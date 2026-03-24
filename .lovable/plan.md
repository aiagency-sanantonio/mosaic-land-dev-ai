

## Update `retrieveAggregate` to fall back to document search

### What changes

**File: `supabase/functions/chat-rag/index.ts`**

1. **Change `retrieveAggregate` signature** — add `message`, `userId`, and `threadId` parameters so it can call `retrieveDocuments` as a fallback.

2. **Add fallback logic** — after querying `project_data`, if `rows.length === 0`, log a message and return `await retrieveDocuments(message, projectName, userId, threadId)` instead of an empty JSON array.

3. **Update call sites** — pass `message`, `userId`, `threadId` to `retrieveAggregate` at both call sites (line ~370 for AGGREGATE and line ~380 for HYBRID).

### Updated function signature

```typescript
async function retrieveAggregate(
  projectName: string | null,
  message: string,
  userId: string,
  threadId: string
): Promise<string>
```

### Fallback insertion (after the query, before mapping rows)

```typescript
if (!data || data.length === 0) {
  console.log('retrieveAggregate: no structured data found, falling back to document search');
  return retrieveDocuments(message, projectName, userId, threadId);
}
```

### Call site updates

```typescript
// AGGREGATE
context = await retrieveAggregate(project_name, message, userId, threadId);

// HYBRID
retrieveAggregate(project_name, message, userId, threadId),
```

When the fallback triggers, `contextType` remains "Structured Cost Data" at the AGGREGATE call site, but the synthesizer will see document content and adapt its answer accordingly. For HYBRID, the parallel call already merges with document results.

