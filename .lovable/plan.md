

## Fix: PDF Text Extraction Failing Due to Compressed Streams

### Problem
The `extractTextFromPdfBinary` function scans raw PDF bytes for BT/ET text markers, but nearly all modern PDFs compress their content streams using FlateDecode. The regex finds nothing in compressed data, so the extracted text is under 50 characters and files are marked as "skipped."

This is why Office files (PPTX) work fine -- the `fflate` library handles their ZIP decompression -- but PDFs fail silently.

### Solution

Replace the naive PDF text extraction with a two-stage approach:

1. **Decompress FlateDecode streams first**: Parse the PDF binary to find stream objects marked with `/FlateDecode`, extract the compressed data between `stream` and `endstream` markers, and inflate them using `fflate` (already imported).

2. **Then apply BT/ET text extraction** on the decompressed content, which will now contain readable text operators.

3. **Additional fallback**: Also scan for raw (uncompressed) streams as before, so both compressed and uncompressed PDFs are handled.

4. **Raise the skip threshold awareness**: Log the extracted text length so we can debug further if needed.

### Technical Details

**File: `supabase/functions/batch-index/index.ts`**

- Rewrite `extractTextFromPdfBinary(buffer)` to:
  1. Find all stream objects in the PDF raw bytes
  2. Check if each stream uses `/FlateDecode` filter
  3. If so, use `fflate.inflateSync()` to decompress the stream data
  4. Apply the existing BT/ET + Tj/TJ regex extraction on decompressed content
  5. Also try extracting text from uncompressed streams as a fallback
  6. Log the character count of extracted text for debugging

- Add a log line after text extraction showing how many characters were found, so future debugging is easier.

- No other files need to change. The `fflate` library (`inflateSync`) is already imported.

### What This Fixes
- PDFs with FlateDecode-compressed content streams (the vast majority of PDFs) will now have their text extracted successfully
- Image-only scanned PDFs will still be correctly skipped (no text in streams even after decompression)
- The PPTX/DOCX path remains unchanged and working

