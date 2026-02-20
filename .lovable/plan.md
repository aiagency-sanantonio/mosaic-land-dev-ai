

## Fix: Handle "non_exportable" Dropbox Files

### Problem

The Dropbox `/export` API only works for files created through Dropbox Paper or Google Docs. Regular uploaded PDFs, DOCX, and PPTX files return a `409 non_exportable` error. This is causing all PDF/Office files to fail indexing.

### Solution

Update the `batch-index` edge function to add a **fallback strategy**:

1. **Try `/export` first** (works for Dropbox Paper / Google Docs files)
2. **If "non_exportable", fall back to `/download`** and download the raw file
3. **For PDFs**: Download the binary and attempt to extract any embedded text. PDFs that are purely image-based (scanned documents with no text layer) will be skipped with a clear message.
4. **For Office files (DOCX, PPTX, XLSX)**: These are ZIP-based formats. Download and attempt basic XML text extraction from their internal structure (e.g., extracting text from `word/document.xml` in DOCX files).

### Technical Details

**Changes to `supabase/functions/batch-index/index.ts`:**

1. **New helper: `extractTextFromPdfBinary(buffer)`** -- Scans raw PDF bytes for text stream objects and extracts readable text. Falls back to skipping if no text is found.

2. **New helper: `extractTextFromOfficeFile(buffer, ext)`** -- Unzips DOCX/PPTX/XLSX files and extracts text content from their XML entries.

3. **Update `exportFromDropbox()`** -- Instead of throwing on "non_exportable", return `null` to signal fallback is needed.

4. **Update the main processing loop** -- When export returns null, download the file via `/download` and use the appropriate binary text extractor based on file extension. If extraction yields less than 50 characters of text, mark the file as "skipped" with a message like "No extractable text (image-only PDF or unsupported format)".

This approach ensures:
- Files that work with `/export` continue to use it (best quality)
- Regular uploaded files get processed via binary extraction (good enough for most documents)
- Image-only PDFs and truly unreadable files are cleanly skipped instead of marked as errors

