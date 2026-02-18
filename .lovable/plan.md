
## Update `indexing-status` to Return All Records

### The Problem

There are **4,764 records** in the `indexing_status` table. The current API has two blockers to returning them all:

1. The default page size is 100, with a hard cap of 1,000 passed through to the user
2. The database itself caps any single query at 1,000 rows

Neither increasing `limit` nor removing it will work alone — a single query simply cannot fetch more than 1,000 rows.

### The Solution: Internal Pagination Loop

Add a `fetch_all` boolean parameter. When `true`, the function will loop through the database in pages of 1,000, collecting all results internally, then return them as a single combined response.

This is invisible to N8N — you just send `{"fetch_all": true}` and get back every matching record in one JSON response.

---

### New Parameter

```
{
  "fetch_all": true,   // NEW: bypasses limit, fetches all pages internally
  
  // All existing filters still work as before:
  "status_filter": "success",
  "path_prefix": "/1-Projects/",
  "date_from": "2026-01-01",
  "date_to": "2026-02-18"
}
```

### How It Works (Internal Loop)

```text
Page 1: rows 0–999    → fetch
Page 2: rows 1000–1999 → fetch
Page 3: rows 2000–2999 → fetch
Page 4: rows 3000–3999 → fetch
Page 5: rows 4000–4764 → fetch (764 rows — loop ends)

All pages combined → single JSON response
```

The loop stops automatically when a page returns fewer rows than the page size (1,000), meaning it has hit the end.

---

### Technical Changes

**File:** `supabase/functions/indexing-status/index.ts`

1. Add `fetch_all` as a new optional boolean parameter (defaults to `false`)
2. When `fetch_all` is `true`:
   - Run a loop, fetching 1,000 records at a time using `.range(offset, offset + 999)`
   - Apply all existing filters (`status_filter`, `path_prefix`, `date_from`, `date_to`) to each page
   - Collect all results into one array
   - Stop when a page returns fewer than 1,000 rows
3. When `fetch_all` is `false` (default): existing behavior is unchanged — `limit` and `offset` work as before

No database changes needed. No new secrets needed.

---

### N8N Usage for Deduplication Check

To get the complete list of already-indexed file paths for filtering in N8N:

```json
{
  "status_filter": "success",
  "fetch_all": true
}
```

This returns all 1,400 successfully indexed file paths in a single call. N8N can then build a lookup Set from the `file_path` field of each record and skip any Dropbox file that already appears in that set.
