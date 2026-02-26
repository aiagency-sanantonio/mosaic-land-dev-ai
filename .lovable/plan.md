

## Current State Summary

**Data snapshot:**
- 27,256 total Dropbox files
- 10,821 successfully indexed (39.7%)
- 16,338 skipped (59.9%), 97 failed (0.4%)
- 10,129 / 10,821 structured extraction done (93.6%)
- ~10,418 OCR-eligible files (scanned PDFs + images)
- All processing is currently **stopped** (kill switch active, crons unscheduled)

**Current UI problems:**
1. The page is a long vertical scroll of separate cards with no clear visual hierarchy or pipeline overview
2. The "Progress" card (overall stats) is buried at the bottom, below OCR and extraction cards
3. No indication that processing is globally stopped (kill switch active)
4. OCR and extraction cards show "run/stop" buttons but no awareness of the kill switch state
5. The activity log mixes all event types with no filtering
6. No clear 3-stage pipeline visualization (Index → OCR → Extract)

## Plan: Redesigned Admin Dashboard

### 1. Add a global status banner at the top
- Show a prominent banner when the kill switch is active ("All processing paused") with a "Resume Processing" button that deletes the stopped row
- When running, show a green "Processing Active" banner

### 2. Restructure layout with a pipeline overview at the top
Replace the scattered cards with a clear top-level summary showing the 3-stage pipeline as a horizontal row of stat cards:

```text
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  1. INDEXING     │  │  2. OCR          │  │  3. EXTRACTION   │
│  10,821 / 27,256 │  │  0 / 10,418      │  │  10,129 / 10,821 │
│  ████████░░ 40%  │  │  ░░░░░░░░░░ 0%   │  │  █████████░ 94%  │
│  ✓ Complete      │  │  ⏸ Paused        │  │  ⏸ Paused        │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3. Detailed sections below with collapsible cards
Each pipeline stage gets a collapsible detail section with:
- Breakdown stats (e.g., skipped reasons for indexing, OCR-eligible file types)
- Start/Stop controls (disabled when kill switch is active)
- Rate and ETA when running

### 4. Move Activity Log into a tab or collapsible section
Keep it accessible but not taking prime real estate.

### 5. Simplify state management
- Fetch kill switch status on load to properly reflect global pause state
- Disable all "Start" buttons when kill switch is active
- Add clear "Resume All" / "Pause All" controls

### Technical changes
- Rewrite `src/pages/AdminIndexing.tsx` with the new layout
- Add a `fetchKillSwitchStatus` function that checks `indexing_jobs` for `status = 'stopped'`
- Restructure the return JSX into the pipeline overview + detail sections pattern
- Add resume functionality (delete the stopped row from `indexing_jobs`)

