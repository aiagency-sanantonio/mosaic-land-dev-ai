import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import pdfParse from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";
import { Buffer } from "node:buffer";

// Declare EdgeRuntime for Supabase/Deno Deploy waitUntil support
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BATCH_SIZE = 10;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 5;
const PER_FILE_TIMEOUT_MS = 45_000;
const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_OFFICE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100_000;

const EXPORT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx']);

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'csv', 'html', 'htm', 'xml', 'json', 'rtf', 'eml',
]);

const SKIP_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'ico', 'webp',
  'heic', 'heif', 'dng', 'raw', 'cr2', 'nef',
  'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm',
  'mp3', 'wav', 'aac', 'flac', 'ogg', 'wma', 'dss',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  'dwg', 'dxf', 'dgn', 'shp', 'shx', 'dbf', 'kml', 'kmz', 'dat',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin',
  'psd', 'ai', 'indd', 'sketch', 'fig',
  'msg', 'bak', 'mjs', 'out', 'results',
]);

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
  const chunks: string[] = [];
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

/** Escape non-ASCII chars so the header is a valid ASCII ByteString */
function safeDropboxArg(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  return json.replace(/[\u0080-\uFFFF]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

async function exportFromDropbox(filePath: string, token: string): Promise<string | null> {
  const res = await fetch('https://content.dropboxapi.com/2/files/export', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': safeDropboxArg({ path: filePath }),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes('non_exportable') || errText.includes('missing_scope')) {
      console.log(`Export not available for ${filePath}, falling back to download`);
      return null;
    }
    throw new Error(`Dropbox export error (${res.status}): ${errText}`);
  }
  return res.text();
}

async function downloadTextFromDropbox(filePath: string, token: string): Promise<string> {
  const buffer = await downloadBinaryFromDropbox(filePath, token);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = decoder.decode(buffer);
  if (filePath.toLowerCase().endsWith('.eml')) {
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
  return text;
}

async function downloadBinaryFromDropbox(filePath: string, token: string): Promise<ArrayBuffer> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': safeDropboxArg({ path: filePath }),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dropbox download error (${res.status}): ${errText}`);
  }
  return res.arrayBuffer();
}

async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  try {
    const buf = Buffer.from(buffer);
    const data = await pdfParse(buf);
    const text = (data.text || '').trim();
    console.log(`pdf-parse extracted ${text.length} chars from ${data.numpages} pages`);
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (text.length < 50 || letterCount < 20) {
      console.log(`PDF appears to be scanned/image-only (${letterCount} letters). Skipping.`);
      return '';
    }
    return text;
  } catch (error) {
    console.error('pdf-parse extraction failed:', error);
    return '';
  }
}

function extractTextFromOfficeFile(buffer: ArrayBuffer, ext: string): string {
  try {
    const data = new Uint8Array(buffer);
    const unzipped = unzipSync(data);
    const textParts: string[] = [];
    const targetFiles: string[] = [];
    if (ext === 'docx' || ext === 'doc') {
      targetFiles.push('word/document.xml');
    } else if (ext === 'pptx') {
      for (const path of Object.keys(unzipped)) {
        if (path.startsWith('ppt/slides/slide') && path.endsWith('.xml')) {
          targetFiles.push(path);
        }
      }
      targetFiles.sort();
    } else if (ext === 'xlsx' || ext === 'xls') {
      targetFiles.push('xl/sharedStrings.xml');
      for (const path of Object.keys(unzipped)) {
        if (path.startsWith('xl/worksheets/sheet') && path.endsWith('.xml')) {
          targetFiles.push(path);
        }
      }
    }
    for (const target of targetFiles) {
      if (unzipped[target]) {
        const xml = strFromU8(unzipped[target]);
        const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 0) textParts.push(text);
      }
    }
    return textParts.join('\n\n').trim();
  } catch (err) {
    console.error(`Failed to extract text from Office file: ${err}`);
    return '';
  }
}

