

## Why the table still shows 7 GB

The deletes worked — chunk count dropped from 358k → 228k. But Postgres doesn't return disk space from `DELETE` automatically:

| Component | Size | What it is |
|---|---|---|
| Table data | 549 MB | Live rows (already small!) |
| HNSW vector index | ~3.8 GB | The embedding similarity index — oversized + bloated |
| Dead tuple bloat | ~3 GB | Space from deleted rows, not yet reclaimed |
| **Total** | **~7.4 GB** | **What Lovable Cloud bills you for** |

To actually free the disk, we need to **physically rewrite the table and rebuild the vector index**.

## Plan: reclaim the disk space

### Step 1 — Run `VACUUM FULL` + `REINDEX` on the documents table

A single migration that does:

```sql
VACUUM FULL public.documents;
REINDEX TABLE public.documents;
```

`VACUUM FULL` rewrites the table from scratch with only live rows, returning the dead-tuple space to disk. `REINDEX` rebuilds the HNSW vector index against the now-smaller dataset, which both shrinks it and improves query speed.

**Expected result**: table size drops from **7.4 GB → ~2.5–3.5 GB** (a ~55–65% reduction). The HNSW index alone should shrink by roughly a third because it no longer has entries for the 130k deleted vectors.

### Step 2 — Refresh the Storage Health panel

No code change needed; the existing `get_documents_storage_stats` RPC will pick up the new size automatically once the vacuum finishes.

## Important caveats

- **`VACUUM FULL` takes an exclusive lock** on the table for the duration — searches against `documents` (chat queries, admin search) will wait until it finishes. On a 7.4 GB table this typically runs **2–8 minutes**. Best to run when chat traffic is low.
- It's a **one-time operation**. You won't need to repeat it unless you delete another large batch of rows in the future.
- The HNSW rebuild is the slowest part. It's CPU-bound and will briefly spike database load.

## What to expect after

- Documents table reported size: ~2.5–3.5 GB
- Estimated monthly cost (at $0.125/GB): drops from ~$0.92 → ~$0.40
- Vector search latency: slightly faster (smaller index)
- No data loss, no impact on indexing pipeline, no code changes besides the one migration

## Alternative if you want zero downtime

Skip `VACUUM FULL` and instead run plain `VACUUM` + `REINDEX TABLE CONCURRENTLY`. This avoids the exclusive lock but only **partially** reclaims space (Postgres returns it to the table's free-space map for reuse, not to the OS). Disk usage would drop to maybe **~5 GB** instead of ~3 GB. Recommended only if you can't tolerate a few minutes of paused chat.

