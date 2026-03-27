
Problem:
The bad answer is not happening because the backend lacks Grace Gardens bid data. I confirmed the structured cost table does contain verified bid rows, including the March 12, 2025 total_cost = 5,696,759.30 from `2025-03-12_Grace Gardens Unit 2 Bid Comparison #2.pdf`. The failure is happening in the final LLM synthesis step inside `supabase/functions/chat-rag/index.ts`.

What I found:
1. `classifyQuery` is working correctly:
   - The question was classified as `AGGREGATE`
   - `project_name` was correctly identified as `Grace Gardens`

2. `retrieveAggregate` is also returning data:
   - It queries `project_data`
   - Grace Gardens bid rows exist
   - The code already builds a `VERIFIED BID DATA` section

3. The incorrect answer was generated after retrieval:
   - The stored `chat_jobs.response_content` contains the hallucinated “I don’t have any verified bid data...” response
   - That means the model saw context but still ignored or failed to follow it

Why this is happening:
The current implementation relies on the model to correctly interpret a large JSON blob embedded in the prompt:
```text
=== VERIFIED BID DATA (USE THIS FIRST) ===
[ ...JSON array... ]
```
That is brittle. Even with the new system rule, the model can still miss it when:
- the JSON is long or dense
- the most important row is buried among many records
- the answering model decides to generalize from older/non-bid context
- the prompt doesn’t force a structured extraction of the verified bid summary before freeform answering

Recommended fix:
Make `retrieveAggregate` produce a much more explicit, human-readable bid summary before the raw JSON. Do not rely on raw JSON alone.

Implementation plan:
1. Update `retrieveAggregate` in `supabase/functions/chat-rag/index.ts`
   - Sort verified bid rows by effective date descending
   - Build a compact “MOST RECENT VERIFIED BID SNAPSHOT” section at the top
   - Include top bid figures in plain text, especially:
     - most recent total cost
     - source file
     - date
     - any additional recent bid amounts
   - Keep raw JSON below as supporting detail, not the primary signal

2. Strengthen prompt formatting in `buildSystemPrompt` / `TERRACHAT_SYSTEM_PROMPT`
   - Keep the critical rule
   - Add a stricter instruction like:
     - “If MOST RECENT VERIFIED BID SNAPSHOT is present, quote that section verbatim before any interpretation.”
   - Explicitly forbid fallback language about missing bid data when verified rows are present

3. Add defensive synthesis handling
   - After generating the answer, detect a contradiction:
     - if context contains `VERIFIED BID DATA`
     - and answer says “I don’t have bid data”, “no verified bid data”, or similar
   - Then retry synthesis once with a stricter system addendum, or short-circuit to a templated response based on the extracted top bid row

4. Optional hardening
   - Add a helper to extract/format the top verified bid rows deterministically from structured data
   - This avoids trusting the LLM to parse large JSON correctly
   - This is the safest fix for cost/bid questions

Technical details:
Proposed context shape:
```text
=== MOST RECENT VERIFIED BID SNAPSHOT ===
Project: Grace Gardens
Most recent verified bid total: $5,696,759.30
Date: 2025-03-12
Source: 2025-03-12_Grace Gardens Unit 2 Bid Comparison #2.pdf

Other verified bid records:
- 2024-01-01 | Bid Tabulation Results - Grace Gardens Unit 1.pdf | total_cost | $3,386,197.50
- 2024-01-01 | CO-00674 - Bid Results.pdf | bid_amount | $4,972,090.00
```

Then below that:
```text
=== VERIFIED BID DATA (USE THIS FIRST) ===
[raw JSON here]
```

Expected outcome:
The assistant will stop saying Grace Gardens has no bid data because the most important figure will be surfaced deterministically before the model writes the answer.

Files to update:
- `supabase/functions/chat-rag/index.ts`

Validation after implementation:
- Ask: “What are the most recent bid totals for Grace Gardens?”
- Confirm the response leads with `$5,696,759.30` from March 2025
- Confirm it cites the correct bid comparison file
- Confirm it does not say bid data is missing

