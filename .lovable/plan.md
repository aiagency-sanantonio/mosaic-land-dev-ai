

## Update classifier prompt for due diligence CLARIFY responses

### Change

Update the `CLASSIFY_SYSTEM_PROMPT` in `supabase/functions/chat-rag/index.ts` (line 21) to include a specific clarify question for due diligence cost queries.

**File: `supabase/functions/chat-rag/index.ts`** — modify the CLARIFY line in the prompt:

Replace:
```
CLARIFY — too ambiguous, especially any "due diligence cost" or "DD cost" question without specified scope
```

With:
```
CLARIFY — too ambiguous. For any "due diligence cost" or "DD cost" question without specified scope, set clarify_question to: "Which due diligence components do you want to include? Survey, geotechnical investigation, civil engineering, Phase I ESA, master development plan, or all of the above?"
```

Single line change. No other files affected.

