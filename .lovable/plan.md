

The user is asking why their Lovable Cloud balance (the $25/month + topped-up funds) drained so fast. This is different from the Lovable subscription credits I was looking at earlier. Lovable Cloud usage is the Supabase-side spend: database compute, storage, egress, edge function invocations, AI Gateway calls, etc.

Let me check what's actually been costing money on the Cloud side since April 15.

Key things to check:
1. Edge function invocation volume (esp. heavy ones: process-document, batch-index, ocr-process, chat-rag)
2. AI Gateway usage (LOVABLE_API_KEY calls — gemini-2.5-flash for OCR, gemini-2.5-flash-lite for summaries)
3. Database size growth (documents table now has thousands of chunks with embeddings)
4. Database egress / row reads

Let me query the analytics.
