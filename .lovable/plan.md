

# Fix: Past Messages Sent as `[object Object]` to N8N

## Problem

The `useChatThreads.tsx` hook sends the raw `messages` array to the `chat-webhook` edge function. Each message is a full database row object (`{id, thread_id, role, content, created_at}`). When N8N tries to render `{{ $json.body.messages }}` in a template, JavaScript coerces each object to `[object Object]`.

## Root Cause

In `useChatThreads.tsx` line ~137:
```typescript
body: {
  threadId,
  userId: user.id,
  message: content,
  messages: [...messages, userMessage],  // full DB row objects
}
```

N8N expression `{{ $json.body.messages }}` calls `.toString()` on the array, producing `[object Object],[object Object],[object Object]`.

## Fix

Transform the messages into a simple chat-history format before sending. Two options:

**Option A (recommended):** Send messages as an array of `{role, content}` pairs -- clean, structured, and easy for N8N to iterate or stringify:
```typescript
messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
```

This way N8N can use `{{ $json.body.messages }}` and get proper JSON, or iterate with expressions like `{{ $json.body.messages[0].content }}`.

**Option B:** Additionally send a pre-formatted string field for direct use in N8N prompts:
```typescript
messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
chatHistory: [...messages, userMessage].map(m => `${m.role}: ${m.content}`).join('\n'),
```

I recommend **Option A** -- it keeps the payload clean and lets N8N format as needed. The N8N template would change from `{{ $json.body.messages }}` to `{{ JSON.stringify($json.body.messages) }}` or iterate over items.

## File Changed

- `src/hooks/useChatThreads.tsx` -- map messages to `{role, content}` before sending to webhook

