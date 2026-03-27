
Root cause I found:
- The backend is retrieving the Grace Gardens bid rows correctly. I verified the structured data contains the March 12, 2025 bid of $5,696,759.30 and about 20 verified bid rows within the top 500 retrieved records.
- The failure is happening after retrieval, inside `supabase/functions/chat-rag/index.ts`, during answer synthesis.
- The current “defensive retry” is not actually catching this bad response. The returned text says “I don't have verified bid tabulations...” but the detector only looks for a limited set of phrases like `bid data`, `contractor bids`, and `verified bid`. It does not reliably match “verified bid tabulations for Grace Gardens in the system.”
- Because that regex does not fire, the retry and deterministic fallback never run.
- There is also a deeper design issue: the current solution still trusts the model to obey instructions, even though this is exactly the path that has already failed repeatedly.

What I will change:
1. Make Grace Gardens-style bid answers deterministic before the model writes anything
- In `retrieveAggregate`, extract verified bid rows and build a structured bid summary object:
  - most recent verified bid
  - up to 5 recent verified bid records
  - source file names
  - dates
  - Dropbox links
- Only include rows with meaningful bid metrics (`total_cost`, `bid_amount`, maybe `estimated_cost`) in the primary summary so subtotals and stray line items do not confuse the answer.

2. Add a hard short-circuit for bid questions when verified bids exist
- In the AGGREGATE flow, if the user is clearly asking for recent bids / bid totals and verified bid rows exist:
  - return a formatted response directly from code
  - do not send that question to the model at all
- This removes the model from the critical path for the exact scenario that is failing.

3. Keep the model only for commentary, not for the core figure
- For bid questions with verified rows, the code-generated answer will always lead with:
  - `$5,696,759.30`
  - date: March 12, 2025
  - source file
- Optional supplementary narrative can still be added later, but the lead answer and figures will be deterministic.

4. Strengthen fallback detection anyway
- Expand the contradiction detection to catch broader phrasings:
  - `verified bid tabulations`
  - `bid tabulations for`
  - `no bids in the system`
  - `no contractor bids available`
  - `unable to locate bid tabulations`
- If synthesis is still used anywhere and contradicts the context, it should always trigger retry/fallback.

5. Add explicit debug logging
- Log:
  - verified bid row count
  - whether deterministic bid mode was used
  - whether retry fired
  - whether fallback fired
  - top bid row chosen
- This will make the next failure, if any, immediately diagnosable from logs instead of guessing.

Files to update:
- `supabase/functions/chat-rag/index.ts`

Implementation shape:
```text
classify question
  -> retrieveAggregate()
      -> collect verified bid rows
      -> build deterministic bid summary
  -> if question asks for recent bid totals AND verified bid summary exists
      -> return code-built answer directly
  -> else
      -> use LLM synthesis
      -> if contradiction detected
          -> retry once
          -> else deterministic fallback
```

Why this should fix it:
- Right now the system has the right data but still asks the model to interpret it.
- The reliable fix is to stop asking the model to decide whether bids exist when the code can already prove they do.
- This turns the most important part of the answer from “prompt-dependent” into “data-driven.”

Validation after implementation:
- Ask: “What are the recent bid totals for Grace Gardens?”
- Confirm the first sentence contains `$5,696,759.30` and March 2025.
- Confirm the source file `2025-03-12_Grace Gardens Unit 2 Bid Comparison #2.pdf` is cited.
- Confirm the response does not say bids are unavailable.
- Confirm logs show deterministic bid mode was used.
- Also test one non-bid aggregate question to make sure normal synthesis still works.

Technical notes:
- I also found a separate UI warning in `src/components/chat/ChatMessage.tsx` involving refs/markdown components, but that is not the cause of this Grace Gardens failure.
- The async job pipeline is working correctly: `chat-webhook` creates the job, `chat-rag` returns 200, and `chat-response-webhook` saves the bad answer. So the problem is not transport, polling, or job completion.
