
# Background Indexing with Persistent Status

## Problem
Currently, the indexing loop runs entirely in your browser. If you close the tab or leave, it stops. There's no way to know the outcome when you return.

## Solution
Move the batch loop to the server using a scheduled database job (pg_cron). The UI will poll for status and show whether indexing is running, completed, or failed.

## How It Works

1. **New `indexing_jobs` table** -- tracks each indexing run with fields like `status` (running / completed / failed / stopped), `started_at`, `stats` (JSON with processed/skipped/failed counts), and `last_error`.

2. **pg_cron job** -- a recurring schedule (every 30 seconds) that calls the `batch-index` function. The function checks if there's a job in "running" state; if so, it processes one batch of 3 files and updates the job row. If no running job exists, the cron invocation does nothing.

3. **Start/Stop from the UI** -- clicking "Start Indexing" creates a new job row with status "running". Clicking "Stop" sets it to "stopped". The cron job picks up on this automatically.

4. **UI polls for status** -- the admin page polls the `indexing_jobs` table every 5 seconds to show real-time progress, even after you navigate away and come back.

## Technical Details

### 1. Database migration
Create an `indexing_jobs` table:
```
- id (uuid, PK)
- status (text): running | completed | failed | stopped
- started_at, completed_at (timestamptz)
- stats (jsonb): { totalProcessed, totalSkipped, totalFailed, remaining, batchesCompleted }
- last_error (text, nullable)
- created_at, updated_at (timestamptz)
```
RLS: authenticated users can SELECT; service role can manage.

### 2. Enable pg_cron + pg_net and create schedule
A cron job every 30 seconds calls `batch-index` with a body flag `{ "cron": true }` so the function knows it's a server-side invocation.

### 3. Update `batch-index` edge function
- Accept a `cron: true` flag in the request body.
- When `cron` is true: check for a running job in `indexing_jobs`. If none, return early. If found, process one batch of 3 files, update the job's `stats` and `last_error`. If remaining hits 0, set status to "completed". If an unrecoverable error occurs, set status to "failed".
- The existing browser-based loop path continues to work as before for backwards compatibility.

### 4. Update `AdminIndexing.tsx`
- On mount, query `indexing_jobs` for the latest job to restore state (running/completed/failed).
- Poll every 5 seconds while a job is running.
- "Start Indexing" inserts a new job row (status: running) instead of looping in the browser.
- "Stop" updates the job status to "stopped".
- Show a banner for completed/failed status with the final stats.
- Activity log populated from `indexing_status` table (most recent entries) rather than in-memory state.

### 5. Config update
Add `verify_jwt = false` for batch-index if not already present (it is).

## User Experience
- Click "Start Indexing" -- job begins on the server.
- Close the browser, go have lunch.
- Come back, open the page -- see "Indexing in progress: 1,234 processed, 89 skipped, 2 failed, 3,400 remaining" or "Indexing complete!" or "Indexing failed: [error message]".
- Click "Stop" at any time to pause. Click "Resume" to create a new job that picks up where it left off.
