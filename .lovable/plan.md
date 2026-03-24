

## Diagnosis: Realtime Race Condition

The chatbot spins indefinitely because of a **race condition** between the Realtime subscription setup and the backend response.

### Timeline of events:
1. Frontend calls `chat-webhook` (04:37:54Z)
2. `chat-webhook` creates job, triggers `chat-rag`, returns `job_id` (04:37:54Z)
3. `chat-rag` classifies as CLARIFY, posts response to `chat-response-webhook` (04:37:55Z)
4. `chat-response-webhook` UPDATEs `chat_jobs` to `completed` (04:37:55Z)
5. Frontend receives `job_id` from step 2, **now** sets up Realtime subscription (04:37:56Z+)
6. The UPDATE event already fired — subscription misses it entirely

The job completes in ~1 second, but the frontend only starts listening *after* getting the webhook response. The Realtime channel needs time to connect and subscribe, so it misses the UPDATE.

### Fix

**File: `src/hooks/useChatThreads.tsx`** — in the `sendMessage` function (lines 228-261)

Add a **polling fallback** after subscribing to Realtime. Once the channel subscribes, immediately check if the job is already completed. This handles the race condition where the job finishes before the subscription is active.

```typescript
// After .subscribe(), add an immediate check:
const channel = supabase
  .channel(`job-${jobId}`)
  .on('postgres_changes', { ... }, async (payload) => { ... })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      // Check if job already completed before we subscribed
      const { data: job } = await supabase
        .from('chat_jobs')
        .select('status, response_content')
        .eq('id', jobId)
        .single();
      
      if (job && (job.status === 'completed' || job.status === 'failed')) {
        if (threadId) await fetchMessages(threadId);
        setSendingMessage(false);
        supabase.removeChannel(channel);
        clearTimeout(timeout);
        await supabase.from('chat_threads')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', threadId);
        fetchThreads();
      }
    }
  });
```

This ensures that even if the job completes before the subscription is active, the frontend will detect it immediately upon subscribing. No other files need to change.

