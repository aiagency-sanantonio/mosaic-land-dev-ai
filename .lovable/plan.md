

## Root Cause Analysis

There are **two distinct bugs** here:

### Bug 1: "Frozen" / response never renders until refresh

**What happens:** When a `chat-rag` call fails (crashes, times out, etc.), `chat-webhook` catches the error and updates `chat_jobs` to `status='failed'` with `response_content='Processing service returned an error'`. However, **no message is ever inserted into the `messages` table**. 

The frontend's `handleJobDone` callback fires correctly (via Realtime or polling), calls `fetchMessages()`, and sets `sendingMessage=false`. But since no assistant message exists in the DB, the user sees... nothing. The spinner disappears but no response appears. It looks "frozen."

There's also a race condition: if `chat-rag` errors very quickly (1-3 seconds as shown in logs), the `chat_jobs` row may already be set to `failed` before the Realtime channel finishes subscribing. The existing "immediate poll on subscribe" should catch this, but there are edge cases where it misses.

**The fix:** In `handleJobDone`, after fetching messages, check if the job `status === 'failed'` and if so, insert/display the error message from `response_content` so the user always sees feedback.

### Bug 2: Second document upload crashes chat-rag

**What happens:** The user's second message in the same thread (with a new document attached) causes `chat-rag` to fail. The DB confirms this: job `3e91bf55` (the second document question) has `status: failed` after only 3.5 seconds.

The likely cause is the `uploaded_document` concatenation logic. When a second document is uploaded, `sendMessage` fetches ALL previous uploads' extracted text, concatenates them (up to 50,000 chars), and sends that entire payload along with the full chat history. This combined payload (previous conversation + two documents' extracted text + system prompt) likely exceeds the LLM's input token limit or causes `chat-rag` to error during processing.

**The fix:** Add error handling in `chat-rag` for oversized payloads, and truncate the uploaded document context more aggressively when multiple documents are present.

---

## Implementation Plan

### File 1: `src/hooks/useChatThreads.tsx`

**Change 1 — Show failed job responses to the user:**
- In `handleJobDone`, after `fetchMessages(threadId)`, query the job's final status
- If `status === 'failed'`, insert a visible error message into the messages state (and optionally the DB) so the user sees feedback instead of nothing
- This prevents the "frozen" appearance

**Change 2 — Strengthen polling for fast failures:**
- Add an immediate poll right after the channel `.subscribe()` call returns (even before `SUBSCRIBED` status), to catch jobs that fail within milliseconds
- Reduce initial poll interval from 3s to 2s for the first few checks

### File 2: `supabase/functions/chat-rag/index.ts`

**Change 3 — Handle multi-document context gracefully:**
- When `uploaded_document` is present and large, cap the total context sent to the LLM more aggressively (e.g., 30,000 chars for uploaded docs, leaving room for system prompt + history)
- Add a try-catch around the LLM call that produces a meaningful error message instead of crashing
- Log the total payload size before sending to the LLM for future debugging

### File 3: `supabase/functions/chat-response-webhook/index.ts`

No changes needed — this function is working correctly.

---

## Technical Details

The key data points from investigation:
- Job `3e91bf55` (second doc) failed in 3.5 seconds — indicates an immediate error, not a timeout
- Job `e4c9a0d0` (first doc) completed successfully in ~13 seconds — the pipeline works fine for single documents
- There is also 1 permanently `pending` job (`50bb10ef`) from March 12 — a fire-and-forget that was never resolved, confirming the "never renders" pattern
- The `handleJobDone` function correctly stops the spinner but never shows failure feedback

## Expected Outcome

After these changes:
1. When a job fails, the user will see an error message like "I encountered an issue processing your request. Please try again." instead of a frozen screen
2. Multi-document conversations will work without crashing because the context will be properly capped
3. Debug logs will show payload sizes for future troubleshooting

