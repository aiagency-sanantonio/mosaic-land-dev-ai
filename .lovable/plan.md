

## Plan: Fix Missing Dropbox Links in Chat Responses

### Root Cause

The `formatDocs` function in `chat-rag/index.ts` (line 643) calls `buildDropboxUrl(d.file_path)` to generate Dropbox links. But the documents returned by `search-ranked-documents` don't include `file_path` — they include a pre-built `file_url` field instead. So `d.file_path` is always `undefined`, `buildDropboxUrl` returns `null`, and no links appear in the response.

### Fix

Update `formatDocs` to use `d.file_url` (the pre-computed Dropbox URL from search-ranked-documents) instead of trying to rebuild it from a nonexistent `file_path`.

### Changes — `supabase/functions/chat-rag/index.ts`

**One-line fix in `formatDocs`** (~line 643):

```typescript
// Before:
const dbxUrl = buildDropboxUrl(d.file_path);

// After:
const dbxUrl = d.file_url || buildDropboxUrl(d.file_path);
```

This uses the pre-built URL when available and falls back to building one from `file_path` for any other code paths that might still pass raw documents.

### What stays the same
- No frontend changes
- No database changes
- `search-ranked-documents` unchanged
- System prompt source citation instructions unchanged
- All other retrieval paths (aggregate, status, bids) already build their own Dropbox URLs correctly

### Files changed
| File | Change |
|------|--------|
| `supabase/functions/chat-rag/index.ts` | Fix `formatDocs` to use `d.file_url` from search results |

