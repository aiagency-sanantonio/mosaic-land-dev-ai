import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── LLM Structured Extraction ────────────────────────────────────────────────

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
    if (!toolCall?.function?.arguments) return null;

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
  await Promise.all([
    supabase.from('project_data').delete().eq('source_file_path', filePath),
    supabase.from('permits_tracking').delete().eq('source_file_path', filePath),
    supabase.from('dd_checklists').delete().eq('source_file_path', filePath),
  ]);

  const results = { metrics: 0, permits: 0, dd_items: 0 };

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

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Kill switch: check if any indexing_jobs row has status 'stopped'
    const { data: stopRow } = await supabase.from('indexing_jobs').select('id').eq('status', 'stopped').limit(1).single();
    if (stopRow) {
      console.log('Kill switch active — aborting structured data extraction');
      return new Response(JSON.stringify({ message: 'Processing stopped by kill switch' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Auth: accept N8N_WEBHOOK_SECRET or valid Supabase JWT
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
    let authorized = false;

    if (authHeader && expectedSecret && authHeader.replace('Bearer ', '') === expectedSecret) {
      authorized = true;
    } else if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (user) authorized = true;
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const batchSize = body.batch_size || 10;
    const projectFilter = body.project_filter || null;

    // If force, reset the structured_extracted flag for matching files
    if (force) {
      let resetQuery = supabase
        .from('indexing_status')
        .update({ structured_extracted: false } as any)
        .eq('status', 'success')
        .eq('structured_extracted', true);

      if (projectFilter) {
        resetQuery = resetQuery.ilike('file_path', `%${projectFilter}%`);
      }
      await resetQuery;
    }

    // Query files that need extraction: status=success AND structured_extracted=false
    let query = supabase
      .from('indexing_status')
      .select('file_path, file_name')
      .eq('status', 'success')
      .eq('structured_extracted', false)
      .order('file_path', { ascending: true })
      .limit(batchSize);

    if (projectFilter) {
      query = query.ilike('file_path', `%${projectFilter}%`);
    }

    const { data: filesToProcess, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!filesToProcess || filesToProcess.length === 0) {
      // Get total counts for the response
      const [totalRes, doneRes] = await Promise.all([
        supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success'),
        supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success').eq('structured_extracted', true),
      ]);
      return new Response(JSON.stringify({
        processed: 0, skipped: 0, failed: 0, remaining: 0,
        totals: { metrics: 0, permits: 0, dd_items: 0 },
        extraction_progress: { done: doneRes.count ?? 0, total: totalRes.count ?? 0 },
        errors: [], message: 'All files already processed',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Extract batch: ${filesToProcess.length} files to process`);

    // Process each file in the batch
    let processed = 0;
    let failed = 0;
    const totals = { metrics: 0, permits: 0, dd_items: 0 };
    const errors: Array<{ file: string; error: string }> = [];

    for (const file of filesToProcess) {
      try {
        // Get document chunks for this file
        const { data: chunks, error: chunkError } = await supabase
          .from('documents')
          .select('content, metadata')
          .eq('file_path', file.file_path)
          .order('created_at', { ascending: true })
          .limit(10);

        if (chunkError) throw chunkError;
        if (!chunks || chunks.length === 0) {
          console.warn(`No chunks found for ${file.file_path}, marking as extracted`);
          await supabase.from('indexing_status').update({ structured_extracted: true } as any).eq('file_path', file.file_path);
          processed++;
          continue;
        }

        // Concatenate chunks up to 6000 chars
        let content = '';
        for (const chunk of chunks) {
          if (content.length >= 6000) break;
          content += chunk.content + '\n';
        }
        content = content.slice(0, 6000);

        if (content.trim().length < 50) {
          console.warn(`Insufficient content for ${file.file_path}, marking as extracted`);
          await supabase.from('indexing_status').update({ structured_extracted: true } as any).eq('file_path', file.file_path);
          processed++;
          continue;
        }

        // Run LLM extraction
        const structuredData = await extractStructuredDataWithLLM(
          content, file.file_path, file.file_name || '', openaiApiKey
        );

        if (structuredData) {
          const results = await storeStructuredData(supabase, structuredData, file.file_path, file.file_name || '');
          totals.metrics += results.metrics;
          totals.permits += results.permits;
          totals.dd_items += results.dd_items;
          console.log(`✓ ${file.file_path}: ${results.metrics}m ${results.permits}p ${results.dd_items}d`);
        }

        // Mark as extracted regardless of whether data was found
        await supabase.from('indexing_status').update({ structured_extracted: true } as any).eq('file_path', file.file_path);
        processed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ file: file.file_path, error: msg });
        console.error(`✗ ${file.file_path}: ${msg}`);
        // Still mark as extracted to avoid infinite loop on consistently failing files
        await supabase.from('indexing_status').update({ structured_extracted: true } as any).eq('file_path', file.file_path);
      }
    }

    // Check how many remain
    const { count: remainingCount } = await supabase
      .from('indexing_status')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success')
      .eq('structured_extracted', false);

    const remaining = remainingCount ?? 0;

    // Self-chain if more files remain
    if (remaining > 0) {
      const selfUrl = `${supabaseUrl}/functions/v1/extract-structured-data`;
      console.log(`Self-chaining: ${remaining} files remaining...`);
      setTimeout(() => {
        fetch(selfUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${expectedSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ force: false, batch_size: batchSize, project_filter: projectFilter }),
        }).catch(err => console.error('Self-chain error:', err));
      }, 200);
    }

    // Get total for progress reporting
    const { count: totalSuccess } = await supabase
      .from('indexing_status')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success');

    const done = (totalSuccess ?? 0) - remaining;

    return new Response(JSON.stringify({
      processed, skipped: 0, failed, remaining, totals, errors,
      extraction_progress: { done, total: totalSuccess ?? 0 },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Extract structured data error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
