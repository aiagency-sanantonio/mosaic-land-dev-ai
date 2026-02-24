import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate embedding using OpenAI
async function generateEmbedding(text: string, openaiApiKey: string): Promise<number[]> {
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');

    if (!authHeader || !expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const {
      query,
      match_count = 15,
      match_threshold = 0.15,
      filter_project = null,
      filter_doc_type = null,
      filter_file_type = null,
      filter_date_from = null,
      filter_date_to = null,
    } = await req.json();

    const hasFilters = !!(filter_project || filter_doc_type || filter_file_type || filter_date_from || filter_date_to);
    const hasQuery = !!(query && query.trim());

    if (!hasQuery && !hasFilters) {
      return new Response(
        JSON.stringify({ error: 'Provide a query, filters, or both' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Search: query="${(query || '').substring(0, 80)}", filters: project=${filter_project}, doc_type=${filter_doc_type}, file_type=${filter_file_type}, date=${filter_date_from}-${filter_date_to}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate embedding only if there's a query
    let embeddingText: string | null = null;
    if (hasQuery) {
      console.log('Generating query embedding...');
      const queryEmbedding = await generateEmbedding(query, openaiApiKey);
      embeddingText = JSON.stringify(queryEmbedding);
    }

    // Always use the v2 function
    const { data: documents, error: searchError } = await supabase.rpc('match_documents_filtered_v2', {
      query_embedding_text: embeddingText,
      match_threshold,
      match_count,
      filter_project,
      filter_doc_type,
      filter_file_type,
      filter_date_from,
      filter_date_to,
    });

    if (searchError) {
      console.error('Search error:', searchError);
      throw searchError;
    }

    console.log(`Found ${documents?.length || 0} matching documents`);

    return new Response(
      JSON.stringify({
        success: true,
        documents: documents || [],
        query: query || null,
        match_count: documents?.length || 0,
        filters_applied: hasFilters,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error searching documents:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
