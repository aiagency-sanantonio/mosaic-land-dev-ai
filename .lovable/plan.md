

## Fix: Claude Haiku returning markdown-wrapped JSON in `classifyQuery`

### Problem
The `classifyQuery` function in `chat-rag/index.ts` calls Claude Haiku to classify user queries. Despite the system prompt saying "Return ONLY valid JSON — no markdown", Haiku is wrapping the response in ` ```json ... ``` ` code fences. `JSON.parse` then fails, causing the entire pipeline to error out and the frontend spinner to spin forever.

### Fix
Strip markdown code fences from the response text before parsing JSON. Add a simple regex cleanup in the `classifyQuery` function (line 60):

```typescript
// Before JSON.parse, strip markdown fences if present
const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
return JSON.parse(cleaned) as ClassifyResult;
```

This is a one-line change in `supabase/functions/chat-rag/index.ts` at line 60. No other files need changes.

