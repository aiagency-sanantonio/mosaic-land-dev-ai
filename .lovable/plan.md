

## Persist Uploaded Document Context Across Follow-up Messages

**Problem**: When you upload a file and ask a question, the extracted text is sent to the AI. But on the next message (without a new upload), no document context is sent — so the bot has no idea what file you're talking about.

**Solution**: Before sending each message, check the `user_uploads` table for any previous uploads in the current thread and include their extracted text in the AI request.

### Plan

1. **Fetch thread uploads on every message** (`src/hooks/useChatThreads.tsx`)
   - In `sendMessage`, after resolving any new upload, also query `user_uploads` for all uploads linked to the current `threadId`
   - Combine extracted text from all thread uploads (capped to prevent token overflow)
   - Pass combined text as `uploaded_document` to `chat-webhook`, even when no new file is attached

2. **No backend changes needed** — the `chat-webhook` and `chat-rag` functions already handle `uploaded_document` correctly; they just need to receive it

### Technical Detail

```typescript
// After resolving the current upload, fetch ALL thread uploads
const { data: threadUploads } = await supabase
  .from('user_uploads')
  .select('extracted_text, file_name')
  .eq('thread_id', threadId)
  .not('extracted_text', 'is', null);

if (threadUploads?.length) {
  uploadedDocument = threadUploads
    .map(u => `[${u.file_name}]\n${u.extracted_text}`)
    .join('\n\n---\n\n')
    .slice(0, 50000); // cap to prevent token overflow
}
```

This way, every message in the thread will carry the full document context from any previously uploaded files.

