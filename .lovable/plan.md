

## Optimize OCR Processing: Batch Size 10 + Parallel Processing

### Changes

**File: `supabase/functions/ocr-process/index.ts`**

1. **Increase default batch size** from 5 to 10 (line 10)

2. **Replace sequential `for` loop with `Promise.allSettled`** (lines 306-380)
   - Instead of processing files one-by-one, process all files in the batch concurrently
   - Each file's processing (download, OCR, chunk, embed, insert) becomes a self-contained async function
   - `Promise.allSettled` ensures one failure doesn't cancel the others
   - After settling, iterate results to tally `processed`, `failed`, `skipped` counts and collect errors

### Technical Detail

The sequential loop:
```text
for (const file of files) {
  // download, OCR, embed, insert (one at a time)
}
```

Becomes:
```text
const results = await Promise.allSettled(
  files.map(file => withTimeout(async () => {
    // download, OCR, embed, insert
  }, PER_FILE_TIMEOUT_MS, file.file_name))
);
// tally results from settled promises
```

This means up to 10 OpenAI Vision calls run concurrently. Since each call takes 5-15 seconds, sequential processing of 10 files would take 50-150 seconds (risking edge function timeouts). With parallel processing, the batch completes in roughly the time of the slowest single file.

### Risk Note
OpenAI rate limits for `gpt-4o` are generous (thousands of requests/min on most tiers), so 10 concurrent calls should be well within limits. If rate limiting does occur, the existing retry logic with exponential backoff on embeddings will handle it, and individual file failures won't block the rest thanks to `Promise.allSettled`.

