

## Plan: Web Links — Shared Link Library + Chat Integration

### 1. Database Migration

Create `saved_web_links` table:

```sql
CREATE TABLE public.saved_web_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  project_name text,
  categories text[] NOT NULL DEFAULT '{}',
  notes text,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  last_researched_at timestamptz
);

ALTER TABLE public.saved_web_links ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view all links (shared library)
CREATE POLICY "Authenticated users can view web links"
  ON public.saved_web_links FOR SELECT TO authenticated
  USING (is_active = true);

-- Any authenticated user can add links
CREATE POLICY "Authenticated users can insert web links"
  ON public.saved_web_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = added_by);

-- Users can update their own links
CREATE POLICY "Users can update own web links"
  ON public.saved_web_links FOR UPDATE TO authenticated
  USING (auth.uid() = added_by);

-- Users can soft-delete their own links
CREATE POLICY "Users can delete own web links"
  ON public.saved_web_links FOR DELETE TO authenticated
  USING (auth.uid() = added_by);

-- Service role full access
CREATE POLICY "Service role manages web links"
  ON public.saved_web_links FOR ALL TO public
  USING (true) WITH CHECK (true);
```

### 2. Frontend: Web Links Page (`src/pages/WebLinks.tsx`)

New route `/web-links` added to `App.tsx`. Page includes:
- Header with search input and "Add Link" button
- Searchable, filterable list of all saved links (search by name, project, category)
- Category filter chips
- Each link card shows: name, URL (clickable), project_name, categories as badges, notes, added_by email, date
- Mobile-friendly responsive grid (1 col mobile, 2 col tablet, 3 col desktop)
- Uses `@tanstack/react-query` for data fetching

### 3. Frontend: Add Link Dialog (`src/components/weblinks/AddLinkDialog.tsx`)

Modal form with fields:
- URL (required, validated)
- Name (required)
- Project Name (plain text input — no dropdown, no master list)
- Categories (multi-select from predefined list: Vendor, Consultant, Government, Utility, Reference, Permit, Legal, Other)
- Notes (optional textarea)

Pre-fill URL and name when triggered from chat context (via URL params or state).

### 4. Frontend: Navigation Access

Add a "Web Links" button to the sidebar (`ChatSidebar.tsx`) between New Chat and New Folder — a `Link2` icon button that navigates to `/web-links`.

### 5. Chat Integration: "Save This Link" Flow

**In `ChatMessage.tsx`**: After an assistant message that was a URL_RESEARCH response (detected by checking if the message contains `## Summary` and `## Sources` patterns and the preceding user message contained a URL), show a "Save this link" button below the feedback buttons.

Clicking "Save this link" opens the `AddLinkDialog` pre-filled with:
- URL extracted from the user's message
- Name pre-filled from the page title in the summary

**In `chat-rag/index.ts`**: Add a `SAVED_LINK_SEARCH` intercept. Before classification, detect if the user is asking to find a saved link (e.g., "find saved link for...", "what links do we have for..."). If detected:
- Query `saved_web_links` by project_name, categories, or name (case-insensitive ILIKE)
- Return formatted results
- Skip normal RAG pipeline

Also add to the classification prompt a new type `SAVED_LINK_SEARCH` for queries about saved web links.

**Chat "save this link" command**: In `chat-rag`, detect messages like "save this link" or "save that link". If detected, look back in chat history for the most recent URL_RESEARCH URL, then return a response with a special marker that the frontend interprets to open the save dialog pre-filled.

### 6. Backend: chat-rag Changes

Add to `chat-rag/index.ts`:
- New intercept after URL_RESEARCH check: detect "save this link" commands
- New function `searchSavedLinks(query, projectName, category)` that queries `saved_web_links`
- Add `SAVED_LINK_SEARCH` to the classify prompt so the classifier can route link-search queries
- When classification returns `SAVED_LINK_SEARCH`, query saved links and format as markdown list

### 7. Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/WebLinks.tsx` | Create — main page |
| `src/components/weblinks/AddLinkDialog.tsx` | Create — add/edit form |
| `src/components/weblinks/LinkCard.tsx` | Create — individual link display |
| `src/hooks/useWebLinks.tsx` | Create — CRUD hook |
| `src/App.tsx` | Add `/web-links` route |
| `src/components/chat/ChatSidebar.tsx` | Add Web Links nav button |
| `src/components/chat/ChatMessage.tsx` | Add "Save this link" button for URL_RESEARCH responses |
| `supabase/functions/chat-rag/index.ts` | Add SAVED_LINK_SEARCH type + save-link command detection |

### Key Constraints Honored
- Project name is plain text only — no dropdown, no validation against a master list
- Bot never auto-saves links — only explicit user action (UI button or "save this link" command)
- URL research continues to work as-is without saving
- All users see all active links (shared library)

