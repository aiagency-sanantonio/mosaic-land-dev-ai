

## Fix OCR Pipeline: Cron Auth + Rate Limiting

### Problem 1: Cron calls get 401 Unauthorized (blocking)
The `ocr-process` cron job sends `{"cron": true}` with the anon key, but the function only accepts `N8N_WEBHOOK_SECRET` or a valid user JWT. Neither matches, so every cron tick returns 401 and no files get processed automatically.

The `batch-index` function handles this correctly with a separate `isCron` code path that skips auth. The OCR function needs the same pattern.

### Problem 2: Pixtral Vision rate limiting
The Pixtral (image description) API returns 429 for 4 out of 5 images per batch. Need to add a delay between image descriptions to stay under the rate limit.

### Fix (single file change)

**File:** `supabase/functions/ocr-process/index.ts`

1. **Add cron path detection**: Check `body.cron === true` and skip auth when present (matching the `batch-index` pattern). The cron job is already protected by `verify_jwt = false` in config.toml and the function uses the service role key internally.

2. **Add delay between Pixtral vision calls**: Insert a 2-second delay before each `describeImage()` call to avoid 429 rate limits.

3. **Keep existing auth for non-cron calls**: The N8N secret and JWT auth remain for manual/API invocations.

### Technical Details

The auth section (around line 199) will be restructured:
```text
Before:
  - Always checks N8N secret or JWT

After:
  - If body.cron === true -> skip auth (cron path, use service role)
  - Otherwise -> check N8N secret or JWT (browser/API path)
```

For rate limiting, a `await new Promise(r => setTimeout(r, 2000))` will be added before image description calls.

No database changes needed. The function will be redeployed automatically.
