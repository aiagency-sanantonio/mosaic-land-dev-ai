import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunking configuration
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 5;

// ─── Text Splitting ───────────────────────────────────────────────────────────

function splitText(text: string): string[] {
  const separators = ['\n\n', '\n', '. ', ' ', ''];
  const chunks: string[] = [];

  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (text.length <= CHUNK_SIZE) return [text];
    const separator = separators[separatorIndex];
    const parts = separator ? text.split(separator) : text.split('');
    const result: string[] = [];
    let currentChunk = '';
    for (const part of parts) {
      const partWithSeparator = separator ? part + separator : part;
      if (currentChunk.length + partWithSeparator.length <= CHUNK_SIZE) {
        currentChunk += partWithSeparator;
      } else {
        if (currentChunk.length > 0) result.push(currentChunk.trim());
        if (partWithSeparator.length > CHUNK_SIZE && separatorIndex < separators.length - 1) {
          result.push(...splitRecursive(partWithSeparator, separatorIndex + 1));
          currentChunk = '';
        } else {
          currentChunk = partWithSeparator;
        }
      }
    }
    if (currentChunk.trim().length > 0) result.push(currentChunk.trim());
    return result;
  }

  const rawChunks = splitRecursive(text, 0);
  for (let i = 0; i < rawChunks.length; i++) {
    if (i > 0 && CHUNK_OVERLAP > 0) {
      const overlap = rawChunks[i - 1].slice(-CHUNK_OVERLAP);
      chunks.push(overlap + rawChunks[i]);
    } else {
      chunks.push(rawChunks[i]);
    }
  }
  return chunks.filter(chunk => chunk.trim().length > 0);
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

async function generateEmbedding(text: string, openaiApiKey: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    if (response.ok) {
      const data = await response.json();
      return data.data[0].embedding;
    }
    const errorText = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      continue;
    }
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }
  throw new Error('Max retries exceeded');
}

async function generateEmbeddingsBatch(texts: string[], openaiApiKey: string): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(text => generateEmbedding(text, openaiApiKey)));
    results.push(...batchResults);
    if (i + EMBEDDING_BATCH_SIZE < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  return results;
}

// ─── Indexing Status ──────────────────────────────────────────────────────────

async function updateIndexingStatus(
  supabase: SupabaseClient, filePath: string, fileName: string | null,
  status: 'pending' | 'success' | 'failed' | 'skipped',
  chunksCreated: number, errorMessage: string | null, extractedMetadata: Record<string, unknown>
) {
  const { error } = await supabase.from('indexing_status').upsert({
    file_path: filePath, file_name: fileName, status,
    chunks_created: chunksCreated, error_message: errorMessage,
    metadata: extractedMetadata,
    indexed_at: status === 'success' ? new Date().toISOString() : null,
  }, { onConflict: 'file_path' });
  if (error) console.error('Error updating indexing status:', error);
}

// ─── LLM Structured Extraction ───────────────────────────────────────────────

interface ExtractedStructuredData {
  project_metrics: Array<{
    project_name: string;
    category: string;
    metric_name: string;
    value: number;
    unit: string;
    date?: string;
    raw_text?: string;
  }>;
  permits: Array<{
    project_name: string;
    permit_type: string;
    permit_no?: string;
    description?: string;
    issued_date?: string;
    expiration_date?: string;
    status?: string;
    raw_text?: string;
  }>;
  dd_items: Array<{
    project_name: string;
    checklist_item: string;
    status: string;
    completed_date?: string;
    notes?: string;
  }>;
  doc_type?: string;
}

