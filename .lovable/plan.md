

## Fix: Document search timeout caused by alias resolution explosion

### Problem

When a user asks about "Landon Ridge", the `search-ranked-documents` function resolves it to **80+ project aliases** via the `project_aliases` table. It then loops through every single alias calling `match_documents_filtered_v2` sequentially — that's 80+ individual vector search RPC calls. This causes a Postgres statement timeout (`code: "57014"`), which surfaces as a 500 error. The first attempt fails; sometimes a retry succeeds if caching kicks in.

The logs confirm this:
- `Resolved "Landon Ridge" → [80+ names]`
- `canceling statement due to statement timeout`

### Fix

Instead of looping through each alias individually, pass all resolved project names into a **single** RPC call. The `match_documents_filtered_v2` function currently accepts a single `filter_project` string. Two options:

**Option chosen**: Filter by project in application code instead of per-alias RPC calls.
1. Call `match_documents_filtered_v2` **once** with `filter_project = null` (no project filter) when there are many aliases (say > 5)
2. Then filter the results in JS by checking if each document's project name matches any of the resolved aliases
3. For small alias sets (≤ 5), keep the current loop behavior since it's fast enough

This avoids modifying the database function and keeps the fix contained to the edge function.

### Changes

**File: `supabase/functions/search-ranked-documents/index.ts`**

Replace the loop at lines 266-285 with:
- If `resolvedProjects.length <= 5`: keep existing per-project loop
- If `resolvedProjects.length > 5`: run a single unfiltered query, then filter results in JS by checking if the document's file_path or metadata project_name matches any resolved alias (case-insensitive)
- Increase `initialMatchCount` for the unfiltered query to compensate (e.g., `match_count * 3`)

### Technical detail

```text
Before:  80 aliases → 80 sequential RPC calls → timeout
After:   80 aliases → 1 RPC call (no project filter) → JS filter → fast
```

No database migrations needed. Single file change.

