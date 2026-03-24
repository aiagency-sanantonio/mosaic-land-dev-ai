

## Add `synthesizeAnswer` function to `chat-rag`

### What it does

Calls the Anthropic API (claude-sonnet-4-6) with the TerraChat system prompt, combining chat history, user question, and retrieved context into a final answer.

### Implementation

Add `synthesizeAnswer(message: string, chatHistory: string, context: string, contextType: string)` after `retrieveDocuments` (around line 201):

1. Gets `ANTHROPIC_API_KEY` from env
2. Trims `chatHistory` to last 3000 characters
3. Builds user content string:
   - `## Recent Chat History\n{trimmedHistory}` (if any)
   - `## User Question\n{message}`
   - `## {contextType}\n{context}` — where `contextType` is one of `"Structured Cost Data"`, `"Permit Status Data"`, or `"Retrieved Documents"`
4. Calls `https://api.anthropic.com/v1/messages` with:
   - `model: 'claude-sonnet-4-6-20250514'`
   - `max_tokens: 2048`
   - The TerraChat system prompt (Texas land dev context, source citation rules, urgency flagging, data age warnings)
   - Single user message with the assembled content
5. Returns the text response

No database or config changes needed. Function defined but not yet wired into the main handler.

