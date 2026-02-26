

## Clean Up All Mistral OCR Data

### Summary
Delete all document chunks and structured data that were created by the Mistral OCR pipeline, keeping only the OpenAI-processed data.

### What will be deleted

| Table | Mistral Records | OpenAI Records (kept) |
|-------|-----------------|----------------------|
| documents | 17,512 chunks | 79 chunks |
| project_data | 29 rows | untouched |
| dd_checklists | 0 | n/a |
| permits_tracking | 0 | n/a |
| indexing_status | already cleaned | n/a |

### Steps

1. **Delete 17,512 Mistral document chunks** from `documents` where `metadata->>'ocr_source' = 'mistral'`
2. **Delete 29 Mistral-sourced project_data rows** whose `source_file_path` matches Mistral-processed files
3. Verify final counts to confirm only OpenAI data remains

### Technical Details

Three SQL statements executed via the data update tool:

```sql
-- Step 1: Remove Mistral document chunks
DELETE FROM documents WHERE metadata->>'ocr_source' = 'mistral';

-- Step 2: Remove project_data rows linked to Mistral OCR files
DELETE FROM project_data 
WHERE source_file_path IN (
  SELECT DISTINCT file_path FROM indexing_status 
  WHERE error_message LIKE 'Scanned/image-only PDF%' 
     OR error_message LIKE 'Non-vectorizable format%'
);

-- Step 3: Verification query
SELECT metadata->>'ocr_source' as source, count(*) FROM documents GROUP BY 1;
```

No schema or code changes required -- data cleanup only.

