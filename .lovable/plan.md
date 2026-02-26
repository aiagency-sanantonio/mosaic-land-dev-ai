

## Fix: N8N Search Tool Description to Enforce Complete Schema

### Problem
The agent frequently omits filter fields from the search request body, which causes JSON serialization issues in N8N (empty interpolation slots instead of `null`). The current tool description doesn't make it clear that **every parameter must be included in the request**, even when not being used.

### Solution
Rewrite the tool description to explicitly list all required fields with their defaults, and instruct the agent to always send the complete schema.

### Updated Tool Description

Replace the current description with:

```
Search the indexed document database using semantic similarity, metadata filters, 
or both. At least one of "query" or a filter must be provided.

IMPORTANT: You MUST include ALL parameters in every request. Set unused parameters 
to null — do NOT omit them.

Before using any filter, call "List Available Filters" first to get exact valid values.

Parameters (ALL required in every request):
- query (string or null): Natural language search text. Set to null for browse/filter-only mode.
- match_count (number): How many results to return. Use 20 for broad questions, 10 for specific lookups.
- match_threshold (number): Similarity threshold. Use 0.15 for broad, 0.2 for specific.
- filter_project (string or null): Exact project folder name from "List Available Filters". Set to null if not filtering by project.
- filter_doc_type (string or null): Document type from "List Available Filters" (e.g., "permit", "invoice", "contract"). Set to null if not filtering by type.
- filter_file_type (string or null): File extension from "List Available Filters" (e.g., "pdf", "xlsx"). Set to null if not filtering by extension.
- filter_date_from (string or null): Start date in YYYY-MM-DD format. Set to null if no date filter.
- filter_date_to (string or null): End date in YYYY-MM-DD format. Set to null if no date filter.

Example request body:
{
  "query": "drainage easement",
  "match_count": 15,
  "match_threshold": 0.15,
  "filter_project": "Landon Ridge",
  "filter_doc_type": null,
  "filter_file_type": "pdf",
  "filter_date_from": null,
  "filter_date_to": null
}

If only filters are provided with no query (query: null), results are returned in 
reverse chronological order (browse mode).
```

### What Changed
- Listed every parameter explicitly with type and default behavior
- Added "ALL required in every request" and "do NOT omit them" instructions
- Included a concrete example JSON body showing null usage
- Kept the "List Available Filters" requirement and browse mode explanation

### Where to Apply
Paste this into the N8N AI Agent's tool description field for the Search tool (the HTTP Request node that calls the `search-documents` edge function).

