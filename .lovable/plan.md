

## Update `classifyQuery` to handle follow-up answers to clarifying questions

### What changes

**File: `supabase/functions/chat-rag/index.ts`**

**1. Update `CLASSIFY_SYSTEM_PROMPT`** — Add instructions telling the classifier that when chat history shows the assistant just asked a clarifying question and the user's current message is a short answer (e.g. "all", "yes", a project name), it should NOT return CLARIFY. Instead, it should combine the original question with the answer and classify as the appropriate type.

**2. Update `classifyQuery` signature** — Accept `chatHistory: string` parameter.

**3. Pass chat history into the classifier messages** — Include trimmed recent chat history (last ~1500 chars) as context before the user message, so the LLM can detect follow-up patterns.

**4. Update the call site** (line 351) — Pass `chatHistory` (or `body.chatHistory`) to `classifyQuery`.

### Code details

**`CLASSIFY_SYSTEM_PROMPT`** — append:
```
If the chat history shows the assistant just asked a clarifying question and the user's current message is a short follow-up answer (e.g. "all", "yes", "all of the above", a project name, or a list of components), do NOT return CLARIFY. Instead, combine the original question from chat history with the user's answer and classify the combined intent as AGGREGATE, STATUS_LOOKUP, DOCUMENT_SEARCH, or HYBRID accordingly.
```

**`classifyQuery`** signature and body:
```typescript
async function classifyQuery(message: string, chatHistory: string = ''): Promise<ClassifyResult> {
  // ...
  const messages: any[] = [];
  const trimmedHistory = chatHistory ? chatHistory.slice(-1500) : '';
  if (trimmedHistory) {
    messages.push({ role: 'user', content: `## Recent Chat History\n${trimmedHistory}\n\n## Current Question\n${message}` });
  } else {
    messages.push({ role: 'user', content: message });
  }
  // pass messages array to the API call
}
```

**Call site** (line 351):
```typescript
classifyQuery(message, chatHistory || ''),
```

No database changes needed.

