

# Increase Chat Webhook Timeout to 10 Minutes

**Change:** Update line 36 in `supabase/functions/chat-webhook/index.ts` from 300,000ms (5 min) to 600,000ms (10 min).

```typescript
const timeout = setTimeout(() => controller.abort(), 600000); // 10 minutes
```

One-line change.

