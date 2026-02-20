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

// Regex patterns for metadata extraction
const COST_PATTERN = /\$[\d,]+(?:\.\d{2})?/g;
const DATE_PATTERN = /\b(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)?\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi;
const PROJECT_PATTERN = /(?:project|lot|tract|phase|unit|parcel)[\s:#-]*([A-Za-z0-9-]+)/gi;
const PERMIT_PATTERN = /(?:permit|license|bond)[\s:#-]*([A-Za-z0-9-]+)/gi;
const EXPIRY_PATTERN = /(?:expir(?:es?|ation|y)|due|valid until|renew(?:al)?)[:\s]+([^\n,;]+)/gi;

// Extract structured metadata from text
function extractMetadata(text: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  
  // Extract costs
  const costs = text.match(COST_PATTERN);
  if (costs && costs.length > 0) {
    const costNumbers = costs.map(c => c.replace(/[$,]/g, '')).map(Number).filter(n => !isNaN(n));
    metadata.costs = costNumbers;
    metadata.total_cost = costNumbers.reduce((a, b) => a + b, 0);
    metadata.max_cost = Math.max(...costNumbers);
    metadata.min_cost = Math.min(...costNumbers);
  }
  
  // Extract dates
  const dates = text.match(DATE_PATTERN);
  if (dates && dates.length > 0) {
    metadata.dates = [...new Set(dates)];
  }
  
  // Extract project/lot identifiers
  const projects: string[] = [];
  let projectMatch;
  while ((projectMatch = PROJECT_PATTERN.exec(text)) !== null) {
    projects.push(projectMatch[1]);
  }
  if (projects.length > 0) {
    metadata.projects = [...new Set(projects)];
    metadata.project_name = projects[0]; // Primary project
  }
  
  // Extract permit/bond numbers
  const permits: string[] = [];
  let permitMatch;
  while ((permitMatch = PERMIT_PATTERN.exec(text)) !== null) {
    permits.push(permitMatch[1]);
  }
  if (permits.length > 0) {
    metadata.permits = [...new Set(permits)];
  }
  
  // Extract expiration-related info
  const expirations: string[] = [];
  let expiryMatch;
  while ((expiryMatch = EXPIRY_PATTERN.exec(text)) !== null) {
    expirations.push(expiryMatch[1].trim());
  }
  if (expirations.length > 0) {
    metadata.expirations = [...new Set(expirations)];
  }
  
  // Detect document type based on keywords
  const lowerText = text.toLowerCase();
  if (lowerText.includes('invoice') || lowerText.includes('billing')) {
    metadata.doc_type = 'invoice';
  } else if (lowerText.includes('permit') || lowerText.includes('license')) {
    metadata.doc_type = 'permit';
  } else if (lowerText.includes('contract') || lowerText.includes('agreement')) {
    metadata.doc_type = 'contract';
  } else if (lowerText.includes('proposal') || lowerText.includes('quote')) {
    metadata.doc_type = 'proposal';
  } else if (lowerText.includes('report') || lowerText.includes('summary')) {
    metadata.doc_type = 'report';
  }
  
  return metadata;
}

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

// Generate embedding using OpenAI with retry logic
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

// Generate embeddings in parallel batches with throttling
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

// Update indexing status
async function updateIndexingStatus(
  supabase: SupabaseClient,
  filePath: string,
  fileName: string | null,
  status: 'pending' | 'success' | 'failed' | 'skipped',
  chunksCreated: number,
  errorMessage: string | null,
  extractedMetadata: Record<string, unknown>
) {
  const { error } = await supabase
    .from('indexing_status')
    .upsert({
      file_path: filePath,
      file_name: fileName,
      status,
      chunks_created: chunksCreated,
      error_message: errorMessage,
      metadata: extractedMetadata,
      indexed_at: status === 'success' ? new Date().toISOString() : null,
    }, {
      onConflict: 'file_path',
    });
  
  if (error) {
    console.error('Error updating indexing status:', error);
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Initialize Supabase client early for status tracking
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let filePath: string | null = null;
  let fileName: string | null = null;

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
    filePath = file_path;
    fileName = file_name;

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

    // Content validation - skip files with minimal content
    if (!content || content.trim().length < 50) {
      console.log(`Skipping file with insufficient content: ${file_name || file_path || 'unknown'} (${content?.length || 0} chars)`);
      
      if (filePath) {
        await updateIndexingStatus(supabase, filePath, fileName, 'skipped', 0, 'Insufficient content (< 50 chars)', {});
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'Insufficient content',
          chunks_created: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing document: ${file_name || 'unknown'} (${content.length} chars)`);

    // Update status to pending
    if (filePath) {
      await updateIndexingStatus(supabase, filePath, fileName, 'pending', 0, null, {});
    }

    // Extract structured metadata from full content
    console.log('Extracting structured metadata...');
    const extractedMetadata = extractMetadata(content);
    console.log('Extracted metadata:', JSON.stringify(extractedMetadata));

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

    // Generate embeddings in parallel batches
    console.log(`Generating embeddings for ${chunks.length} chunks in batches of ${EMBEDDING_BATCH_SIZE}...`);
    const embeddings = await generateEmbeddingsBatch(chunks, openaiApiKey);

    // Prepare documents with merged metadata
    const documents = chunks.map((chunk, i) => ({
      content: chunk,
      embedding: JSON.stringify(embeddings[i]),
      file_path: file_path || null,
      file_name: file_name || null,
      metadata: {
        ...metadata,
        ...extractedMetadata,
        chunk_index: i,
        total_chunks: chunks.length,
      },
    }));

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

    // Update indexing status to success
    if (filePath) {
      await updateIndexingStatus(supabase, filePath, fileName, 'success', documents.length, null, extractedMetadata);
    }

    console.log(`Successfully processed document: ${file_name || file_path || 'unknown'}`);

    return new Response(
      JSON.stringify({
        success: true,
        chunks_created: documents.length,
        document_ids: data?.map(d => d.id) || [],
        extracted_metadata: extractedMetadata,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing document:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // Update indexing status to failed
    if (filePath) {
      await updateIndexingStatus(supabase, filePath, fileName, 'failed', 0, message, {});
    }
    
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
