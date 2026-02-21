import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { unzipSync, strFromU8, inflateSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BATCH_SIZE = 3;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_BATCH_SIZE = 5;
const PER_FILE_TIMEOUT_MS = 45_000;

// Extensions that can use Dropbox /export API (returns plain text)
const EXPORT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx']);

// Extensions we download and decode as text
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'csv', 'html', 'htm', 'xml', 'json', 'rtf', 'eml',
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

// Metadata extraction patterns
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

/** Use Dropbox /export API for PDF and Office docs — returns plain text, or null if non-exportable */
async function exportFromDropbox(filePath: string, token: string): Promise<string | null> {
  const res = await fetch('https://content.dropboxapi.com/2/files/export', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    // Non-exportable files (regular uploads) or missing scope — signal fallback
    if (errText.includes('non_exportable') || errText.includes('missing_scope')) {
      console.log(`Export not available for ${filePath}, falling back to download`);
      return null;
    }
    throw new Error(`Dropbox export error (${res.status}): ${errText}`);
  }
  return res.text();
}

/** Use Dropbox /download API for plain-text formats */
async function downloadTextFromDropbox(filePath: string, token: string): Promise<string> {
  const buffer = await downloadBinaryFromDropbox(filePath, token);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = decoder.decode(buffer);

  // Special handling for EML: extract headers + body
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

/** Download raw binary from Dropbox /download API */
async function downloadBinaryFromDropbox(filePath: string, token: string): Promise<ArrayBuffer> {
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

/** Extract readable text from PDF binary using fflate decompression */
function extractTextFromPdfBinary(buffer: ArrayBuffer): string {
  try {
    const bytes = new Uint8Array(buffer);
    const raw = new TextDecoder('latin1').decode(bytes);
    const textParts: string[] = [];

    // Find all stream/endstream blocks
    const streamRegex = /stream\r?\n/g;
    let match;
    while ((match = streamRegex.exec(raw)) !== null) {
      const streamStart = match.index + match[0].length;
      const endIdx = raw.indexOf('endstream', streamStart);
      if (endIdx === -1) continue;

      // Look back for /FlateDecode in the object header (within 500 chars before "stream")
      const headerStart = Math.max(0, match.index - 500);
      const header = raw.substring(headerStart, match.index);
      const isFlate = header.includes('/FlateDecode');

      let content: string;
      if (isFlate) {
        try {
          const compressed = bytes.slice(streamStart, endIdx);
          const decompressed = inflateSync(compressed);
          content = new TextDecoder('latin1').decode(decompressed);
        } catch {
          continue; // skip streams that fail to decompress
        }
      } else {
        content = raw.substring(streamStart, endIdx);
      }

      // Extract text from PDF text operators
      const extracted = extractTextFromContentStream(content);
      if (extracted.length > 0) textParts.push(extracted);
    }

    const result = textParts.join('\n').replace(/\s+/g, ' ').trim();
    console.log(`PDF text extraction (fflate): found ${result.length} characters`);
    return result;
  } catch (error) {
    console.error('PDF fflate extraction failed:', error);
    return '';
  }
}

/** Extract text from a PDF content stream by parsing Tj/TJ operators and BT/ET blocks */
function extractTextFromContentStream(content: string): string {
  const parts: string[] = [];

  // Extract strings from Tj operator: (some text) Tj
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let m;
  while ((m = tjRegex.exec(content)) !== null) {
    const decoded = decodePdfString(m[1]);
    if (decoded.trim()) parts.push(decoded);
  }

  // Extract strings from TJ operator (array of strings): [(text1) 50 (text2)] TJ
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/gi;
  while ((m = tjArrayRegex.exec(content)) !== null) {
    const inner = m[1];
    const strRegex = /\(([^)]*)\)/g;
    let s;
    while ((s = strRegex.exec(inner)) !== null) {
      const decoded = decodePdfString(s[1]);
      if (decoded.trim()) parts.push(decoded);
    }
  }

  return parts.join(' ');
}

/** Decode basic PDF string escape sequences */
function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/** Extract text from Office files (DOCX, PPTX, XLSX) by unzipping and reading XML */
function extractTextFromOfficeFile(buffer: ArrayBuffer, ext: string): string {
  try {
    const data = new Uint8Array(buffer);
    const unzipped = unzipSync(data);

    const textParts: string[] = [];
    // Determine which XML files to read based on format
    const targetFiles: string[] = [];
    if (ext === 'docx' || ext === 'doc') {
      targetFiles.push('word/document.xml');
    } else if (ext === 'pptx') {
      // Slides are numbered: ppt/slides/slide1.xml, slide2.xml, etc.
      for (const path of Object.keys(unzipped)) {
        if (path.startsWith('ppt/slides/slide') && path.endsWith('.xml')) {
          targetFiles.push(path);
        }
      }
      targetFiles.sort();
    } else if (ext === 'xlsx' || ext === 'xls') {
      // Shared strings contain cell text
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
        // Strip XML tags to get plain text
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

/** Exchange refresh token for a fresh short-lived access token */
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

/** Wrap a promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms processing ${label}`)), ms)
    ),
  ]);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
    // Get a fresh Dropbox access token via refresh token
    const dropboxToken = await getDropboxAccessToken();

    // Verify user
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch unindexed files
    const { data: unindexedFiles, error: rpcError } = await supabase.rpc('get_unindexed_dropbox_files', {
      p_limit: BATCH_SIZE,
    });

    if (rpcError) throw rpcError;

    if (!unindexedFiles || unindexedFiles.length === 0) {
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
      if (SKIP_EXTENSIONS.has(ext) || (!EXPORT_EXTENSIONS.has(ext) && !TEXT_EXTENSIONS.has(ext) && ext !== '')) {
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

      // Legacy .doc format cannot be parsed — skip with clear message
      if (ext === 'doc') {
        await supabase.from('indexing_status').upsert({
          file_path: filePath,
          file_name: fileName,
          status: 'skipped',
          chunks_created: 0,
          error_message: 'Legacy .doc format not supported - convert to .docx for indexing',
          indexed_at: new Date().toISOString(),
        }, { onConflict: 'file_path' });
        skipped++;
        activity.push({ file: fileName || filePath, status: 'skipped' });
        continue;
      }

      try {
        // Process with per-file timeout
        await withTimeout(
          (async () => {
            let text: string;

            if (EXPORT_EXTENSIONS.has(ext)) {
              // Try Dropbox /export API first (works for Dropbox Paper / Google Docs)
              const exportResult = await exportFromDropbox(filePath, dropboxToken);
              if (exportResult !== null) {
                text = exportResult;
              } else {
                // Fallback: download raw binary and extract text
                console.log(`Downloading binary for ${filePath} (ext: ${ext})`);
                const binary = await downloadBinaryFromDropbox(filePath, dropboxToken);
                if (ext === 'pdf') {
                  text = extractTextFromPdfBinary(binary);
                } else {
                  text = extractTextFromOfficeFile(binary, ext);
                }
              }
            } else {
              // Download and decode as text
              text = await downloadTextFromDropbox(filePath, dropboxToken);
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
              return;
            }

            const extractedMetadata = extractMetadata(text);

            // Delete existing chunks for this file
            await supabase.from('documents').delete().eq('file_path', filePath);

            // Chunk and embed
            const chunks = splitText(text);
            const embeddings = await generateEmbeddingsBatch(chunks, openaiApiKey);

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
          })(),
          PER_FILE_TIMEOUT_MS,
          fileName || filePath
        );

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
    const { count: remainingCount } = await supabase
      .from('dropbox_files')
      .select('id', { count: 'exact', head: true });

    const { count: indexedCount } = await supabase
      .from('indexing_status')
      .select('id', { count: 'exact', head: true });

    const remaining = (remainingCount || 0) - (indexedCount || 0);

    return new Response(JSON.stringify({
      processed, skipped, failed,
      remaining: Math.max(0, remaining),
      errors, activity,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Batch index error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
