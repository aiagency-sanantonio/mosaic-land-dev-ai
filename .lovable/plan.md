

## Hybrid Bulk Indexing -- Button in Your App, No Keys Needed

### Overview

A new backend function processes 10 files per call using secrets already stored in your backend. Your app gets an admin page where you click "Start Indexing" and watch progress. Estimated time: **12-18 hours** for ~19,500 files.

### What You Need to Provide

**One thing only:** A Dropbox Access Token, which I'll securely store as a backend secret. You get this from [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) under Settings > OAuth 2 > Generate access token.

Since the run may take 12-18 hours and Dropbox tokens expire after ~4 hours, we'll build in support for you to update the token mid-run if needed (you'd just paste a new one and click resume).

---

### What Gets Built

**1. New backend function: `batch-index`**
- Fetches 10 unindexed files from the database (using existing `get_unindexed_dropbox_files` RPC)
- Marks non-vectorizable files (images, CAD, video, etc.) as "skipped" in bulk
- For each vectorizable file:
  - Downloads content from Dropbox API using the stored token
  - Extracts text (handles PDF via a lightweight Deno PDF parser, plus plain text formats like CSV, TXT, EML, HTML, XML)
  - Chunks text (1000 chars, 200 overlap -- same as existing system)
  - Generates embeddings via OpenAI (already stored)
  - Inserts chunks into `documents` table
  - Updates `indexing_status`
- Returns `{ processed, skipped, failed, remaining, errors }` so the frontend knows progress

**2. New admin page: `/admin/indexing`**
- Protected route (requires login)
- "Start Indexing" button that calls `batch-index` in a loop
- Live progress: files processed, remaining, success/skip/fail counts
- Log of recent files processed
- "Stop" button to pause (just stops the loop -- resume anytime)
- Status persists in React state so you see where things stand

**3. Navigation update**
- Add a link/button in the chat sidebar to access the indexing admin page

---

### File Type Handling

The backend function handles text extraction for common formats natively in Deno:
- **PDF**: Using a lightweight Deno-compatible PDF text extraction library
- **TXT, LOG, MD, CSV, HTML, XML, JSON, RTF**: Direct text read
- **EML**: Basic email header + body parsing
- **DOCX, XLSX, DOC, PPTX**: Attempted as plain text (may extract partial content)
- **Images, video, CAD, archives, fonts**: Automatically skipped

---

### How the Loop Works

```text
User clicks "Start Indexing"
    |
    v
Frontend calls batch-index (10 files)
    |
    v
Function returns: { processed: 8, skipped: 2, remaining: 19,480 }
    |
    v
Frontend updates progress bar, calls again
    |
    v
... repeats until remaining = 0 or user clicks "Stop"
```

---

### Technical Details

**New files to create:**
- `supabase/functions/batch-index/index.ts` -- the batch processing function
- `src/pages/AdminIndexing.tsx` -- the admin UI page

**Files to modify:**
- `src/App.tsx` -- add route for `/admin/indexing`
- `src/components/chat/ChatSidebar.tsx` -- add navigation link to admin page
- `supabase/config.toml` -- add `[functions.batch-index]` entry

**Secrets needed:**
- `DROPBOX_ACCESS_TOKEN` -- new, will prompt you to add it

**Existing secrets used (no action needed):**
- `OPENAI_API_KEY` -- already stored
- `SUPABASE_SERVICE_ROLE_KEY` -- available in the environment
- `SUPABASE_URL` -- available in the environment

**Performance estimate:**
- 10 files per batch, ~30-45 seconds per batch
- ~1,950 batches for 19,500 files
- ~12-18 hours total (well under 1 day)

