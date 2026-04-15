

## Plan: Fix URL Follow-Up by Including URL in Perplexity Prompt

### Problem
When the user asks a follow-up question about a previously pasted URL (e.g., "how many sections are on that page?"), the classifier correctly extracts the URL from chat history and routes to `URL_RESEARCH`. However, the `summarizeUrlWithPerplexity` function on line 782 has a bug:

```typescript
const userPrompt = opts.userMessage.trim() || `Please analyze this URL: ${opts.url}`;
```

Since the user's message ("Can you give me a summary of the first map on that page?") is truthy, the URL is **never included** in the Perplexity prompt. Perplexity receives a question with no URL context and can't fetch or analyze the page.

### Fix

**File:** `supabase/functions/chat-rag/index.ts`

**1. Always include the URL in the Perplexity user prompt (line ~782)**

Change the `userPrompt` construction to always include the URL, and when the user's message is a follow-up question (not just the URL itself), frame it as "analyze this URL and answer this specific question":

```typescript
const hasQuestion = opts.userMessage.trim() && !opts.userMessage.trim().startsWith('http');
const userPrompt = hasQuestion
  ? `Analyze this URL: ${opts.url}\n\nUser's question about this page: ${opts.userMessage.trim()}`
  : `Please analyze this URL: ${opts.url}`;
```

**2. Update the system prompt to handle Q&A mode (~line 759)**

Add a line to the system prompt telling Perplexity that when a specific question accompanies the URL, it should answer that question directly using the page content rather than giving a generic summary.

### What stays the same
- No frontend changes
- No database changes
- Pre-classifier fast path for explicit URLs unchanged
- Classifier prompt unchanged
- Saved link search unchanged

### Files changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Fix `userPrompt` in `summarizeUrlWithPerplexity` to always include URL; update system prompt for Q&A mode |

