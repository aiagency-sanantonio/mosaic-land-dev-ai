
## Reset Mistral OCR + Failed Files for OpenAI Reprocessing

### What
Reset 7,236 files in the `indexing_status` table back to `skipped` status so they are eligible for reprocessing by the new OpenAI Vision pipeline.

### Two SQL Updates

**1. Reset 4,173 Mistral-processed files**
- Target: files with `status = 'success'` and `metadata->>'ocr_source' = 'mistral'`
- Set `status` to `'skipped'`, clear `chunks_created`, `indexed_at`, `error_message`
- Clear `ocr_source` from metadata
- Also delete their existing document chunks from the `documents` table (so we don't get duplicates when reprocessed)

**2. Reset 3,063 failed files**
- Target: files with `status = 'failed'`
- Set `status` to `'skipped'`, clear `error_message`, `chunks_created`, `indexed_at`

### Steps
1. Delete document chunks for the 4,173 Mistral files (match on `file_path`)
2. Update those 4,173 records to `status = 'skipped'`
3. Update the 3,063 failed records to `status = 'skipped'`

No code or schema changes needed -- these are data updates only.
