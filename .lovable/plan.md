
## Add Indexing Status API Endpoint

### What It Does

A new backend function (`indexing-status`) that exposes the `indexing_status` table over a secure HTTP API, allowing N8N, dashboards, or any external tool to query the indexing state of files.

### Security

Uses the same `N8N_WEBHOOK_SECRET` authorization that `process-document` and `search-documents` already use. No new secrets needed.

---

### API Design

**Endpoint:** `POST /functions/v1/indexing-status`

**Request body (all fields optional):**

```text
{
  "status_filter": "failed",          // "success" | "failed" | "skipped" | "pending" | null (all)
  "path_prefix": "/1-Projects/",      // filter by Dropbox folder prefix
  "date_from": "2026-01-01",          // indexed_at >= this date
  "date_to": "2026-02-18",            // indexed_at <= this date
  "summary_only": false,              // if true, only return counts per status
  "limit": 100,                       // max records to return (default 100)
  "offset": 0                         // for pagination
}
```

**Response:**

```text
{
  "success": true,
  "summary": {
    "success": 1400,
    "failed": 3,
    "skipped": 3360,
    "pending": 1,
    "total": 4764
  },
  "records": [
    {
      "file_path": "/1-Projects/...",
      "file_name": "Invoice.pdf",
      "status": "failed",
      "chunks_created": 0,
      "error_message": "...",
      "indexed_at": null,
      "created_at": "2026-02-04T..."
    }
  ],
  "total_returned": 3
}
```

---

### Technical Implementation

**New file:** `supabase/functions/indexing-status/index.ts`

The function will:
1. Validate the `Authorization: Bearer <N8N_WEBHOOK_SECRET>` header
2. Parse optional filters from the request body
3. Query `indexing_status` table using the Supabase service role client
4. Always return a summary counts object plus the filtered records
5. Support pagination via `limit` / `offset`

**No database changes needed** — the `indexing_status` table and its RLS policies are already in place. The edge function uses the service role key which bypasses RLS.

---

### N8N Use Cases This Enables

- **Re-index failed files**: Filter `status=failed`, loop over results, re-send each `file_path` to `process-document`
- **Coverage check**: Before indexing a Dropbox folder, call with `path_prefix` to see what's already done
- **Audit trail**: Pull all files indexed in a date range to confirm a batch completed successfully
- **Skip duplicates**: Check if a `file_path` already has `status=success` before sending to `process-document`
