

# Fix Indexing: Token Expiry Race Condition and Unicode File Paths

## Problems Found

### 1. Token expiry marks job as "failed" (root cause of the hang)
The Dropbox access token (short-lived, ~4 hours) expired mid-run. The error handler at line 543 detects any error containing "401" and marks the entire job as "failed". Additionally, a race condition in the self-chaining mechanism causes a concurrent batch to overwrite `last_error` to null, hiding the actual error message.

### 2. Unicode characters in file paths break Dropbox API calls (4 failures)
Files with em-dash characters (e.g., `Cibolo–Mosaic`) in their paths cause `Failed to construct 'Request': 'headers' of 'RequestInit' is not a valid ByteString`. The `Dropbox-API-Arg` header only accepts ASCII. The Dropbox API requires non-ASCII characters to be JSON-escaped (e.g., `\u2013`).

### 3. "Unknown error" failures (20 files)
These are PDFs where the error message was not properly captured -- the `err.message` was empty or the error was a non-Error object. These files should be retried after the other fixes.

## Solution

### Fix 1: Proper token refresh handling in `batch-index/index.ts`
- Refresh the Dropbox token proactively if it has been running for extended periods
- When a 401 error occurs at the job level, **do not** mark the job as permanently failed. Instead, keep it as "running" so the next cron tick can retry with a fresh token
- Only mark as "failed" if the token refresh itself fails (meaning credentials are invalid, not just expired)

### Fix 2: Encode the `Dropbox-API-Arg` header for non-ASCII paths
- In both `exportFromDropbox` and `downloadBinaryFromDropbox`, use `JSON.stringify()` with a replacer that escapes non-ASCII characters, or use a utility to ensure the header value is valid ASCII
- The Dropbox API supports JSON-escaped unicode in the `Dropbox-API-Arg` header (this is documented behavior)

### Fix 3: Race condition in self-chain updates
- Re-check the job status before updating stats. If the job was already marked as "failed" or "stopped" by another chain, skip the update
- This prevents a successful batch from overwriting the error message set by a failed batch

### Fix 4: Reset failed files for retry
- Update the 20 "Unknown error" files in `indexing_status` to delete their records so they get retried
- The 4 ByteString files will be retried automatically once Fix 2 is deployed

## Technical Details

**File: `supabase/functions/batch-index/index.ts`**

**Dropbox-API-Arg encoding (Fix 2):**
- Create a helper function `safeDropboxArg(obj)` that converts `JSON.stringify(obj)` to ASCII by replacing any character above U+007F with its `\uXXXX` escape sequence
- Use this helper in both `exportFromDropbox` (line 151) and `downloadBinaryFromDropbox` (line 190) for the `Dropbox-API-Arg` header value

**Token error handling (Fix 1):**
- Change line 543-556: Only mark job as "failed" if the error is from `getDropboxAccessToken()` itself (token refresh failure), not from per-file 401 errors
- For transient 401 errors, keep the job "running" and let the self-chain retry with a fresh token

**Race condition (Fix 3):**
- Before updating job stats (line 514), re-fetch the job status
- If the job is no longer "running" (was stopped or failed by another chain), skip the stats update

**Database: reset failed files for retry:**
- Delete `indexing_status` records where `error_message = 'Unknown error'` (20 records) so they are picked up again on the next run

## Expected Impact
- The 4 em-dash files will process successfully
- The 20 "Unknown error" files get a fresh retry
- Token expiry no longer kills the entire indexing job -- it self-heals on the next batch
- No more silent `last_error: null` when a job fails
