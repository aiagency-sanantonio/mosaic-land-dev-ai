

## Build `extract-structured-data` Edge Function

A new lightweight edge function that reads existing document content from the `documents` table and runs the LLM structured extraction to populate `project_data`, `permits_tracking`, and `dd_checklists` -- without re-chunking or re-embedding.

### How It Works

1. Query `indexing_status` for all files with `status = 'success'`
2. For each file, grab the first chunk from `documents` (chunk_index 0) to get representative content
3. Run the same `gpt-4o-mini` extraction logic already in `process-document`
4. Store results in the three structured tables
5. Self-chain (like `batch-index` does) to process in batches without timing out

### Technical Details

**New file: `supabase/functions/extract-structured-data/index.ts`**

- Processes files in batches of 10 (same pattern as `batch-index`)
- For each file, concatenates its document chunks (up to 6000 chars) to feed to the LLM
- Reuses the exact same OpenAI tool-calling prompt and `storeStructuredData` logic from `process-document`
- Skips files that already have entries in `project_data`, `permits_tracking`, or `dd_checklists` (unless `force: true` is passed)
- Self-chains to process the next batch automatically
- Tracks progress via a simple stats object returned in the response
- Auth: uses `N8N_WEBHOOK_SECRET` like all other functions

**Config: `supabase/config.toml`**

- Add `[functions.extract-structured-data]` with `verify_jwt = false`

### Request Format

```json
POST /extract-structured-data
Authorization: Bearer <N8N_WEBHOOK_SECRET>

{
  "force": false,        // re-extract even if structured data exists
  "batch_size": 10,      // files per batch
  "project_filter": null // optional: only process files matching this project path
}
```

### Response

```json
{
  "processed": 10,
  "skipped": 2,
  "failed": 1,
  "remaining": 487,
  "totals": { "metrics": 15, "permits": 3, "dd_items": 8 },
  "errors": [{ "file": "path/to/file", "error": "..." }]
}
```

### Cost Estimate

- ~9,500 files x ~6,000 chars each at gpt-4o-mini rates = roughly $0.50-$1.00 total
- No embedding costs since we skip that entirely

