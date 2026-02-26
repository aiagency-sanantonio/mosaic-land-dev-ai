
## Fix: Delete button pushed off-screen by long thread titles

### Problem
When a chat thread title is very long, the delete (trash) button gets pushed outside the visible area of the sidebar menu button, making it inaccessible.

### Root Cause
The `SidebarMenuButton` has `justify-between` but the inner flex container with `flex-1` can still push content beyond the button's bounds when the title text is very long.

### Fix
In `src/components/chat/ChatSidebar.tsx`, add `overflow-hidden` to the `SidebarMenuButton` so content never escapes its bounds. This ensures the truncated title and the delete button always stay within the visible area of the sidebar item.

### Changes
**`src/components/chat/ChatSidebar.tsx`** (line 119):
- Add `overflow-hidden` to the `SidebarMenuButton` className so it becomes: `"group w-full justify-between overflow-hidden"`

This single class addition ensures long titles are properly truncated and the delete button remains visible and accessible on hover.
