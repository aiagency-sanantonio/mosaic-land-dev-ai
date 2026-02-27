
## Polish Chat Sidebar Items

### Problem
1. Chat thread items look rough -- the menu dots button and the thread title compete for space, causing titles to overflow
2. The `SidebarMenuItem` uses `position: relative` by default, but the dropdown trigger is a sibling of the full-width `SidebarMenuButton`, so there's no proper flex constraint keeping things tidy

### Solution

**Single file change: `src/components/chat/ChatSidebar.tsx`**

#### Chat thread items (`renderThread`)
- Add `className="flex items-center"` to `SidebarMenuItem` so the button and dropdown sit in a proper flex row
- The `SidebarMenuButton` already has `min-w-0 flex-1` which will now work correctly inside a flex parent, constraining the title and enabling truncation
- Reduce the dropdown trigger to a smaller, more subtle style (slightly transparent, smaller icon)

#### Folder headers
- Already using flex layout -- just tighten up spacing and ensure the dots button is visually consistent with thread items

#### Truncation enforcement
- The `SidebarMenuButton` base styles include `overflow-hidden` and `[&>span:last-child]:truncate`, so titles will properly truncate once the flex container constrains the button width
- Add `max-w-full` to the menu button to ensure it respects the container bounds

### Technical details

The key CSS change on `SidebarMenuItem`:
```text
Before: class="group/menu-item relative"  (no flex, button takes full width)
After:  class="group/menu-item relative flex items-center"  (flex row, button shrinks for dropdown)
```

This is a small, focused change -- just adding flex to the menu item container and minor style tweaks to the dropdown trigger for a cleaner look.
