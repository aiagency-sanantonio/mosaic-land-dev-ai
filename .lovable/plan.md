

# Fix Indexing: Memory Crash Loop, Case-Sensitive Extensions, and Missing Skip Formats

## Problems Found

### 1. Crash loop causing the hang (CRITICAL)
The file `Exhibit A- Haeckerville Amenity Examples.pptx` is **128MB**. Every cron tick downloads it, exceeds the edge function memory limit, and crashes before the error handler can mark it as failed. It stays unindexed and gets retried forever.

### 2. Case-sensitive extension matching
Extensions like `JPG`, `HEIC`, `MOV`, `PNG`, `PDF` (uppercase) don't match the lowercase sets (`SKIP_EXTENSIONS`, `TEXT_EXTENSIONS`, `EXPORT_EXTENSIONS`). This means ~3,300+ image/video files are being attempted instead of instantly skipped.

### 3. Missing skip extensions
Formats like `dss`, `msg`, `out`, `results`, `bak`, `mjs`, `kml`, `dgn`, `tif`, `MOV`, `webp`, `gif` are not in `SKIP_EXTENSIONS`, so they fall through to processing and waste time.

## Solution

### Edge function changes (`supabase/functions/batch-index/index.ts`)

1. **Add a file size limit for all binary files (not just PDF)**
   - Add a `MAX_OFFICE_SIZE_BYTES` constant of 20MB
   - Skip any PPTX/DOCX/XLSX file over 20MB with a descriptive message
   - This prevents the 128MB .pptx from ever being downloaded

2. **Make extension matching case-insensitive**
   - The `ext` variable is already lowercased on line 306: `.toLowerCase().replace('.', '')`
   - But the `EXPORT_EXTENSIONS` and `SKIP_EXTENSIONS` sets only contain lowercase values
   - The issue is that the `file_extension` column in the database stores the original case (e.g., `JPG`, `HEIC`)
   - Verify the `.toLowerCase()` is applied correctly -- it is, so this should work. The real issue is that some uppercase extensions like `HEIC`, `MOV`, `DNG` are missing from the skip list entirely.

3. **Expand `SKIP_EXTENSIONS` to include all missing formats**
   - Add: `heic`, `heif`, `dng`, `raw`, `cr2`, `nef`, `mov`, `tif`, `dss`, `msg`, `bak`, `mjs`, `out`, `results`, `kml`, `kmz`, `dgn`, `shx`, `dbf`, `dat`, `gif`, `webp`, `csv` (wait -- csv is text, keep it)
   - Actually `msg` (Outlook) and some others could theoretically be parsed, but for now skip them to avoid crashes

4. **Mark the stuck .pptx as skipped via a database update**
   - Insert a record into `indexing_status` for the stuck file so it won't be retried

### No UI changes needed
The progress bar and ETA display from the previous fix will continue working.

## Technical Details

**File: `supabase/functions/batch-index/index.ts`**

- Add `const MAX_OFFICE_SIZE_BYTES = 20 * 1024 * 1024;` near line 18
- Add a size check for Office files (similar to the PDF check at line 330) right after the PDF size check
- Expand `SKIP_EXTENSIONS` set to include: `heic`, `heif`, `dng`, `raw`, `cr2`, `nef`, `mov`, `tif`, `dss`, `msg`, `bak`, `mjs`, `out`, `results`, `kml`, `dgn`, `shx`, `dat`, `gif`, `webp`, `csv` (actually keep csv since it's text-extractable)
- Add missing entries: `heic`, `heif`, `dng`, `mov`, `tif`, `dss`, `msg`, `bak`, `mjs`, `kml`, `dat`, `gif`, `webp`

**Database: mark the stuck file**
- Run a SQL insert to add `indexing_status` record for the 128MB .pptx so the cron stops retrying it immediately

## Expected Impact
- The crash loop stops immediately (stuck file gets marked)
- ~5,000+ image/video/binary files get instantly skipped instead of attempted
- Remaining ~14,000 PDFs and text files process normally
- With the self-chaining at 10 files/batch, should complete in roughly 4-5 hours

