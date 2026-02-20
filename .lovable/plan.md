

## Solution: Python Script for Reliable Bulk Indexing

### Why the Current Setup Keeps Failing

The `process-document` edge function has a ~60 second execution limit. For large documents that produce many chunks, the embedding generation (even at 5 per batch with delays) can exceed this. When N8N sends many documents in parallel, multiple edge function instances timeout simultaneously, causing N8N to error and stop the workflow.

### Recommended Approach: Local Python Script

A Python script running on your machine (or a server) bypasses both the edge function timeout and N8N execution limits. It can:

- Run for hours without any timeout
- Process documents one at a time, sequentially
- Automatically skip already-indexed files
- Resume from where it left off if interrupted
- Log progress clearly

### How It Works

1. Call `query-dropbox-files` to get unindexed file paths
2. For each file, download content from Dropbox using the Dropbox API
3. Chunk the text, generate embeddings via OpenAI, and insert directly into the database
4. Update `indexing_status` after each file
5. Add delays between files to avoid rate limits

### What You Need

- Python 3.8+ installed
- `pip install openai supabase dropbox` (three packages)
- Your existing API keys: OpenAI API key, Supabase URL + service role key, Dropbox access token

### The Script

The script would:

```text
For each unindexed file:
  1. Download from Dropbox
  2. Extract text (handle PDF/DOCX/etc)
  3. Split into chunks (same logic as current edge function)
  4. Generate embeddings via OpenAI (with retry + backoff)
  5. Insert chunks into 'documents' table
  6. Update 'indexing_status' to 'success'
  7. Print progress: "Processed 142/26062: filename.pdf (8 chunks)"
  8. Wait 500ms before next file
```

If the script is interrupted, re-running it automatically picks up where it left off (it queries for unindexed files each time).

### What Changes in Lovable

**No code changes needed.** The existing `process-document` edge function stays as-is for future single-document indexing (e.g., when N8N detects a new file). The Python script is only for the initial bulk backfill.

### Alternative: Keep N8N But Fix the Flow

If you prefer staying in N8N, the fix is to configure the workflow to:
- Process files **one at a time** (not in parallel)
- Add a **Wait node** (2-3 seconds) between each document
- Use **error handling** on the HTTP node to continue on failure instead of stopping
- Process in batches of 500 using `limit` and `offset` instead of `fetch_all: true`

This would work but will be much slower than the Python script since each call still has the edge function overhead.

### Recommendation

Use the **Python script for the initial bulk indexing** of 26,000 files, then keep the N8N workflow for **ongoing incremental indexing** of new/changed files (where it only processes a handful at a time and won't hit these limits).

I can provide the complete Python script ready to run if you'd like to proceed with this approach.

