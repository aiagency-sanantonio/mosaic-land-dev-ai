

## Redesign Delete Actions: Sidebar Simplification + Chat Header Menu

### Overview
Move chat deletion out of the sidebar into the chat window header. Keep folder management (rename + delete) in the sidebar but fix the broken dropdown. The sidebar becomes focused on organization (drag-drop, rename), while destructive actions live in the chat window.

### Changes

#### 1. Simplify sidebar thread items (`ChatSidebar.tsx`)
- Remove the `DropdownMenu` from each thread row entirely -- threads become clean, clickable, draggable items with just an icon and truncated title
- Remove the `AlertDialog` for thread deletion from the sidebar (it moves to Chat.tsx)
- Keep the folder `DropdownMenu` (Rename + Delete) but fix the rendering: wrap the trigger in a proper `div` outside the `CollapsibleTrigger` scope and ensure pointer events don't bubble up to the collapsible
- Keep the folder delete `AlertDialog` in the sidebar since folder delete stays here
- Remove unused imports (`ArrowRight`, `DropdownMenuSub`, `DropdownMenuSubContent`, `DropdownMenuSubTrigger`, `DropdownMenuSeparator`)

#### 2. Add delete action to chat header (`Chat.tsx`)
- Add a three-dot `DropdownMenu` in the chat header bar (right side), visible only when a thread is selected
- The dropdown contains a "Delete Chat" item styled in red/destructive
- Add an `AlertDialog` confirmation dialog in Chat.tsx
- On confirmation, call `deleteThread(currentThreadId)` which already clears the thread and shows a toast
- Import `MoreHorizontal`, `Trash2` from lucide, plus `DropdownMenu` and `AlertDialog` components

#### 3. Update props
- Remove `onDeleteThread` from `ChatSidebarProps` interface since deletion no longer happens in the sidebar
- Keep `onDeleteFolder` since folder delete stays in the sidebar

### Technical details

```text
ChatSidebar.tsx:
  - Remove: DropdownMenu from renderThread()
  - Remove: thread delete state/handlers (threadToDelete, handleDeleteThread)
  - Remove: onDeleteThread from props interface
  - Keep: folder DropdownMenu with Rename + Delete
  - Keep: folderToDelete state + AlertDialog for folder deletion
  - Fix: folder dropdown trigger -- ensure button is outside CollapsibleTrigger

Chat.tsx:
  - Add: DropdownMenu in header with "Delete Chat" option
  - Add: AlertDialog for delete confirmation
  - Add: local state for deleteDialogOpen
  - Wire: confirmDelete calls deleteThread(currentThreadId)
```

