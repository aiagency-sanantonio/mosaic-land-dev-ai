import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CLASSIFY_SYSTEM_PROMPT = `Classify the question into exactly one type. Return ONLY valid JSON — no markdown:

AGGREGATE — cost averages, totals, comparisons across projects (e.g. "average grading cost per lot")

STATUS_LOOKUP — permits, bonds, TPDES, SWPPP, expiration dates

DOCUMENT_SEARCH — specific document content, contracts, proposals, surveys

HYBRID — needs both structured data and documents (e.g. "full status update for X project")

CLARIFY — too ambiguous, especially any "due diligence cost" or "DD cost" question without specified scope

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

  return JSON.parse(text) as ClassifyResult;
}

function getSourcePriority(filePath: string | null): { rank: number; label: string } {
  const fp = (filePath || '').toLowerCase();
  if (fp.includes('zz md_50kft') || fp.includes('recent bids') || fp.includes('bid tab')) {
    return { rank: 0, label: 'HIGH (bid tab)' };
  }
  if (fp.includes('opc') || fp.includes('opinion')) {
    return { rank: 2, label: 'LOW (OPC)' };
  }
  return { rank: 1, label: 'NORMAL' };
}

async function retrieveAggregate(projectName: string | null): Promise<string> {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { threadId, userId, message, chatHistory, job_id, callback_url } = body;

    console.log('chat-rag received:', JSON.stringify({ threadId, userId, message, job_id, callback_url }));

    const classification = await classifyQuery(message);
    console.log('classification:', JSON.stringify(classification));

    return new Response(
      JSON.stringify({ success: true, classification }),
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
