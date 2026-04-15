

## Plan: Add Ultra-Low-Cost YouTube Video Summary Mode

### Overview
Add a `VIDEO_SUMMARY` path in `chat-rag` that detects YouTube URLs, fetches transcripts via a free API, compresses them aggressively, and summarizes with `claude-haiku` (cheapest model in your stack). Perplexity is only called if the user explicitly asks for verification/research. The existing URL_RESEARCH intercept (for non-YouTube URLs) stays intact.

### Changes

#### 1. `supabase/functions/chat-rag/index.ts`

**New helpers** (add before the existing URL section, ~line 715):

- `isYouTubeUrl(url)` — matches `youtube.com/watch`, `youtu.be/`, `m.youtube.com/watch`
- `getYouTubeVideoId(url)` — extracts video ID from any YouTube URL format
- `fetchYouTubeTranscript(videoId)` — calls the free `https://youtubetranscript.com` API (or the `youtube-transcript` npm-compatible Deno module) to get captions. Returns `{ text, segments }` or `null`
- `compressTranscript(segments)` — strips filler words (`um`, `uh`, `you know`, `like`), collapses repeated/near-duplicate adjacent lines, merges segments, keeps timestamps only every 2-3 minutes, caps total output at ~4000 chars
- `summarizeTranscriptCheap({ userMessage, videoUrl, transcript })` — calls `claude-haiku-4-5-20251001` with a minimal prompt (no chat history, no profile, no system knowledge). Instructs compact output: 1 paragraph summary + 3-5 bullet key points + optional timestamps
- `shouldResearchVideo(message)` — regex check for phrases like "verify", "fact check", "research", "what are people saying", "claims"
- `researchVideoClaimsWithPerplexity({ videoUrl, transcriptSummary, userMessage })` — calls existing Perplexity `sonar` with a focused prompt asking to verify claims from the summary. Returns `{ answer, sources }`

**Modify the URL intercept block** (~line 877-926):

Currently, any URL triggers Perplexity. Change to:
1. Check `isYouTubeUrl(detectedUrls[0])` first
2. If YouTube → enter `VIDEO_SUMMARY` mode:
   - Parse video ID
   - Fetch transcript
   - If no transcript → return honest fallback message
   - If transcript exists → compress → summarize with Haiku
   - If `shouldResearchVideo(message)` → also call Perplexity for verification, append result
   - POST response to `callback_url`
   - Log to `retrieval_logs` with `query_type: 'VIDEO_SUMMARY'` and metadata (`video_url`, `transcript_used`, `research_enriched`)
   - Return early
3. If not YouTube → existing Perplexity URL_RESEARCH flow (unchanged)

**Token budget**: Haiku call receives only: system prompt (~200 tokens) + compressed transcript (~1500-2000 tokens) + user message. No chat history, no profile, no RAG context. Target total input < 3000 tokens.

#### 2. `src/components/chat/EmptyState.tsx`

Add a 5th suggestion card:
- Icon: `Youtube` (from lucide-react)
- Title: "Summarize a Video"
- Description: "Paste a YouTube link for a quick transcript summary"

#### 3. `src/components/chat/ChatInput.tsx`

Update placeholder to mention YouTube summaries (already mentions URLs, just add "YouTube" to the text).

### Response Formats

**Default (transcript only):**
```
## Summary
[1 short paragraph]

## Key Points
- point 1
- point 2
- point 3

📋 *Based on video transcript only*
```

**With research enrichment:**
```
## Summary
[1 short paragraph]

## Key Points
- point 1
- point 2

## Verification
- [finding from web research]

## Sources
- [source](url)

📋 *Based on transcript + web research*
```

**No transcript fallback:**
```
I couldn't access captions/transcript for that video, so I can't reliably summarize it yet.
```

### Cost Analysis
- Transcript fetch: free (public API)
- Haiku summarization: ~$0.0002-0.0005 per call (compressed input ~2K tokens, output ~300 tokens)
- Perplexity verification: only when explicitly requested
- No vector search, no profile fetch, no system knowledge, no chat history

### Technical Details
- Transcript API: `https://yt.vl.comp.nus.edu.sg/transcript?v={videoId}` as primary, with `https://youtubetranscript.com/?server_vid2={videoId}` as fallback — both are free, no API key needed
- Model: `claude-haiku-4-5-20251001` (already used for classification, cheapest in stack)
- No new secrets required
- No database changes
- Existing Perplexity URL_RESEARCH path for non-YouTube URLs is untouched

