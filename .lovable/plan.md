

# Auto-Populate Project Aliases

## Approach
Two complementary mechanisms — no manual entry needed.

### 1. Batch alias discovery edge function (`detect-project-aliases`)
- Scans `project_data.project_name` grouped by the folder extracted from `source_file_path`
- Also scans `documents.metadata->>'project_name'` and `permits_tracking.project_name`
- Groups all distinct names that share the same `/1-Projects/X/` path prefix
- For each group with 2+ distinct names, picks the most frequent as canonical and inserts the rest as aliases
- Idempotent — skips existing alias pairs
- Can be called manually or on a schedule

### 2. Hook in `process-document` indexing
- After LLM extraction, compare the extracted `project_name` against the folder name from `file_path`
- If they differ meaningfully (not just casing), upsert into `project_aliases`
- Lightweight — just one extra insert per document when a mismatch is found

### Database
No schema changes — uses the existing `project_aliases` table.

### Files

**New**: `supabase/functions/detect-project-aliases/index.ts`
- Queries `project_data`, `documents`, `permits_tracking` for distinct project names per path prefix
- Groups and inserts aliases
- Returns a summary of what was found/created

**Modified**: `supabase/functions/process-document/index.ts`
- After `storeStructuredData`, extract folder name from path and compare to extracted project names
- If mismatch, upsert alias row

**Modified**: `supabase/config.toml`
- Register `detect-project-aliases` with `verify_jwt = false`

### N8N note
After running the batch scan once, aliases will be populated. Future indexing keeps them current automatically. No N8N changes needed.

