

# Audit: Phase 2 Edge Functions — Issues Found

After reviewing all Phase 2 edge functions, I found the following issues:

## Issue 1: Missing `config.toml` entries (will cause deploy/auth failures)

Three functions exist on disk but are **not registered** in `supabase/config.toml`:
- `list-filter-options`
- `chat-webhook`
- `index-webhook`

Without `verify_jwt = false`, these functions will reject all requests with JWT verification errors.

**Fix:** Add all three to `config.toml`.

## Issue 2: `list-filter-options` has 1000-row limit

This function queries the `documents` table (which has many thousands of rows) with a hard `limit(1000)` on all three queries. It will return an incomplete list of projects, doc types, and file types. The code even has comments acknowledging this (lines 94-99).

**Fix:** Use the same `fetchAll` pagination pattern used in `detect-project-aliases`, or query `indexing_status` / `dropbox_files` for project names instead (lighter weight).

## Issue 3: `query-project-metrics` has 500-row limit

With 19,000+ rows in `project_data`, a broad query (no project filter) will silently truncate results and produce incorrect aggregations.

**Fix:** Either paginate or increase the limit for aggregation queries. Since this is called by N8N with filters, a limit of 1000-2000 with a warning when truncated is reasonable.

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/config.toml` | Add `list-filter-options`, `chat-webhook`, `index-webhook` entries |
| `supabase/functions/list-filter-options/index.ts` | Add pagination to get complete project/doctype/filetype lists |
| `supabase/functions/query-project-metrics/index.ts` | Increase limit and add `truncated` warning flag |

No changes needed for: `detect-project-aliases` (already fixed), `resolve-project-alias`, `compare-projects`, `query-permits`, `query-dd-status`, `search-ranked-documents`, `extract-structured-data`, `process-document` — these all look correct.

