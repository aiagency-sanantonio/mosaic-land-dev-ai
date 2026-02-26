
## Undo All OCR-Processed Images

### Current State
- **2,766 images** marked as `success` in `indexing_status` (OCR-processed with Mistral)
- **1,077 images** marked as `failed` (mostly 429 rate limit errors)
- **4,919 document chunks** in `documents` table from OCR-processed images
- **1,094 images** still `skipped`

### What We'll Do

**Step 1: Delete all OCR image chunks from the `documents` table**
Remove all document chunks that came from OCR-processed image files (where `metadata->>'ocr_source' = 'mistral'` and file is an image).

**Step 2: Reset all image files in `indexing_status` back to `skipped`**
Set all image files (success + failed) back to `status = 'skipped'` with their original `Non-vectorizable format: .ext` error message, clear `chunks_created`, `indexed_at`, and OCR metadata. This puts them back in the queue for when the OCR function is fixed and ready to re-process.

### Technical Details

Two data operations (no schema changes):

```sql
-- 1. Delete OCR image chunks from documents
DELETE FROM documents 
WHERE metadata->>'ocr_source' = 'mistral' 
  AND file_name ~* '\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp)$';

-- 2. Reset image indexing_status entries back to skipped
UPDATE indexing_status 
SET status = 'skipped',
    chunks_created = 0,
    indexed_at = NULL,
    metadata = '{}',
    error_message = 'Non-vectorizable format: .' || LOWER(REVERSE(SPLIT_PART(REVERSE(file_name), '.', 1)))
WHERE file_name ~* '\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp)$'
  AND status IN ('success', 'failed');
```

This resets ~3,843 image files (2,766 success + 1,077 failed) and removes ~4,919 document chunks.
