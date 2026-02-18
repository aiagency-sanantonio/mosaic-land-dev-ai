
## Fix: URL Too Long When Fetching File Details in `query-dropbox-files`

### Root Cause

When `not_yet_indexed: true` (or any path slice is requested), the function calls:

```typescript
supabase
  .from('dropbox_files')
  .select('...')
  .in('file_path', pathSlice)
```

The Supabase JS client sends `.in()` values as a URL query parameter, like:
```
?file_path=in.(/path/one,/path/two,/path/three,...)
```

With hundreds of long Dropbox file paths, this URL grows to thousands of characters and exceeds browser/HTTP URL length limits, causing a `TypeError: Invalid URL` and a 500 response.

### The Fix

Batch the `pathSlice` array into chunks of 50 paths and run multiple `.in()` queries in parallel, then merge the results. This keeps each individual URL well within length limits.

```typescript
// Break into batches of 50
const BATCH_SIZE = 50;
const batches = [];
for (let i = 0; i < pathSlice.length; i += BATCH_SIZE) {
  batches.push(pathSlice.slice(i, i + BATCH_SIZE));
}

// Fetch each batch in parallel
const batchResults = await Promise.all(
  batches.map(batch =>
    supabase
      .from('dropbox_files')
      .select('file_path, file_name, ...')
      .in('file_path', batch)
      .order('file_path', { ascending: true })
  )
);

// Merge results
const allRecords = batchResults.flatMap(r => r.data ?? []);
```

### Technical Changes

**File: `supabase/functions/query-dropbox-files/index.ts`**

- Add a `BATCH_SIZE = 50` constant
- Replace the single `.in('file_path', pathSlice)` query with a batched parallel fetch using `Promise.all`
- Merge all batch results into a single `allRecords` array
- Handle errors from any batch (throw on first error)
- No schema changes required
- No changes to the `changed_since_indexed` logic
