

## Plan: Add URL Research Mode via Perplexity API (using `sonar`)

### Overview
Detect public URLs in user messages within `chat-rag`, skip the normal RAG classifier, and route to a Perplexity `sonar` model call that summarizes the URL content with web-grounded sources.

### Prerequisites
- **Perplexity connector** — connect via the Perplexity connector (no manual API key needed)
- Verify `PERPLEXITY_API_KEY` becomes available after connection

### Changes

#### 1. `supabase/functions/chat-rag/index.ts`

**Add `extractPublicUrls(message)` helper** (near line 714, with other helpers):
- Regex to find `https?://...` URLs
- Reject localhost, private IPs (10.x, 172.16-31.x, 192.168.x), .local, .internal
- Return array of valid public URLs

**Add `summarizeUrlWithPerplexity({ url, userMessage, chatHistory })` helper**:
- Call `https://api.perplexity.ai/chat/completions` with model `sonar`
- System prompt instructs: fetch/analyze URL content, search web for context, return structured markdown (Summary, Key Findings, Notes/Risks, Sources)
- Parse `citations` array from response and append as source links
- Return formatted markdown

**Add early intercept** (~line 782, after "Remember This" check, before classification):
- `const urls = extractPublicUrls(message)`
- If URLs found, take first URL, call `summarizeUrlWithPerplexity`
- POST result to `callback_url` via existing job callback pattern
- Return early

#### 2. `src/components/chat/EmptyState.tsx`
- Add a 4th suggestion card: icon `Link`, title "Analyze a URL", description "Paste a public URL to get a grounded summary with sources"

#### 3. `src/components/chat/ChatInput.tsx`
- Update placeholder text to mention URL analysis capability

### Response Format
```
## Summary
[Overview of URL content]

## Key Findings
- Finding 1
- Finding 2

## Notes & Risks
- Caveats or concerns

## Sources
- [Title](url) — description
```

### Flow
```text
User message with URL → chat-webhook → chat-rag
  → extractPublicUrls? YES → summarizeUrlWithPerplexity (sonar)
                                → POST to callback_url → chat-response-webhook
  → No URLs → normal classification → RAG pipeline
```

### Technical Details
- Model: `sonar` (not sonar-pro)
- Temperature: 0.2 for factual grounding
- Perplexity connector provides the API key automatically as `PERPLEXITY_API_KEY`
- No changes to job flow, callback pattern, or existing classification logic

