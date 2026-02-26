

## Emergency Stop: Kill All Background Processing

### Step 1: Unschedule all 3 cron jobs
Run SQL to remove the cron triggers so nothing fires again:
```sql
SELECT cron.unschedule('batch-index-cron');
SELECT cron.unschedule('ocr-process-cron');
SELECT cron.unschedule('extract-structured-data-cron');
```

### Step 2: Break the self-chaining loops
Edit the `ocr-process` edge function to add an early-exit "kill switch" that checks a flag before processing. This ensures any in-flight self-chain calls also stop immediately.

Add a check at the top of the handler: query a simple flag (e.g., check if a specific row exists in `indexing_jobs` with status `'stopped'`), and if so, return immediately without processing or self-chaining.

### Step 3: Audit the UI accuracy issue
After stopping everything, investigate the Admin dashboard to understand why progress reporting is inaccurate -- this will be a separate follow-up task.

### What this fixes
- Immediately stops all cron-triggered invocations (no more every-minute calls)
- Stops self-chaining loops from continuing
- Prevents any further OpenAI API charges
- Leaves data intact so processing can be resumed later when the UI is fixed

