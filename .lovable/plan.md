

# Async Chat Pattern — Robust N8N Integration

## Problem
The edge function logs confirm the real issue: **N8N itself is returning HTTP 524 (Cloudflare timeout) and 500 errors** after ~2-3 minutes. This is a Cloudflare proxy timeout on N8N's side, not our edge function. No amount of timeout increase on our end fixes this — the upstream infrastructure kills the connection.

## Solution: Fire-and-Forget + Realtime Polling

Split the synchronous request-response into two parts:

```text
CURRENT (broken):
  Frontend ──invoke──► Edge Function ──fetch──► N8N ──(524 timeout)──✗

NEW (async):
  1. Frontend ──invoke──► chat-webhook ──► returns job_id immediately
     └── also fires N8N request (fire-and-forget)

  2. N8N finishes ──POST──► chat-response-webhook ──► writes response to DB

  3. Frontend polls DB (or uses Realtime) ──► gets response when ready
```

## Changes

### 1. New DB table: `chat_jobs`
```sql
CREATE TABLE public.chat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | completed | failed
  request_payload jsonb NOT NULL,
  response_content text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.chat_jobs ENABLE ROW LEVEL SECURITY;
-- Users can read their own jobs
CREATE POLICY "Users read own jobs" ON public.chat_jobs FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Edge functions insert/update via service role
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_jobs;
```

### 2. Update `chat-webhook` edge function
- Insert a `chat_jobs` row with status `pending`
- Fire N8N request with `fetch()` but **don't await it** — include the `job_id` in the N8N payload so N8N can call back
- Return `{ job_id }` to frontend immediately

### 3. New `chat-response-webhook` edge function
- N8N calls this when done (configure as a "respond to webhook" or HTTP node at the end of the N8N flow)
- Receives `{ job_id, response }` 
- Updates `chat_jobs` row: set `status = 'completed'`, `response_content = response`, `completed_at = now()`

### 4. Update `useChatThreads.tsx` frontend
- After sending message, subscribe to Realtime changes on `chat_jobs` filtered by `job_id`
- When status changes to `completed`, read `response_content`, save as assistant message, unsubscribe
- If no response after 10 minutes, show timeout message
- Keep the loading spinner active while waiting

### 5. N8N workflow change (user action)
- Add an HTTP Request node at the end of the N8N agent flow that POSTs the response back to the `chat-response-webhook` edge function URL with `{ job_id, response }`

## Files Changed
- **Migration**: New `chat_jobs` table + RLS + realtime
- **`supabase/functions/chat-webhook/index.ts`**: Rewrite to async fire-and-forget
- **`supabase/functions/chat-response-webhook/index.ts`**: New callback endpoint
- **`src/hooks/useChatThreads.tsx`**: Replace invoke-and-wait with Realtime subscription

## Important
You will need to update your N8N workflow to add a final HTTP Request node that calls the `chat-response-webhook` function with the `job_id` and response text. I'll provide the exact URL and payload format after implementation.

