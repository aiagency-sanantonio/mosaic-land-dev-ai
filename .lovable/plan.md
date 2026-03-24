

## Update `retrieveStatus` default date window

### What changes

**File: `supabase/functions/chat-rag/index.ts`** — `retrieveStatus` function (lines 179-227)

1. **Detect "historical" intent** — check if the message contains keywords like `historical`, `all permits`, `full history`, `past permits`. If so, skip date filtering (current behavior).

2. **Apply default 90-day window** — when the user does NOT ask for expiring/due specifically AND does not ask for historical data, apply a default filter: `expiration_date >= now - 90 days` (excludes permits expired more than 90 days ago). The existing `expiring`/`due` branch stays as-is (future 90 days only).

3. **Get total count** — run a separate count query (`select('*', { count: 'exact', head: true })`) to get total permits in the system (optionally filtered by project).

4. **Append summary note** — add a note at the end of the JSON output: `"_note": "Showing X permits within the actionable window (expired ≤90 days or expiring ≤90 days). Y total permits exist in the system. Ask for 'all permits' or 'historical permits' to see the full list."`

### Code sketch

```typescript
async function retrieveStatus(projectName: string | null, message: string): Promise<string> {
  const supabase = createClient(/*...*/);

  let query = supabase.from('permits_tracking').select('*');
  if (projectName) query = query.ilike('project_name', `%${projectName}%`);

  const lowerMsg = message.toLowerCase();
  const wantsHistorical = /\b(historical|all permits|full history|past permits|every permit)\b/.test(lowerMsg);

  if (lowerMsg.includes('expiring') || lowerMsg.includes('due')) {
    // Existing: future 90 days only
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + 90);
    query = query.gte('expiration_date', now.toISOString().split('T')[0]);
    query = query.lte('expiration_date', future.toISOString().split('T')[0]);
  } else if (!wantsHistorical) {
    // Default: 90 days ago through future
    const past90 = new Date();
    past90.setDate(past90.getDate() - 90);
    query = query.gte('expiration_date', past90.toISOString().split('T')[0]);
  }
  // If wantsHistorical: no date filter applied

  // Get total count
  let countQuery = supabase.from('permits_tracking').select('*', { count: 'exact', head: true });
  if (projectName) countQuery = countQuery.ilike('project_name', `%${projectName}%`);

  const [{ data, error }, { count: totalCount }] = await Promise.all([
    query.order('expiration_date', { ascending: true }).limit(200),
    countQuery,
  ]);

  if (error) throw new Error(`permits_tracking query failed: ${error.message}`);

  // ... existing urgency mapping logic unchanged ...

  return JSON.stringify({
    permits: results,
    _note: `Showing ${results.length} permits. ${totalCount ?? '?'} total permits exist in the system. Ask for "all permits" or "historical permits" to see the full list.`,
  });
}
```

No database or other file changes needed.

