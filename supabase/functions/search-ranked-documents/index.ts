import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------- helpers ----------

async function generateEmbedding(text: string, openaiApiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embedding error: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

/** Infer source_type from file path / name */
function inferSourceType(filePath: string, fileName: string, metadata: any): string {
  const fp = (filePath || '').toLowerCase();
  const fn = (fileName || '').toLowerCase();
  const meta = metadata || {};

  if (meta.doc_type) return meta.doc_type;

  // Bid tabulations
  if (/bid\s*tab/i.test(fn) || /bid\s*tabulation/i.test(fp)) return 'bid_tabulation';
  if (/\bbid\b/i.test(fn) && /\.pdf$/i.test(fn)) return 'bid';

  // Contracts
  if (/contract|agreement|executed/i.test(fn)) return 'contract';
  if (/contractor.*pric/i.test(fn) || /pricing/i.test(fn)) return 'contractor_pricing';

  // OPC / estimates
  if (/\bopc\b/i.test(fn) || /opinion.*probable.*cost/i.test(fn) || /engineer.*estimate/i.test(fn)) return 'opc';
  if (/cost.*track/i.test(fn) || /budget/i.test(fn)) return 'cost_tracking';

  // Proposals
  if (/proposal/i.test(fn)) return 'proposal';
  if (/geotech/i.test(fn) || /boring/i.test(fn)) return 'geotechnical';
  if (/survey/i.test(fn) || /alta/i.test(fn)) return 'survey';
  if (/phase.*1|phase.*i|esa/i.test(fn)) return 'environmental';
  if (/master.*plan|mdp/i.test(fn)) return 'master_plan';

  // Reports / spreadsheets
  if (/\.(xlsx?|csv)$/i.test(fn)) return 'spreadsheet';
  if (/report/i.test(fn)) return 'report';

  return 'document';
}

/** Extract best available date from metadata / filename / created_at */
function extractDocumentDate(metadata: any, fileName: string, createdAt: string): string | null {
  // 1. Explicit date in metadata
  if (metadata?.document_date) return metadata.document_date;
  if (metadata?.date) return metadata.date;
  if (metadata?.modified_date) return metadata.modified_date;

  // 2. Date from filename (common patterns: 2024-01-15, 01-15-2024, 20240115)
  const fn = fileName || '';
  const isoMatch = fn.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const mdyMatch = fn.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1]}-${mdyMatch[2]}`;

  const compactMatch = fn.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;

  // 3. Fallback to created_at
  return createdAt ? createdAt.substring(0, 10) : null;
}

/** Extract project name from file path */
function extractProjectName(filePath: string, metadata: any): string | null {
  if (metadata?.project_name) return metadata.project_name;
  // Path pattern: /1-Projects/ProjectName/...
  const match = (filePath || '').match(/\/1-Projects\/([^/]+)/i);
  return match ? match[1] : null;
}

/** Construct Dropbox web URL from file path */
function buildDropboxUrl(filePath: string): string | null {
  if (!filePath || !filePath.startsWith('/1-Projects')) return null;
  // Dropbox home links aren't predictable without file IDs, but we can use the search URL pattern
  return `https://www.dropbox.com/home${encodeURI(filePath)}`;
}

/** Check if path looks like an archive */
function isArchivePath(filePath: string): boolean {
  return /archive|old|deprecated|backup/i.test(filePath || '');
}

// ---------- pricing reranker ----------

const PRICING_SOURCE_BOOST: Record<string, number> = {
  bid_tabulation: 0.25,
  bid: 0.20,
  contract: 0.18,
  contractor_pricing: 0.18,
  cost_tracking: 0.08,
  spreadsheet: 0.05,
  opc: -0.05,
};

function recencyBoost(docDate: string | null): number {
  if (!docDate) return -0.05;
  const ageMs = Date.now() - new Date(docDate).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 0.15;
  if (ageDays <= 60) return 0.12;
  if (ageDays <= 90) return 0.10;
  if (ageDays <= 180) return 0.07;
  if (ageDays <= 365) return 0.03;
  if (ageDays <= 730) return 0.00;
  return -0.05; // older than 2 years
}

function rerankForPricing(docs: any[]): any[] {
  return docs
    .map((d) => {
      let boost = PRICING_SOURCE_BOOST[d.source_type] || 0;
      boost += recencyBoost(d.document_date);
      if (isArchivePath(d.file_path)) boost -= 0.15;
      return { ...d, reranked_score: (d.similarity || 0) + boost };
    })
    .sort((a, b) => b.reranked_score - a.reranked_score);
}

// ---------- due diligence expander ----------

async function expandDueDiligenceQuery(supabase: any, query: string) {
  const { data: scopes } = await supabase
    .from('concept_scopes')
    .select('*')
    .eq('default_included', true);

  const allKeywords: string[] = [];
  const matchedScopes: string[] = [];

  for (const scope of scopes || []) {
    allKeywords.push(...(scope.keywords || []));
    matchedScopes.push(scope.scope_name);
  }

  return { expandedKeywords: allKeywords, matchedScopes };
}

// ---------- alias resolution ----------

async function resolveProjectAliases(supabase: any, projectTerm: string): Promise<string[]> {
  if (!projectTerm) return [];
  const term = projectTerm.trim();

  // Check if it's an alias
  const { data: aliasRows } = await supabase
    .from('project_aliases')
    .select('canonical_project_name, alias_name')
    .or(`alias_name.ilike.%${term}%,canonical_project_name.ilike.%${term}%`);

  if (!aliasRows || aliasRows.length === 0) return [term];

  const names = new Set<string>();
  for (const row of aliasRows) {
    names.add(row.canonical_project_name);
    names.add(row.alias_name);
  }
  return Array.from(names);
}

