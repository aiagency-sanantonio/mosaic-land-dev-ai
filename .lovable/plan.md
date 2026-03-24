

## Inject preferred projects into system prompt

### What changes

**File: `supabase/functions/chat-rag/index.ts`**

Currently the profile's `preferred_projects` are only mentioned in the chat history prefix. The request is to also inject them into the system prompt so the LLM prioritizes those projects for general queries.

1. **Change `synthesizeAnswer` signature** — add an optional `profileSystemAddendum` parameter (string, default empty).

2. **Append to system prompt in `synthesizeAnswer`** — concatenate `TERRACHAT_SYSTEM_PROMPT + profileSystemAddendum` when calling the Anthropic API.

3. **Build the addendum in the main handler** — after fetching the profile (line ~355), if `profile.preferred_projects` has items, build the string:
   ```
   "\n\nThis user works primarily with these projects: Project A, Project B. When answering general questions that don't mention a specific project, prioritize data from these projects first."
   ```

4. **Pass it through** — thread `profileSystemAddendum` into `synthesizeAnswer` at the call site (~line 425).

### Code details

**synthesizeAnswer** (line ~285):
```typescript
async function synthesizeAnswer(
  message: string,
  chatHistory: string,
  context: string,
  contextType: string,
  systemAddendum: string = ''
): Promise<string> {
  // ...
  system: TERRACHAT_SYSTEM_PROMPT + systemAddendum,
  // ...
}
```

**Main handler** (after line ~370, build addendum):
```typescript
let systemAddendum = '';
if (profile?.preferred_projects?.length) {
  systemAddendum = `\n\nThis user works primarily with these projects: ${profile.preferred_projects.join(', ')}. When answering general questions that don't mention a specific project, prioritize data from these projects first.`;
}
```

**Call site** (~line 425):
```typescript
const answer = await synthesizeAnswer(message, body.chatHistory || '', context, contextType, systemAddendum);
```

No database or other file changes needed.

