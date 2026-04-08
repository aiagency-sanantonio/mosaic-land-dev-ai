

## Plan: Fix System Knowledge Injection for CLARIFY Queries

### Problem
When a query is classified as `CLARIFY` (out-of-scope), the edge function short-circuits at line 779 and returns a canned refusal — even when system knowledge entries exist that could answer the question. The injected knowledge never reaches the LLM.

### Changes (1 file)

**`supabase/functions/chat-rag/index.ts`**

1. **Line 779** — Add `&& !knowledgeText` to the CLARIFY short-circuit condition:
   ```typescript
   if (query_type === 'CLARIFY' && !hasUploadedDocument && !knowledgeText) {
   ```
   This lets CLARIFY queries fall through to LLM synthesis when system knowledge is available.

2. **After line 861** (after the `HYBRID` else-if block) — Add an else branch for CLARIFY-with-knowledge:
   ```typescript
   } else {
     context = '';
     contextType = 'General Knowledge';
   }
   ```
   No document retrieval is attempted — the LLM answers using only the system knowledge injected via `systemAddendum`.

3. **After line 774** — Add a debug log:
   ```typescript
   console.log(`systemKnowledge injected: length=${knowledgeText.length}`);
   ```

4. **Deploy** the updated `chat-rag` function.

### What This Does NOT Change
- All other query types (AGGREGATE, DOCUMENT_SEARCH, HYBRID, STATUS_LOOKUP) continue to work exactly as before with full document retrieval.
- CLARIFY queries with no system knowledge still short-circuit with the canned refusal (existing behavior preserved).

