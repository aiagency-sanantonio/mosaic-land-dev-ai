

## Plan: Fix SAVED_LINK_SEARCH Misclassification + Add Fallback

### Two Problems

**Problem 1 — Misclassification:** "Who is Mosaic Land Development?" is classified as `SAVED_LINK_SEARCH` because the classifier sees it as an entity lookup. But the user is asking a general knowledge question about the company — this should be `DOCUMENT_SEARCH` (to check indexed docs) or handled by general LLM knowledge.

**Problem 2 — Dead-end on zero results:** When `SAVED_LINK_SEARCH` finds no matching links, it returns a hard-coded "No saved web links found" message and exits immediately. There's no fallback to document search, unlike `URL_RESEARCH` which we already fixed.

### Changes — `supabase/functions/chat-rag/index.ts`

**1. Update classifier prompt to narrow `SAVED_LINK_SEARCH` scope**

Add explicit guidance: `SAVED_LINK_SEARCH` is ONLY for when the user explicitly asks about saved/bookmarked links (e.g. "what links do we have", "show me saved links", "find the TCEQ link we saved"). General "who is X" or "what is X" questions about companies, entities, or concepts are `DOCUMENT_SEARCH`, not `SAVED_LINK_SEARCH`.

**2. Add fallback when `SAVED_LINK_SEARCH` finds zero results**

Instead of returning the "no links found" dead-end, fall back to `DOCUMENT_SEARCH` so the system can try to answer from indexed documents or general knowledge. Change the flow:

```
if (filtered.length === 0) → don't return canned message
  → instead, fall through to DOCUMENT_SEARCH retrieval pipeline
```

Implementation: In the main handler, when `SAVED_LINK_SEARCH` returns zero results, re-route `query_type` to `DOCUMENT_SEARCH` and continue instead of returning early. This mirrors the `URL_RESEARCH` fallback pattern already in place.

### What stays the same
- No frontend changes
- No database changes
- `searchSavedLinks` function itself unchanged
- All other query type handlers unchanged
- `URL_RESEARCH` fallback unchanged

### Files changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Narrow `SAVED_LINK_SEARCH` in classifier prompt; add zero-result fallback to `DOCUMENT_SEARCH` |

