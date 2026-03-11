

# Why N8N Responses Are Still Failing

## Root Cause: Supabase Edge Function Execution Timeout

The 10-minute timeout we set is on the `fetch()` call **inside** the edge function. But Supabase itself kills edge functions after a **wall-clock limit** (~60 seconds, up to 150s on some plans). When N8N takes longer than that to respond, Supabase terminates the entire function process before the fetch even completes.

This means:
- The `fetch()` timeout (10 min) is irrelevant — the function gets killed first
- `supabase.functions.invoke()` on the frontend receives an error
- The frontend shows "I apologize..." or "Unable to connect..." messages

Your error messages confirm this: both error paths (the `error` check on line 216 and the `catch` on line 227) are being triggered, which is consistent with the edge function being killed mid-execution.

## Fix: Two Changes

### 1. Add logging to the edge function to capture what N8N actually returns
Add `console.log` of the raw response data so we can see the actual shape of N8N's response and catch any format issues.

### 2. Add `console.log` on the frontend for the `supabase.functions.invoke` return
Log both `data` and `error` from the invoke call so we can see exactly what's failing — whether it's a timeout, a format issue, or something else.

```typescript
// In useChatThreads.tsx, after the invoke call:
console.log('Edge function response:', { data, error });
```

### 3. Update edge function CORS headers
The current CORS headers are missing some headers that `supabase.functions.invoke` sends, which could cause failures on some browsers/instances:

```typescript
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
```

## Files Changed
- `supabase/functions/chat-webhook/index.ts` — Add response logging + fix CORS headers
- `src/hooks/useChatThreads.tsx` — Add debug logging for invoke response

## Important Note
If the real issue is the Supabase edge function execution time limit, the only true fix would be to switch to an async pattern (send message, poll for response) or increase the plan's function timeout. The logging will confirm whether this is the case.

