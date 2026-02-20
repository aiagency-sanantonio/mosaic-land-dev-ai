import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 5;

// Extensions that can be text-extracted
const VECTORIZABLE_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'csv', 'html', 'htm', 'xml', 'json', 'rtf',
  'eml', 'pdf', 'doc', 'docx', 'xlsx', 'xls', 'pptx',
]);

// Extensions to skip entirely
const SKIP_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'ico', 'webp',
  'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm',
  'mp3', 'wav', 'aac', 'flac', 'ogg', 'wma',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  'dwg', 'dxf', 'dgn', 'shp', 'shx', 'dbf',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin',
  'psd', 'ai', 'indd', 'sketch', 'fig',
]);

// Metadata extraction patterns (same as process-document)
const COST_PATTERN = /\$[\d,]+(?:\.\d{2})?/g;
const DATE_PATTERN = /\b(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)?\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi;
const PROJECT_PATTERN = /(?:project|lot|tract|phase|unit|parcel)[\s:#-]*([A-Za-z0-9-]+)/gi;
const PERMIT_PATTERN = /(?:permit|license|bond)[\s:#-]*([A-Za-z0-9-]+)/gi;
const EXPIRY_PATTERN = /(?:expir(?:es?|ation|y)|due|valid until|renew(?:al)?)[:\s]+([^\n,;]+)/gi;

function extractMetadata(text: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const costs = text.match(COST_PATTERN);
  if (costs?.length) {
    const costNumbers = costs.map(c => c.replace(/[$,]/g, '')).map(Number).filter(n => !isNaN(n));
    metadata.costs = costNumbers;
    metadata.total_cost = costNumbers.reduce((a, b) => a + b, 0);
  }
  const dates = text.match(DATE_PATTERN);
  if (dates?.length) metadata.dates = [...new Set(dates)];
  const projects: string[] = [];
  let m;
  while ((m = PROJECT_PATTERN.exec(text)) !== null) projects.push(m[1]);
  if (projects.length) { metadata.projects = [...new Set(projects)]; metadata.project_name = projects[0]; }
  const permits: string[] = [];
  while ((m = PERMIT_PATTERN.exec(text)) !== null) permits.push(m[1]);
  if (permits.length) metadata.permits = [...new Set(permits)];
  const expirations: string[] = [];
  while ((m = EXPIRY_PATTERN.exec(text)) !== null) expirations.push(m[1].trim());
  if (expirations.length) metadata.expirations = [...new Set(expirations)];
  const lower = text.toLowerCase();
  if (lower.includes('invoice') || lower.includes('billing')) metadata.doc_type = 'invoice';
  else if (lower.includes('permit') || lower.includes('license')) metadata.doc_type = 'permit';
  else if (lower.includes('contract') || lower.includes('agreement')) metadata.doc_type = 'contract';
  else if (lower.includes('proposal') || lower.includes('quote')) metadata.doc_type = 'proposal';
  else if (lower.includes('report') || lower.includes('summary')) metadata.doc_type = 'report';
  return metadata;
}

function splitText(text: string): string[] {
  const separators = ['\n\n', '\n', '. ', ' ', ''];
  const chunks: string[] = [];

  function splitRecursive(text: string, sepIdx: number): string[] {
    if (text.length <= CHUNK_SIZE) return [text];
    const sep = separators[sepIdx];
    const parts = sep ? text.split(sep) : text.split('');
    const result: string[] = [];
    let current = '';
    for (const part of parts) {
      const withSep = sep ? part + sep : part;
      if (current.length + withSep.length <= CHUNK_SIZE) {
        current += withSep;
      } else {
        if (current.length > 0) result.push(current.trim());
        if (withSep.length > CHUNK_SIZE && sepIdx < separators.length - 1) {
          result.push(...splitRecursive(withSep, sepIdx + 1));
          current = '';
        } else {
          current = withSep;
        }
      }
    }
    if (current.trim().length > 0) result.push(current.trim());
    return result;
  }

  const raw = splitRecursive(text, 0);
  for (let i = 0; i < raw.length; i++) {
    if (i > 0 && CHUNK_OVERLAP > 0) {
      const overlap = raw[i - 1].slice(-CHUNK_OVERLAP);
      chunks.push(overlap + raw[i]);
    } else {
      chunks.push(raw[i]);
    }
  }
  return chunks.filter(c => c.trim().length > 0);
}

async function generateEmbedding(text: string, apiKey: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.data[0].embedding;
    }
    const errText = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      continue;
    }
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }
  throw new Error('Max retries exceeded');
}

