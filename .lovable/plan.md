

## Fix: Replace Fragile PDF Parser with pdf.js, Handle .doc Files

### Problem
57 PDFs with real text content (contracts, bid procedures, agreements) are being skipped because the regex-based PDF text extractor returns 0 characters. The regex approach fails on real-world PDFs where compressed binary data contains byte sequences that confuse the parser. Additionally, 1 old-format `.doc` file fails because it's not a ZIP archive.

### Solution

**1. Replace custom PDF extraction with Mozilla's pdf.js library**

The current approach tries to manually parse PDF binary with regex -- this is inherently unreliable. Mozilla's `pdf.js` (pdfjs-dist) is the industry-standard JavaScript PDF renderer/parser that handles all PDF complexities: compression, font encodings, CMap tables, cross-reference streams, etc.

We'll import it as an ESM module in the edge function and use its `getDocument` + `getTextContent` APIs to reliably extract text from every page.

**2. Mark old `.doc` files as "skipped" with a clear reason**

The old binary `.doc` format (pre-2007) cannot be parsed in a Deno environment without a specialized native library. These will be marked as "skipped - legacy .doc format" instead of silently failing. Only `.docx` (ZIP-based) is supported.

### Technical Details

**File: `supabase/functions/batch-index/index.ts`**

1. **Import pdf.js**: Add `import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs"` -- this is a self-contained build that works in Deno without a worker.

2. **Replace `extractTextFromPdfBinary`**: New implementation using pdf.js:
   - Load the PDF from an ArrayBuffer using `pdfjsLib.getDocument({ data })` 
   - Iterate over each page with `pdf.getPage(i)`
   - Extract text content with `page.getTextContent()`
   - Concatenate all text items, joining with spaces/newlines
   - This handles FlateDecode, CMap, font encoding, and all other PDF internals automatically

3. **Remove dead code**: Remove the old `extractTextFromStream` helper and the `inflateSync` import (no longer needed for PDF parsing; `fflate` is still used for Office files via `unzipSync`/`strFromU8`).

4. **Handle `.doc` in the processing loop**: Before attempting `extractTextFromOfficeFile` on a `.doc` file, check the extension. If it's `.doc` (not `.docx`), mark it as skipped with message "Legacy .doc format not supported - convert to .docx for indexing."

### What This Fixes
- All 57 PDFs with actual text content will now be properly extracted using a battle-tested library
- Image-only PDFs (engineering drawings, scanned docs without OCR) will still correctly result in minimal text and be skipped
- The 1 `.doc` file gets a clear skip reason instead of a silent failure
- No impact on DOCX/PPTX/XLSX processing (still uses fflate unzip)
