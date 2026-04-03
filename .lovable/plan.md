

## Problem

Currently, uploaded documents are sent as raw extracted text (up to 30,000 chars) directly to the LLM. This is wasteful — much of that text is boilerplate, headers, formatting artifacts, or low-value content. The LLM gets a large but noisy context window, which dilutes the important information and leaves no room for additional documents.

## Solution: Pre-Summarization Pipeline

Instead of sending raw text, **summarize each uploaded document at upload time** using a fast, cheap model, then send the structured summary to the chat LLM. This gives the bot a denser, higher-quality understanding of the document in a fraction of the token budget.

### How it works

```text
Current flow:
  Upload → Extract text (50k chars) → Store raw text → Send raw text to chat LLM (30k cap)

New flow:
  Upload → Extract text (50k chars) → Summarize via fast LLM → Store BOTH raw + summary
  Chat → Send summary (3-5k chars) to chat LLM + raw text available on demand
```

### Implementation

#### File 1: `supabase/functions/process-upload/index.ts`

- After text extraction, call the Lovable AI gateway (Gemini 2.5 Flash Lite — cheapest/fastest) with a structured summarization prompt
- The prompt will instruct the model to extract: key figures, dates, parties, scope items, totals, and notable terms — organized by category
- Store the summary in a new `extracted_summary` column alongside the existing `extracted_text`
- If summarization fails, fall back to the first 5,000 chars of raw text as the summary

#### File 2: Database migration

- Add `extracted_summary TEXT` column to `user_uploads` table (nullable, no breaking change)

#### File 3: `src/hooks/useChatThreads.tsx`

- When building `uploadedDocument`, prefer `extracted_summary` over `extracted_text`
- If summary is available, use it (much smaller); if not, fall back to raw text with existing 30k cap
- This change alone cuts the uploaded document context from ~30k to ~3-5k per document, allowing multiple documents to fit comfortably

#### File 4: `supabase/functions/chat-rag/index.ts`

- Reduce the uploaded document cap from 30k to 15k (summaries will be well under this, but raw fallbacks still get a reasonable budget)
- Add a system prompt note telling the LLM that document summaries are pre-processed extracts of the key information

### Summarization Prompt (used at upload time)

```
Extract a structured summary of this document. Include:
- Document type and title
- Key parties/entities mentioned
- All dollar amounts, costs, totals, and financial figures
- Important dates and deadlines
- Scope of work or key deliverables
- Notable terms, conditions, or warnings
- Any tables of data (preserve the numbers)

Be thorough with numbers and dates. Omit boilerplate, headers, and formatting.
Keep the summary under 4000 characters.
```

### Why this works

- **Better understanding**: A structured summary highlights exactly what matters (costs, dates, parties, scope) instead of burying it in 30k of raw text
- **No increase in context**: Summaries are ~3-5k chars vs 30k raw — actually a significant decrease
- **Multi-document support**: With ~4k per doc summary, you can fit 5+ documents in the same budget that previously held one
- **Raw text preserved**: The original extracted text stays in the DB if ever needed for deep-dive queries later

### Technical details

- Model: `google/gemini-2.5-flash-lite` via Lovable AI gateway (fastest, cheapest — ideal for summarization)
- Summary target: ~3,000-4,000 characters
- Adds ~2-3 seconds to upload processing time (acceptable since upload already takes several seconds)
- No changes to existing documents — `extracted_summary` is nullable, old uploads gracefully fall back to raw text

