

## Fix: Remove pdfjs-serverless (Causes Boot Crash), Use fflate-based PDF Extraction

### Problem
The `pdfjs-serverless@0.6.0` import causes a **BOOT_ERROR** — the edge function cannot start at all. Every request returns 503 "Function failed to start." This blocks ALL indexing, not just PDFs.

### Solution
Replace `pdfjs-serverless` with a lightweight PDF text extractor built on `fflate` (already imported for Office files). The approach:

1. Parse PDF binary to find FlateDecode streams (the most common compression in modern PDFs)
2. Decompress each stream using `inflateSync` from fflate
3. Extract text operators (BT/ET blocks, Tj/TJ operators) from the decompressed content
4. Also extract any uncompressed text directly from the PDF

This is simpler than pdfjs-dist but handles the vast majority of real-world PDFs that contain actual text (not scanned images).

### Technical Details

**File: `supabase/functions/batch-index/index.ts`**

1. **Remove the pdfjs-serverless import** (line 5) — this is the boot crash cause
2. **Add `inflateSync` to the fflate import** (line 4): change to `import { unzipSync, strFromU8, inflateSync } from "https://esm.sh/fflate@0.8.2"`
3. **Replace `extractTextFromPdfBinary`** with a new implementation that:
   - Finds all stream/endstream blocks in the PDF binary
   - Checks for `/FlateDecode` filter and decompresses with `inflateSync`
   - Extracts text from Tj (show string) and TJ (show array) operators
   - Also extracts any plain text between BT/ET (begin text / end text) markers
   - Handles both compressed and uncompressed content streams
4. **Fix CORS headers** (line 9): Add missing `x-supabase-client-platform` and related headers that the Supabase JS client sends

### What This Fixes
- The function will boot again (no heavy library dependency)
- All file types (DOCX, XLSX, PPTX, TXT, etc.) will resume processing immediately
- PDFs with embedded text fonts will be extracted via stream decompression
- Image-only PDFs will still correctly be skipped (no text to extract)
- CORS issues from missing headers will be resolved

### Risk
The fflate-based extractor won't handle every exotic PDF encoding (CIDFont, ToUnicode maps, etc.), but it will extract text from the majority of standard business PDFs. This is a practical tradeoff vs. a library that crashes the runtime entirely.

