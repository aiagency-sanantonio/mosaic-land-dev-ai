
# Speed Up Background Indexing

## Problem
At 3 files per minute, indexing 26,700 remaining files will take over 6 days.

## Solution
Two changes to dramatically increase throughput:

### 1. Increase batch size from 3 to 10
Most files are quick (text files finish in under a second, skipped files are instant). Only PDFs and Office docs take significant time. A batch of 10 is safe within the edge function timeout since the per-file timeout (45s) only applies to slow files, and most files complete in 1-2 seconds.

**Result:** 10 files/minute instead of 3 -- roughly 3x faster on its own.

### 2. Self-chaining for continuous processing
After the function finishes a batch, if there are still files remaining and the job is still "running," it immediately fires another call to itself using `pg_net.http_post`. This creates a continuous processing chain without waiting for the next cron tick. The cron job (every 1 minute) acts as a safety net to restart the chain if it ever breaks.

**Result:** Instead of waiting 60 seconds between batches, the next batch starts within 1-2 seconds of the previous one finishing. With 10 files per batch and near-continuous execution, throughput jumps to roughly 100+ files per minute.

**Estimated time:** Under 6 hours for the remaining 26,700 files (vs 6 days currently).

## Technical Details

### Edge function changes (`supabase/functions/batch-index/index.ts`)
- Change `BATCH_SIZE` from 3 to 10
- After processing a batch in the cron path, if `remaining > 0` and the job is still running, use `fetch()` to call itself with `{"cron": true}` (fire-and-forget using the same function URL and anon key from env vars)
- Add a small delay (500ms) before the self-call to avoid overwhelming the system

### No database or cron schedule changes needed
The existing cron job and `indexing_jobs` table work as-is. The cron just becomes a fallback to restart the chain if it ever stalls.

### UI change (`src/pages/AdminIndexing.tsx`)
- Add an estimated time remaining display based on processing rate (files processed / elapsed time)
