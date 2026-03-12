

# Fix: `list-filter-options` Memory Crash

## Problem
The function fetches ALL rows from the `documents` table into edge function memory to extract unique values. With 19,000+ document chunks, this exceeds the 150MB memory limit.

## Solution
Replace the JavaScript-side aggregation with a single SQL database function that computes distinct values server-side, returning only the small unique lists.

### Step 1: Create a database function `get_filter_options`
A single SQL function that runs three aggregation queries and returns the results as JSON — no large data transfer to the edge function.

```sql
CREATE OR REPLACE FUNCTION public.get_filter_options()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'projects', (
      SELECT jsonb_agg(row_to_json(p) ORDER BY p.name)
      FROM (
        SELECT 
          split_part(file_path, '/', 3) AS name,
          count(*) AS chunk_count
        FROM documents
        WHERE file_path LIKE '/1-Projects/%'
          AND split_part(file_path, '/', 3) != ''
        GROUP BY split_part(file_path, '/', 3)
        ORDER BY name
      ) p
    ),
    'doc_types', (
      SELECT jsonb_agg(row_to_json(d) ORDER BY d.type)
      FROM (
        SELECT 
          metadata->>'doc_type' AS type,
          count(*) AS chunk_count
        FROM documents
        WHERE metadata->>'doc_type' IS NOT NULL
        GROUP BY metadata->>'doc_type'
        ORDER BY type
      ) d
    ),
    'file_types', (
      SELECT jsonb_agg(row_to_json(f) ORDER BY f.extension)
      FROM (
        SELECT 
          lower(regexp_replace(file_name, '.*\.', '')) AS extension,
          count(*) AS chunk_count
        FROM documents
        WHERE file_name IS NOT NULL
          AND file_name LIKE '%.%'
        GROUP BY lower(regexp_replace(file_name, '.*\.', ''))
        ORDER BY extension
      ) f
    )
  ) INTO result;
  
  RETURN result;
END;
$$;
```

### Step 2: Rewrite `list-filter-options/index.ts`
Replace all the pagination + JavaScript aggregation with a single RPC call:

```typescript
const { data, error } = await supabase.rpc('get_filter_options');
```

Return `data` directly. The response shape stays identical so N8N needs no changes.

### Why this works
- SQL aggregation runs server-side — only ~1KB of results transferred instead of 19,000+ rows
- No memory pressure on the edge function
- Faster execution (single query vs three paginated loops)

