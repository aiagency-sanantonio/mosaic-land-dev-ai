

## Chat Sidebar UI Fixes and Folder Organization

### Problem 1: Delete button not visible
The delete button is placed **inside** `SidebarMenuButton`, which has `overflow-hidden` in its base styles. This clips the button. The sidebar component already provides a `SidebarMenuAction` component designed for exactly this use case -- it positions absolutely outside the button and supports `showOnHover`.

### Problem 2: No folder organization
Chats are displayed in a flat list with no way to group them.

---

### Changes

#### 1. Database: Add `chat_folders` table and update `chat_threads`

Create a new `chat_folders` table:
- `id` (uuid, primary key)
- `user_id` (uuid, not null)
- `name` (text, not null)
- `created_at`, `updated_at` (timestamps)

Add a nullable `folder_id` column to `chat_threads` referencing `chat_folders.id` (with `ON DELETE SET NULL` so deleting a folder ungroups chats rather than deleting them).

RLS policies: users can only CRUD their own folders.

#### 2. Fix delete button in `ChatSidebar.tsx`

Move the delete `Button` out of `SidebarMenuButton` and use `SidebarMenuAction` with `showOnHover` instead. This places it absolutely positioned to the right of each menu item, visible on hover, and not clipped by overflow.

Before (broken):
```
<SidebarMenuItem>
  <SidebarMenuButton>
    <span>title</span>
    <Button>delete</Button>  <!-- clipped by overflow-hidden -->
  </SidebarMenuButton>
</SidebarMenuItem>
```

After (fixed):
```
<SidebarMenuItem>
  <SidebarMenuButton>
    <MessageSquare />
    <span>title</span>
  </SidebarMenuButton>
  <SidebarMenuAction showOnHover onClick={delete}>
    <Trash2 />
  </SidebarMenuAction>
</SidebarMenuItem>
```

#### 3. Add folder management UI to `ChatSidebar.tsx`

- Add a "New Folder" button next to "New Chat"
- Display folders as collapsible `SidebarGroup` sections using the existing `Collapsible` component
- Each folder header shows the folder name with a delete/rename option
- Threads inside a folder are nested under their folder group
- Ungrouped threads appear in a default "Chats" section
- Drag-and-drop is not needed initially; instead, each thread's context (right-click or a small "move" action) lets users pick a folder via a dropdown/popover

#### 4. Update `useChatThreads.tsx` hook

- Add folder CRUD operations: `createFolder`, `deleteFolder`, `renameFolder`, `moveThreadToFolder`
- Fetch threads with their `folder_id` included
- Fetch folders list on load
- Export folders and folder operations

#### 5. Files changed

| File | Change |
|------|--------|
| **New migration** | Create `chat_folders` table, add `folder_id` to `chat_threads` |
| `src/hooks/useChatThreads.tsx` | Add folder state, CRUD, and `moveThreadToFolder` |
| `src/components/chat/ChatSidebar.tsx` | Fix delete button using `SidebarMenuAction`; add folder groups with collapsible sections; add folder create/rename/delete UI; add "Move to folder" dropdown on threads |
| `src/pages/Chat.tsx` | Pass new folder props down to `ChatSidebar` |

