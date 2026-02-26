
## Replace Mistral OCR with OpenAI Vision

### Summary
Replace both Mistral OCR (`mistral-ocr-latest`) and Mistral Pixtral (`pixtral-large-latest`) with OpenAI's `gpt-4o` vision model. This simplifies the pipeline to a single API provider for both text extraction and image description, and avoids the Mistral rate-limit issues.

### Changes (single file: `supabase/functions/ocr-process/index.ts`)

**1. Remove Mistral dependencies**
- Remove `describeImage()` (Pixtral vision function)
- Remove `ocrImage()` (Mistral OCR for images)
- Remove `ocrPdf()` (Mistral OCR for PDFs -- file upload + OCR)
- Remove `MISTRAL_API_KEY` from env loading (no longer needed)

**2. Add OpenAI Vision function**
- New `analyzeImageWithOpenAI(base64, mimeType, openaiApiKey)` function that sends the image to `gpt-4o` with a prompt asking for both a detailed description AND any visible text (OCR).
- Returns combined output: description + extracted text in a single call (no need for two separate API calls).
- For scanned PDFs: we still need to convert pages to images. Since we can't easily do PDF-to-image in Deno without native libraries, scanned PDFs will use base64 of the raw PDF sent to OpenAI (GPT-4o supports PDF input natively as of late 2024).

**3. Update the processing loop**
- For images: single `analyzeImageWithOpenAI()` call replaces both `ocrImage()` + `describeImage()`.
- For scanned PDFs: send PDF binary directly to OpenAI vision (GPT-4o accepts PDFs).
- Remove the 2-second Pixtral delay (no longer needed -- single call per file).
- Update metadata tags from `ocr_source: 'mistral'` to `ocr_source: 'openai'`.

**4. Update prompt**
The prompt will ask GPT-4o to:
- Describe the image in detail (objects, people, equipment, structures, text, signage)
- Extract ALL visible text verbatim
- Return both sections clearly labeled

This means every image gets both a description AND OCR text in one API call, which is simpler and avoids rate-limit issues from making two sequential Mistral calls.

### Technical Details

```text
Before (2 Mistral calls per image):
  Image -> Mistral OCR (text) -> wait 2s -> Pixtral Vision (description) -> combine -> embed

After (1 OpenAI call per image):
  Image -> GPT-4o Vision (description + text) -> embed
```

- Model: `gpt-4o` (supports images up to 20MB, PDFs natively)
- Uses existing `OPENAI_API_KEY` secret (already configured)
- Embeddings continue using `text-embedding-3-small` (unchanged)
- Self-chaining logic unchanged
- Auth logic unchanged
