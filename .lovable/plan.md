

## Flag 5,256 Skipped PDFs for OCR Processing

### What
Update the ~5,256 `indexing_status` records that are currently `status = 'skipped'` with a `NULL` error_message so the OCR pipeline recognizes them as eligible.

### How
Run a single SQL UPDATE (via the insert tool) to set their `error_message` to `'Scanned/image-only PDF - no extractable text'` -- the exact trigger string the `ocr-process` edge function looks for when selecting eligible files.

```sql
UPDATE indexing_status
SET error_message = 'Scanned/image-only PDF - no extractable text',
    status = 'skipped'
WHERE status = 'skipped'
  AND error_message IS NULL;
```

### Why this works
The `ocr-process` function filters for files where `error_message = 'Scanned/image-only PDF - no extractable text'` and `status = 'skipped'`. By setting that exact string, these PDFs will be picked up in subsequent OCR batch runs automatically -- no code changes needed.

### Risk
None -- this is a data-only change. The OCR pipeline will process them in batches of 10 (5 concurrent) as usual, so it won't overload anything.

