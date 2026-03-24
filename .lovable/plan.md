

## Add data currency flags to `retrieveAggregate`

### What changes

**File: `supabase/functions/chat-rag/index.ts`**, lines 104–121

Add a `data_currency_flag` field to each row in the mapping step, computed from the `date` field:

- `null` date → `"⚠️ No date available — cannot assess data currency"`
- Older than 730 days → `"⚠️ Data is over 2 years old — recommend getting fresh bids"`
- 365–730 days old → `"⚠️ Data is 1-2 years old"`
- Otherwise → `null` (no flag)

The flag is included in the JSON output passed to the synthesizer, so it naturally appears in the context the LLM uses to compose the final answer.

### Code

Replace the row mapping block (lines 104–121) with:

```typescript
const now = new Date();

const rows = (data || []).map(r => {
  const priority = getSourcePriority(r.source_file_path);

  let data_currency_flag: string | null = null;
  if (!r.date) {
    data_currency_flag = '⚠️ No date available — cannot assess data currency';
  } else {
    const ageMs = now.getTime() - new Date(r.date).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 730) {
      data_currency_flag = '⚠️ Data is over 2 years old — recommend getting fresh bids';
    } else if (ageDays > 365) {
      data_currency_flag = '⚠️ Data is 1-2 years old';
    }
  }

  return {
    project_name: r.project_name,
    category: r.category,
    metric_name: r.metric_name,
    value: r.value,
    unit: r.unit,
    date: r.date,
    source_file_name: r.source_file_name,
    source_priority: priority.label,
    data_currency_flag,
    _rank: priority.rank,
  };
});

rows.sort((a, b) => a._rank - b._rank);

return JSON.stringify(rows.map(({ _rank, ...rest }) => rest));
```

No other files or call sites need changes — the flags flow through the existing `context` string into `synthesizeAnswer`, and the system prompt already instructs the model to "flag data older than 2 years."

