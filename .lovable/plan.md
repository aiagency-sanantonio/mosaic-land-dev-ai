

## Plan: Fix YouTube Transcript Fetching

### Problem
Both transcript APIs (`yt.vl.comp.nus.edu.sg` and `youtubetranscript.com`) are failing. The first has a DNS resolution error (host is down), and the second returns no usable data. This causes every YouTube summary to return the "couldn't access transcript" fallback.

### Solution
Replace the two broken third-party APIs with YouTube's own internal `timedtext` API, which is what all transcript services use under the hood. The approach:

1. Fetch the YouTube video page HTML to extract caption track metadata
2. Parse the `captionTracks` data from the page's embedded player config
3. Fetch the actual transcript XML from YouTube's `timedtext` endpoint directly
4. Keep the broken APIs as last-resort fallbacks (they may come back online)

### Changes

**File: `supabase/functions/chat-rag/index.ts`**

Replace the `fetchYouTubeTranscript` function (~lines 756-803) with a new implementation:

1. **Primary method**: Fetch `https://www.youtube.com/watch?v={videoId}` with a browser-like User-Agent, extract the `captionTracks` JSON from the page source using regex, then fetch the transcript XML from the `baseUrl` in that data
2. **Secondary method**: Try YouTube's direct timedtext endpoint `https://www.youtube.com/api/timedtext?v={videoId}&lang=en&fmt=srv3`
3. **Tertiary fallback**: Keep existing two APIs as last-resort options

The XML parsing logic already in the function (lines 785-790) works correctly for YouTube's native XML format, so that stays the same.

### Technical Details
- YouTube's video page embeds `"captionTracks":[{...}]` in the page HTML — we extract the first English track's `baseUrl`
- The transcript XML uses `<text start="..." dur="...">content</text>` format — already handled by existing parser
- User-Agent header needed to avoid YouTube returning a simplified page
- No new dependencies or secrets required
- All other code (compress, summarize, research, intercept) remains unchanged

