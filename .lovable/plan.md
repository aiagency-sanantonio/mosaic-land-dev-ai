
## Fix: Delete button still not visible on long thread titles

### Problem
The `overflow-hidden` fix on `SidebarMenuButton` wasn't sufficient. The inner `div` with `flex-1` still expands to fill all available space, pushing the delete button out of view. The screenshot confirms titles are still cut off with no delete button visible.

### Solution
A more robust approach:

1. Remove `justify-between` from `SidebarMenuButton` (it fights with `flex-1`)
2. Add a hard `max-width` or `overflow-hidden` on the text wrapper div so it never grows beyond the available space
3. Ensure the delete button uses `shrink-0` and `ml-auto` to always stay visible

### Changes

**`src/components/chat/ChatSidebar.tsx`** — Restructure the thread item layout:

Replace the current `SidebarMenuButton` content (lines 116-137) with:

```tsx
<SidebarMenuButton
  onClick={() => onSelectThread(thread.id)}
  isActive={currentThreadId === thread.id}
  className="group w-full overflow-hidden"
>
  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
    <MessageSquare className="h-4 w-4 shrink-0" />
    {!isCollapsed && (
      <span className="truncate text-sm">{thread.title}</span>
    )}
  </div>
  {!isCollapsed && (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto"
      onClick={(e) => handleDeleteClick(thread.id, e)}
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  )}
</SidebarMenuButton>
```

Key changes:
- Removed `justify-between` — replaced with `ml-auto` on the delete button
- Added `overflow-hidden` to the inner text wrapper div so the `truncate` on the span actually works within the constrained parent
- These two changes together ensure the text truncates properly and the delete button is always pinned to the right edge
