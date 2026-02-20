

## Python Bulk Indexing Script

This script runs on your computer and processes all 26,000+ files without any timeout limits. It handles everything end-to-end: fetches unindexed file paths from your database, downloads each file from Dropbox, extracts text, generates embeddings, and stores everything back in your database.

### Current State

| Status | Count |
|--------|-------|
| Success | 611 |
| Skipped | 571 |
| Failed | 12 |
| Remaining | ~26,062 |

### File Types to Process vs Skip

**Will vectorize (~19,500 files):**
- PDF: 16,598
- DOCX: 1,115
- XLSX: 877
- XLS: 279
- EML: 246
- DOC: 220
- PPTX: 140
- MSG: 108
- CSV: 30
- LOG: 32
- TXT and others

**Will skip (~7,700 files):**
- Images: JPG, JPEG, PNG, HEIC, TIF, DNG (~4,500)
- CAD: DWG, DGN (~408)
- Video: MOV, MP4 (~296)
- Archives: ZIP (~131)
- Fonts: TTF (~30)
- GIS: KMZ, KML, SHX (~144)
- Other binary: BAK, MJS (~126)

### What the Script Does

```text
1. Connect to your database and Dropbox
2. Fetch all unindexed file paths from the database
3. For each file:
   a. Check extension -- skip images, video, CAD, etc.
   b. Download from Dropbox
   c. Extract text (PDF, DOCX, XLSX, EML, CSV, TXT)
   d. Skip if content is too short (< 50 chars)
   e. Split into ~1000-character chunks with 200-char overlap
   f. Extract metadata (costs, dates, project names, permits)
   g. Generate embeddings via OpenAI (batch of 5, with retry)
   h. Insert chunks into 'documents' table
   i. Update 'indexing_status' to 'success'
   j. Print progress: "Processed 142/19500: filename.pdf (8 chunks)"
   k. Wait 500ms before next file
4. If interrupted, re-run and it picks up where it left off
```

### What You Need to Run It

1. Python 3.8+ installed on your computer
2. Install packages: `pip install openai supabase dropbox PyPDF2 python-docx openpyxl`
3. Four environment variables (or paste directly into the script):
   - `SUPABASE_URL` -- your project URL
   - `SUPABASE_SERVICE_ROLE_KEY` -- your service role key
   - `OPENAI_API_KEY` -- your OpenAI key
   - `DROPBOX_ACCESS_TOKEN` -- your Dropbox access token
4. Run: `python bulk_index.py`

### What Changes in Your Lovable Project

**No code changes needed.** The script talks directly to your database and OpenAI. The existing backend functions stay as-is for future single-file indexing via N8N.

### The Script Will Be Created As

A single file `bulk_index.py` placed in the project root. It is a standalone Python script (not part of the web app) meant to be downloaded and run locally on your machine.

### Technical Details

- Uses the same chunking logic (1000 chars, 200 overlap) as the existing `process-document` function
- Uses the same metadata extraction (costs, dates, projects, permits, doc types)
- Uses `text-embedding-3-small` model (same as current)
- Retries OpenAI calls with exponential backoff on 429/5xx errors
- Processes files sequentially to avoid rate limits
- Logs every file processed with chunk count and running total
- Marks non-vectorizable files as "skipped" in the database so they are not retried

