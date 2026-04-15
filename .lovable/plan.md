

## Plan: Context-Aware URL Research & Saved Link Search

### Problem
Three context gaps in `chat-rag/index.ts`:
1. **URL Research** only triggers when the *current* message contains a URL. "Can you do the same but with this link" (referencing a prior message's URL) doesn't work.
2. **Saved Link Search** uses naive regex stripping to extract keywords — fails on conversational queries like "Where are the district maps again?"
3. **Follow-up questions** about previously researched URLs or saved links have no way to resolve "the first one", "that link", etc.

### Solution: Use the Classifier as the Context Brain

The classifier (Claude Haiku) already receives chat history. Instead of adding more regex hacks, we lean on the classifier to extract structured context from conversational messages.

### Changes — All in `supabase/functions/chat-rag/index.ts`

**1. Expand classifier output to extract URLs and search keywords**

Update `CLASSIFY_SYSTEM_PROMPT` to also return:
- `"url"`: if the user is referencing a URL (from their message or from chat history), extract it
- `"search_keywords"`: for `SAVED_LINK_SEARCH`, extract the actual entity/topic keywords (e.g., "district maps" from "where are the district maps again?")

Update `ClassifyResult` interface to include `url?: string | null` and `search_keywords?: string | null`.

**2. Add `URL_RESEARCH` as a classifier type**

Currently URL detection is a pre-classifier regex intercept. Add `URL_RESEARCH` to the classifier so it can identify when a user is asking about a URL mentioned *earlier in conversation* (e.g., "summarize the first link", "do the same with this one: ...").

The pre-classifier regex intercept stays as a fast path for messages that literally contain a URL. But if the classifier returns `URL_RESEARCH` with a `url` field extracted from history, the same `summarizeUrlWithPerplexity` flow runs.

**3. Fix `searchSavedLinks` to use classifier-extracted keywords**

Instead of the current naive regex strip at line 1075:
```typescript
const searchTerm = project_name || message.replace(/(?:find|show|...)/gi, '').trim();
```

Use the classifier's `search_keywords` field (which Claude extracts with full conversational context). Fall back to `project_name` if `search_keywords` is empty. Split into individual keywords and search with OR across name, project_name, url columns.

**4. URL follow-up context from chat history**

When the classifier returns `URL_RESEARCH` with a `url` extracted from chat history, pass it to `summarizeUrlWithPerplexity` along with the user's current question so Perplexity answers the specific question about that URL (not just summarizes it).

### Updated Classifier Prompt Addition

```
URL_RESEARCH — user is asking about, referencing, or wants analysis of a specific web URL. 
Extract the URL into the "url" field. If the URL is in chat history (not the current message), 
still extract it. Examples: "summarize that link", "do the same thing but with this one", 
"how many lots are on that page?"

For SAVED_LINK_SEARCH: extract the core topic/entity into "search_keywords" 
(e.g., "district maps" from "where are the district maps again?").

Return: { "query_type": "...", "project_name": "...", "url": "url or null", 
"search_keywords": "extracted keywords or null", ... }
```

### Flow After Changes

```text
User: "How many maps are on the district maps page?"
  → Classifier sees chat history has a "District Maps" saved link URL
  → Returns: { query_type: "URL_RESEARCH", url: "https://...", search_keywords: "district maps" }
  → summarizeUrlWithPerplexity(url, userQuestion)
  → Grounded answer about that specific URL

User: "Where are the district maps again?"
  → Classifier: { query_type: "SAVED_LINK_SEARCH", search_keywords: "district maps" }
  → searchSavedLinks with keywords ["district", "maps"]
  → Returns matching saved link

User: "Can you do the same thing but with this link: https://..."
  → Pre-classifier intercept catches the URL
  → URL_RESEARCH as before (fast path)
```

### Files Changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Update classifier prompt, interface, search logic, URL intercept fallback |

### What Stays the Same
- No frontend changes
- No database changes  
- Pre-classifier fast path for explicit URLs still works
- Save link flow unchanged
- All other query types unchanged

