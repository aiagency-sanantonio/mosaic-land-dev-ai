

## Plan: Fix Indexing Self-Chain Reliability

### Problem

The indexing loop silently dies because of two issues:

1. **`setTimeout` is unreliable in edge functions** (lines 568-577 of `batch-index`). The Deno edge runtime can terminate the function *before* the `setTimeout` callback fires. The `fetch` inside it is fire-and-forget and never awaited — so the self-chain request simply never happens.

2. **The cron safety net only runs once per day** (2:30 AM UTC). So when the self-chain breaks, nothing re-triggers indexing until the next night. The memory notes say "every minute" but the actual cron schedule is `30 2 * * *`.

### Fix (2 changes)

#### 1. Replace `setTimeout` with `EdgeRuntime.waitUntil` in `batch-index/index.ts`

Instead of fire-and-forget `setTimeout`, use `EdgeRuntime.waitUntil()` to guarantee the self-chain fetch completes before the runtime shuts down. This is the standard Deno Deploy / Supabase pattern for background work after returning a response.

**Current code (lines 562-578):**
```typescript
if (!isDone) {
  setTimeout(() => {
    fetch(fnUrl, { ... }).catch(err => console.error(...));
  }, 500);
}
```

**New approach:**
- Build the self-chain fetch as a delayed promise
- Return the HTTP response immediately
- Use `EdgeRuntime.waitUntil(chainPromise)` to keep the runtime alive until the fetch completes

This means restructuring the serve handler slightly: instead of returning the response at the end, we capture the chain promise and call `waitUntil` before returning.

#### 2. Increase cron frequency from daily to every 5 minutes

Change the `nightly-batch-index` cron job from `30 2 * * *` to `*/5 * * * *`. The batch-index function already exits gracefully when there's no running job ("No running job found, skipping"), so frequent cron hits are harmless when idle. But when a chain breaks, the cron will pick it back up within 5 minutes instead of waiting until the next night.

This requires unscheduling the old job and creating a new one via SQL insert.

### Technical Details

**`supabase/functions/batch-index/index.ts`**:
- Declare `let chainPromise: Promise<void> | null = null` before the response
- Replace the `setTimeout` block with:
  ```typescript
  if (!isDone) {
    chainPromise = new Promise<void>(resolve => setTimeout(resolve, 500))
      .then(() => fetch(fnUrl, { method: 'POST', headers: {...}, body: ... }))
      .then(r => r.text())
      .then(() => console.log('Self-chain triggered'))
      .catch(err => console.error('Self-chain failed:', err));
  }
  ```
- After building the Response object but before returning it, add:
  ```typescript
  if (chainPromise) {
    EdgeRuntime.waitUntil(chainPromise);
  }
  ```
- Add a TypeScript declaration for `EdgeRuntime` at the top of the file

**Cron job update** (via SQL):
- `SELECT cron.unschedule(7)` to remove the daily job
- Create new job with `*/5 * * * *` schedule, same HTTP call

### What This Fixes
- Self-chaining will reliably fire even when the edge runtime wants to shut down
- If a chain still breaks (network blip, OOM, etc.), the 5-minute cron will restart it automatically
- No changes to the processing logic, kill switch, or stats tracking