// ---------- main ----------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check (N8N webhook secret)
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

    const body = await req.json();
    const {
      query = '',
      query_type = 'general',
      match_count = 8,
      content_max_length = 300,
      match_threshold = 0.15,
      filter_project = null,
      filter_doc_type = null,
      filter_file_type = null,
      filter_date_from = null,
      filter_date_to = null,
      user_id = null,
      thread_id = null,
      include_archive = false,
    } = body;

    // Normalize empty strings to null
    const norm = (v: any) => (v === '' ? null : v);
    const fProject = norm(filter_project);
    const fDocType = norm(filter_doc_type);
    const fFileType = norm(filter_file_type);
    const fDateFrom = norm(filter_date_from);
    const fDateTo = norm(filter_date_to);

    const hasQuery = !!(query && query.trim());
    const hasFilters = !!(fProject || fDocType || fFileType || fDateFrom || fDateTo);

    if (!hasQuery && !hasFilters) {
      return new Response(JSON.stringify({ error: 'Provide a query, filters, or both' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[search-ranked] type=${query_type}, query="${(query || '').substring(0, 60)}", project=${fProject}`);

    // --- Resolve project aliases ---
    let resolvedProjects: string[] = [];
    let normalizedProject = fProject;
    if (fProject) {
      resolvedProjects = await resolveProjectAliases(supabase, fProject);
      normalizedProject = resolvedProjects[0] || fProject;
      console.log(`[search-ranked] Resolved "${fProject}" → [${resolvedProjects.join(', ')}]`);
    }

    // --- Due diligence expansion ---
    let ddContext: { expandedKeywords: string[]; matchedScopes: string[] } | null = null;
    if (query_type === 'due_diligence') {
      ddContext = await expandDueDiligenceQuery(supabase, query);
      console.log(`[search-ranked] DD scopes: ${ddContext.matchedScopes.join(', ')}`);
    }

    // --- Determine match count for initial retrieval ---
    const isPricing = query_type === 'pricing' || query_type === 'line_item_pricing';
    const initialMatchCount = isPricing ? 30 : (query_type === 'due_diligence' ? 25 : match_count);

    // --- Generate embedding if we have a query ---
    let embeddingText: string | null = null;
    if (hasQuery) {
      const queryEmbedding = await generateEmbedding(query, openaiApiKey);
      embeddingText = JSON.stringify(queryEmbedding);
    }

    // --- Run base vector search (for each resolved project name or once with the original filter) ---
    let allResults: any[] = [];

    const projectFilters = resolvedProjects.length > 0 ? resolvedProjects : [fProject];

    for (const projFilter of projectFilters) {
      const { data: docs, error: searchErr } = await supabase.rpc('match_documents_filtered_v2', {
        query_embedding_text: embeddingText,
        match_threshold,
        match_count: initialMatchCount,
        filter_project: projFilter,
        filter_doc_type: fDocType,
        filter_file_type: fFileType,
        filter_date_from: fDateFrom,
        filter_date_to: fDateTo,
      });

      if (searchErr) {
        console.error('Search RPC error:', searchErr);
        throw searchErr;
      }
      if (docs) allResults.push(...docs);
    }

    // Deduplicate by document id
    const seen = new Set<string>();
    allResults = allResults.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    // --- Enrich each result with metadata ---
    const enriched = allResults.map((doc) => {
      const sourceType = inferSourceType(doc.file_path, doc.file_name, doc.metadata);
      const documentDate = extractDocumentDate(doc.metadata, doc.file_name, doc.created_at);
      const projectName = extractProjectName(doc.file_path, doc.metadata);
      const fileUrl = buildDropboxUrl(doc.file_path);
      const isArchive = isArchivePath(doc.file_path);

      return {
        file_name: doc.file_name,
        content: doc.content.substring(0, content_max_length),
        source_type: sourceType,
        document_date: documentDate,
        project_name: projectName,
        similarity: doc.similarity,
        file_url: fileUrl,
        is_archive: isArchive,
      };
    });

    // --- Filter archive unless explicitly requested ---
    let filtered = include_archive ? enriched : enriched.filter((d) => !d.is_archive);

    // --- Apply query-type-specific reranking ---
    if (isPricing) {
      filtered = rerankForPricing(filtered);
      // Mark match_reason
      filtered = filtered.map((d, i) => ({
        ...d,
        match_reason: i < 5 ? 'exact_or_closest' : 'comparable',
      }));
    }

    // Trim to final match_count
    const finalDocs = filtered.slice(0, match_count);

    // --- Build source_type breakdown ---
    const sourceBreakdown: Record<string, number> = {};
    for (const d of finalDocs) {
      sourceBreakdown[d.source_type] = (sourceBreakdown[d.source_type] || 0) + 1;
    }

    // --- Log retrieval ---
    try {
      await supabase.from('retrieval_logs').insert({
        user_id: user_id || null,
        thread_id: thread_id || null,
        question: (query || '').substring(0, 2000),
        query_type,
        normalized_project: normalizedProject,
        top_sources: finalDocs.slice(0, 5).map((d) => ({
          file_name: d.file_name,
          source_type: d.source_type,
          similarity: d.similarity,
          document_date: d.document_date,
        })),
        source_type_breakdown: sourceBreakdown,
        archive_included: include_archive,
      });
    } catch (logErr) {
      console.warn('Failed to log retrieval:', logErr);
    }

    console.log(`[search-ranked] Returning ${finalDocs.length} results (type=${query_type})`);

    return new Response(
      JSON.stringify({
        success: true,
        documents: finalDocs,
        query_type,
        match_count: finalDocs.length,
        ...(ddContext ? { due_diligence_scopes: ddContext.matchedScopes } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in search-ranked-documents:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
