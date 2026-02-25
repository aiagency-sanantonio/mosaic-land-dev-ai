import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BATCH_SIZE = 5;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 5;
const PER_FILE_TIMEOUT_MS = 90_000; // 90s per file (OCR is slower)
const MAX_TEXT_LENGTH = 100_000;

// Extensions Mistral OCR supports
const OCR_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp']);
const OCR_PDF_ERROR = 'Scanned/image-only PDF - no extractable text';

// MIME types for Mistral OCR
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
  gif: 'image/gif', webp: 'image/webp',
};

// ─── Dropbox helpers ──────────────────────────────────────────────────────────

function safeDropboxArg(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[\u0080-\uFFFF]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

async function getDropboxAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get('DROPBOX_REFRESH_TOKEN')!;
  const appKey = Deno.env.get('DROPBOX_APP_KEY')!;
  const appSecret = Deno.env.get('DROPBOX_APP_SECRET')!;
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: appKey, client_secret: appSecret,
    }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function downloadBinaryFromDropbox(filePath: string, token: string): Promise<ArrayBuffer> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': safeDropboxArg({ path: filePath }),
    },
  });
  if (!res.ok) throw new Error(`Dropbox download error (${res.status}): ${await res.text()}`);
  return res.arrayBuffer();
}

// ─── Mistral Vision (Pixtral) ─────────────────────────────────────────────────

async function describeImage(base64: string, mimeType: string, mistralKey: string): Promise<string> {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mistralKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'pixtral-large-latest',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: 'Describe this image in detail. What does it show? Include any visible objects, people, equipment, conditions, text, signage, structures, surroundings, and any other relevant context. Be specific and thorough.' },
        ],
      }],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    console.error(`Pixtral vision error (${res.status}): ${await res.text()}`);
    return ''; // Non-fatal: return empty so OCR text still gets indexed
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ─── Mistral OCR ──────────────────────────────────────────────────────────────

