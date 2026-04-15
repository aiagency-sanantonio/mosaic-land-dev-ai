

## Plan: Fix Transcript Extraction — Use Perplexity Sonar as Summarizer Directly

### Root Cause
Perplexity `sonar` is a search-grounded LLM, not a transcript scraper. When asked to "extract the full transcript," it responds that it can't access the video, which triggers the `NO_TRANSCRIPT` fallback. The two-step approach (extract transcript with Perplexity → summarize with Haiku) doesn't work because step 1 fails.

### Solution
Collapse the two steps into one: ask Perplexity `sonar` to **summarize the video directly** using its web-grounded search capabilities. It can find video content/transcripts through its search index and return a summary in one call. This eliminates the broken transcript extraction step entirely.

The Haiku call becomes unnecessary — `sonar` is already cheap and will produce the summary directly with citations.

### Changes

**File: `supabase/functions/chat-rag/index.ts`**

1. **Replace `fetchYouTubeTranscript`** with a new function `summarizeYouTubeWithPerplexity(videoId, userMessage)` that:
   - Calls Perplexity `sonar` with a prompt like: *"Summarize this YouTube video: [URL]. Provide: 1 short summary paragraph, 3-5 bullet key points. Be concise."*
   - If user asked for "detailed summary", adjust prompt for slightly longer output
   - Returns `{ summary: string, sources: string[] } | null`
   - If Perplexity returns a useful response → done (no Haiku call needed)
   - If Perplexity fails → return the honest fallback message

2. **Simplify the VIDEO_SUMMARY intercept** (~line 877+):
   - Remove the compress → Haiku pipeline (it depended on transcript extraction)
   - Call `summarizeYouTubeWithPerplexity` directly
   - Keep `shouldResearchVideo` for explicit fact-check requests (second Perplexity call)
   - Keep metadata logging (`query_type: VIDEO_SUMMARY`, `video_url`, `research_enriched`)

3. **Remove dead code**: `compressTranscript`, `summarizeTranscriptCheap`, `parseTranscriptXml`, `parseVttTranscript` — all depended on transcript extraction which doesn't work from cloud IPs

### Cost Impact
- One `sonar` call per video summary (cheap — short prompt, ~300-500 token output)
- Eliminates the Haiku call (saves ~$0.0003 but was never working anyway)
- Optional second `sonar` call only for explicit fact-check requests

### What Stays the Same
- `isYouTubeUrl`, `getYouTubeVideoId`, `extractPublicUrls` — unchanged
- `shouldResearchVideo`, `researchVideoClaimsWithPerplexity` — unchanged
- Response format (Summary + Key Points + optional Verification) — unchanged
- Frontend (EmptyState, ChatInput) — unchanged
- Async job architecture and callback flow — unchanged

### Response Format
Same as before:
```
## Summary
[1 short paragraph from Perplexity]

## Key Points
- point 1
- point 2
- point 3

📋 *Based on web-grounded video analysis*
```

