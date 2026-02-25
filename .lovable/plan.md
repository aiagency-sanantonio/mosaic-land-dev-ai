
## Fix Extract-Structured-Data: Two Critical Bugs

### Problem 1: Only fetches 1,000 files (out of 9,475)
The query on line 282 has `.limit(1000)`, so it never sees more than the first 1,000 files alphabetically. This is why logs always say "1000 remaining."

### Problem 2: Files with no extracted data loop forever
The skip logic checks if a file has rows in `project_data`, `permits_tracking`, or `dd_checklists`. But most files (maps, surveys, images-as-PDFs) extract 0 metrics, 0 permits, 0 DD items -- so nothing gets inserted, and they're never marked as "done." The same 10 files get reprocessed on every self-chain call.

### Solution

**1. Add a tracking column to `indexing_status`** (database migration)

Add a boolean column `structured_extracted` (default `false`) to the `indexing_status` table. After each file is processed (even if 0 items were extracted), set it to `true`.

```sql
ALTER TABLE indexing_status 
ADD COLUMN structured_extracted boolean NOT NULL DEFAULT false;
```

**2. Rewrite the file selection query in the edge function**

Instead of fetching 1,000 files and then filtering client-side, query directly for files where `status = 'success' AND structured_extracted = false`. This:
- Removes the 1,000-file cap (use pagination instead)
- Eliminates the need for the 3-table skip-check
- Properly marks files as done even when they yield no structured data

**3. Mark files as extracted after processing**

After each file completes (success or no data), update `indexing_status` to set `structured_extracted = true` for that file path.

### Technical Changes

**Database migration:**
- Add `structured_extracted` boolean column to `indexing_status`

**Edge function (`supabase/functions/extract-structured-data/index.ts`):**
- Replace the `.limit(1000)` query + 3-table skip-check with a single query: `indexing_status WHERE status='success' AND structured_extracted=false`, limited to `batchSize`
- After processing each file, run `UPDATE indexing_status SET structured_extracted=true WHERE file_path=...`
- Keep the self-chaining logic as-is
- Increase default batch_size from 10 to 50 for faster throughput

**Admin UI (`src/pages/AdminIndexing.tsx`):**
- Update the extraction card to show overall progress (query count of `structured_extracted=true` vs total success files)
- Add a progress bar for extraction status

### Verifying the test run worked
The logs confirm the test run did process files -- 5 unique files got data in `project_data` (13 rows total). But it kept looping over the same 10 files because the "0m 0p 0d" files were never marked as done. The fix will prevent this infinite loop.