async function ocrImage(base64: string, mimeType: string, mistralKey: string): Promise<string> {
  const res = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mistralKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'image_url', image_url: `data:${mimeType};base64,${base64}` },
    }),
  });
  if (!res.ok) throw new Error(`Mistral OCR image error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.pages || []).map((p: { markdown: string }) => p.markdown || '').join('\n\n').trim();
}

async function ocrPdf(binary: ArrayBuffer, fileName: string, mistralKey: string): Promise<string> {
  // Step 1: Upload PDF to Mistral
  const blob = new Blob([binary], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('purpose', 'ocr');
  formData.append('file', blob, fileName || 'document.pdf');

  const uploadRes = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mistralKey}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mistral file upload error (${uploadRes.status}): ${await uploadRes.text()}`);
  const { id: fileId } = await uploadRes.json();

  // Step 2: OCR the uploaded file
  const ocrRes = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mistralKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'file', file_id: fileId },
    }),
  });
  if (!ocrRes.ok) throw new Error(`Mistral OCR PDF error (${ocrRes.status}): ${await ocrRes.text()}`);
  const data = await ocrRes.json();

  // Cleanup: delete uploaded file (best effort)
  fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${mistralKey}` },
  }).catch(() => {});

  return (data.pages || []).map((p: { markdown: string }) => p.markdown || '').join('\n\n').trim();
}

// ─── Text chunking & embeddings (same as batch-index) ─────────────────────────

function splitText(text: string): string[] {
  const separators = ['\n\n', '\n', '. ', ' ', ''];
  function splitRecursive(text: string, sepIdx: number): string[] {
    if (text.length <= CHUNK_SIZE) return [text];
    const sep = separators[sepIdx];
    const parts = sep ? text.split(sep) : text.split('');
    const result: string[] = [];
    let current = '';
    for (const part of parts) {
      const withSep = sep ? part + sep : part;
      if (current.length + withSep.length <= CHUNK_SIZE) { current += withSep; }
      else {
        if (current.length > 0) result.push(current.trim());
        if (withSep.length > CHUNK_SIZE && sepIdx < separators.length - 1) {
          result.push(...splitRecursive(withSep, sepIdx + 1));
          current = '';
        } else { current = withSep; }
      }
    }
    if (current.trim().length > 0) result.push(current.trim());
    return result;
  }
  const raw = splitRecursive(text, 0);
  const chunks: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    chunks.push(i > 0 && CHUNK_OVERLAP > 0 ? raw[i - 1].slice(-CHUNK_OVERLAP) + raw[i] : raw[i]);
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
    if (res.ok) return (await res.json()).data[0].embedding;
    if ((res.status === 429 || res.status >= 500) && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      continue;
    }
    throw new Error(`OpenAI embedding error (${res.status}): ${await res.text()}`);
  }
  throw new Error('Max retries exceeded');
}

async function generateEmbeddingsBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    results.push(...await Promise.all(batch.map(t => generateEmbedding(t, apiKey))));
    if (i + EMBEDDING_BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ─── Metadata extraction (lightweight) ────────────────────────────────────────

const COST_PATTERN = /\$[\d,]+(?:\.\d{2})?/g;
const DATE_PATTERN = /\b(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)?\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi;
const PROJECT_PATTERN = /(?:project|lot|tract|phase|unit|parcel)[\s:#-]*([A-Za-z0-9-]+)/gi;

function extractMetadata(text: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const costs = text.match(COST_PATTERN);
  if (costs?.length) {
    const nums = costs.map(c => c.replace(/[$,]/g, '')).map(Number).filter(n => !isNaN(n));
    metadata.costs = nums;
    metadata.total_cost = nums.reduce((a, b) => a + b, 0);
  }
  const dates = text.match(DATE_PATTERN);
  if (dates?.length) metadata.dates = [...new Set(dates)];
  const projects: string[] = [];
  let m;
  while ((m = PROJECT_PATTERN.exec(text)) !== null) projects.push(m[1]);
  if (projects.length) { metadata.projects = [...new Set(projects)]; metadata.project_name = projects[0]; }
  const lower = text.toLowerCase();
  if (lower.includes('invoice') || lower.includes('billing')) metadata.doc_type = 'invoice';
  else if (lower.includes('permit') || lower.includes('license')) metadata.doc_type = 'permit';
  else if (lower.includes('contract') || lower.includes('agreement')) metadata.doc_type = 'contract';
  else if (lower.includes('proposal') || lower.includes('quote')) metadata.doc_type = 'proposal';
  else if (lower.includes('report') || lower.includes('summary')) metadata.doc_type = 'report';
  return metadata;
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)),
  ]);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
  const mistralApiKey = Deno.env.get('MISTRAL_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth: cron path skips auth (protected by verify_jwt=false + service role),
    // otherwise check N8N secret or Supabase JWT
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');

    // Parse body early so we can check for cron flag
    const body = await req.json().catch(() => ({}));
    const isCron = body.cron === true;

    if (!isCron) {
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
    } else {
      console.log('Cron invocation — skipping auth');
    }

    const batchSize = body.batch_size || BATCH_SIZE;
    const testMode = body.test_mode === true;
    const testLimit = body.test_limit || 50;

    // Find OCR-eligible files: skipped images + scanned PDFs
    // Images: error_message like 'Non-vectorizable format: .jpg' etc.
    // PDFs: error_message = 'Scanned/image-only PDF - no extractable text'
    const ocrExtensions = [...OCR_IMAGE_EXTENSIONS].map(e => `Non-vectorizable format: .${e}`);
    const allEligibleErrors = [...ocrExtensions, OCR_PDF_ERROR];

    const { data: files, error: fetchError } = await supabase
      .from('indexing_status')
      .select('file_path, file_name, error_message')
      .eq('status', 'skipped')
      .in('error_message', allEligibleErrors)
      .order('file_path', { ascending: true })
      .limit(testMode ? Math.min(batchSize, testLimit) : batchSize);

    if (fetchError) throw fetchError;

    if (!files || files.length === 0) {
      // Count total eligible for progress
      const { count } = await supabase
        .from('indexing_status')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'skipped')
        .in('error_message', allEligibleErrors);

      return new Response(JSON.stringify({
        processed: 0, failed: 0, skipped: 0, remaining: 0,
        ocr_eligible_total: count ?? 0,
        message: 'No OCR-eligible files remaining',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`OCR batch: ${files.length} files to process`);

    // Get Dropbox token
    const dropboxToken = await getDropboxAccessToken();

    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ file: string; error: string }> = [];

    for (const file of files) {
      try {
        await withTimeout((async () => {
          const ext = (file.file_name || file.file_path).split('.').pop()?.toLowerCase() || '';
          const isScannedPdf = file.error_message === OCR_PDF_ERROR;
          let imageDescribed = false;

          // Download binary from Dropbox
          console.log(`Downloading: ${file.file_name || file.file_path}`);
          const binary = await downloadBinaryFromDropbox(file.file_path, dropboxToken);

          // Run Mistral OCR
          let ocrText: string;
          if (isScannedPdf) {
            ocrText = await ocrPdf(binary, file.file_name || 'document.pdf', mistralApiKey);
          } else {
            const mimeType = MIME_MAP[ext] || 'image/jpeg';
            const bytes = new Uint8Array(binary);
            let b64 = '';
            // Encode to base64 in chunks to avoid stack overflow
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              b64 += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(b64);
            ocrText = await ocrImage(base64, mimeType, mistralApiKey);

            // Rate-limit delay before Pixtral vision call
            await new Promise(r => setTimeout(r, 2000));
            // Get image description via Pixtral vision model
            console.log(`Describing image: ${file.file_name}`);
            const description = await describeImage(base64, mimeType, mistralApiKey);
            if (description) {
              ocrText = `## Image Description\n${description}\n\n## Extracted Text (OCR)\n${ocrText}`;
              imageDescribed = true;
            }
          }

          if (ocrText.trim().length < 20) {
            console.log(`OCR returned minimal text for ${file.file_name}, marking skipped`);
            await supabase.from('indexing_status').update({
              status: 'skipped',
              error_message: 'OCR returned insufficient text (< 20 chars)',
            }).eq('file_path', file.file_path);
            skipped++;
            return;
          }

          let text = ocrText;
          if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);

          console.log(`OCR extracted ${text.length} chars from ${file.file_name}${imageDescribed ? ' (with description)' : ''}`);

          // Extract metadata
          const metadata = extractMetadata(text);

          // Delete existing chunks if any
          await supabase.from('documents').delete().eq('file_path', file.file_path);

          // Chunk & embed
          const chunks = splitText(text);
          const embeddings = await generateEmbeddingsBatch(chunks, openaiApiKey);
          const documents = chunks.map((chunk, i) => ({
            content: chunk,
            embedding: JSON.stringify(embeddings[i]),
            file_path: file.file_path,
            file_name: file.file_name,
            metadata: { ...metadata, chunk_index: i, total_chunks: chunks.length, ocr_source: 'mistral', ...(imageDescribed ? { image_described: true } : {}) },
          }));

          const { error: insertError } = await supabase.from('documents').insert(documents);
          if (insertError) throw insertError;

          // Update indexing_status to success
          await supabase.from('indexing_status').update({
            status: 'success',
            chunks_created: documents.length,
            error_message: null,
            metadata: { ...metadata, ocr_source: 'mistral', ...(imageDescribed ? { image_described: true } : {}) },
            indexed_at: new Date().toISOString(),
          }).eq('file_path', file.file_path);

          processed++;
          console.log(`✓ ${file.file_name}: ${documents.length} chunks`);
        })(), PER_FILE_TIMEOUT_MS, file.file_name || file.file_path);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ file: file.file_path, error: msg });
        console.error(`✗ ${file.file_path}: ${msg}`);
        await supabase.from('indexing_status').update({
          status: 'failed',
          error_message: `OCR failed: ${msg.slice(0, 500)}`,
        }).eq('file_path', file.file_path);
      }
    }

    // Count remaining
    const { count: remainingCount } = await supabase
      .from('indexing_status')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'skipped')
      .in('error_message', allEligibleErrors);

    const remaining = remainingCount ?? 0;

    // Self-chain if more remain (and not test mode)
    if (remaining > 0 && !testMode) {
      const selfUrl = `${supabaseUrl}/functions/v1/ocr-process`;
      console.log(`Self-chaining: ${remaining} files remaining...`);
      setTimeout(() => {
        fetch(selfUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${expectedSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ batch_size: batchSize }),
        }).catch(err => console.error('Self-chain error:', err));
      }, 500);
    }

    return new Response(JSON.stringify({
      processed, failed, skipped, remaining, errors,
      message: remaining > 0 ? `Batch done, ${remaining} files remaining` : 'All OCR files processed',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('OCR process error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
