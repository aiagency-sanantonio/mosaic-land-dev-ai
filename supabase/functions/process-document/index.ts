import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunking configuration
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// Recursive character text splitter
function splitText(text: string): string[] {
  const separators = ['\n\n', '\n', '. ', ' ', ''];
  const chunks: string[] = [];
  
  function splitRecursive(text: string, separatorIndex: number): string[] {
    if (text.length <= CHUNK_SIZE) {
      return [text];
    }
    
    const separator = separators[separatorIndex];
    const parts = separator ? text.split(separator) : text.split('');
    const result: string[] = [];
    let currentChunk = '';
    
    for (const part of parts) {
      const partWithSeparator = separator ? part + separator : part;
      
      if (currentChunk.length + partWithSeparator.length <= CHUNK_SIZE) {
        currentChunk += partWithSeparator;
      } else {
        if (currentChunk.length > 0) {
          result.push(currentChunk.trim());
        }
        
        // If the part itself is too large, try next separator
        if (partWithSeparator.length > CHUNK_SIZE && separatorIndex < separators.length - 1) {
          const subChunks = splitRecursive(partWithSeparator, separatorIndex + 1);
          result.push(...subChunks);
          currentChunk = '';
        } else {
          currentChunk = partWithSeparator;
        }
      }
    }
    
    if (currentChunk.trim().length > 0) {
      result.push(currentChunk.trim());
    }
    
    return result;
  }
  
  const rawChunks = splitRecursive(text, 0);
  
  // Apply overlap
  for (let i = 0; i < rawChunks.length; i++) {
    if (i > 0 && CHUNK_OVERLAP > 0) {
      const prevChunk = rawChunks[i - 1];
      const overlap = prevChunk.slice(-CHUNK_OVERLAP);
      chunks.push(overlap + rawChunks[i]);
    } else {
      chunks.push(rawChunks[i]);
    }
  }
  
  return chunks.filter(chunk => chunk.trim().length > 0);
}

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

    // Parse request body
    const { content, file_path, file_name, metadata: rawMetadata = {} } = await req.json();

    // Handle metadata - parse if it's a string (from N8N JSON.stringify)
    let metadata = rawMetadata;
    if (typeof rawMetadata === 'string') {
      try {
        metadata = JSON.parse(rawMetadata);
      } catch (e) {
        console.warn('Could not parse metadata string, using empty object:', e);
        metadata = {};
      }
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing document: ${file_name || 'unknown'} (${content.length} chars)`);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete existing chunks for this file_path (if updating)
    if (file_path) {
      console.log(`Deleting existing chunks for: ${file_path}`);
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('file_path', file_path);

      if (deleteError) {
        console.error('Error deleting existing chunks:', deleteError);
      }
    }

    // Split text into chunks
    const chunks = splitText(content);
    console.log(`Split into ${chunks.length} chunks`);

    // Process each chunk
    const documents = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Generating embedding for chunk ${i + 1}/${chunks.length}`);

      const embedding = await generateEmbedding(chunk, openaiApiKey);

      documents.push({
        content: chunk,
        embedding: JSON.stringify(embedding),
        file_path: file_path || null,
        file_name: file_name || null,
        metadata: {
          ...metadata,
          chunk_index: i,
          total_chunks: chunks.length,
        },
      });
    }

    // Insert all chunks
    console.log(`Inserting ${documents.length} document chunks`);
    const { data, error: insertError } = await supabase
      .from('documents')
      .insert(documents)
      .select('id');

    if (insertError) {
      console.error('Error inserting documents:', insertError);
      throw insertError;
    }

    console.log(`Successfully processed document: ${file_name || file_path || 'unknown'}`);

    return new Response(
      JSON.stringify({
        success: true,
        chunks_created: documents.length,
        document_ids: data?.map(d => d.id) || [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing document:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
