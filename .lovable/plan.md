

## Diagnosis: UI is correct, but no job is running

### What's actually happening

1. **UI shows the truth**: 13,383 success / 22,539 skipped / 67,309 total. These numbers come straight from `indexing_status` and they aren't moving because nothing is being indexed right now.

2. **No active job**: The most recent `indexing_jobs` row was marked `completed` on **2026-04-15 16:20** (yesterday). Every cron tick since then logs:
   ```
   Cron invocation — checking for running job
   No running job found, skipping
   ```
   The batch-index function only does work when there's a row in `indexing_jobs` with `status = 'running'`. There isn't one.

3. **There's still real work to do**: My RPC just returned **518 unindexed live files** (outside `_ARCHIVED/`). They're sitting there waiting, but nothing is picking them up.

4. **The "67,309 total" denominator is misleading** — it includes the ~31k archived files we decided to exclude. Those will never move from the "unindexed" bucket because the RPC filters them out, but the UI math still counts them as the universe. That's why progress looks frozen at 54% even when we catch up on live files.

### Why the job ended

Yesterday's job logged `last_error: "Unknown error"` and stopped with `remaining: 31288` — that "remaining" was computed *before* we shipped the archive-exclusion RPC. So it thought there were 31k files left, hit some error, and never got restarted.

### Fix plan

**Two small, surgical changes:**

**1. Start a fresh indexing job** (one-shot)
   - Insert a new row into `indexing_jobs` with `status = 'running'` so the next cron tick picks it up.
   - Or trigger it via the existing "Start Indexing" button on `/admin/indexing` — same effect, no code needed.

**2. Fix the UI denominator on `/admin/indexing`** (`src/pages/AdminIndexing.tsx`)
   - Change the "indexed" total from `total dropbox_files` to `total dropbox_files WHERE path NOT ILIKE '%/_ARCHIVED/%'`.
   - This way the percentage and "remaining" reflect the actual work the indexer will do, instead of including 30k files we've intentionally excluded.
   - Optional: add a small subtitle like *"+30,771 archived files excluded"* so the exclusion is visible, not hidden.

**3. (Optional) Auto-restart guard in `batch-index`**
   - When a job ends with an error and there are still unindexed live files, log a clear warning. Right now `last_error: "Unknown error"` tells us nothing — we should capture the actual exception message so next time we can debug instead of guessing.

### Files to touch

| File | Change |
|------|--------|
| `indexing_jobs` table | Insert a new running job (can be done from the UI button — no migration needed) |
| `src/pages/AdminIndexing.tsx` | Exclude `_ARCHIVED` paths from the "total files" denominator + show excluded count |
| `supabase/functions/batch-index/index.ts` | Improve error logging so `last_error` captures the real exception |

### What I'd like you to do first

Go to `/admin/indexing` and click **Start Indexing** (or whichever button kicks off a new job). That alone should unstick the 518 live files within a couple of minutes thanks to the speed optimizations we just shipped. Then I'll fix the denominator math and error logging so this is easier to diagnose next time.