async function extractStructuredDataWithLLM(
  content: string, filePath: string, fileName: string,
  openaiApiKey: string
): Promise<ExtractedStructuredData | null> {
  // Take first 6000 chars to stay within context limits while getting meaningful data
  const truncated = content.slice(0, 6000);

  const systemPrompt = `You are a data extraction specialist for a land development company. Extract ONLY data that is clearly and explicitly stated in the document. Do NOT guess or infer values.

Return a JSON object with these arrays (empty arrays if nothing found):

1. "project_metrics": Cost/financial data, lot counts, acreage, pricing.
   Each item: { "project_name", "category", "metric_name", "value" (number), "unit", "date" (YYYY-MM-DD if known), "raw_text" (the exact sentence) }
   Categories: "excavation", "grading", "utilities", "paving", "engineering", "dd_engineering", "land", "hard_costs", "soft_costs", "lots", "acreage", "other"
   Metric names: "cost_per_acre", "cost_per_lot", "total_cost", "price_per_acre", "lot_count", "acreage", "price_total", etc.

2. "permits": Permits, bonds, licenses, agreements with dates.
   Each item: { "project_name", "permit_type", "permit_no", "description", "issued_date" (YYYY-MM-DD), "expiration_date" (YYYY-MM-DD), "status", "raw_text" }
   permit_type: "TPDES", "SWPPP", "plat_bond", "performance_bond", "grading_permit", "building_permit", "easement", "agreement", "other"

3. "dd_items": Due diligence checklist items and their completion status.
   Each item: { "project_name", "checklist_item", "status" ("done"|"pending"|"in_progress"|"not_started"), "completed_date" (YYYY-MM-DD if known), "notes" }

4. "doc_type": One of "invoice", "permit", "contract", "proposal", "report", "land_plan", "checklist", "correspondence", "plat", "survey", "environmental", "geotechnical", "title", "other"

CRITICAL RULES:
- Only extract data explicitly stated. Never fabricate.
- For project_name, infer from file path if not in text: "${filePath}"
- "value" must be a number, not a string.
- Dates must be YYYY-MM-DD format or omit.
- If the document has no extractable structured data, return empty arrays.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract structured data from this document.\n\nFile: ${fileName}\nPath: ${filePath}\n\n---\n${truncated}` },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'extract_structured_data',
            description: 'Extract structured business data from a document',
            parameters: {
              type: 'object',
              properties: {
                project_metrics: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      project_name: { type: 'string' },
                      category: { type: 'string' },
                      metric_name: { type: 'string' },
                      value: { type: 'number' },
                      unit: { type: 'string' },
                      date: { type: 'string' },
                      raw_text: { type: 'string' },
                    },
                    required: ['project_name', 'category', 'metric_name', 'value', 'unit'],
                  },
                },
                permits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      project_name: { type: 'string' },
                      permit_type: { type: 'string' },
                      permit_no: { type: 'string' },
                      description: { type: 'string' },
                      issued_date: { type: 'string' },
                      expiration_date: { type: 'string' },
                      status: { type: 'string' },
                      raw_text: { type: 'string' },
                    },
                    required: ['project_name', 'permit_type'],
                  },
                },
                dd_items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      project_name: { type: 'string' },
                      checklist_item: { type: 'string' },
                      status: { type: 'string' },
                      completed_date: { type: 'string' },
                      notes: { type: 'string' },
                    },
                    required: ['project_name', 'checklist_item', 'status'],
                  },
                },
                doc_type: { type: 'string' },
              },
              required: ['project_metrics', 'permits', 'dd_items'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'extract_structured_data' } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`LLM extraction failed (${response.status}):`, errText);
      return null;
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.warn('No tool call in LLM response');
      return null;
    }

    const parsed = typeof toolCall.function.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    return parsed as ExtractedStructuredData;
  } catch (error) {
    console.error('LLM extraction error:', error);
    return null;
  }
}

// ─── Store Structured Data ────────────────────────────────────────────────────

async function storeStructuredData(
  supabase: SupabaseClient,
  data: ExtractedStructuredData,
  filePath: string,
  fileName: string
) {
  // Delete existing structured data for this file (re-indexing)
  await Promise.all([
    supabase.from('project_data').delete().eq('source_file_path', filePath),
    supabase.from('permits_tracking').delete().eq('source_file_path', filePath),
    supabase.from('dd_checklists').delete().eq('source_file_path', filePath),
  ]);

  const results = { metrics: 0, permits: 0, dd_items: 0 };

  // Insert project metrics
  if (data.project_metrics?.length > 0) {
    const rows = data.project_metrics.map(m => ({
      project_name: m.project_name,
      category: m.category,
      metric_name: m.metric_name,
      value: m.value,
      unit: m.unit || null,
      date: m.date || null,
      source_file_path: filePath,
      source_file_name: fileName,
      raw_text: m.raw_text || null,
    }));
    const { error } = await supabase.from('project_data').insert(rows);
    if (error) console.error('Error inserting project_data:', error);
    else results.metrics = rows.length;
  }

  // Insert permits
  if (data.permits?.length > 0) {
    const rows = data.permits.map(p => ({
      project_name: p.project_name,
      permit_type: p.permit_type,
      permit_no: p.permit_no || null,
      description: p.description || null,
      issued_date: p.issued_date || null,
      expiration_date: p.expiration_date || null,
      status: p.status || 'active',
      source_file_path: filePath,
      source_file_name: fileName,
      raw_text: p.raw_text || null,
    }));
    const { error } = await supabase.from('permits_tracking').insert(rows);
    if (error) console.error('Error inserting permits_tracking:', error);
    else results.permits = rows.length;
  }

  // Insert DD checklist items
  if (data.dd_items?.length > 0) {
    const rows = data.dd_items.map(d => ({
      project_name: d.project_name,
      checklist_item: d.checklist_item,
      status: d.status,
      completed_date: d.completed_date || null,
      notes: d.notes || null,
      source_file_path: filePath,
      source_file_name: fileName,
    }));
    const { error } = await supabase.from('dd_checklists').insert(rows);
    if (error) console.error('Error inserting dd_checklists:', error);
    else results.dd_items = rows.length;
  }

  return results;
}

