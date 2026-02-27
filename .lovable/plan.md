

## Fix Delete Buttons for Chats and Folders

### Root Cause
The `SidebarMenuAction` with `showOnHover` uses `md:opacity-0` and relies on `group-hover/menu-item:opacity-100` to reveal buttons. In the narrow sidebar (16rem), this hover-based approach is not working reliably -- the buttons exist in the DOM but never become visible. The same issue affects folder action buttons which use `opacity-0 group-hover:opacity-100`.

### Solution: Replace hover-based actions with a compact dropdown menu

Instead of relying on CSS hover states for opacity transitions, use a **DropdownMenu** (three-dot "more" menu) on each chat item and folder. This is always visible and provides a reliable way to access delete, move, and other actions.

### Changes (single file: `src/components/chat/ChatSidebar.tsx`)

**For each chat thread:**
- Remove the two `SidebarMenuAction` buttons (delete + move popover)
- Add a small `DropdownMenu` triggered by a `MoreHorizontal` icon button, positioned to the right of the chat title
- The dropdown contains: "Move to folder" (submenu with folder list) and "Delete" (red, triggers confirmation dialog)
- The trigger button is always visible (no hover-dependent opacity)

**For each folder:**
- The existing rename/delete buttons use `opacity-0 group-hover:opacity-100` which has the same issue
- Replace with an always-visible `MoreHorizontal` dropdown containing "Rename" and "Delete" options

**Layout approach:**
- Each thread row: `flex` container with icon + truncated title taking `flex-1 min-w-0`, and a small fixed-width dropdown trigger button on the right
- This avoids absolute positioning and opacity issues entirely
- The dropdown trigger is a small 6x6 button with a subtle icon that doesn't take much space

### Technical details

```text
Before (broken):
  SidebarMenuItem
    SidebarMenuButton (full width, overflow-hidden)
    SidebarMenuAction showOnHover (absolute, opacity-0 -> never shows)

After (working):
  SidebarMenuItem
    SidebarMenuButton (flex-1, min-w-0, truncate)
    DropdownMenu trigger (small fixed button, always visible)
      DropdownMenuItem: Move to folder -> submenu
      DropdownMenuItem: Delete (red)
```

No database changes needed. No hook changes needed. Only `ChatSidebar.tsx` is modified.
