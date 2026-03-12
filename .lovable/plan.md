

# Phase 3: User Profile Settings Page

## What we're building
A settings page accessible from the chat sidebar where users can view and edit their profile preferences. These preferences feed into the AI's context so it can tailor responses.

## Database
The `user_profiles_extended` table already exists with all needed columns: `display_name`, `role_title`, `company_context_summary`, `drafting_preferences`, `preferred_projects`, `notes_for_ai`. No migrations needed.

## Files

### New: `src/pages/Settings.tsx`
- Form with fields for all `user_profiles_extended` columns
- Loads existing profile on mount via `supabase.from('user_profiles_extended').select().eq('user_id', user.id).single()`
- Upserts on save
- Fields: Display Name, Role/Title, Company Context Summary (textarea), Drafting Preferences (textarea), Preferred Projects (comma-separated input mapped to text array), Notes for AI (textarea)
- Back button to return to chat
- Toast on save success/error

### Modified: `src/App.tsx`
- Add route: `/settings` -> `Settings`

### Modified: `src/components/chat/ChatSidebar.tsx`
- Add a Settings icon button (gear icon) next to the sign-out button in the footer
- Navigates to `/settings`