// ─── Simple metadata for chunk-level (lightweight, kept from original) ────────

function extractBasicMetadata(text: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const lowerText = text.toLowerCase();

  // Doc type detection (kept simple)
  if (lowerText.includes('invoice') || lowerText.includes('billing')) metadata.doc_type = 'invoice';
  else if (lowerText.includes('permit') || lowerText.includes('license')) metadata.doc_type = 'permit';
  else if (lowerText.includes('contract') || lowerText.includes('agreement')) metadata.doc_type = 'contract';
  else if (lowerText.includes('proposal') || lowerText.includes('quote')) metadata.doc_type = 'proposal';
  else if (lowerText.includes('report') || lowerText.includes('summary')) metadata.doc_type = 'report';

  return metadata;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let filePath: string | null = null;
  let fileName: string | null = null;

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
    if (!authHeader || !expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (authHeader.replace('Bearer ', '') !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Parse body
    const { content, file_path, file_name, metadata: rawMetadata = {} } = await req.json();
    filePath = file_path;
    fileName = file_name;

    let metadata = rawMetadata;
    if (typeof rawMetadata === 'string') {
      try { metadata = JSON.parse(rawMetadata); } catch { metadata = {}; }
    }

    // Skip minimal content
    if (!content || content.trim().length < 50) {
      console.log(`Skipping file with insufficient content: ${file_name || file_path || 'unknown'}`);
      if (filePath) await updateIndexingStatus(supabase, filePath, fileName, 'skipped', 0, 'Insufficient content (< 50 chars)', {});
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'Insufficient content', chunks_created: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Processing document: ${file_name || 'unknown'} (${content.length} chars)`);
    if (filePath) await updateIndexingStatus(supabase, filePath, fileName, 'pending', 0, null, {});

    // Basic metadata for chunks
    const basicMetadata = extractBasicMetadata(content);

    // LLM structured extraction (runs in parallel with chunking/embedding)
    let structuredPromise: Promise<ExtractedStructuredData | null> = Promise.resolve(null);
    console.log('Starting LLM structured extraction...');
    structuredPromise = extractStructuredDataWithLLM(
      content, file_path || '', file_name || '', openaiApiKey
    );

    // Delete existing chunks
    if (file_path) {
      const { error: deleteError } = await supabase.from('documents').delete().eq('file_path', file_path);
      if (deleteError) console.error('Error deleting existing chunks:', deleteError);
    }

    // Split & embed
    const chunks = splitText(content);
    console.log(`Split into ${chunks.length} chunks`);
    const embeddings = await generateEmbeddingsBatch(chunks, openaiApiKey);

    // Prepare documents
    const documents = chunks.map((chunk, i) => ({
      content: chunk,
      embedding: JSON.stringify(embeddings[i]),
      file_path: file_path || null,
      file_name: file_name || null,
      metadata: { ...metadata, ...basicMetadata, chunk_index: i, total_chunks: chunks.length },
    }));

    // Insert chunks
    const { data, error: insertError } = await supabase.from('documents').insert(documents).select('id');
    if (insertError) throw insertError;

    // Await structured extraction result
    const structuredData = await structuredPromise;
    let structuredResults = { metrics: 0, permits: 0, dd_items: 0 };
    if (structuredData && filePath) {
      console.log('Storing structured data...');
      structuredResults = await storeStructuredData(supabase, structuredData, filePath, fileName || '');
      console.log(`Stored: ${structuredResults.metrics} metrics, ${structuredResults.permits} permits, ${structuredResults.dd_items} DD items`);

      // Auto-detect project aliases by comparing extracted names to folder name
      await detectAndStoreAliases(supabase, structuredData, filePath);
    }

    // Update status
    const finalMetadata = {
      ...basicMetadata,
      doc_type: structuredData?.doc_type || basicMetadata.doc_type,
      structured_extraction: structuredResults,
    };
    if (filePath) await updateIndexingStatus(supabase, filePath, fileName, 'success', documents.length, null, finalMetadata);

    return new Response(JSON.stringify({
      success: true,
      chunks_created: documents.length,
      document_ids: data?.map(d => d.id) || [],
      structured_data: structuredResults,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error processing document:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (filePath) await updateIndexingStatus(supabase, filePath, fileName, 'failed', 0, message, {});
    return new Response(JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
