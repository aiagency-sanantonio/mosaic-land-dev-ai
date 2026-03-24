

## Create `chat-rag` Edge Function (Stub)

### What I'll do

1. **Create `supabase/functions/chat-rag/index.ts`** — A stub edge function that:
   - Handles CORS preflight
   - Parses the POST body (`threadId`, `userId`, `message`, `chatHistory`, `job_id`, `callback_url`)
   - Logs the body
   - Returns `{ success: true }`

2. **Add config entry** to `supabase/config.toml`:
   ```toml
   [functions.chat-rag]
   verify_jwt = false
   ```

Straightforward stub — no database changes needed.

