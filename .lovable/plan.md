

## Chat Sidebar UI Fixes

### 1. Fix folder name input visibility (white-on-white text)
The sidebar has dark background with light foreground text (`--sidebar-foreground`). The `Input` component uses `bg-background` (light) but inherits the sidebar's light text color. This makes typed text invisible.

**Fix**: Add explicit `text-foreground bg-background` classes to the new-folder and rename-folder Input components so the text is dark on a light background.

### 2. Ensure chat titles truncate with ellipsis
The `truncate` class is already on thread titles, but `SidebarMenuButton` needs `overflow-hidden` and `min-w-0` to allow truncation to work within the flex layout. Will verify the menu button styles allow truncation and add `min-w-0` to the span wrapper if needed.

### 3. Add drag-and-drop for moving chats into folders
Implement native HTML5 drag-and-drop (no extra dependencies needed):

- Make each thread item **draggable** with `draggable="true"`, storing the thread ID in `dataTransfer`
- Make each folder header a **drop target** with `onDragOver` (prevent default to allow drop) and `onDrop` (call `onMoveThread`)
- Add an "Ungrouped" drop zone so users can drag threads out of folders
- Visual feedback: highlight the folder on `onDragEnter`/`onDragLeave` with a border/background change

### Technical changes

**File: `src/components/chat/ChatSidebar.tsx`**

- Add `draggingThreadId` state for visual feedback
- In `renderThread`: add `draggable="true"`, `onDragStart` (set thread ID), `onDragEnd` (clear state)
- On folder `div`: add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers; apply highlight class when a thread is dragged over
- On ungrouped section: same drop handlers with `folderId = null`
- Fix Input classes: add `text-foreground bg-background` to new folder input and rename input
- Ensure thread title span has `truncate` and parent has `min-w-0 overflow-hidden`

No database or hook changes needed -- the existing `onMoveThread` prop handles the actual move.
