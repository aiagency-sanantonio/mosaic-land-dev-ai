

## Fix: Batch Indexing Infinite Loop

### Problem

The indexing is stuck in an infinite loop processing the same 3 image files every batch. Two root causes:

1. **Database function only skips "success" files**: The `get_unindexed_dropbox_files` RPC joins on `indexing_status` filtering `status = 'success'` only. Files marked as "skipped" or "failed" are returned again on every call.

2. **No unique constraint on `file_path`**: The `upsert` call uses `onConflict: 'file_path'`, but there is no unique constraint on that column, so the upsert silently fails and no record gets saved.

### Fix (2 changes)

**1. Add a unique constraint on `indexing_status.file_path`**

Database migration:
```sql
ALTER TABLE indexing_status 
ADD CONSTRAINT indexing_status_file_path_unique UNIQUE (file_path);
```

This makes the `upsert(..., { onConflict: 'file_path' })` actually work.

**2. Update the `get_unindexed_dropbox_files` RPC to exclude ALL indexed files**

Change the LEFT JOIN condition from filtering only `status = 'success'` to including any status. This way, once a file is marked as skipped, failed, or success, it won't be returned again.

```sql
CREATE OR REPLACE FUNCTION public.get_unindexed_dropbox_files(...)
  -- Change: remove "AND ist.status = 'success'" from the JOIN
  LEFT JOIN indexing_status ist ON df.file_path = ist.file_path
  WHERE ist.file_path IS NULL
  ...
```

### Technical Details

- **File:** No code file changes needed -- the edge function code is already correct
- **Database:** Two migrations: one for the unique constraint, one to update the RPC
- After these fixes, the existing function will correctly skip image files once and move on to PDFs, text files, etc.

