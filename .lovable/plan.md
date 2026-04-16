

## Plan: Fix Broken Dropbox Links (URL Encoding)

### Root Cause

`buildDropboxUrl` in both `search-ranked-documents` and `chat-rag` generates URLs with unencoded parentheses. When the AI response contains a markdown link like:

```text
[View](https://www.dropbox.com/home/1-Projects/Clearwater%20Creek%20(FM%202538)/file.pdf)
```

The markdown parser sees the `)` after `2538` as the closing paren of the link syntax, producing a truncated/broken URL. Clicking it sends you to a nonexistent Dropbox path → "refused to connect."

### Fix

Replace `encodeURI(filePath)` with segment-by-segment `encodeURIComponent` in both `buildDropboxUrl` functions. `encodeURIComponent` encodes `(` → `%28` and `)` → `%29`, which prevents markdown parsing conflicts while keeping the URL valid for Dropbox.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/search-ranked-documents/index.ts` | Update `buildDropboxUrl` to use per-segment `encodeURIComponent` |
| `supabase/functions/chat-rag/index.ts` | Verify existing `buildDropboxUrl` already uses `encodeURIComponent` (it does — no change needed) |

The `search-ranked-documents` fix (1 line):
```typescript
// Before:
return `https://www.dropbox.com/home${encodeURI(filePath)}`;

// After:
return `https://www.dropbox.com/home${filePath.split('/').map(s => encodeURIComponent(s)).join('/')}`;
```

### What stays the same
- No frontend changes
- No database changes
- `chat-rag/buildDropboxUrl` already uses `encodeURIComponent` — unchanged
- All other retrieval logic unchanged

### Testing note
After deploying, also test on the **published URL** (`mosaic-land-dev-ai.lovable.app`) rather than the preview iframe, since iframe sandboxing can independently block external navigation.

