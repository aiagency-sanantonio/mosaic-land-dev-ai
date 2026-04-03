import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const BATCH_SIZE = 500;

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

async function listFolder(accessToken: string, folderPath: string, recursive: boolean): Promise<DropboxEntry[]> {
  const allEntries: DropboxEntry[] = [];

  const initialResp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath, recursive }),
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
      throw new Error(`list_folder/continue failed [${contResp.status}]: ${text}`);
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Step 1: Get top-level folders only
    const topLevel = await listFolder(accessToken, '/1-Projects', false);
    const subfolders = topLevel.filter((e) => e['.tag'] === 'folder');

    let totalFilesFound = 0;
    let totalRegistered = 0;
    let foldersScanned = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    // Step 2: Process each subfolder independently
    for (const folder of subfolders) {
      try {
        const entries = await listFolder(accessToken, folder.path_display, true);

        const files = entries.filter((e) => {
          if (e['.tag'] !== 'file') return false;
          const ext = getExtension(e.name);
          if (ext === 'zip') return false;
          if (e.size && e.size > MAX_FILE_SIZE) return false;
          return true;
        });

        totalFilesFound += files.length;

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

        // Upsert in batches
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          const { error } = await supabase
            .from('dropbox_files')
            .upsert(batch, { onConflict: 'file_path', ignoreDuplicates: false });
          if (error) {
            errors.push(`${folder.name} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
          } else {
            totalRegistered += batch.length;
          }
        }

        foldersScanned++;
        console.log(`✓ ${folder.name}: ${files.length} files`);
      } catch (folderErr) {
        const msg = folderErr instanceof Error ? folderErr.message : String(folderErr);
        errors.push(`${folder.name}: ${msg}`);
        console.error(`✗ ${folder.name}: ${msg}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        folders_scanned: foldersScanned,
        folders_total: subfolders.length,
        total_files_found: totalFilesFound,
        total_registered: totalRegistered,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in sync-dropbox:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
