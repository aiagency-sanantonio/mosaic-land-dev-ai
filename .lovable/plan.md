

## Update `getSourcePriority` in `chat-rag/index.ts`

### Change

Split the current rank-0 tier into two tiers, giving the `zz md_50kft` / `recent bids` / `average cost` folder the highest priority (rank 0), and demoting regular `bid tab` matches to rank 1.

**File: `supabase/functions/chat-rag/index.ts`**, lines 64–73 — replace `getSourcePriority`:

```typescript
function getSourcePriority(filePath: string | null): { rank: number; label: string } {
  const fp = (filePath || '').toLowerCase();
  // Tier 0 — company master cost tracking folder
  if (fp.includes('zz md_50kft') || fp.includes('recent bids') || fp.includes('average cost')) {
    return { rank: 0, label: 'HIGHEST (master cost)' };
  }
  // Tier 1 — regular bid tabs
  if (fp.includes('bid tab')) {
    return { rank: 1, label: 'HIGH (bid tab)' };
  }
  // Tier 3 — OPC / opinion of probable cost
  if (fp.includes('opc') || fp.includes('opinion')) {
    return { rank: 3, label: 'LOW (OPC)' };
  }
  return { rank: 2, label: 'NORMAL' };
}
```

Rank scale (lower = better): 0 master cost → 1 bid tab → 2 normal → 3 OPC. The sort in `retrieveAggregate` already sorts ascending by `_rank`, so no other changes needed.

