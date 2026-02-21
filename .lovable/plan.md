

# Fix: Inflated Progress Stats and Review Failed/Skipped Files

## The Problem

The admin dashboard shows **inflated processed/skipped counts** because the job-level stats (`indexing_jobs.stats`) accumulate across multiple job runs independently, while files are only processed once (tracked via `indexing_status`). The stopped job shows 13,828 processed and 25,320 skipped, but the real numbers are much lower.

### Actual Database Truth (`indexing_status` table)

| Status | Count | Notes |
|--------|-------|-------|
| Success | 8,394 | Produced 260,514 document chunks |
| Skipped | 13,761 | Legitimate reasons (see below) |
| Failed | 82 | Mostly retryable (see below) |
| Remaining | 5,011 | Still unindexed |
| **Total** | **27,256** | Total Dropbox inventory |

### Why the dashboard shows wrong numbers

The progress card reads from `indexing_jobs.stats`, which is a running counter per job. When jobs are stopped and restarted, the new job starts counting from zero but processes different files than the old job counted. The old stopped job shows `totalProcessed: 13,828` -- nearly double the real `8,394`.

## Skipped Files Breakdown (all legitimate)

| Reason | Count |
|--------|-------|
| Scanned/image-only PDFs (no text) | 6,913 |
| PDFs over 5MB size limit | 1,941 |
| Images (.jpg, .jpeg, .png, .tif, .heic, .dng) | 3,168 |
| CAD/GIS files (.dwg, .dgn, .shx, .kmz) | 471 |
| Videos (.mov, .mp4) | 80 |
| Old Office (.doc) | 205 |
| Archives (.zip) | 125 |
| Email/system (.msg, .bak, .mjs, .ttf) | 258 |
| Insufficient text (under 50 chars) | 307 |
| Other formats | ~293 |

All skips are legitimate -- these are either non-text files or scanned PDFs without extractable text.

## Failed Files Breakdown (82 total)

| Error | Count | Retryable? |
|-------|-------|------------|
| Unknown error (timeout/crash) | 65 | Yes |
| Dropbox rate limit (429) | 9 | Yes |
| OpenAI connection reset | 3 | Yes |
| OpenAI API 403 | 2 | Investigate |
| Dropbox token expired (401) | 1 | Yes |
| Other | 2 | Yes |

**All but the 2 OpenAI 403 errors are transient and retryable.**

## Fix: Use Real Database Counts in the Dashboard

The fix is to make the AdminIndexing page read actual counts from the `indexing_status` table instead of relying on the inflated `indexing_jobs.stats` JSON.

### Changes

**1. `src/pages/AdminIndexing.tsx`**
- Add a new `fetchRealStats()` function that queries `indexing_status` grouped by status
- Display these real counts in the Progress card instead of `job.stats`
- Keep the job status/banner as-is (running/stopped/failed)
- Calculate "remaining" as total dropbox_files minus total indexed

**2. Reset the 82 failed files for retry**
- Delete the 82 failed `indexing_status` records so they get picked up by the currently running job
- The transient errors (rate limits, timeouts) will likely succeed on retry

**3. Note: A job is currently running**
- Job `88ece950` started at 20:20 UTC and has processed 25 files so far with 5,008 remaining
- It is actively working through the backlog right now

## Technical Details

**`src/pages/AdminIndexing.tsx` changes:**

```typescript
// Add a new state for real stats from indexing_status
const [realStats, setRealStats] = useState({ success: 0, skipped: 0, failed: 0, total: 0 });

// Fetch real counts from database
const fetchRealStats = useCallback(async () => {
  const { data: statusCounts } = await supabase
    .from('indexing_status')
    .select('status');
  // Count by status...
  
  const { count: totalFiles } = await supabase
    .from('dropbox_files')
    .select('*', { count: 'exact', head: true });
  // Calculate remaining = totalFiles - (success + skipped + failed)
}, []);
```

- Replace the Progress card's stats with `realStats` values
- Keep the job-level ETA/rate calculation since that's per-session and valid

**Database cleanup:**
- Delete all 82 failed records from `indexing_status` to allow retry
