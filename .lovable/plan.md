

## Rewire `chat-webhook` to call `chat-rag` instead of N8N

### What changes

Replace the N8N forwarding logic in `chat-webhook/index.ts` so it calls the internal `chat-rag` edge function instead.

### What stays the same
- `chat_jobs` row creation (lines 34-52) — untouched
- `callbackUrl` construction (line 58) — untouched
- `EdgeRuntime.waitUntil` / fallback pattern — untouched
- Error handling that marks job as `failed` — kept, updated messaging
- Returns `{ job_id }` immediately — untouched

### What changes
1. **Remove** the `N8N_CHAT_WEBHOOK_URL` env check (lines 16-24)
2. **Remove** the `xhr` import (line 1) — not needed
3. **Build the `chat-rag` URL** as `${supabaseUrl}/functions/v1/chat-rag`
4. **Replace the fetch target** from `webhookUrl` to the chat-rag URL
5. **Add auth header** using `SUPABASE_ANON_KEY` as Bearer token (already available as a secret)
6. **Update error messages** from "N8N" references to "chat-rag" / "processing service"

### Technical detail

The payload sent to `chat-rag` remains identical: `{ ...body, job_id, callback_url }`. The only difference is the destination URL and the addition of an `Authorization: Bearer <SUPABASE_ANON_KEY>` header. The `chat-rag` function already handles the full RAG pipeline and posts results to the callback URL.

