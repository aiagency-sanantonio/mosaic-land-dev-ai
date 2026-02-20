

## Fix Bulk Indexing: Better PDF Extraction and Reliability

### Problem Summary

The batch-index function has three critical issues:
1. PDF text extraction uses raw regex parsing that fails on most PDFs (571 skipped as "insufficient content")
2. Processing 10 files per batch causes timeouts (the "Failed to send request" error)
3. DOCX/XLSX files can't be extracted as plain text

### Solution

**1. Use Dropbox's built-in PDF-to-text export instead of parsing PDFs ourselves**

Dropbox has an `/export` API endpoint that can convert PDFs and Office documents to plain text. This is far more reliable than any Deno-based parser and handles:
- Scanned PDFs (OCR)
- Complex PDF layouts
- DOCX, XLSX, PPTX natively

For files where export isn't available, fall back to the current text extraction.

**2. Reduce batch size from 10 to 3 files per call**

This keeps each invocation well within the 60-second timeout. The frontend loop compensates by calling more frequently. Total time increases only slightly since the bottleneck is embedding generation, not loop overhead.

**3. Add per-file timeout protection**

Wrap each file's processing in a timeout (45 seconds) so one slow file doesn't kill the entire batch.

**4. Reset the 571 incorrectly skipped files**

Run a database update to reset files that were marked "skipped" due to "Insufficient content" so they get re-processed with the improved extraction.

---

### Technical Details

**File changed:** `supabase/functions/batch-index/index.ts`

Key changes:
- Replace the raw PDF regex parser with Dropbox's `/2/files/export` API for PDFs and Office docs
- Fall back to `/2/files/download` + text decode for plain text formats (TXT, CSV, EML, etc.)
- Reduce `BATCH_SIZE` from 10 to 3
- Add a 45-second timeout wrapper per file using `AbortController` / `Promise.race`
- Improve error messages (capture actual error details instead of "Unknown error")

**Database fix:** Reset the 571 skipped files so they get re-indexed:
```sql
DELETE FROM indexing_status 
WHERE status = 'skipped' AND error_message = 'Insufficient content (< 50 chars)';
```

**Dropbox export API usage:**
```text
POST https://content.dropboxapi.com/2/files/export
Header: Dropbox-API-Arg: {"path": "/path/to/file.pdf"}
Response: plain text content of the PDF
```

This endpoint supports: PDF, DOCX, XLSX, PPTX, and other Office formats.

**Updated processing flow per file:**
```text
1. Check extension
2. If PDF/DOCX/XLSX/PPTX -> use Dropbox /export API (returns clean text)
3. If TXT/CSV/EML/HTML/etc -> use Dropbox /download API + text decode  
4. If image/video/CAD -> mark as skipped
5. Chunk text -> generate embeddings -> insert into documents table
6. Update indexing_status
```

**Estimated time with 3 files per batch:**
- ~9,000 remaining vectorizable files (after skipping images/video)
- 3 files per batch, ~20-30 seconds per batch
- ~3,000 batches = roughly 18-24 hours

This stays within your one-day target.
