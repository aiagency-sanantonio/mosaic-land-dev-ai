

# Fix Progress Bar Percentage Display

## Problem
With ~26,700 total files, early progress is invisible. After processing 40 files, `Math.round(0.15%)` displays as `0%`, making it look broken. The progress bar itself is also too thin to show movement at such small percentages.

## Solution

### 1. Show decimal precision for small percentages (`AdminIndexing.tsx`)
- When progress is under 1%, display one decimal place (e.g., "0.2% complete")
- When progress is 1% or above, continue showing integer values
- This gives immediate visual feedback that things are moving

### 2. Ensure progress bar shows minimum visible fill
- When progress is above 0 but below 1%, clamp the visual value to at least 1% so the bar shows a small sliver of color
- This makes the Progress component visually respond from the very first batch

### Changes
**File: `src/pages/AdminIndexing.tsx`**
- Line ~220: Update the `Progress` value to use `Math.max(progressPercent, totalDone > 0 ? 1 : 0)` so there's always a visible indicator once processing starts
- Line ~255: Change `Math.round(progressPercent)` to show one decimal place when under 1%: `progressPercent < 1 ? progressPercent.toFixed(1) : Math.round(progressPercent)`

No backend or edge function changes needed.

