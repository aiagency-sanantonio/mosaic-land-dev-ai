

## Export Documents Table (Split into Two Files)

### What I'll do

Run two `psql COPY` commands to export the documents table:

1. **`documents_data.csv`** — all columns except embeddings (id, content, metadata, file_path, file_name, created_at, updated_at)
2. **`documents_embeddings.csv`** — just id + embedding

Both files go to `/mnt/documents/` for immediate download.

### Steps

1. Export `documents_data.csv` (all columns minus embedding)
2. Export `documents_embeddings.csv` (id + embedding only)
3. Compress both with gzip since they'll be large
4. Deliver both files

