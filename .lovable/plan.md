

## Plan: Make YouTube Video Q&A Context-Aware

### Problem
The `summarizeYouTubeWithPerplexity` function always sends `"Summarize this YouTube video: {url}"` to Perplexity, ignoring the user's actual question. Specific questions get a generic summary instead of a targeted answer.

### Solution
Detect whether the user is asking a specific question or just sharing a link, then adjust the Perplexity prompt accordingly.

### Changes

**File: `supabase/functions/chat-rag/index.ts`** — `summarizeYouTubeWithPerplexity` function (~lines 756-820)

1. **Add question detection**: Check if the user message contains a specific question beyond just sharing a URL (e.g., has a question mark, contains interrogative words, or has substantive text beyond the URL itself).

2. **Branch the prompt**:
   - **Generic summary mode** (user just pastes a link or says "summarize this"): Keep current behavior — structured Summary + Key Points format
   - **Specific question mode** (user asks something about the video): Send the user's actual question as the user message, with a system prompt like: *"Answer the user's question about this YouTube video using your web search. Be specific and cite the video content. If you can't find the answer, say so."* — no forced Summary/Key Points format

3. **Update the user message sent to Perplexity**:
   - Generic: `"Summarize this YouTube video: {url}"`
   - Specific: `"Regarding this YouTube video ({url}): {user's actual question}"`

### Example Behavior

| User says | Mode | Perplexity gets |
|-----------|------|-----------------|
| `https://youtube.com/watch?v=abc` | Generic | "Summarize this YouTube video..." |
| `summarize this https://youtube.com/watch?v=abc` | Generic | "Summarize this YouTube video..." |
| `what does he say about concrete costs? https://youtube.com/watch?v=abc` | Specific | "Regarding this YouTube video: what does he say about concrete costs?" |
| `is the speaker right about inflation? https://youtube.com/watch?v=abc` | Specific | "Regarding this YouTube video: is the speaker right about inflation?" |

### What Changes
- ~20 lines modified in `summarizeYouTubeWithPerplexity`
- Nothing else changes — the intercept, research path, and response callback all stay the same

