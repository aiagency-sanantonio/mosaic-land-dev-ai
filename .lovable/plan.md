

# Fix: sync-dropbox Edge Function Timeout

## Problem
The `sync-dropbox` function is timing out before completing. The error "Failed to send a request to the Edge Function" confirms the function never returns a response. No logs appear because the function is killed before it can finish. Scanning all subfolders under `/1-Projects` recursively exceeds the Edge Function execution time limit (~150-400s depending on tier).

## Solution: Chunked Processing with Client-Side Polling

Split the sync into two modes: (1) a "start" call that lists top-level folders and processes them one at a time via sequential invocations from the client, and (2) a per-folder mode where the Edge Function processes a single folder per call.

### Changes

**1. Update `supabase/functions/sync-dropbox/index.ts`**
- Accept an optional `folder` parameter in the request body
- **No folder provided**: Only list top-level folders under `/1-Projects` (fast, no recursion) and return the folder list
- **Folder provided**: Recursively scan that single folder, upsert its files, and return results for that folder only
- This keeps each invocation short enough to avoid timeouts

**2. Update `src/pages/AdminIndexing.tsx` — Dropbox Sync section**
- Change the button handler to a multi-step process:
  1. Call `sync-dropbox` with no folder → get list of subfolders
  2. Loop through each folder, calling `sync-dropbox` with that folder path
  3. Update the textarea progressively showing "Processing folder X of Y: FolderName..."
  4. Accumulate totals across all folders
  5. Show final summary when complete
- This gives real-time progress feedback and avoids any single call timing out

### Technical Details
- Each per-folder call should complete in under 30 seconds even for large folders
- The client drives the loop, so there's no single long-running Edge Function call
- Errors in individual folders are collected and shown but don't stop the overall sync
- The loading spinner and button disabled state persist throughout the full loop

