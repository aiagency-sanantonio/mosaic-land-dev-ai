

# Targeted Improvements to Mosaic Land Development AI

This plan covers 10 interconnected improvements, broken into phases for manageability. No redesign — all changes layer onto the existing architecture.

---

## Phase 1: Database Schema (New Tables + Column Additions)

### New tables to create via migration:

**`project_aliases`** — lightweight alias resolution
- `id`, `canonical_project_name`, `alias_name`, `alias_type` (enum: owner_name, old_name, phase_name, abbreviation), `notes`, `created_at`
- RLS: authenticated SELECT, service role ALL

**`user_profiles_extended`** — per-user AI context (separate from existing `profiles`)
- `id`, `user_id` (references auth.users), `display_name`, `role_title`, `company_context_summary`, `drafting_preferences`, `preferred_projects` (text[]), `notes_for_ai`, `created_at`, `updated_at`
- RLS: users can CRUD their own row

**`retrieval_logs`** — debug logging
- `id`, `user_id`, `thread_id`, `question`, `query_type`, `normalized_project`, `top_sources` (jsonb), `source_type_breakdown` (jsonb), `archive_included` (bool), `created_at`, `answer_message_id` (uuid, nullable)
- RLS: users SELECT own, service role ALL

**`answer_feedback`** — thumbs up/down
- `id`, `message_id` (uuid), `user_id`, `thread_id`, `rating` (text: up/down), `feedback_text`, `expected_source`, `created_at`
- RLS: users can INSERT/SELECT own

**`concept_scopes`** — configurable DD scope mapping
- `id`, `scope_name`, `keywords` (text[]), `doc_types` (text[]), `default_included` (bool), `created_at`
- Seed with: engineering proposals, geotechnical, surveying, civil planning, Phase 1, OPCs, master planning
- Exclusion: land acquisition

### Column addition to `documents` metadata:
No schema change needed — metadata is already JSONB. The retrieval layer will normalize/extract `source_type`, `document_date`, `project_name` from existing metadata at query time.

---

## Phase 2: Enhanced Search Edge Function

### Replace `search-documents` with `search-ranked-documents`

Keep the existing function as-is for backward compatibility. Create a new edge function `search-ranked-documents` that:

1. **Accepts `query_type`** parameter: `general`, `pricing`, `line_item_pricing`, `due_diligence`, `permits`, `document_lookup`, `web_research`

2. **Resolves project aliases** before searching — queries `project_aliases` table to find canonical names

3. **For pricing/line_item_pricing**:
   - Runs the standard vector search with higher `match_count` (30)
   - Post-processes results with metadata-based reranking:
     - Score boost for `source_type` in [bid_tabulation, bid, contract, contractor_pricing] 
     - Score boost for recency (30/60/90/180/365/730 day windows)
     - Score penalty for OPC/engineer estimates
     - Score penalty for archive paths
   - Returns top 15 after reranking

4. **For due_diligence**:
   - Queries `concept_scopes` table to expand search terms
   - Adds keyword-based filters for proposals, geotechnical, surveying, etc.
   - Excludes land acquisition by default
   - Returns matched subcategories in response

5. **Enriches each result** with:
   - `source_type` (inferred from file path/name/metadata)
   - `document_date` (priority: metadata date → filename date → modified_date → created_date)
   - `project_name` (from path or metadata)
   - `file_url` (constructed Dropbox URL if path starts with `/1-Projects/`)
   - `match_reason` (exact vs comparable)
   - `confidence` score

6. **Logs retrieval** to `retrieval_logs` table

### New helper edge functions:
- **`resolve-project-alias`** — accepts a project term, returns canonical name + all aliases
- **`get-user-profile`** — returns user_profiles_extended for a given user_id (called by N8N at chat start)
- **`save-user-profile`** — upsert user profile (called from frontend)
- **`log-chat-retrieval`** — stores retrieval debug info
- **`save-answer-feedback`** — stores thumbs up/down feedback

---

## Phase 3: Frontend UI Changes (Minimal)

### ChatMessage component updates:
- Parse structured source metadata from assistant messages (the AI will include `<!-- sources: [...] -->` or a JSON block at the end)
- Render **source chips** below assistant messages: badge with source_type icon + file name + date
- Each chip is clickable → opens Dropbox web URL in new tab
- Optional "Assumptions used" collapsible block if the model returns one

### New UserProfile page/modal:
- Simple form: display name, role title, company context, drafting preferences, preferred projects, notes for AI
- Accessible from sidebar footer (settings icon next to sign out)
- Calls `save-user-profile` edge function on save

### Answer feedback:
- Add thumbs up/down buttons below each assistant message
- Optional text feedback in a small popover
- Calls `save-answer-feedback` edge function

---

## Phase 4: N8N Integration Updates

After implementation, the following N8N workflow changes will be needed:

1. **Replace the search tool URL** from `search-documents` to `search-ranked-documents`, adding `query_type` parameter
2. **Add a user profile fetch** at chat start — call `get-user-profile` to inject context
3. **Update system prompt** to use the enriched source metadata (file_url, source_type, match_reason) for citations
4. **Format sources in response** so the frontend can parse them (structured JSON block or markdown convention)

---

## Files Changed Summary

### New edge functions (6):
- `supabase/functions/search-ranked-documents/index.ts`
- `supabase/functions/resolve-project-alias/index.ts`
- `supabase/functions/get-user-profile/index.ts`
- `supabase/functions/save-user-profile/index.ts`
- `supabase/functions/log-chat-retrieval/index.ts`
- `supabase/functions/save-answer-feedback/index.ts`

### Modified files:
- `supabase/config.toml` — register new functions
- `src/components/chat/ChatMessage.tsx` — source chips, feedback buttons
- `src/components/chat/ChatSidebar.tsx` — profile link in footer
- `src/App.tsx` — add profile route
- `src/pages/UserProfile.tsx` — new page
- `src/hooks/useChatThreads.tsx` — pass user profile to chat-webhook

### Database migration:
- 4 new tables: `project_aliases`, `user_profiles_extended`, `retrieval_logs`, `answer_feedback`
- 1 new table: `concept_scopes` with seed data
- RLS policies for all tables

### No environment variables needed — all functions use existing secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, N8N_WEBHOOK_SECRET).

---

## Implementation Order

Given the scope, I recommend implementing in this order across multiple messages:

1. **Database migration** (all 5 tables + seed data + RLS)
2. **search-ranked-documents + resolve-project-alias** (core retrieval improvement)
3. **get-user-profile + save-user-profile + UserProfile page**
4. **ChatMessage source chips + feedback UI + save-answer-feedback**
5. **log-chat-retrieval + retrieval logging integration**

Shall I proceed with step 1 (database migration)?