async function getDropboxAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get('DROPBOX_REFRESH_TOKEN');
  const appKey = Deno.env.get('DROPBOX_APP_KEY');
  const appSecret = Deno.env.get('DROPBOX_APP_SECRET');
  if (!refreshToken || !appKey || !appSecret) {
    throw new Error('Dropbox OAuth not configured: need DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET');
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dropbox token refresh failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.access_token;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms processing ${label}`)), ms)
    ),
  ]);
}

/** Core batch processing logic — shared between browser and cron paths */
async function processBatch(supabase: ReturnType<typeof createClient>, openaiApiKey: string, dropboxToken: string) {
  // Priority pass: fetch unindexed files from ZZ MD_50KFT first
  const { data: priorityFiles, error: priorityError } = await supabase.rpc('get_unindexed_dropbox_files', {
    p_path_prefix: '/ZZ MD_50KFT',
    p_limit: BATCH_SIZE,
  });
  if (priorityError) throw priorityError;

  let unindexedFiles = priorityFiles ?? [];

  // Fill remaining slots with normal unindexed files if priority didn't fill the batch
  if (unindexedFiles.length < BATCH_SIZE) {
    const { data: normalFiles, error: rpcError } = await supabase.rpc('get_unindexed_dropbox_files', {
      p_limit: BATCH_SIZE - unindexedFiles.length,
    });
    if (rpcError) throw rpcError;

    // Deduplicate in case any overlap
    const existingPaths = new Set(unindexedFiles.map((f: { file_path: string }) => f.file_path));
    const extras = (normalFiles ?? []).filter((f: { file_path: string }) => !existingPaths.has(f.file_path));
    unindexedFiles = [...unindexedFiles, ...extras];
  }

  if (!unindexedFiles || unindexedFiles.length === 0) {
    return { processed: 0, skipped: 0, failed: 0, remaining: 0, errors: [], activity: [], message: 'All files have been indexed!' };
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

    if (SKIP_EXTENSIONS.has(ext) || (!EXPORT_EXTENSIONS.has(ext) && !TEXT_EXTENSIONS.has(ext) && ext !== '')) {
      await supabase.from('indexing_status').upsert({
        file_path: filePath, file_name: fileName, status: 'skipped', chunks_created: 0,
        error_message: `Non-vectorizable format: .${ext}`, indexed_at: new Date().toISOString(),
      }, { onConflict: 'file_path' });
      skipped++;
      activity.push({ file: fileName || filePath, status: 'skipped' });
      continue;
    }

    if (ext === 'doc') {
      await supabase.from('indexing_status').upsert({
        file_path: filePath, file_name: fileName, status: 'skipped', chunks_created: 0,
        error_message: 'Legacy .doc format not supported - convert to .docx for indexing', indexed_at: new Date().toISOString(),
      }, { onConflict: 'file_path' });
      skipped++;
      activity.push({ file: fileName || filePath, status: 'skipped' });
      continue;
    }

    if (ext === 'pdf' && file.file_size_bytes && file.file_size_bytes > MAX_PDF_SIZE_BYTES) {
      await supabase.from('indexing_status').upsert({
        file_path: filePath, file_name: fileName, status: 'skipped', chunks_created: 0,
        error_message: `PDF too large (${(file.file_size_bytes / 1024 / 1024).toFixed(1)}MB) - max ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB`,
        indexed_at: new Date().toISOString(),
      }, { onConflict: 'file_path' });
      skipped++;
      activity.push({ file: fileName || filePath, status: 'skipped' });
      continue;
    }

    if (EXPORT_EXTENSIONS.has(ext) && ext !== 'pdf' && file.file_size_bytes && file.file_size_bytes > MAX_OFFICE_SIZE_BYTES) {
      await supabase.from('indexing_status').upsert({
        file_path: filePath, file_name: fileName, status: 'skipped', chunks_created: 0,
        error_message: `Office file too large (${(file.file_size_bytes / 1024 / 1024).toFixed(1)}MB) - max ${MAX_OFFICE_SIZE_BYTES / 1024 / 1024}MB`,
        indexed_at: new Date().toISOString(),
      }, { onConflict: 'file_path' });
      skipped++;
      activity.push({ file: fileName || filePath, status: 'skipped' });
      continue;
    }

    try {
      await withTimeout(
        (async () => {
          let text: string;
          if (EXPORT_EXTENSIONS.has(ext)) {
            const exportResult = await exportFromDropbox(filePath, dropboxToken);
            if (exportResult !== null) {
              text = exportResult;
            } else {
              console.log(`Downloading binary for ${filePath} (ext: ${ext})`);
              const binary = await downloadBinaryFromDropbox(filePath, dropboxToken);
              if (ext === 'pdf') {
                text = await extractTextFromPdf(binary);
              } else {
                text = extractTextFromOfficeFile(binary, ext);
              }
            }
          } else {
            text = await downloadTextFromDropbox(filePath, dropboxToken);
          }

          if (text.trim().length < 50) {
            await supabase.from('indexing_status').upsert({
              file_path: filePath, file_name: fileName, status: 'skipped', chunks_created: 0,
              error_message: ext === 'pdf' ? 'Scanned/image-only PDF - no extractable text' : 'Insufficient extractable text (< 50 chars)',
              indexed_at: new Date().toISOString(),
            }, { onConflict: 'file_path' });
            skipped++;
            activity.push({ file: fileName || filePath, status: 'skipped' });
            return;
          }

          if (text.length > MAX_TEXT_LENGTH) {
            console.log(`Truncating ${fileName} from ${text.length} to ${MAX_TEXT_LENGTH} chars`);
            text = text.slice(0, MAX_TEXT_LENGTH);
          }

          const extractedMetadata = extractMetadata(text);
          await supabase.from('documents').delete().eq('file_path', filePath);
          const chunks = splitText(text);
          const embeddings = await generateEmbeddingsBatch(chunks, openaiApiKey);
          const documents = chunks.map((chunk, i) => ({
            content: chunk,
            embedding: JSON.stringify(embeddings[i]),
            file_path: filePath,
            file_name: fileName,
            metadata: { ...extractedMetadata, chunk_index: i, total_chunks: chunks.length, file_extension: ext },
          }));

          const { error: insertError } = await supabase.from('documents').insert(documents);
          if (insertError) throw insertError;

          await supabase.from('indexing_status').upsert({
            file_path: filePath, file_name: fileName, status: 'success', chunks_created: documents.length,
            error_message: null, metadata: extractedMetadata, indexed_at: new Date().toISOString(),
          }, { onConflict: 'file_path' });

          processed++;
          activity.push({ file: fileName || filePath, status: 'success' });
        })(),
        PER_FILE_TIMEOUT_MS,
        fileName || filePath
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Error processing ${filePath}:`, errMsg);
      await supabase.from('indexing_status').upsert({
        file_path: filePath, file_name: fileName, status: 'failed', chunks_created: 0,
        error_message: errMsg, indexed_at: new Date().toISOString(),
      }, { onConflict: 'file_path' });
      failed++;
      errors.push({ file: fileName || filePath, error: errMsg });
      activity.push({ file: fileName || filePath, status: 'failed' });
    }
  }

  // Get remaining count
  const { count: remainingCount } = await supabase
    .from('dropbox_files')
    .select('id', { count: 'exact', head: true });
  const { count: indexedCount } = await supabase
    .from('indexing_status')
    .select('id', { count: 'exact', head: true });
  const remaining = Math.max(0, (remainingCount || 0) - (indexedCount || 0));

  return { processed, skipped, failed, remaining, errors, activity };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

    // Parse request body
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body OK */ }

    const isCron = body.cron === true;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Kill switch: check if any indexing_jobs row has status 'stopped'
    const { data: stopRow } = await supabase.from('indexing_jobs').select('id').eq('status', 'stopped').limit(1).single();
    if (stopRow) {
      console.log('Kill switch active — aborting batch-index processing');
      return new Response(JSON.stringify({ message: 'Processing stopped by kill switch' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (isCron) {
      // ===== CRON PATH: server-side background processing =====
      console.log('Cron invocation — checking for running job');

      // Find the latest running job
      const { data: jobs, error: jobError } = await supabase
        .from('indexing_jobs')
        .select('*')
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1);

      if (jobError) throw jobError;

      if (!jobs || jobs.length === 0) {
        console.log('No running job found, skipping');
        return new Response(JSON.stringify({ message: 'No running job' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const job = jobs[0];
      const jobId = job.id;

      try {
        const dropboxToken = await getDropboxAccessToken();
        const result = await processBatch(supabase, openaiApiKey, dropboxToken);

        // Re-fetch job to guard against race condition (another chain may have failed/stopped it)
        const { data: freshJob } = await supabase
          .from('indexing_jobs')
          .select('status, stats')
          .eq('id', jobId)
          .single();

        if (freshJob && freshJob.status !== 'running') {
          console.warn(`Job ${jobId} is no longer running (status: ${freshJob.status}), skipping stats update`);
          return new Response(JSON.stringify({ jobId, skipped: true, reason: 'job no longer running' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Update job stats
        const currentStats = ((freshJob?.stats ?? job.stats) as Record<string, number>) || {};
        const newStats = {
          totalProcessed: (currentStats.totalProcessed || 0) + result.processed,
          totalSkipped: (currentStats.totalSkipped || 0) + result.skipped,
          totalFailed: (currentStats.totalFailed || 0) + result.failed,
          remaining: result.remaining,
          batchesCompleted: (currentStats.batchesCompleted || 0) + 1,
        };

        // Check if done
        const isDone = result.remaining === 0 ||
          (result.processed === 0 && result.skipped === 0 && result.failed === 0);

        const updatePayload: Record<string, unknown> = {
          stats: newStats,
          last_error: result.errors.length > 0 ? result.errors[0].error : null,
        };

        if (isDone) {
          updatePayload.status = 'completed';
          updatePayload.completed_at = new Date().toISOString();
        }

        await supabase.from('indexing_jobs').update(updatePayload).eq('id', jobId).eq('status', 'running');

        // Self-chain: if there's more work and job is still running, trigger next batch
        let chainPromise: Promise<unknown> | null = null;
        if (!isDone) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
          const fnUrl = `${supabaseUrl}/functions/v1/batch-index`;
          // Delayed self-chain — EdgeRuntime.waitUntil ensures it completes
          chainPromise = new Promise<void>(resolve => setTimeout(resolve, 500))
            .then(() => fetch(fnUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({ cron: true }),
            }))
            .then(r => r.text())
            .then(() => console.log('Self-chain triggered successfully'))
            .catch(err => console.error('Self-chain fetch failed:', err));
        }

        const response = new Response(JSON.stringify({ jobId, ...result, done: isDone }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

        if (chainPromise) {
          EdgeRuntime.waitUntil(chainPromise);
        }

        return response;

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Cron batch error:', errMsg);

        // Only mark as permanently failed if token refresh credentials are invalid
        const isCredentialError = errMsg.includes('Dropbox token refresh failed') || errMsg.includes('OAuth not configured');

        if (isCredentialError) {
          await supabase.from('indexing_jobs').update({
            status: 'failed',
            last_error: errMsg,
            completed_at: new Date().toISOString(),
          }).eq('id', jobId);
        } else {
          // Transient error (401, timeout, etc.) — keep running, log the error, let next tick retry
          await supabase.from('indexing_jobs').update({
            last_error: errMsg,
          }).eq('id', jobId).eq('status', 'running');
          console.warn(`Transient error, keeping job ${jobId} running for retry: ${errMsg}`);
        }

        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

    } else {
      // ===== BROWSER PATH: original behavior (auth required) =====
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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

      const dropboxToken = await getDropboxAccessToken();
      const result = await processBatch(supabase, openaiApiKey, dropboxToken);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Batch index error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
