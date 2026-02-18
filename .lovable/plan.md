
## Fix: `not_yet_indexed` Filter in `query-dropbox-files`

### What's Broken

There are two bugs in `supabase/functions/query-dropbox-files/index.ts`:

**Bug 1 — Wrong summary count (causes the `0` you're seeing)**

The `not_yet_indexed` count in the summary is calculated as:
```
totalFiles - indexedCount = 798 - 1400 = -602 → clamped to 0
```

The problem: `indexedCount` is the total number of rows in `indexing_status` with `status = success` (1,400), which is *larger* than the number of Dropbox files logged (798). This happens because `indexing_status` keeps history for files that were indexed before the `dropbox_files` table even existed.

The correct count is: how many `dropbox_files` paths are **not present** in the success set — not a raw subtraction.

**Bug 2 — Filter applied after a small page fetch**

When `not_yet_indexed: true` but `fetch_all: false`, the function fetches only the first `limit` rows (e.g. 100), then filters them in memory. If all 100 of those rows happen to be indexed, you get 0 results back — even though later pages may have un-indexed files.

---

### The Fix

**Fix 1 — Correct the summary count**

Instead of subtracting counts, count how many `dropbox_files` paths are actually missing from `indexedSet`:

```typescript
// Fetch all dropbox file paths (just the paths, lightweight)
const { data: allPaths } = await supabase
  .from('dropbox_files')
  .select('file_path');

const notYetIndexedCount = (allPaths ?? []).filter(
  r => !indexedSet.has(r.file_path)
).length;

const summary = {
  total_files: totalFiles,
  indexed: indexedCount,  // how many dropbox files ARE in the success set
  not_yet_indexed: notYetIndexedCount,
};
```

**Fix 2 — Apply `not_yet_indexed` filter before pagination**

When `not_yet_indexed: true`, fetch all matching `file_path` values first, filter them against `indexedSet`, then slice to the requested page. This ensures pagination is correct even when most records are already indexed.

The revised flow:
1. Fetch all file paths (all records, lightweight — just `file_path`)
2. Filter against `indexedSet` in memory
3. Apply `extension_filter` and `path_prefix` in memory on the filtered set
4. Slice to the requested `offset` + `limit` (or return all if `fetch_all: true`)
5. Fetch full details only for the sliced paths

This avoids the "filter after a partial page" problem entirely.

---

### Technical Changes

**File: `supabase/functions/query-dropbox-files/index.ts`**

- Rewrite the summary calculation to count actual `dropbox_files` paths not in `indexedSet`
- When `not_yet_indexed: true`, fetch all file paths first, filter in memory, then paginate — rather than paginating first and filtering after
- The `changed_since_indexed` logic is not affected and stays the same
- No database schema changes required
