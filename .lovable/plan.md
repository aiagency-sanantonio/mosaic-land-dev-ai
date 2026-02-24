

# Improve N8N Agent Tool Calling with Filter-First Search

## Problem

The N8N AI agent currently has a single tool -- "Search Vector Database" -- with only three inputs: `query`, `match_threshold`, and `match_count`. Every question goes through embedding similarity search, which works for general knowledge retrieval but fails for structured queries like:

- "Show me all invoices for Landon Ridge"
- "What permits are expiring for Thea Meadows?"
- "List all contracts for Clearwater Creek"

The `search-documents` edge function already accepts filter parameters (`filter_project`, `filter_file_type`, `filter_date_from`, `filter_date_to`), but the N8N tool doesn't expose them. Additionally, the `project_name` metadata field is unreliable (regex extraction picked up random words like "Total", "Key", "GREEN"). The real project identity lives in the **folder path** (e.g., `/1-Projects/Landon Ridge/...`).

## Solution

A two-part approach: give the agent a **discovery tool** to learn what's available, and upgrade the **search tool** to accept filters that actually work.

### 1. New Edge Function: `list-filter-options`

A lightweight endpoint the agent can call to discover available filter values before searching. Returns:

- **Project folders** (30 real project names from the file path, e.g., "Landon Ridge", "Thea Meadows")
- **Document types** (permit, invoice, contract, report, proposal)
- **File extensions** (pdf, docx, xlsx, csv, etc.)

This lets the agent present accurate options and construct precise filtered queries instead of guessing.

### 2. Update `search-documents` to Filter by Folder Path

Replace the broken `metadata->>'project_name'` filter with a `file_path ILIKE` filter using the actual folder structure. When the agent passes `filter_project = "Landon Ridge"`, the query filters on `file_path ILIKE '%/Landon Ridge/%'`.

Also add a `filter_doc_type` parameter to filter by the `metadata->>'doc_type'` field (permit, invoice, contract, etc.), which is reliably extracted and present on ~261k of ~291k chunks.

### 3. New RPC Function: `match_documents_filtered_v2`

A new Postgres function that:
- Filters by folder path (not metadata project_name)
- Filters by document type
- Filters by file extension
- Filters by date range
- Then ranks remaining results by cosine similarity
- Supports an optional "no embedding" mode where `query` is empty, returning recent documents matching the filters (for browsing use cases)

### 4. N8N Tool Configuration Changes

**Existing tool** ("Search Vector Database") -- add these inputs:
| Input | Type | Description |
|---|---|---|
| `filter_project` | string | Project folder name (e.g., "Landon Ridge"). Call list-filter-options to see available projects. |
| `filter_doc_type` | string | Document type: permit, invoice, contract, report, proposal |
| `filter_file_type` | string | File extension: pdf, docx, xlsx, csv |
| `filter_date_from` | string | ISO date for date range start |
| `filter_date_to` | string | ISO date for date range end |

**New tool** ("List Available Filters") -- single input-free tool that calls `list-filter-options` and returns the available project names, document types, and file types. The agent description should instruct: "Call this tool first when a user asks about a specific project or document type to discover exact filter values."

## Technical Details

### New Edge Function: `supabase/functions/list-filter-options/index.ts`

Executes three lightweight aggregate queries:
```sql
-- Projects (from folder path)
SELECT DISTINCT split_part(file_path, '/', 3) as name, count(*) as chunk_count
FROM documents WHERE file_path LIKE '/1-Projects/%'
GROUP BY name ORDER BY name;

-- Doc types (from metadata)
SELECT metadata->>'doc_type', count(*) FROM documents
WHERE metadata->>'doc_type' IS NOT NULL GROUP BY 1;

-- File extensions
SELECT DISTINCT substring(file_name from '\.([^.]+)$'), count(*) FROM documents GROUP BY 1;
```

Auth: same `N8N_WEBHOOK_SECRET` bearer token pattern as existing functions.

### New RPC: `match_documents_filtered_v2`

```sql
CREATE FUNCTION match_documents_filtered_v2(
  query_embedding_text text DEFAULT NULL,
  match_threshold float DEFAULT 0.15,
  match_count int DEFAULT 15,
  filter_project text DEFAULT NULL,
  filter_doc_type text DEFAULT NULL,
  filter_file_type text DEFAULT NULL,
  filter_date_from timestamptz DEFAULT NULL,
  filter_date_to timestamptz DEFAULT NULL
)
```

Key difference from `match_documents_with_filters`: uses `file_path ILIKE '%/' || filter_project || '/%'` instead of `metadata->>'project_name'`. When `query_embedding_text` is NULL, skips similarity ranking and returns by `created_at DESC`.

### Updated `search-documents/index.ts`

- Accept `filter_doc_type` as a new parameter
- Route to `match_documents_filtered_v2` instead of the old `match_documents_with_filters`
- Auto-detect `use_filters` from whether any filter parameter is non-null (remove the explicit `use_filters` flag)

### Updated `supabase/config.toml`

Add entry for the new function:
```toml
[functions.list-filter-options]
verify_jwt = false
```

### Files changed
- `supabase/functions/list-filter-options/index.ts` -- new file
- `supabase/functions/search-documents/index.ts` -- update to use v2 RPC and new filters
- `supabase/config.toml` -- add new function config
- Database migration -- create `match_documents_filtered_v2` RPC function

### Files unchanged
- `chat-webhook/index.ts` -- still just proxies to N8N
- All frontend files -- no UI changes needed
- N8N workflow configuration -- must be updated manually by you in the N8N editor (add the new inputs to the tool node and create a second tool node for `list-filter-options`)

