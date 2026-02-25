

## Add Image Description to OCR Pipeline

### Problem
The current OCR pipeline only extracts text from images using Mistral OCR. For many construction site photos, permits, and other visual documents, the text alone doesn't capture important context (e.g., what's shown in a photo, the condition of equipment, progress of work).

### Approach
After extracting OCR text from an image, send the same image to a vision-capable model to generate a natural language description. Combine the OCR text and description into a single document before chunking and embedding.

### Changes

**1. Update `supabase/functions/ocr-process/index.ts`**

- Add a new `describeImage()` function that sends the base64 image to **Mistral's Pixtral model** (`pixtral-large-latest`) via the `/v1/chat/completions` endpoint with a vision prompt. The MISTRAL_API_KEY is already configured.
- The prompt will ask the model to describe the visual content of the image: what it shows, any visible objects, conditions, context, etc.
- Combine the results: prepend `## Image Description\n{description}\n\n## Extracted Text\n{ocrText}` so both are captured in the document chunks.
- This applies **only to images** (not PDFs), since PDFs are multi-page text documents where description adds less value.
- Add an `image_described: true` flag to the metadata so we can track which documents have descriptions.

**2. No changes needed to other functions**
- The chunking, embedding, and search logic all work on text content, so the combined text will flow through the existing pipeline seamlessly.
- The structured data extraction will also benefit since it reads from the indexed chunks.

### Technical Details

The vision call to Pixtral:
```text
POST https://api.mistral.ai/v1/chat/completions
Model: pixtral-large-latest
Messages:
  - role: user
    content:
      - type: image_url (base64 data URI)
      - type: text ("Describe this image in detail...")
```

The combined output format per image file:
```text
## Image Description
[Vision model's description of what the image shows]

## Extracted Text (OCR)
[Mistral OCR extracted text/markdown]
```

This adds one extra API call per image file (not per PDF). The existing 90-second per-file timeout should accommodate this since both calls typically complete in under 30 seconds total.

