

# Fix: Batch Alias Detection Pagination

## Problem
The `detect-project-aliases` function queries `project_data` (19,287 rows), `permits_tracking` (1,137 rows), and `dd_checklists` (557 rows) using the Supabase client, which defaults to a **1,000-row limit**. Most data is never seen, so no aliases get created.

## Solution
Update `detect-project-aliases/index.ts` to paginate all three queries using `.range()` in batches of 1,000 until all rows are consumed.

Additionally, add a smarter canonical name selection: use the **folder name** as canonical (since that's the stable identifier) rather than the most frequent extracted name. Many extracted names are document titles or legal descriptions, not actual project names.

## Changes

### `supabase/functions/detect-project-aliases/index.ts`
- Add a `fetchAll` helper that paginates `.select()` calls in batches of 1,000
- Use it for all three table queries
- Change canonical name logic: always use the folder name as canonical, all other distinct names become aliases
- Filter out aliases that are clearly document titles (very long names, contain "acres field notes", etc.) — optional heuristic to reduce noise
- Lower the threshold: create aliases even when there's only 1 distinct name that differs from the folder name (currently requires `< 2` distinct names)

## File changed
- `supabase/functions/detect-project-aliases/index.ts` — pagination + canonical logic fix

