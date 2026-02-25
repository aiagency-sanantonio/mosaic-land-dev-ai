

## Add pg_cron Safety Nets for OCR and Structured Extraction

### Problem
Both the `ocr-process` and `extract-structured-data` edge functions rely on self-chaining (each batch triggers the next via `setTimeout + fetch`). If a chain breaks due to a timeout, network error, or edge function cold-start failure, processing silently stops and requires a manual restart. The `batch-index` function already has a pg_cron job as a safety net -- we need the same for these two.

### Changes

**1. Create pg_cron job for `ocr-process` (every minute)**

A SQL insert (not migration) to schedule a cron job that calls the `ocr-process` function every minute. The function already handles the case where there are no eligible files (returns early), so repeated cron calls when there's nothing to do are harmless.

**2. Create pg_cron job for `extract-structured-data` (every minute)**

Same pattern -- a cron job that POSTs to the extraction function every minute. The function already checks for unprocessed files and returns early if none exist.

**3. Update both edge functions to be idempotent with concurrent calls**

Both functions already query for unprocessed files and process them, so concurrent invocations from cron + self-chain will simply both grab files. Since each file is marked as processed (via `structured_extracted = true` or `status = 'success'`) before the next batch, there's minimal risk of double-processing. No code changes needed -- the existing logic is already safe.

### Technical Details

Two SQL statements using `cron.schedule` and `net.http_post`, matching the existing `batch-index-cron` pattern. Each will:
- Run every minute (`*/1 * * * *`)
- POST to the function URL with the anon key in the Authorization header
- Pass an empty JSON body (or `{"cron": true}`)

The functions' existing auth allows the anon key bearer token (since `verify_jwt = false` in config.toml), so no auth changes are needed.
