

## Update `retrieveDocuments` with name-variation fallback

### What changes

Modify `retrieveDocuments` in `supabase/functions/chat-rag/index.ts` (lines 158-204) to try multiple project name variations and fall back to an unfiltered search if results are sparse.

### Logic

1. **Build name variations** from the classified `projectName`:
   - The original name (e.g. `"Landon Ridge"`)
   - Common prefixes/suffixes: `"<name> MLP"`, `"SA <name>"`, `"MLP <name>"`
   - These cover the most common alias patterns in the data

2. **First attempt**: Call `search-ranked-documents` with `filter_project` set to the original `projectName` (current behavior).

3. **Check result count**: If fewer than 3 documents come back, **retry** with `filter_project: null` but prepend the project name to the query string (e.g. `"Landon Ridge: <original message>"`) so vector similarity still prioritizes relevant docs.

4. **Merge & deduplicate**: Combine results from both calls, deduplicate by document `id`, keep the higher-similarity hit when duplicates exist.

5. **No project name → skip variations**: If `projectName` is null, make a single call as today.

### Changes

**File: `supabase/functions/chat-rag/index.ts`** — replace `retrieveDocuments` function (lines 158-204):

- Add a helper to call `search-ranked-documents` with given params
- First call with `filter_project: projectName`
- If `docs.length < 3`, retry with `filter_project: null`, `query: "${projectName}: ${message}"`
- Deduplicate by `id`, format and return

Single file change. No database migrations.

