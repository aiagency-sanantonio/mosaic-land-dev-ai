

## Add incomplete-record instruction for STATUS_LOOKUP queries

### What changes

**File: `supabase/functions/chat-rag/index.ts`**

Update the `synthesizeAnswer` call or the `systemAddendum` to include a STATUS_LOOKUP-specific instruction. The cleanest approach: where `contextType` is set to `'Permit Status Data'` (the STATUS_LOOKUP branch around line 460), also append to the existing `systemAddendum` variable:

```typescript
} else if (query_type === 'STATUS_LOOKUP') {
  context = await retrieveStatus(project_name, message);
  contextType = 'Permit Status Data';
  systemAddendum += '\n\nWhen permit records are missing a permit number, flag them with ⚠️ INCOMPLETE RECORD and note that the data may have been extracted incorrectly from the source document. Do not treat incomplete records as fully reliable.';
}
```

This keeps the instruction scoped to STATUS_LOOKUP queries only. The existing `systemAddendum` (which may contain user profile/project preferences) is preserved via `+=`. No other files or database changes needed.

