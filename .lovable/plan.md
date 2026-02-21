
# Fix: Progress Bar Shows Wrong Numbers (1000-Row Limit)

## Root Cause

The `fetchRealStats()` function in `AdminIndexing.tsx` queries the `indexing_status` table with `.select('status')`, which returns at most **1000 rows** (the default Supabase limit). With 22,216+ rows in that table, the dashboard only counts the first 1000, showing ~564 processed and ~538 skipped instead of the actual 8,425 and 13,781.

## Fix

Replace the client-side row-by-row counting with a **server-side count** approach. Instead of fetching all rows and counting in JavaScript, use three separate HEAD requests with `count: 'exact'` and a status filter -- one for each status. This returns just the count without transferring any row data.

## Technical Details

**File: `src/pages/AdminIndexing.tsx` -- `fetchRealStats` function (lines 69-93)**

Replace the current approach:
```typescript
// BEFORE (broken -- limited to 1000 rows)
const [statusRes, totalRes] = await Promise.all([
  supabase.from('indexing_status').select('status'),
  supabase.from('dropbox_files').select('*', { count: 'exact', head: true }),
]);
// ... manually count statuses from statusRes.data
```

With exact count queries:
```typescript
// AFTER (correct -- uses server-side counting)
const [successRes, skippedRes, failedRes, totalRes] = await Promise.all([
  supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success'),
  supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'skipped'),
  supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
  supabase.from('dropbox_files').select('*', { count: 'exact', head: true }),
]);

const success = successRes.count ?? 0;
const skipped = skippedRes.count ?? 0;
const failed = failedRes.count ?? 0;
const totalDropbox = totalRes.count ?? 0;
const remaining = Math.max(0, totalDropbox - success - skipped - failed);

setRealStats({ success, skipped, failed, totalDropbox, remaining });
```

This uses `head: true` so no row data is transferred -- only the count is returned in the response header. No row limit applies.

No other files need changes.
