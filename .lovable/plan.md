

## Reset Processed Images for Re-Processing with Descriptions

### What needs to happen

47 image files were already OCR-processed without the new image description feature. To re-process them:

1. **Delete existing document chunks** for image files from the `documents` table (47 rows)
2. **Reset indexing_status** for those same image files back to `skipped` status with `chunks_created = 0`, clearing the `indexed_at` timestamp so the OCR pipeline picks them up again automatically

### Steps

**Step 1: Delete old document chunks for image files**
```sql
DELETE FROM documents 
WHERE file_name ~* '\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp|heic)$';
```

**Step 2: Reset indexing_status for those image files**
```sql
UPDATE indexing_status 
SET status = 'skipped', 
    chunks_created = 0, 
    error_message = NULL, 
    indexed_at = NULL, 
    metadata = '{}'::jsonb
WHERE file_name ~* '\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp|heic)$'
  AND status = 'success';
```

### What happens next

The `ocr-process-cron` safety net fires every minute. It will automatically pick up these 47 files (now marked as `skipped`) and re-process them through the updated OCR pipeline, which includes both text extraction and image description via Pixtral.

No code changes needed -- just two data operations.

