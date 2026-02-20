

## Fix: Indexing Pipeline Reliability Issues

### Problems Found

**1. `query-dropbox-files` summary is extremely slow and may timeout**
The summary calculation (lines 69-97) fetches ALL 27,256 file paths one page at a time (28 queries) just to count them. This wastes time and could cause the edge function to timeout before even returning results.

**2. `process-document` has no retry logic for OpenAI API calls**
The embedding generation fires 10 parallel OpenAI requests per batch with zero error handling for rate limits (HTTP 429). When N8N sends hundreds of documents rapidly, OpenAI rate-limits the requests, causing failures that crash the N8N workflow.

**3. `process-document` has no delay between embedding batches**
Back-to-back batches of 10 parallel OpenAI calls will hit rate limits quickly during bulk indexing.

**4. Response size issue**
Returning 26,000+ full file records in a single JSON response can be very large and slow to transmit, potentially causing N8N HTTP timeouts.

---

### Fix 1: Replace summary with SQL COUNT queries

**File:** `supabase/functions/query-dropbox-files/index.ts`

Replace the 27-line summary section (fetching all paths into memory, then filtering) with two simple COUNT queries:

```typescript
// Efficient summary using COUNT
const { count: totalFiles, error: countError } = await supabase
  .from('dropbox_files')
  .select('*', { count: 'exact', head: true });
if (countError) throw countError;

const { count: indexedCount, error: indexedCountError } = await supabase
  .from('indexing_status')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'success');
if (indexedCountError) throw indexedCountError;

const summary = {
  total_files: totalFiles ?? 0,
  indexed: indexedCount ?? 0,
  not_yet_indexed: (totalFiles ?? 0) - (indexedCount ?? 0),
};
```

This replaces 28+ database queries with 2 fast COUNT queries.

### Fix 2: Add retry logic and rate-limit handling to OpenAI calls

**File:** `supabase/functions/process-document/index.ts`

Update the `generateEmbedding` function to retry on failure (especially HTTP 429 rate limits):

```typescript
async function generateEmbedding(text: string, openaiApiKey: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.data[0].embedding;
    }

    const errorText = await response.text();

    // Retry on rate limit (429) or server errors (5xx)
    if ((response.status === 429 || response.status >= 500) && attempt < retries - 1) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.warn(`OpenAI API ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  throw new Error('Max retries exceeded');
}
```

### Fix 3: Add delay between embedding batches

**File:** `supabase/functions/process-document/index.ts`

Add a small delay between batches in `generateEmbeddingsBatch` to avoid overwhelming the OpenAI API:

```typescript
async function generateEmbeddingsBatch(texts: string[], openaiApiKey: string): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(text => generateEmbedding(text, openaiApiKey))
    );
    results.push(...batchResults);

    // Small delay between batches to avoid rate limits
    if (i + EMBEDDING_BATCH_SIZE < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}
```

### Fix 4: Reduce parallel embedding calls from 10 to 5

Change `EMBEDDING_BATCH_SIZE` from 10 to 5 to reduce the chance of rate limiting:

```typescript
const EMBEDDING_BATCH_SIZE = 5;
```

---

### Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/query-dropbox-files/index.ts` | Replace 28-query summary with 2 COUNT queries |
| `supabase/functions/process-document/index.ts` | Add retry with exponential backoff for OpenAI calls |
| `supabase/functions/process-document/index.ts` | Add 200ms delay between embedding batches |
| `supabase/functions/process-document/index.ts` | Reduce batch size from 10 to 5 |

### No database changes needed

### Both edge functions will be redeployed

### Additional Note
If N8N Cloud has a workflow execution time limit and you have 26,000+ files to process, it may still hit that limit. In that case, you would need to configure N8N to process files in smaller batches (e.g., 500 per run) using the `limit` and `offset` parameters instead of `fetch_all: true`, and trigger multiple runs.
