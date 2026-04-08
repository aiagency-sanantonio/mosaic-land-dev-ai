

## Diagnosis: Nightly Sync and Indexing Are Completely Broken

### The Problem

Both cron jobs (`nightly-dropbox-sync` and `nightly-batch-index`) have been **failing every single night** with this error:

```text
ERROR: function extensions.http_post(url => unknown, headers => jsonb, body => jsonb) does not exist
```

The jobs call `extensions.http_post(...)` but the installed extension is `pg_net`, which exposes `net.http_post(...)` — not `extensions.http_post()`. Every run since the jobs were created has failed silently.

### Current State

- **Last Dropbox sync**: April 3 (manual run from the admin dashboard)
- **Last file indexed**: March 25
- **Indexed**: 27,291 files (10,849 success, 16,345 skipped, 97 failed)
- **Unindexed**: ~40,018 files
- **Indexing process itself**: Not compromised — when triggered manually it works fine. Only the automated nightly trigger is broken.

### Fix: Update Both Cron Jobs

Drop the existing broken jobs and recreate them using the correct `net.http_post` function signature.

**Step 1 — Drop old jobs:**
```sql
SELECT cron.unschedule('nightly-dropbox-sync');
SELECT cron.unschedule('nightly-batch-index');
```

**Step 2 — Recreate with correct function:**
```sql
SELECT cron.schedule(
  'nightly-dropbox-sync',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://movtatkeydoydorkzfbi.supabase.co/functions/v1/sync-dropbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'nightly-batch-index',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://movtatkeydoydorkzfbi.supabase.co/functions/v1/batch-index',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"cron": true}'::jsonb
  ) AS request_id;
  $$
);
```

These must be run via the SQL insert tool (not migrations) since they contain project-specific URLs and keys.

### Regarding the 40k Unindexed Files

The indexing process itself is healthy — the last manual run on Feb 21 processed thousands of files successfully. Once the cron jobs are fixed:
- The nightly sync will pick up any new/modified Dropbox files
- The nightly batch-index will start chewing through the backlog automatically (it self-chains in batches of 10)
- At ~10 files per batch with self-chaining, it will take a while for 40k files, but you can also trigger manual batch runs from the admin dashboard to speed things up

### Summary

| Item | Status |
|------|--------|
| Dropbox sync function | Healthy (works when called manually) |
| Batch indexing function | Healthy (works when called manually) |
| Nightly cron triggers | **Broken** — wrong function name (`extensions.http_post` vs `net.http_post`) |
| Fix complexity | Small — two SQL statements to recreate the jobs |

