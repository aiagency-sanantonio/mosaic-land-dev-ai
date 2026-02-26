

## Fix: OCR Memory Limit Exceeded

### Problem
The parallel processing change (all 10 files via `Promise.allSettled`) downloads 10 images into memory simultaneously, converts them to base64, and fires 10 OpenAI Vision requests at once. Each image can be several MB, so holding all 10 in memory at once exceeds the edge function's ~150MB memory limit.

### Solution
Add a **concurrency limiter** that processes files in groups of 3. The batch size stays at 10 (meaning 10 files per cron cycle), but only 3 run in parallel at any time. This keeps memory usage manageable while still being 3x faster than fully sequential.

### Changes

**File: `supabase/functions/ocr-process/index.ts`**

1. Add a `processInGroups` helper function that splits an array into chunks of N and runs each chunk with `Promise.allSettled` sequentially:

```text
async function processInGroups<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<PromiseSettledResult<string>>
): Promise<PromiseSettledResult<string>[]> {
  const results: PromiseSettledResult<string>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const group = items.slice(i, i + concurrency);
    const groupResults = await Promise.allSettled(group.map(fn));
    results.push(...groupResults);
  }
  return results;
}
```

2. Replace the current `Promise.allSettled(files.map(...))` (lines 306-369) with `processInGroups(files, 3, ...)` so only 3 files are in memory at once.

3. Add a `CONCURRENCY` constant set to 3 alongside the existing `BATCH_SIZE = 10`.

This gives us 10 files per batch cycle with 3 concurrent at a time -- roughly 3-4 groups per cycle, each completing in ~15 seconds, for ~45-60 seconds total (well within edge function limits).

