

# Fix: `list-filter-options` edge function crash

## Problem

The error `supabase.rpc(...).throwOnError(...).catch is not a function` occurs because `throwOnError()` on the Supabase JS client returns a `PromiseLike` that doesn't have a `.catch()` method. The code tries to call a non-existent RPC `get_filter_projects` with a `.throwOnError().catch()` fallback pattern that doesn't work.

## Fix

Replace the broken RPC-with-fallback pattern on line 43-48 with a simple direct query. Since `get_filter_projects` doesn't exist as an RPC function anyway, just use the fallback query directly -- query the `documents` table for file paths starting with `/1-Projects/`.

### File: `supabase/functions/list-filter-options/index.ts`

Replace the `Promise.all` block (lines 41-56) to remove the broken `supabase.rpc('get_filter_projects')` call and use the three direct queries instead:

```typescript
const [projectsResult, docTypesResult, fileTypesResult] = await Promise.all([
  // Projects from folder path - direct query
  supabase.from('documents')
    .select('file_path')
    .like('file_path', '/1-Projects/%')
    .limit(1000),
  // Doc types from metadata
  supabase.from('documents')
    .select('metadata')
    .not('metadata->doc_type', 'is', null)
    .limit(1000),
  // File extensions
  supabase.from('documents')
    .select('file_name')
    .not('file_name', 'is', null)
    .limit(1000),
]);
```

This removes the non-existent RPC call and the incompatible `.throwOnError().catch()` chain entirely.

