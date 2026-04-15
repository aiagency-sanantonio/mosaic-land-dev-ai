

## Plan: Harden Classifier JSON Parsing + Improve Follow-Up Context

### Two Bugs Found in Logs

**Bug 1 — JSON parse crash (causes 500 error):**
The classifier (Claude Haiku) sometimes returns extra conversational text after the JSON block. The current cleanup regex only strips markdown fences but doesn't isolate the JSON object, so `JSON.parse` chokes on trailing text like "**Quick Answer:** Based on the chat history..."

**Bug 2 — Misclassification of follow-up questions:**
"Just give me the link to the first district map" was classified as `SAVED_LINK_SEARCH` instead of `URL_RESEARCH`, even though the conversation already had a researched URL. The classifier needs stronger guidance to recognize when a follow-up references previously researched content.

### Changes — `supabase/functions/chat-rag/index.ts`

**1. Fix JSON extraction (line ~86)**

Replace the naive regex strip with a robust JSON extractor that finds the first `{...}` block using brace counting. This handles:
- Markdown fences with trailing text
- Extra commentary after the JSON
- Any model formatting quirks

```typescript
// Extract first valid JSON object from potentially messy LLM output
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in classifier response');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error('Unterminated JSON object in classifier response');
}
```

**2. Strengthen classifier prompt for follow-up context**

Add explicit instruction to the `CLASSIFY_SYSTEM_PROMPT`:
- When the assistant previously researched a URL and the user asks a follow-up about its content (e.g., "give me the link to the first district map", "how many sections are there?"), classify as `URL_RESEARCH` with the URL extracted from history — not `SAVED_LINK_SEARCH`.
- `SAVED_LINK_SEARCH` is only for finding links the team has *saved* in the library when no prior URL research exists in the conversation.

**3. Increase classifier max_tokens**

Bump `max_tokens` from 256 to 300 to reduce truncation risk on longer reasoning outputs (the crash response had 348 chars of JSON alone).

### What Stays the Same
- No frontend changes
- No database changes
- Pre-classifier fast path for explicit URLs unchanged
- Perplexity prompt fix from prior plan unchanged
- All other query type handlers unchanged

### Files Changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Add `extractJsonObject` helper, update classifier prompt, bump max_tokens |

