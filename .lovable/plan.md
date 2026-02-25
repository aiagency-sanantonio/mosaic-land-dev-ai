

## Fix Stalled Structured Data Extraction

### Problem
The extraction self-chaining loop keeps dying because processing 50 files sequentially (each requiring an OpenAI API call taking 2-5 seconds) exceeds the edge function's execution time limit. Once the chain breaks, processing stops entirely -- there's no cron job to restart it like batch-index has.

### Solution

**1. Reduce batch size in the edge function to 10 files** (from 50)

10 files at ~3-5 seconds each = 30-50 seconds, which fits within the edge function timeout. This keeps the self-chain alive.

**2. Add auto-polling to the Admin UI**

When the user clicks "Run Extraction", start a polling interval (every 15 seconds) that:
- Refreshes the extraction progress counts from the database
- If progress stalls (no change after 3 polls), auto-retriggers the edge function to restart the chain
- Stops polling when all files are done or the user navigates away

**3. Update the UI button to show live progress while running**

- Show a "running" state with a spinner while the extraction is actively processing
- Auto-refresh the progress bar during extraction
- Display the current rate (files/minute) based on progress changes

### Technical Changes

**Edge function (`supabase/functions/extract-structured-data/index.ts`):**
- Change default batch_size from 50 to 10
- Reduce self-chain delay from 500ms to 200ms for faster cycling

**Admin UI (`src/pages/AdminIndexing.tsx`):**
- Add a `useEffect` polling interval when extraction is active
- Track `extractionRunning` state that persists across polls
- Auto-retrigger the function if progress stalls (same count for 3 consecutive polls)
- Add a "Stop" button for extraction
- Show estimated time remaining for extraction based on observed rate

### File Changes
1. `supabase/functions/extract-structured-data/index.ts` -- reduce batch_size default
2. `src/pages/AdminIndexing.tsx` -- add polling/auto-restart logic for extraction

