

## Switch Structured Extraction from Lovable AI to OpenAI

A simple swap in `supabase/functions/process-document/index.ts` to use the OpenAI API directly (which you're already paying for) instead of the Lovable AI gateway.

### Changes (single file)

**File: `supabase/functions/process-document/index.ts`**

1. Change the function signature from `lovableApiKey` to `openaiApiKey` parameter (line 143)
2. Switch the API endpoint from `https://ai.gateway.lovable.dev/v1/chat/completions` to `https://api.openai.com/v1/chat/completions` (line 174)
3. Change the model from `google/gemini-2.5-flash` to `gpt-4o-mini` (line 181)
4. Update the caller: use `openaiApiKey` instead of `lovableApiKey` when calling the function (lines 419-425)
5. Remove the `lovableApiKey` variable since it's no longer needed (line 374)

No new secrets needed -- `OPENAI_API_KEY` is already configured and used for embeddings in the same function.

### Cost Note

`gpt-4o-mini` is very cheap (~$0.15 per 1M input tokens). Processing 9,500 files at ~6,000 chars each would cost roughly $0.50-$1.00 total.

