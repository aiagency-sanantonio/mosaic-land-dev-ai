

# Fix: Reduce Agent Token Usage

## Problem
Each search returns 15-20 document chunks (~1000 chars each) with full `content`, `metadata`, `file_path`, and redundant fields. That's ~15,000-20,000 characters per tool call injected into the agent's context window. Multiply by several tool calls per conversation and context bloats fast.

## Root Causes
1. **Full chunk content returned** — each document chunk is ~1000 chars, all sent back raw
2. **Redundant fields** — `metadata`, `file_path`, `id`, `is_archive`, `confidence` (duplicate of `similarity`) all inflate the response
3. **Too many results by default** — 15-20 results when 8-10 would suffice for most queries
4. **Filter list verbosity** — `list-filter-options` returns chunk counts the agent doesn't need

## Solution: Truncate and slim responses server-side

### Change 1: Truncate content in `search-ranked-documents`
Add a `content_max_length` parameter (default 300). Truncate each chunk's `content` to that limit and strip fields the agent doesn't use for reasoning.

In the enriched document mapping (~line 302), change from returning the full object to a slim version:

```typescript
// Before: full content + all metadata
{ id, content, file_name, file_path, file_url, metadata, similarity, source_type, ... }

// After: truncated content, no metadata blob, no raw file_path
{ file_name, content: doc.content.substring(0, contentMaxLength), source_type, 
  document_date, project_name, similarity, file_url }
```

This cuts each result from ~1200 tokens to ~100-150 tokens.

### Change 2: Reduce default match_count
Change the default `match_count` from 15 to 8 for general queries. The agent prompt already specifies 10-20 — this just makes the edge function default leaner.

### Change 3: Slim the top-level response
Remove `resolved_projects`, `source_type_breakdown`, and `filters_applied` from the response — the agent doesn't need these for answering.

### Change 4: Slim `list-filter-options` response
Remove `chunk_count` from each entry — the agent only needs the names. Return simple string arrays instead of objects:
```json
{ "projects": ["Landon Ridge", "Mosaic"], "doc_types": ["permit", "contract"], "file_types": ["pdf", "xlsx"] }
```

### Implementation

**File: `supabase/functions/search-ranked-documents/index.ts`**
- Add `content_max_length` param (default 300)
- Strip `id`, `metadata`, `file_path`, `is_archive`, `confidence`, `match_reason` from response documents
- Change default `match_count` to 8
- Remove `resolved_projects`, `source_type_breakdown`, `filters_applied` from top-level response

**File: `supabase/functions/list-filter-options/index.ts`**  
- Map the RPC result to simple string arrays (strip `chunk_count`)

**Database: Update `get_filter_options()` function**
- Simplify to return string arrays instead of objects with counts

### Expected Impact
- Per-search token cost drops from ~15,000 to ~2,000-3,000 characters
- Filter discovery drops from ~500 tokens to ~100 tokens
- Overall agent context stays manageable across multi-turn conversations

