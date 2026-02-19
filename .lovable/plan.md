
## Fix: Fetch All Unindexed Files Beyond 1000-Row Limit

### Problem
When `fetch_all: true` and `not_yet_indexed: true`, the edge function makes a single RPC call with `p_limit: 0`. While the SQL function removes its own LIMIT, the Supabase REST API silently caps results at 1000 rows. Files beyond 1000 are never returned.

### Solution
Add pagination to the RPC call when `fetch_all` is true, looping in batches of 1000 until all records are retrieved (same pattern already used in the non-RPC branch).

### Technical Details

**File:** `supabase/functions/query-dropbox-files/index.ts`

Replace the `not_yet_indexed` branch (lines 112-125) with paginated logic:

```typescript
if (not_yet_indexed) {
  if (fetch_all) {
    // Paginate through RPC to bypass the 1000-row REST API cap
    const PAGE_SIZE = 1000;
    let pageOffset = 0;
    while (true) {
      const { data: page, error: rpcError } = await supabase
        .rpc('get_unindexed_dropbox_files', {
          p_extension_filter: extension_filter ?? null,
          p_path_prefix: path_prefix ?? null,
          p_limit: PAGE_SIZE,
          p_offset: pageOffset,
        });
      if (rpcError) throw rpcError;
      allRecords.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) break;
      pageOffset += PAGE_SIZE;
    }
  } else {
    const { data, error: rpcError } = await supabase
      .rpc('get_unindexed_dropbox_files', {
        p_extension_filter: extension_filter ?? null,
        p_path_prefix: path_prefix ?? null,
        p_limit: limit,
        p_offset: offset,
      });
    if (rpcError) throw rpcError;
    allRecords = data ?? [];
  }
}
```

### What Changes
- **1 file modified:** `supabase/functions/query-dropbox-files/index.ts` -- add pagination loop for the `fetch_all + not_yet_indexed` case
- **No database changes needed** -- the existing RPC function already supports limit/offset correctly
- **Redeploy** the edge function

### How It Works
Instead of one call expecting all rows, it loops in batches of 1000, accumulating results until a batch returns fewer than 1000 rows (indicating the end). This is the same proven pattern already used in the non-RPC `fetch_all` branch on lines 141-150.
