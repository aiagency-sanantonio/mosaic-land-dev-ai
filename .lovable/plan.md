

## Reset Failed Files for Re-indexing

Since you've updated the Dropbox token, we need to reset the files that failed due to the expired token so they'll be picked up again by the indexing process.

### What will happen

A database update will clear the status of files that failed with token-related errors, setting them back to "pending" so they re-enter the indexing queue on the next batch run.

### Technical details

Run a SQL update against the `indexing_status` table:

```sql
DELETE FROM indexing_status 
WHERE status = 'failed' AND error_message LIKE '%invalid_access_token%';
```

We use `DELETE` rather than `UPDATE` because the `get_unindexed_dropbox_files` RPC looks for files with no entry in `indexing_status`. Removing the failed records puts those files back into the "unindexed" pool automatically.

We will also reset the 571 files that were incorrectly skipped with "Insufficient content" from the old extraction logic:

```sql
DELETE FROM indexing_status 
WHERE status = 'skipped' AND error_message LIKE 'Insufficient content%';
```

After this, navigate to /admin/indexing and resume indexing.

