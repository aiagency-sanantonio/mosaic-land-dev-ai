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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
    
    if (!authHeader || !expectedSecret) {
      console.error('Missing authorization header or secret');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== expectedSecret) {
      console.error('Invalid authorization token');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body with new filter options
    const { 
      query, 
      match_count = 15, 
      match_threshold = 0.15,
      filter_project = null,
      filter_file_type = null,
      filter_date_from = null,
      filter_date_to = null,
      use_filters = false
    } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: query' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Searching for: "${query.substring(0, 100)}..." (match_count: ${match_count}, threshold: ${match_threshold})`);
    if (use_filters) {
      console.log(`Filters: project=${filter_project}, file_type=${filter_file_type}, date_from=${filter_date_from}, date_to=${filter_date_to}`);
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate embedding for the query
    console.log('Generating query embedding...');
    const queryEmbedding = await generateEmbedding(query, openaiApiKey);

    // Format embedding as JSON array string for text-based RPC
    const embeddingText = JSON.stringify(queryEmbedding);
    
    let documents;
    let searchError;

    if (use_filters && (filter_project || filter_file_type || filter_date_from || filter_date_to)) {
      // Use filtered search function
      console.log('Using filtered search...');
      const result = await supabase.rpc('match_documents_with_filters', {
        query_embedding_text: embeddingText,
        match_threshold: match_threshold,
        match_count: match_count,
        filter_project: filter_project,
        filter_file_type: filter_file_type,
        filter_date_from: filter_date_from,
        filter_date_to: filter_date_to,
      });
      documents = result.data;
      searchError = result.error;
    } else {
      // Use standard text-based function
      console.log('Using standard search...');
      const result = await supabase.rpc('match_documents_text', {
        query_embedding_text: embeddingText,
        match_threshold: match_threshold,
        match_count: match_count,
      });
      documents = result.data;
      searchError = result.error;
    }
    
    if (searchError) {
      console.error('Search error:', searchError);
      throw searchError;
    }

    console.log(`Found ${documents?.length || 0} matching documents`);

    // Log metadata summary for debugging
    if (documents && documents.length > 0) {
      const uniqueProjects = new Set<string>();
      const allCosts: number[] = [];
      
      documents.forEach((doc: { metadata?: { project_name?: string; costs?: number[] } }) => {
        if (doc.metadata?.project_name) {
          uniqueProjects.add(doc.metadata.project_name);
        }
        if (doc.metadata?.costs) {
          allCosts.push(...doc.metadata.costs);
        }
      });
      
      console.log(`Unique projects in results: ${Array.from(uniqueProjects).join(', ') || 'none'}`);
      console.log(`Total cost figures found: ${allCosts.length}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        documents: documents || [],
        query: query,
        match_count: documents?.length || 0,
        filters_applied: use_filters && (filter_project || filter_file_type || filter_date_from || filter_date_to),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error searching documents:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
