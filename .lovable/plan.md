

## Plan: Add Multi-Step Planning to chat-rag Classifier

### Problem
Currently, each query maps to exactly one action: either search saved links OR research a URL OR search documents. When a user asks "How many sections are on the statewide map?" and the statewide map is a saved link (not in chat history), the system can't chain: find the saved link → research that URL → answer the question. It picks one path and fails.

### Solution: Two-Step Action Plan from the Classifier

Expand the classifier to optionally return a `plan` field — an ordered array of up to 2 steps. The executor runs them sequentially, passing results forward.

**Example flow:**
```text
User: "How many sections are on the statewide map?"

Classifier returns:
{
  "query_type": "MULTI_STEP",
  "plan": [
    { "action": "SAVED_LINK_SEARCH", "search_keywords": "statewide map" },
    { "action": "URL_RESEARCH", "question": "How many sections are on this page?" }
  ],
  "reasoning": "Need to find the saved link first, then research its content"
}

Executor:
  Step 1: searchSavedLinks("statewide map") → finds URL https://example.com/map
  Step 2: summarizeUrlWithPerplexity(found URL, user question) → answer
```

### Changes — `supabase/functions/chat-rag/index.ts`

**1. Expand classifier prompt and interface**

Add `MULTI_STEP` query type and `plan` field to `ClassifyResult`:

```typescript
interface PlanStep {
  action: 'SAVED_LINK_SEARCH' | 'URL_RESEARCH';
  search_keywords?: string;
  question?: string;
  url?: string;
}

interface ClassifyResult {
  // ... existing fields ...
  plan?: PlanStep[] | null;  // max 2 steps
}
```

Add to `CLASSIFY_SYSTEM_PROMPT`:
```
MULTI_STEP — the user's question requires chaining two actions. Use this when:
- The user asks a question about content on a saved link they haven't pasted 
  (need to find the link first, then research it)
- The user references "that page" or a topic that maps to a saved link, 
  and wants specific content from it

Return a "plan" array with up to 2 steps, executed in order:
  Step 1: { "action": "SAVED_LINK_SEARCH", "search_keywords": "..." }
  Step 2: { "action": "URL_RESEARCH", "question": "the user's actual question" }

Step 2 automatically receives the URL found in Step 1.
Only use MULTI_STEP when a single action type cannot answer the question.
```

**2. Add plan executor**

A new function `executeMultiStepPlan(plan, supabase, message, chatHistory)` that:
1. Runs step 1 (SAVED_LINK_SEARCH) → extracts the first URL from results
2. If a URL is found, runs step 2 (URL_RESEARCH) with that URL + the user's question
3. If step 1 finds no URL, returns the saved links list as-is (graceful degradation)

**3. Wire into main handler**

After classification, before the existing `URL_RESEARCH` / `SAVED_LINK_SEARCH` blocks, add:
```typescript
if (query_type === 'MULTI_STEP' && classification.plan?.length) {
  const result = await executeMultiStepPlan(classification.plan, supabase, message, chatHistory);
  // send result via callback, log, return
}
```

### Cost Impact
- **Classifier (Haiku):** No extra call — same single classification, just a richer output
- **Perplexity:** Same single call as URL_RESEARCH today
- **Saved links query:** One lightweight DB query (already exists)
- **Net cost increase:** Zero additional API calls vs. a user manually doing 2 messages

### Context Window Impact
- No increase. The plan is decided by the classifier in its existing call. Execution is sequential with no extra LLM calls beyond what each individual path already uses.

### What Stays the Same
- No frontend changes, no database changes
- Single-step queries (direct URL paste, simple saved link search, document search, etc.) route exactly as before
- Pre-classifier URL fast path unchanged
- All other query types unchanged

### Files Changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Add `MULTI_STEP` to classifier prompt/interface, add `executeMultiStepPlan` function, wire into main handler |