async function generateEmbeddingsBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(t => generateEmbedding(t, apiKey)));
    results.push(...batchResults);
    if (i + EMBEDDING_BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

async function downloadFromDropbox(filePath: string, token: string): Promise<ArrayBuffer> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dropbox download error (${res.status}): ${errText}`);
  }
  return res.arrayBuffer();
}

function extractTextFromBuffer(buffer: ArrayBuffer, ext: string): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(buffer);

  if (['txt', 'log', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'rtf'].includes(ext)) {
    return text;
  }

  if (ext === 'eml') {
    // Basic EML: strip headers, return body
    const parts = text.split('\n\n');
    const headers = parts[0] || '';
    const body = parts.slice(1).join('\n\n');
    const subjectMatch = headers.match(/^Subject:\s*(.+)$/mi);
    const fromMatch = headers.match(/^From:\s*(.+)$/mi);
    const dateMatch = headers.match(/^Date:\s*(.+)$/mi);
    let result = '';
    if (subjectMatch) result += `Subject: ${subjectMatch[1]}\n`;
    if (fromMatch) result += `From: ${fromMatch[1]}\n`;
    if (dateMatch) result += `Date: ${dateMatch[1]}\n`;
    result += '\n' + body;
    return result;
  }

  // For docx, xlsx, pptx, doc — attempt as plain text (partial extraction)
  if (['docx', 'xlsx', 'xls', 'pptx', 'doc'].includes(ext)) {
    // These are ZIP-based XML formats; raw text decode may capture some readable content
    // Filter out binary noise — keep only printable ASCII + common unicode
    return text.replace(/[^\x20-\x7E\n\r\t\u00A0-\u024F]/g, ' ').replace(/\s{3,}/g, ' ').trim();
  }

  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: require logged-in user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
    const dropboxToken = Deno.env.get('DROPBOX_ACCESS_TOKEN');

    if (!dropboxToken) {
      return new Response(JSON.stringify({ error: 'DROPBOX_ACCESS_TOKEN not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user is authenticated
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch unindexed files
    const { data: unindexedFiles, error: rpcError } = await supabase.rpc('get_unindexed_dropbox_files', {
      p_limit: BATCH_SIZE,
    });

    if (rpcError) throw rpcError;

    if (!unindexedFiles || unindexedFiles.length === 0) {
      // Get remaining count
      const { data: remainingData } = await supabase.rpc('get_unindexed_dropbox_files', { p_limit: 0 });
      return new Response(JSON.stringify({
        processed: 0, skipped: 0, failed: 0, remaining: 0,
        errors: [], message: 'All files have been indexed!',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const errors: { file: string; error: string }[] = [];
    const activity: { file: string; status: string }[] = [];

    for (const file of unindexedFiles) {
      const ext = (file.file_extension || '').toLowerCase().replace('.', '');
      const filePath = file.file_path;
      const fileName = file.file_name;

      // Skip non-vectorizable files
      if (SKIP_EXTENSIONS.has(ext) || (!VECTORIZABLE_EXTENSIONS.has(ext) && ext !== '')) {
        await supabase.from('indexing_status').upsert({
          file_path: filePath,
          file_name: fileName,
          status: 'skipped',
          chunks_created: 0,
          error_message: `Non-vectorizable format: .${ext}`,
          indexed_at: new Date().toISOString(),
        }, { onConflict: 'file_path' });
        skipped++;
        activity.push({ file: fileName || filePath, status: 'skipped' });
        continue;
      }

      try {
        // Download from Dropbox
        const buffer = await downloadFromDropbox(filePath, dropboxToken);

        // Extract text
        let text: string;
        if (ext === 'pdf') {
          // For PDF: try text decode, if mostly binary try basic extraction
          const decoder = new TextDecoder('utf-8', { fatal: false });
          const rawText = decoder.decode(buffer);

          // Simple PDF text extraction: find text between BT and ET markers, or stream content
          const textParts: string[] = [];
          // Try to extract text from PDF text objects
          const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
          let match;
          while ((match = btEtRegex.exec(rawText)) !== null) {
            const block = match[1];
            // Extract text from Tj and TJ operators
            const tjRegex = /\(([^)]*)\)\s*Tj/g;
            let tjMatch;
            while ((tjMatch = tjRegex.exec(block)) !== null) {
              textParts.push(tjMatch[1]);
            }
            // TJ array
            const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
            let tjArrMatch;
            while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
              const inner = tjArrMatch[1];
              const stringRegex = /\(([^)]*)\)/g;
              let strMatch;
              while ((strMatch = stringRegex.exec(inner)) !== null) {
                textParts.push(strMatch[1]);
              }
            }
          }

          text = textParts.join(' ').trim();
          if (text.length < 50) {
            // Fallback: grab any readable text
            text = rawText.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
          }
        } else {
          text = extractTextFromBuffer(buffer, ext);
        }

        // Skip if too little content
        if (text.trim().length < 50) {
          await supabase.from('indexing_status').upsert({
            file_path: filePath,
            file_name: fileName,
            status: 'skipped',
            chunks_created: 0,
            error_message: 'Insufficient extractable text (< 50 chars)',
            indexed_at: new Date().toISOString(),
          }, { onConflict: 'file_path' });
          skipped++;
          activity.push({ file: fileName || filePath, status: 'skipped' });
          continue;
        }

        // Extract metadata
        const extractedMetadata = extractMetadata(text);

        // Delete existing chunks for this file
        await supabase.from('documents').delete().eq('file_path', filePath);

        // Chunk text
        const chunks = splitText(text);

        // Generate embeddings
        const embeddings = await generateEmbeddingsBatch(chunks, openaiApiKey);

        // Insert chunks
        const documents = chunks.map((chunk, i) => ({
          content: chunk,
          embedding: JSON.stringify(embeddings[i]),
          file_path: filePath,
          file_name: fileName,
          metadata: {
            ...extractedMetadata,
            chunk_index: i,
            total_chunks: chunks.length,
            file_extension: ext,
          },
        }));

        const { error: insertError } = await supabase.from('documents').insert(documents);
        if (insertError) throw insertError;

        // Update indexing status
        await supabase.from('indexing_status').upsert({
          file_path: filePath,
          file_name: fileName,
          status: 'success',
          chunks_created: documents.length,
          error_message: null,
          metadata: extractedMetadata,
          indexed_at: new Date().toISOString(),
        }, { onConflict: 'file_path' });

        processed++;
        activity.push({ file: fileName || filePath, status: 'success' });

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Error processing ${filePath}:`, errMsg);

        await supabase.from('indexing_status').upsert({
          file_path: filePath,
          file_name: fileName,
          status: 'failed',
          chunks_created: 0,
          error_message: errMsg,
          indexed_at: new Date().toISOString(),
        }, { onConflict: 'file_path' });

        failed++;
        errors.push({ file: fileName || filePath, error: errMsg });
        activity.push({ file: fileName || filePath, status: 'failed' });
      }
    }

    // Get remaining count
    const { data: remainingFiles } = await supabase.rpc('get_unindexed_dropbox_files', { p_limit: 1 });
    // To get total remaining we do a count query
    const { count: remainingCount } = await supabase
      .from('dropbox_files')
      .select('id', { count: 'exact', head: true });
    
    const { count: indexedCount } = await supabase
      .from('indexing_status')
      .select('id', { count: 'exact', head: true });

    const remaining = (remainingCount || 0) - (indexedCount || 0);

    return new Response(JSON.stringify({
      processed,
      skipped,
      failed,
      remaining: Math.max(0, remaining),
      errors,
      activity,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Batch index error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
