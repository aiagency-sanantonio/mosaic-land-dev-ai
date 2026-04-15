

## Plan: Fix YouTube Q&A Prompting and Refusal Detection

### Problem
Perplexity returns hedging responses like "I cannot provide a detailed analysis because the search results do not contain the actual transcript" instead of actually answering with whatever info it can find. This response passes the `NO_VIDEO_INFO` check and gets returned as the final answer.

### Changes

**File: `supabase/functions/chat-rag/index.ts`**

1. **Rewrite the specific-question system prompt** (~line 799) to be assertive:
   - Tell Perplexity to answer using ALL available information: video description, comments, related articles, web discussions, etc.
   - Explicitly instruct: "Do NOT say you cannot access the video or need a transcript. Use whatever information your search returns."
   - Add: "If you find partial information, share what you found. Only respond with NO_VIDEO_INFO if you literally find zero results about this video."

2. **Also improve the summary system prompt** (~line 781) with the same anti-hedging instruction.

3. **Fix `shouldResearchVideo` regex** (~line 848): Add "verifiable", "real", "true", "accurate" variants so questions like "are these points real and verifiable" trigger the research path.

4. **Add refusal detection** after receiving Perplexity's response (~line 834): Check for phrases like "I cannot provide", "I don't have access", "search results do not contain" — if detected, retry with a more forceful prompt OR return null to trigger the fallback message instead of passing the refusal through.

### What Stays the Same
- The summary vs. question branching logic
- The overall VIDEO_SUMMARY intercept flow
- Frontend, response callback, metadata logging

