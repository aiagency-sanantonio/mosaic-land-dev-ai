
## Fix Folder Actions Menu -- Move Below Folder Header

### Problem
The three-dot menu button for folders sits inline with the `CollapsibleTrigger` inside a flex row. The sidebar's overflow constraints and the Collapsible component's event handling are likely preventing the dropdown from rendering or being clickable. The button may be clipped or swallowed by the collapsible trigger.

### Solution
Move the folder actions (Rename / Delete) out of the folder header row and into a small action bar that appears **below** the folder name, inside the `CollapsibleContent`. This guarantees visibility and avoids all interaction conflicts with the `CollapsibleTrigger`.

### Changes (single file: `src/components/chat/ChatSidebar.tsx`)

1. **Remove the `DropdownMenu` from the folder header row** (lines 226-248) -- the header becomes just the chevron + folder icon + name, acting purely as a collapsible toggle.

2. **Add a folder action bar inside `CollapsibleContent`**, rendered as a small row below the folder name and above the thread list:
   - A "Rename" button (pencil icon + text)
   - A "Delete" button (trash icon + text, styled destructive)
   - Styled as small, subtle ghost buttons in a flex row with `px-4 py-1` padding to align with the indented thread list

3. **Keep all existing logic unchanged** -- `handleDeleteFolder`, `handleRenameFolder`, rename input state, and the `AlertDialog` for delete confirmation all stay as-is. Only the UI placement moves.

### Layout sketch
```text
Before:
  [chevron] [folder icon] Folder Name  [...]  <-- dots often invisible/unclickable

After:
  [chevron] [folder icon] Folder Name
    [Rename] [Delete]                          <-- always visible action buttons
    - Chat 1
    - Chat 2
```

### Technical note
The rename inline input will continue to appear in the header row (replacing the folder name text) when the user clicks Rename -- that behavior stays the same. The only change is where the Rename/Delete triggers live.
