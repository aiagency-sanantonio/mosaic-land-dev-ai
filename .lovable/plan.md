
## Dropbox File Discovery Log

### What This Solves

Right now, your system only learns about a file *after* N8N tries to index it. There's no pre-flight inventory — no record of what Dropbox files exist independently of whether they've been vectorized. This makes it hard to:
- Know what files are waiting to be processed
- Detect files that were missed or skipped by accident
- Build a "what's left to index?" queue
- Track Dropbox file changes over time (new files, moved files, deleted files)

This adds a `dropbox_files` table that N8N populates on every scan, giving you a complete, up-to-date map of Dropbox *before* any vectorization decisions happen.

---

### New Table: `dropbox_files`

This stores everything Dropbox tells you about a file, plus a derived status so you can immediately tell what's been vectorized and what hasn't.

| Column | Type | Purpose |
|---|---|---|
| `file_path` | text (unique) | Full Dropbox path — the primary key for matching |
| `file_name` | text | Just the filename, useful for display |
| `file_extension` | text | `.pdf`, `.docx`, etc — useful for filtering by type |
| `file_size_bytes` | bigint | Size in bytes — useful to predict processing time |
| `dropbox_id` | text | Dropbox's own stable file ID (survives renames) |
| `content_hash` | text | Dropbox content hash — detect if file changed since last scan |
| `dropbox_modified_at` | timestamptz | When Dropbox says the file was last modified |
| `discovered_at` | timestamptz | When N8N first logged this file |
| `last_seen_at` | timestamptz | Updated on every scan — lets you detect deleted files |
| `created_at` / `updated_at` | timestamptz | Standard tracking |

A **computed column** isn't needed — N8N (or the app) will join against `indexing_status` on `file_path` to derive the vectorization state on-demand. This keeps the two tables independent and avoids sync issues.

---

### New Edge Function: `log-dropbox-files`

N8N calls this at the start of every scan, passing a batch of file objects. The function upserts them all in one call.

**Endpoint:** `POST /functions/v1/log-dropbox-files`

**Auth:** Same `Authorization: Bearer <N8N_WEBHOOK_SECRET>` header as all other functions.

**Request body:**
```json
{
  "files": [
    {
      "file_path": "/1-Projects/Lot 42/invoice.pdf",
      "file_name": "invoice.pdf",
      "file_extension": ".pdf",
      "file_size_bytes": 204800,
      "dropbox_id": "id:abc123",
      "content_hash": "a1b2c3d4...",
      "dropbox_modified_at": "2026-02-10T14:30:00Z"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "upserted": 312,
  "total_received": 312
}
```

The function uses `upsert` with `onConflict: 'file_path'` so re-scanning is safe — existing records get their `last_seen_at` and `content_hash` updated, new files get inserted.

---

### New Query Edge Function: `query-dropbox-files`

A read API (same pattern as `indexing-status`) so N8N or the app can query the inventory with filters.

**Endpoint:** `POST /functions/v1/query-dropbox-files`

**Request body (all optional):**
```json
{
  "extension_filter": ".pdf",
  "path_prefix": "/1-Projects/",
  "not_yet_indexed": true,
  "changed_since_indexed": true,
  "fetch_all": false,
  "limit": 100,
  "offset": 0
}
```

The `not_yet_indexed` flag joins against `indexing_status` to return only files with no `success` record — the most useful filter for building your N8N indexing queue. The `changed_since_indexed` flag returns files whose `content_hash` or `dropbox_modified_at` changed after their last successful index, so you can re-index updated files automatically.

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_files": 4900,
    "not_yet_indexed": 3500,
    "indexed": 1400
  },
  "records": [...],
  "total_returned": 100
}
```

---

### N8N Workflow Integration

Your updated N8N indexing flow would look like:

```text
1. Dropbox List Files (all files in folder)
        ↓
2. HTTP POST → log-dropbox-files  ← NEW: log everything first
        ↓
3. HTTP POST → query-dropbox-files  ← NEW: get only un-indexed files
   { "not_yet_indexed": true, "fetch_all": true }
        ↓
4. Loop: for each file
        ↓
5. Dropbox Get File Content
        ↓
6. HTTP POST → process-document  ← existing, unchanged
```

This replaces the current approach of calling `indexing-status` mid-workflow to deduplicate — instead, the deduplication happens at step 3 and gives you a clean list to iterate.

---

### Technical Changes

1. **Database migration** — Create the `dropbox_files` table with appropriate RLS (service role can manage, authenticated users can view)

2. **New edge function** — `supabase/functions/log-dropbox-files/index.ts` — bulk upsert endpoint for N8N to call during scans

3. **New edge function** — `supabase/functions/query-dropbox-files/index.ts` — filtered query endpoint with `not_yet_indexed`, `changed_since_indexed`, and `fetch_all` support

4. **Update `supabase/config.toml`** — register both new functions with `verify_jwt = false`

No changes to existing functions, tables, or RLS policies.
