

## Diagnostic results: why Cloud is bleeding storage

Your `documents` table is **7.4 GB / 358,354 chunks**. Here's what's actually in it:

| Bucket | Chunks | Files | Size | Status |
|---|---|---|---|---|
| `_ARCHIVED` paths | **125,065** | 2,535 | 122 MB content | Already excluded from search — pure dead weight |
| `OPC` files | 1,367 | 92 | 1.4 MB | Already filtered out at query time |
| `litigation` files | 1,340 | 33 | 1.3 MB | Already filtered out at query time |
| Orphan rows (NULL file_path) | **1,984** | — | — | Can never be cited; pure waste |
| GIS/CAD files (.shp.xml, .kmz, .dwg) | 832 | a few | — | Should never have been indexed |
| HTML files (.htm/.html) | 3,710 | many | — | Mostly junk (browser-saved pages) |
| Live, useful project chunks | ~225,000 | ~9,300 | ~218 MB | Keep |

**The single biggest win is deleting the `_ARCHIVED` chunks** — that alone removes ~35% of the table.

Plus, certain individual files are massively bloated (one `.docx` contract = 1,485 chunks, one GIS `.shp.xml` = 832 chunks). Future indexing should cap chunks per file.

---

## Cleanup plan

### Phase 1 — Safe deletes (one-time SQL, instant freed space)

Run as data migrations (DELETE statements):

1. **Delete `_ARCHIVED` chunks** — `WHERE file_path ILIKE '%/_ARCHIVED/%' OR file_path ILIKE '%/_archive/%'` → removes ~125k chunks (~35% of table)
2. **Delete orphan chunks** — `WHERE file_path IS NULL` → removes 1,984 chunks
3. **Delete GIS/CAD/binary garbage** — `WHERE file_name ILIKE ANY('{%.shp,%.shp.xml,%.shx,%.dbf,%.kmz,%.kml,%.dwg,%.dxf}')` → removes ~830 chunks
4. **Delete OPC + litigation chunks** (already filtered at query time) → removes ~2,700 chunks

**Estimated post-cleanup table size: ~228k chunks / ~4.7 GB** (~37% reduction).

### Phase 2 — Prevent regrowth (small code changes)

5. **Add `MAX_CHUNKS_PER_FILE = 50` cap in `process-document/index.ts`** — if a single file would create >50 chunks, take the first 50 and log a warning. Prevents one bloated file from consuming thousands of slots.
6. **Extend skip list in `bulk_index.py` / `process-document`** to include `.shp`, `.shp.xml`, `.shx`, `.dbf`, `.kmz`, `.kml`, `.dwg`, `.dxf`, `.htm`, `.html` so the same junk doesn't come back on next sync.

### Phase 3 — Visibility (admin dashboard widget)

7. Add a small "Storage Health" panel to `/admin/indexing`:
   - Total documents table size + chunk count
   - Top 10 files by chunk count (with a one-click "Purge this file's chunks" button)
   - 7-day chunk growth trend
   - Estimated monthly storage cost

This gives you eyes on bloat before it eats credits again.

---

## Technical details

- All Phase 1 deletes use the insert-tool (not migrations) since they're DELETE statements on existing data, not schema changes.
- Each DELETE will be batched (e.g. 10,000 rows at a time) to avoid long table locks.
- The matching `indexing_status` rows for archived files will be **kept** so we don't accidentally re-index them. Same for skip-list rows.
- The chunk cap in `process-document` is a guard, not retroactive — it only affects future files.
- No risk to active chat: search queries already exclude `_ARCHIVED`, OPC, and litigation paths.

---

## What I need from you

Pick which phases to run:

- **Phase 1 only** — fast, frees ~37% of storage now, no code changes
- **Phase 1 + 2** — recommended; prevents the same bloat returning
- **All three phases** — full solution including admin visibility

