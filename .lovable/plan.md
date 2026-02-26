

## Fix: Delete button invisible on long thread titles (Root Cause Found)

### Root Cause

The previous fixes targeted the `SidebarMenuButton` and its children, but the `SidebarMenuButton` **already has `overflow-hidden` built into its base styles** in `sidebar.tsx`. The real problem is the **parent elements** don't constrain width:

1. `SidebarMenuItem` (li) has only `relative` -- no width constraint, no overflow hidden
2. `ScrollArea` allows content to expand horizontally
3. So the li grows to fit the full text content, making the button's `w-full` equal to the (unconstrained) text width

The fix is to add `overflow-hidden` to the `SidebarMenuItem` so it stays within the sidebar's bounds, which then makes everything inside it properly constrain.

### Changes

**`src/components/chat/ChatSidebar.tsx`**:

1. Add `overflow-hidden` to the `SidebarMenuItem` (line 115):
```tsx
<SidebarMenuItem key={thread.id} className="overflow-hidden">
```

2. Clean up redundant classes on `SidebarMenuButton` (line 119) -- `overflow-hidden` and `w-full` are already in the base styles:
```tsx
className="group"
```

This ensures the `li` element constrains to the sidebar width, the button fills it, text truncates, and the delete button stays visible.

