
## Fix: Make Chat Delete Button Visible

### Problem
The delete button on chat threads uses `opacity-0 group-hover:opacity-100`, making it invisible until hover. This doesn't work on touch devices and can be hard to discover even on desktop.

### Solution
Change the delete button to always be visible (with slightly muted styling) instead of relying on hover to reveal it.

### Changes

**`src/components/chat/ChatSidebar.tsx`** (1 edit):
- Remove `opacity-0 group-hover:opacity-100` from the delete button's className
- Replace with `opacity-60 hover:opacity-100` so the button is always visible but becomes more prominent on hover
