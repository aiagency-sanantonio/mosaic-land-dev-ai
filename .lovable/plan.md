

## Problem Diagnosis

The agent is returning incomplete/inaccurate answers because of the aggressive token optimization we applied:

1. **`content_max_length = 300`** — 300 characters is very short. Many documents have key information beyond the first 300 chars (e.g., cost breakdowns, permit details, scope descriptions). The agent simply can't see enough of each document to give complete answers.

2. **`match_count = 8`** — For aggregation questions ("total costs across all phases"), 8 results may miss relevant documents.

## Proposed Fix

Increase the defaults to a balanced middle ground — enough content for accuracy without blowing up the context window:

### Changes to `supabase/functions/search-ranked-documents/index.ts`

| Parameter | Current | Proposed | Rationale |
|-----------|---------|----------|-----------|
| `content_max_length` | 300 | 800 | Captures most key content (costs, dates, terms) while still being ~60% smaller than full content |
| `match_count` (general) | 8 | 12 | Better coverage for aggregation questions |
| `match_count` (pricing) | 30 → trim to 8 | 30 → trim to 12 | More final results for cost comparisons |
| `match_count` (DD) | 25 → trim to 8 | 25 → trim to 12 | Better DD scope coverage |

This is a single-line default change plus updating the `initialMatchCount` fallback. The agent prompt's recommended `match_count` values (10 for specific, 20 for broad) will override these defaults when the agent sends them explicitly.

### N8N Agent Prompt Update

Update the search parameter guidance to recommend:
- Broad questions: `match_count: 15` (was 20 — still fine)
- Specific lookups: `match_count: 10` (unchanged)
- Add `content_max_length: 800` as a visible parameter the agent can override to `1200` for content-heavy questions like "what does the contract say about..."

