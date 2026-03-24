

## Add `retrieveDocuments` function to `chat-rag`

### What it does

Calls `search-ranked-documents` internally to perform semantic document search, authenticating with `N8N_WEBHOOK_SECRET`, and returns results formatted as numbered sources.

### Implementation

Add `retrieveDocuments(message: string, projectName: string | null, userId: string, threadId: string)` after `retrieveStatus`:

1. Fetches `SUPABASE_URL` and `N8N_WEBHOOK_SECRET` from env
2. POSTs to `${SUPABASE_URL}/functions/v1/search-ranked-documents` with:
   - Bearer token from `N8N_WEBHOOK_SECRET`
   - Body: `{ query, query_type: "general", match_count: 12, content_max_length: 1000, match_threshold: 0.15, filter_project, user_id, thread_id, include_archive: false }`
3. Parses the response JSON, extracts `documents` array
4. Formats each document as a numbered source string: `[1] filename (source_type, date)\ncontent`
5. Returns the concatenated string

No database or config changes needed.

