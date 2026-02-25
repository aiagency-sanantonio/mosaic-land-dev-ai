

## Better Visual Feedback for OCR Processing

### Problem
The OCR section currently only shows a tiny spinner icon and "Processing..." text, making it hard to tell at a glance that something is actively running.

### Changes (all in `src/pages/AdminIndexing.tsx`)

1. **Pulsing card border when running** -- Add an animated green/primary border glow to the OCR card while processing, so it visually "breathes" and stands out on the page.

2. **Animated progress bar** -- Add a proper `Progress` bar showing how many files have been processed out of the initial eligible count (tracking the decrease in eligible files).

3. **Live elapsed time counter** -- Show a ticking clock (e.g., "Running for 2m 34s") that updates every second, giving immediate proof that the UI is alive and tracking.

4. **Prominent status banner inside the card** -- Replace the small "Processing..." text with a colored banner (green background) showing the running state with the spinner, elapsed time, rate, and ETA all in one visible row.

5. **File count delta** -- Show "X files processed so far this session" based on the difference between the initial eligible count and the current eligible count.

### Technical Details

- Add an `ocrElapsedSeconds` state updated by a 1-second `setInterval` while `ocrRunning` is true.
- Track `ocrInitialEligible` (captured when OCR starts) to calculate session progress and show a meaningful progress bar percentage.
- Apply conditional classes to the OCR `Card`: `border-primary/50 shadow-primary/20 shadow-md animate-pulse-subtle` when running.
- Add a `Progress` component showing `((ocrInitialEligible - ocrEligible) / ocrInitialEligible) * 100`.
- Format elapsed time as `Xm Ys` using simple math on the seconds counter.
