

## Fix: PDF Extraction Broken -- Replace pdfjs-dist with pdfjs-serverless

### Problem
Every single PDF is being skipped because `pdfjs-dist` requires a web worker (`GlobalWorkerOptions.workerSrc`) that doesn't exist in the Deno edge function environment. The error `No "GlobalWorkerOptions.workerSrc" specified` fires on every PDF, the extraction returns empty text, and files get marked as "skipped."

DOCX, XLSX, and PPTX files are all indexing fine -- only PDFs are broken.

### Solution
Replace the `pdfjs-dist` import with `pdfjs-serverless`, a redistribution of PDF.js specifically built for serverless/Deno environments. It inlines the worker code so no `workerSrc` configuration is needed.

### Technical Details

**File: `supabase/functions/batch-index/index.ts`**

1. **Change the import** (line 5):
   - Remove: `import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs"`
   - Add: `import { getDocument } from "https://esm.sh/pdfjs-serverless@0.4.1"`

2. **Update `extractTextFromPdfBinary`** to use the new API:
   - Replace `pdfjsLib.getDocument({ data })` with `getDocument({ data, useSystemFonts: true })`
   - The rest of the page iteration / `getTextContent()` logic stays the same

3. **Clear previously skipped PDF entries** from `indexing_status` so they get retried with the working parser.

### What This Fixes
- All PDFs with extractable text will now be properly indexed
- Scanned/image-only PDFs will still correctly result in minimal text and be skipped (which is fine per your request)
- No changes to DOCX/PPTX/XLSX processing

