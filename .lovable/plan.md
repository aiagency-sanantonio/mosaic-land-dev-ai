

## Fix: Eliminate URL Length Issue in query-dropbox-files

### Root Cause

The `.in('file_path', batch)` approach puts file paths into the URL as query parameters. Your Dropbox paths are extremely long (~250 characters each URL-encoded), so even batches of 50 paths create URLs of 12,500+ characters. The Supabase REST API / Deno runtime rejects these as invalid URLs.

### The Fix

Replace the client-side filtering + `.in()` approach with a **server-side SQL function** that does a LEFT JOIN between `dropbox_files` and `indexing_status` directly in the database. This eliminates the need to pass any file paths in URLs.

### Step 1: Create a database function

Create an RPC function `get_unindexed_dropbox_files` that:
- LEFT JOINs `dropbox_files` with `indexing_status` (on `file_path`)
- Filters to rows where `indexing_status` has no match (i.e., not yet indexed)
- Supports optional `extension_filter` and `path_prefix` parameters
- Supports `p_limit` and `p_offset` for pagination, or returns all when `p_limit = 0`

```sql
CREATE OR REPLACE FUNCTION public.get_unindexed_dropbox_files(
  p_extension_filter text DEFAULT NULL,
  p_path_prefix text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  file_path text,
  file_name text,
  file_extension text,
  file_size_bytes bigint,
  dropbox_id text,
  content_hash text,
  dropbox_modified_at timestamptz,
  discovered_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    df.file_path,
    df.file_name,
    df.file_extension,
    df.file_size_bytes,
    df.dropbox_id,
    df.content_hash,
    df.dropbox_modified_at,
    df.discovered_at,
    df.last_seen_at
  FROM dropbox_files df
  LEFT JOIN indexing_status ist ON df.file_path = ist.file_path AND ist.status = 'success'
  WHERE ist.file_path IS NULL
    AND (p_extension_filter IS NULL OR df.file_extension = p_extension_filter)
    AND (p_path_prefix IS NULL OR df.file_path LIKE p_path_prefix || '%')
  ORDER BY df.file_path ASC
  LIMIT CASE WHEN p_limit = 0 THEN NULL ELSE p_limit END
  OFFSET p_offset;
$$;
```

### Step 2: Update the edge function

**File: `supabase/functions/query-dropbox-files/index.ts`**

Replace the `not_yet_indexed` branch (which currently fetches all paths, filters in memory, then uses `.in()`) with a single `.rpc()` call:

```typescript
if (not_yet_indexed) {
  const rpcParams: Record<string, unknown> = {
    p_extension_filter: extension_filter ?? null,
    p_path_prefix: path_prefix ?? null,
    p_limit: fetch_all ? 0 : limit,
    p_offset: fetch_all ? 0 : offset,
  };

  const { data, error: rpcError } = await supabase
    .rpc('get_unindexed_dropbox_files', rpcParams);

  if (rpcError) throw rpcError;
  allRecords = data ?? [];
}
```

This replaces approximately 40 lines of complex client-side logic (path fetching, in-memory filtering, batching, parallel queries) with a single efficient database call. No file paths are passed in URLs.

### Step 3: Redeploy

Deploy the updated `query-dropbox-files` edge function.

### Why This Is Better

- **No URL length limits**: The RPC call sends parameters in the POST body, not the URL
- **Much faster**: The database does the JOIN instead of the edge function fetching thousands of rows and filtering in memory
- **Simpler code**: Removes ~40 lines of complex batching/filtering logic
- **Scales**: Works regardless of how many files or how long the paths are

### Summary of Changes

1. **New database migration**: Creates `get_unindexed_dropbox_files` SQL function
2. **Update `supabase/functions/query-dropbox-files/index.ts`**: Replace the `not_yet_indexed` branch with a single `.rpc()` call; keep the summary calculation and `changed_since_indexed` logic unchanged
3. **Deploy**: Redeploy the edge function
