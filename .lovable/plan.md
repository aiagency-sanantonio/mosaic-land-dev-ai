

## Plan: Harden URL_RESEARCH Fallback + Add Classification Safety Net

### Issues Found

**Bug: Silent empty-context fallback when classifier returns `URL_RESEARCH` without a URL**
At line 1112, the condition `if (query_type === 'URL_RESEARCH' && classifiedUrl)` skips when `classifiedUrl` is null. But the code then continues past `SAVED_LINK_SEARCH` and falls into the retrieval section. Since `query_type` is `URL_RESEARCH`, none of the retrieval branches (AGGREGATE, STATUS_LOOKUP, DOCUMENT_SEARCH, HYBRID) match — it hits the `else` at line 1240, setting `context = ''`. The user gets an LLM answer with zero retrieval context.

**Risk: False URL_RESEARCH classification on database questions**
No code-level protection exists. A question like "What's the grading cost for Fischer Ranch?" could be misclassified as `URL_RESEARCH` if chat history contains URLs.

### Changes — `supabase/functions/chat-rag/index.ts`

**1. Fallback when `URL_RESEARCH` has no URL or Perplexity fails**

After the `URL_RESEARCH` block (line ~1146), if we didn't return (meaning either `classifiedUrl` was null or Perplexity threw), re-classify `query_type` to `DOCUMENT_SEARCH` so the request falls into the normal retrieval pipeline instead of the empty-context dead end.

```typescript
// After line 1146 (end of URL_RESEARCH block)
// If URL_RESEARCH didn't return (no URL or Perplexity failed), 
// fall back to document search so we don't hit empty context
if (query_type === 'URL_RESEARCH') {
  console.log('URL_RESEARCH did not resolve — falling back to DOCUMENT_SEARCH');
  classification.query_type = 'DOCUMENT_SEARCH';
}
```

This requires destructuring `classification` as mutable (currently uses `const { query_type, ... }`). Change to `let` or reassign on the object directly.

**2. No other changes needed**

The classifier prompt already has strong guidance about when to use `URL_RESEARCH` vs database queries. The `try/catch` around Perplexity is already solid. The `SAVED_LINK_SEARCH` gracefully handles zero results. Adding more guardrails (like validating the URL format from the classifier) would over-engineer it — the real fix is just ensuring the fallback doesn't dead-end.

### What stays the same
- No frontend changes
- No database changes
- Pre-classifier fast path for explicit URLs unchanged
- Classifier prompt unchanged
- `SAVED_LINK_SEARCH` logic unchanged
- `summarizeUrlWithPerplexity` unchanged

### Files changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Add fallback from failed/empty `URL_RESEARCH` to `DOCUMENT_SEARCH` (~3 lines) |

