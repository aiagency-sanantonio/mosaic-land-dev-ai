

# Fix: N8N response field not being read correctly

## Problem
The frontend (`useChatThreads.tsx` line 218) only checks `data.response` and `data.error` when reading the N8N webhook return. But N8N returns the AI agent's answer in the `output` field. Since neither `response` nor `error` exist on the returned object, it falls through to the fallback: *"I received your message but could not generate a response."*

## Root Cause
```
data?.response   → undefined (N8N doesn't use this field)
data?.error      → undefined (no error)
→ falls through to generic message
```

## Fix
Update line 218 in `src/hooks/useChatThreads.tsx` to also check `data.output`:

```typescript
const responseContent = error
  ? 'I apologize, but I encountered an issue processing your request. Please try again.'
  : data?.response || data?.output || data?.error || 'I received your message but could not generate a response.';
```

This is a one-line change. The `data.output` check is added before `data.error` so valid responses are prioritized.

## Technical Note
The edge function (`chat-webhook/index.ts`) passes through whatever JSON N8N returns via `JSON.stringify(data)`. N8N's AI agent node outputs its result in the `output` field by default, not `response`. Adding `data?.output` covers this without breaking any existing behavior.

