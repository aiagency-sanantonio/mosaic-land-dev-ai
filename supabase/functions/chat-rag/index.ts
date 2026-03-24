import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TERRACHAT_SYSTEM_PROMPT = `You are TerraChat, the AI assistant for Mosaic Land Development — a Texas land development company managing 30+ active residential projects. Be specific, always cite sources (file name, source type, date). For costs: show the source tier (bid tab vs OPC) and flag data older than 2 years. For permits: highlight EXPIRED and CRITICAL urgency prominently. If data is incomplete or conflicting, say so explicitly. Do not fabricate numbers. Texas context: MUDs, PIDs, TIRZs, TxDOT, TCEQ, TPDES, plat bonds.`;

const CLASSIFY_SYSTEM_PROMPT = `Classify the question into exactly one type. Return ONLY valid JSON — no markdown:

AGGREGATE — cost averages, totals, comparisons across projects (e.g. "average grading cost per lot")

STATUS_LOOKUP — permits, bonds, TPDES, SWPPP, expiration dates

DOCUMENT_SEARCH — specific document content, contracts, proposals, surveys

HYBRID — needs both structured data and documents (e.g. "full status update for X project")

CLARIFY — too ambiguous. For any "due diligence cost" or "DD cost" question without specified scope, set clarify_question to: "Which due diligence components do you want to include? Survey, geotechnical investigation, civil engineering, Phase I ESA, master development plan, or all of the above?"

Return: { "query_type": "...", "project_name": "name or null", "clarify_question": "question to ask user or null", "reasoning": "one sentence" }`;

interface ClassifyResult {
  query_type: 'AGGREGATE' | 'STATUS_LOOKUP' | 'DOCUMENT_SEARCH' | 'HYBRID' | 'CLARIFY';
  project_name: string | null;
  clarify_question: string | null;
  reasoning: string;
}

async function classifyQuery(message: string): Promise<ClassifyResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  console.log('classifyQuery raw response:', text);

  const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
  return JSON.parse(cleaned) as ClassifyResult;
}

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

async function retrieveAggregate(
  projectName: string | null,
  message: string,
  userId: string,
  threadId: string
): Promise<string> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('project_data').select('*');
  if (projectName) {
    query = query.ilike('project_name', `%${projectName}%`);
  }
  const { data, error } = await query.order('date', { ascending: false }).limit(200);
  if (error) throw new Error(`project_data query failed: ${error.message}`);

  if (!data || data.length === 0) {
    console.log('retrieveAggregate: no structured data found, falling back to document search');
    return retrieveDocuments(message, projectName, userId, threadId);
  }

  const rows = (data || []).map(r => {
    const priority = getSourcePriority(r.source_file_path);
    return {
      project_name: r.project_name,
      category: r.category,
      metric_name: r.metric_name,
      value: r.value,
      unit: r.unit,
      date: r.date,
      source_file_name: r.source_file_name,
      source_priority: priority.label,
      _rank: priority.rank,
    };
  });

  rows.sort((a, b) => a._rank - b._rank);

  return JSON.stringify(rows.map(({ _rank, ...rest }) => rest));
}

async function retrieveStatus(projectName: string | null, message: string): Promise<string> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('permits_tracking').select('*');
  if (projectName) {
    query = query.ilike('project_name', `%${projectName}%`);
  }

  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('expiring') || lowerMsg.includes('due')) {
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + 90);
    query = query.gte('expiration_date', now.toISOString().split('T')[0]);
    query = query.lte('expiration_date', future.toISOString().split('T')[0]);
  }

  const { data, error } = await query.order('expiration_date', { ascending: true }).limit(200);
  if (error) throw new Error(`permits_tracking query failed: ${error.message}`);

  const now = new Date();
  const results = (data || []).map(r => {
    let days_until_expiry: number | null = null;
    let urgency = 'OK';
    if (r.expiration_date) {
      const exp = new Date(r.expiration_date);
      days_until_expiry = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (days_until_expiry < 0) urgency = 'EXPIRED';
      else if (days_until_expiry <= 30) urgency = 'CRITICAL';
      else if (days_until_expiry <= 90) urgency = 'WARNING';
    }
    return {
      project_name: r.project_name,
      permit_type: r.permit_type,
      permit_no: r.permit_no,
      status: r.status,
      description: r.description,
      issued_date: r.issued_date,
      expiration_date: r.expiration_date,
      days_until_expiry,
      urgency,
    };
  });

  return JSON.stringify(results);
}

