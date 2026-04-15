

## Plan: Use Perplexity to Fetch YouTube Transcripts

### Problem
YouTube blocks transcript requests from cloud IPs (Supabase runs on AWS). All direct scraping methods fail.

### Solution
Use Perplexity `sonar` as a transcript extraction tool — it has its own crawling infra that can access YouTube. Ask it to return **only the raw transcript text** (not a summary), then feed that to Haiku for the cheap summarization as before.

### Changes

**File: `supabase/functions/chat-rag/index.ts`**

Replace the body of `fetchYouTubeTranscript` (~lines 768-818) with:

1. **Primary method**: Call Perplexity `sonar` with a prompt like:
   ```
   "Extract the full spoken transcript/captions from this YouTube video: https://www.youtube.com/watch?v={videoId}. Return ONLY the raw transcript text, no commentary, no summary. If captions are unavailable, respond with exactly: NO_TRANSCRIPT"
   ```
   - Temperature: 0 (factual extraction, not creative)
   - Parse the response — if it contains `NO_TRANSCRIPT`, return null
   - Otherwise, split the text into pseudo-segments (every ~30 words = one segment, estimate timestamps)

2. **Fallback**: Keep existing direct scrape methods as secondary attempts (they may work from non-cloud environments in the future)

### Cost Impact
- Perplexity `sonar` call for transcript extraction: minimal (short prompt, ~1-2K output tokens)
- Still cheaper than sending the video to a paid transcript API
- Haiku summarization cost stays the same (~$0.0003 per call)
- Total cost per YouTube summary: one `sonar` call + one Haiku call

### What Stays the Same
- `compressTranscript`, `summarizeTranscriptCheap`, `shouldResearchVideo`, `researchVideoClaimsWithPerplexity` — all unchanged
- The VIDEO_SUMMARY intercept logic in the main handler — unchanged
- Frontend — unchanged
- Response format — unchanged

### Technical Details
- Since Perplexity returns plain text (not timestamped segments), we generate synthetic segments by splitting every ~30 words with estimated timestamps — this keeps `compressTranscript` working
- The `sonar` prompt is deliberately minimal to keep token usage low
- `PERPLEXITY_API_KEY` is already available (connected via connector)

