import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

async function getDropboxAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get('DROPBOX_REFRESH_TOKEN')!;
  const appKey = Deno.env.get('DROPBOX_APP_KEY')!;
  const appSecret = Deno.env.get('DROPBOX_APP_SECRET')!;

  const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Dropbox token refresh failed [${resp.status}]: ${text}`);
  }

  const data = await resp.json();
  return data.access_token;
}

interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
  size?: number;
  content_hash?: string;
  server_modified?: string;
}

async function listAllFiles(accessToken: string, folderPath: string): Promise<DropboxEntry[]> {
  const allEntries: DropboxEntry[] = [];

  const initialResp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath, recursive: true }),
  });

  if (!initialResp.ok) {
    const text = await initialResp.text();
    throw new Error(`Dropbox list_folder failed [${initialResp.status}]: ${text}`);
  }

  let result = await initialResp.json();
  allEntries.push(...(result.entries ?? []));

  while (result.has_more) {
    const contResp = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cursor: result.cursor }),
    });

    if (!contResp.ok) {
      const text = await contResp.text();
      throw new Error(`Dropbox list_folder/continue failed [${contResp.status}]: ${text}`);
    }

    result = await contResp.json();
    allEntries.push(...(result.entries ?? []));
  }

  return allEntries;
}

function getExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) return null;
  return fileName.substring(lastDot + 1).toLowerCase();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = await getDropboxAccessToken();

    const folderPath = '/ZZ MD_50KFT/Cost Tracking/00_Average Costs/Recent Bids';
    const allEntries = await listAllFiles(accessToken, folderPath);

    // Filter to files only, skip zip and >20MB
    const files = allEntries.filter((e) => {
      if (e['.tag'] !== 'file') return false;
      const ext = getExtension(e.name);
      if (ext === 'zip') return false;
      if (e.size && e.size > MAX_FILE_SIZE) return false;
      return true;
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date().toISOString();
    const records = files.map((f) => ({
      file_path: f.path_display,
      file_name: f.name,
      file_extension: getExtension(f.name),
      file_size_bytes: f.size ?? null,
      dropbox_id: f.id,
      content_hash: f.content_hash ?? null,
      dropbox_modified_at: f.server_modified ?? null,
      last_seen_at: now,
    }));

    // Upsert in batches of 500
    const BATCH_SIZE = 500;
    let totalUpserted = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('dropbox_files')
        .upsert(batch, { onConflict: 'file_path', ignoreDuplicates: false });
      if (error) throw error;
      totalUpserted += batch.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_entries_found: allEntries.length,
        total_files_found: files.length,
        total_registered: totalUpserted,
        skipped_folders: allEntries.filter((e) => e['.tag'] === 'folder').length,
        skipped_zip_or_oversize: allEntries.filter((e) => {
          if (e['.tag'] !== 'file') return false;
          const ext = getExtension(e.name);
          return ext === 'zip' || (e.size && e.size > MAX_FILE_SIZE);
        }).length,
        file_names: files.map((f) => f.name),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in scan-zz-folder:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
