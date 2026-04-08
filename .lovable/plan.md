

## Plan: Add "Remember This" Chat Command

### Overview
Intercept messages starting with "remember this:" (or similar) in the `chat-rag` edge function. Instead of running the RAG pipeline, insert a new `system_knowledge` entry and return a confirmation message.

### Changes (1 file)

**`supabase/functions/chat-rag/index.ts`**

1. **Add `detectRememberCommand` helper** (before the `serve` block, ~line 714):
   - Regex check for patterns: `^(remember this:|remember that:|save this:|save this knowledge:)(.+)`
   - Case-insensitive, requires a colon delimiter to avoid false positives on conversational phrases like "do you remember this project?"
   - Returns `{ isRemember: boolean, content: string }`

2. **Add `extractTitle` helper**: Takes the content string and returns the first ~60 characters, trimmed to a word boundary, as the auto-generated title.

3. **Add early intercept** (~line 722, right after parsing the request body, before classification):
   - Call `detectRememberCommand(message)`
   - If matched:
     - Create a service-role Supabase client
     - Auto-detect project name from content using a simple heuristic (check if any word matches known project names from `project_aliases` table, or skip)
     - Determine tier: `"contextual"` if project keywords detected, `"always"` otherwise
     - Insert into `system_knowledge` with `title`, `content`, `tier`, `keywords`, `is_active: true`, `created_by: userId`
     - Build a confirmation message: "Got it — I've saved that knowledge and will use it in future conversations."
     - POST confirmation to `callback_url` if present
     - Return early (skip classification, retrieval, and synthesis entirely)

### Trigger Phrases (case-insensitive, colon required)
- `remember this: ...`
- `remember that: ...`
- `save this: ...`
- `save this knowledge: ...`

### Example
User types: `Remember this: Fischer Ranch is sometimes called Fischer`
- Title: `"Fischer Ranch is sometimes called Fischer"`
- Content: `"Fischer Ranch is sometimes called Fischer"`
- Tier: `"always"`
- Keywords: `[]`
- Response: "Got it — I've saved that knowledge and will use it in future conversations."

### What This Does NOT Change
- All existing query classification and RAG retrieval remains untouched
- No editing or deleting knowledge via chat (admin form still needed)
- The 800-char injection cap still applies to all system knowledge

