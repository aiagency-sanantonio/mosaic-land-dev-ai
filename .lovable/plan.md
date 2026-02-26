

## Increase OCR Concurrency to 5

A single-line change to `supabase/functions/ocr-process/index.ts`:

**Change**: Update the `CONCURRENCY` constant from `3` to `5` (line 12).

This means the 10-file batch will now process in 2 groups of 5 instead of 3-4 groups of 3, cutting total batch time roughly in half. Memory usage will increase but should remain within limits since 5 concurrent files is still well under the ~150MB ceiling for most document sizes.

