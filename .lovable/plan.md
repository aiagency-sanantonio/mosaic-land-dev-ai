

## Remove Index Files and Bulk Indexing Buttons from Sidebar

### What changes
In `src/components/chat/ChatSidebar.tsx`:

1. **Remove the "Index Files" button** (the `onIndexFiles` / `isIndexing` button)
2. **Remove the "Bulk Indexing" button** (the one that navigates to `/admin/indexing`)
3. **Remove unused imports**: `FolderSync`, `Database` from lucide-react
4. **Remove unused props**: `onIndexFiles` and `isIndexing` from the component interface and props destructuring

The routes (`/admin/indexing`) stay intact so you can still access them via the address bar. Only the sidebar UI buttons are removed.

### Files modified
- `src/components/chat/ChatSidebar.tsx` — remove buttons, props, and imports
- `src/pages/Chat.tsx` — remove the `onIndexFiles` and `isIndexing` props passed to `ChatSidebar` (and any related state/handlers if they only served the sidebar button)