async function callSearchRanked(
  query: string,
  filterProject: string | null,
  matchCount: number,
  userId: string,
  threadId: string
): Promise<any[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const webhookSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
  if (!supabaseUrl || !webhookSecret) {
    throw new Error('SUPABASE_URL or N8N_WEBHOOK_SECRET not configured');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/search-ranked-documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${webhookSecret}`,
    },
    body: JSON.stringify({
      query,
      query_type: 'general',
      match_count: matchCount,
      content_max_length: 1000,
      match_threshold: 0.15,
      filter_project: filterProject,
      user_id: userId,
      thread_id: threadId,
      include_archive: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`search-ranked-documents error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.documents || [];
}

function formatDocs(docs: any[]): string {
  if (docs.length === 0) return 'No relevant documents found.';
  return docs
    .map((d: any, i: number) =>
      `[${i + 1}] ${d.file_name || 'Unknown'} (${d.source_type || 'document'}, ${d.document_date || 'no date'})\n${d.content || ''}`
    )
    .join('\n\n');
}

async function retrieveDocuments(
  message: string,
  projectName: string | null,
  userId: string,
  threadId: string
): Promise<string> {
  // No project name — single unfiltered call
  if (!projectName) {
    const docs = await callSearchRanked(message, null, 12, userId, threadId);
    return formatDocs(docs);
  }

  // First attempt: filter by classified project name
  console.log(`retrieveDocuments: first attempt with filter_project="${projectName}"`);
  const firstDocs = await callSearchRanked(message, projectName, 12, userId, threadId);
  console.log(`retrieveDocuments: first attempt returned ${firstDocs.length} docs`);

  if (firstDocs.length >= 3) {
    return formatDocs(firstDocs);
  }

  // Fallback: unfiltered search with project name prepended to query
  console.log(`retrieveDocuments: fallback — unfiltered search with project name in query`);
  const augmentedQuery = `${projectName}: ${message}`;
  const fallbackDocs = await callSearchRanked(augmentedQuery, null, 20, userId, threadId);
  console.log(`retrieveDocuments: fallback returned ${fallbackDocs.length} docs`);

  // Merge & deduplicate by id, keeping higher-similarity hit
  const docMap = new Map<string, any>();
  for (const doc of [...firstDocs, ...fallbackDocs]) {
    const id = doc.id || doc.file_name;
    const existing = docMap.get(id);
    if (!existing || (doc.similarity ?? 0) > (existing.similarity ?? 0)) {
      docMap.set(id, doc);
    }
  }

  const merged = Array.from(docMap.values())
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 15);

  return formatDocs(merged);
}

async function synthesizeAnswer(
  message: string,
  chatHistory: string,
  context: string,
  contextType: string
): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const trimmedHistory = chatHistory ? chatHistory.slice(-3000) : '';

  let userContent = '';
  if (trimmedHistory) {
    userContent += `## Recent Chat History\n${trimmedHistory}\n\n`;
  }
  userContent += `## User Question\n${message}\n\n`;
  userContent += `## ${contextType}\n${context}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: TERRACHAT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { threadId, userId, message, chatHistory, job_id, callback_url } = body;

    console.log('chat-rag received:', JSON.stringify({ threadId, userId, message, job_id, callback_url }));

    // Fetch user profile and classify in parallel
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [profileResult, classification] = await Promise.all([
      supabase
        .from('user_profiles_extended')
        .select('display_name, role_title, preferred_projects')
        .eq('user_id', userId)
        .maybeSingle(),
      classifyQuery(message),
    ]);

    console.log('classification:', JSON.stringify(classification));

    const profile = profileResult.data;
    if (profile) {
      const profileLines: string[] = [];
      if (profile.display_name) profileLines.push(`User: ${profile.display_name}`);
      if (profile.role_title) profileLines.push(`Role: ${profile.role_title}`);
      if (profile.preferred_projects?.length) {
        profileLines.push(`Preferred projects: ${profile.preferred_projects.join(', ')}`);
      }
      // No mutation needed — synthesizeAnswer already uses TERRACHAT_SYSTEM_PROMPT;
      // we'll pass profile context as part of the chat history prefix instead.
      if (profileLines.length > 0) {
        const profileContext = `[User Profile]\n${profileLines.join('\n')}\n\n`;
        // Prepend to chatHistory so synthesizeAnswer includes it
        body.chatHistory = profileContext + (chatHistory || '');
      }
    }

    const { query_type, project_name, clarify_question } = classification;

    // CLARIFY — return the clarify question directly, no retrieval
    if (query_type === 'CLARIFY') {
      const response = clarify_question || 'Could you please provide more details about your question?';

      if (callback_url && job_id) {
        await fetch(callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id, response }),
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Retrieve context based on query type
    let context = '';
    let contextType = 'Retrieved Documents';

    if (query_type === 'AGGREGATE') {
      context = await retrieveAggregate(project_name, message, userId, threadId);
      contextType = 'Structured Cost Data';
    } else if (query_type === 'STATUS_LOOKUP') {
      context = await retrieveStatus(project_name, message);
      contextType = 'Permit Status Data';
    } else if (query_type === 'DOCUMENT_SEARCH') {
      context = await retrieveDocuments(message, project_name, userId, threadId);
      contextType = 'Retrieved Documents';
    } else if (query_type === 'HYBRID') {
      const [aggResult, docResult] = await Promise.allSettled([
        retrieveAggregate(project_name, message, userId, threadId),
        retrieveDocuments(message, project_name, userId, threadId),
      ]);

      const parts: string[] = [];
      if (aggResult.status === 'fulfilled') parts.push(`## Structured Cost Data\n${aggResult.value}`);
      if (docResult.status === 'fulfilled') parts.push(`## Retrieved Documents\n${docResult.value}`);
      context = parts.join('\n\n');
      contextType = 'Combined Data';
    }

    console.log(`context retrieved (${contextType}), length=${context.length}`);

    // Synthesize final answer
    const answer = await synthesizeAnswer(message, body.chatHistory || '', context, contextType);

    // POST result to callback
    if (callback_url && job_id) {
      await fetch(callback_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id, response: answer }),
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in chat-rag:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
