

## Fix: Invalid Anthropic model name causing 404

### Problem
The edge function logs show the error clearly:
```
Anthropic API error (404): model: claude-sonnet-4-6-20250514
```
The model `claude-sonnet-4-6-20250514` does not exist. The `synthesizeAnswer` function fails, chat-rag returns 500, and the frontend never gets a response (no spinner either, since the job gets marked as failed but the UI doesn't show that).

### Fix
Change the model in `synthesizeAnswer` in `supabase/functions/chat-rag/index.ts` from `claude-sonnet-4-6-20250514` to `claude-sonnet-4-20250514` (the correct model identifier).

Single line change — update the model string in the `synthesizeAnswer` function's fetch body.

