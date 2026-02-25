

## Fix OCR Pipeline: Two Issues

### Issue 1: Reset images have NULL error_message (blocking)
When we reset the 47 image files, we cleared `error_message` to NULL. But the OCR function filters for files where `error_message IN ('Non-vectorizable format: .jpg', 'Non-vectorizable format: .png', ...)`. Those 47 files are now invisible to the pipeline.

**Fix**: Run a SQL update to restore the correct error messages based on file extension for those 47 files:
```sql
UPDATE indexing_status 
SET error_message = 'Non-vectorizable format: .' || 
  LOWER(REVERSE(SPLIT_PART(REVERSE(file_name), '.', 1)))
WHERE status = 'skipped' 
  AND error_message IS NULL 
  AND file_name ~* '\.(png|jpg|jpeg|gif|webp|tiff|tif|bmp)$';
```

### Issue 2: Mistral OCR PDF API changed (separate bug)
The Mistral OCR API now expects `type: 'file'` instead of `type: 'file_id'` for uploaded PDF documents. The error is clear:
> Input should be 'file' ... "input":"file_id"

**Fix** in `supabase/functions/ocr-process/index.ts`, line 127: Change `type: 'file_id'` to `type: 'file'`.

### Summary
- Step 1: Fix `ocrPdf()` function to use `type: 'file'` (line 127)
- Step 2: Restore error_message values for the 47 reset image files so the cron picks them up
- The cron will then automatically process them with the new description feature

