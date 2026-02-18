import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DropboxFileInput {
  file_path: string;
  file_name?: string;
  file_extension?: string;
  file_size_bytes?: number;
  dropbox_id?: string;
  content_hash?: string;
  dropbox_modified_at?: string;
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
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const files: DropboxFileInput[] = body.files;

    if (!Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Request body must include a non-empty "files" array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date().toISOString();

    // Map to upsert records — set last_seen_at and content_hash on every scan
    const records = files.map((f) => ({
      file_path: f.file_path,
      file_name: f.file_name ?? null,
      file_extension: f.file_extension ?? null,
      file_size_bytes: f.file_size_bytes ?? null,
      dropbox_id: f.dropbox_id ?? null,
      content_hash: f.content_hash ?? null,
      dropbox_modified_at: f.dropbox_modified_at ?? null,
      last_seen_at: now,
      // discovered_at is set only on insert (via DEFAULT now()) — upsert won't overwrite it
    }));

    // Upsert in batches of 500 to stay well within payload limits
    const BATCH_SIZE = 500;
    let totalUpserted = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const { error } = await supabase
        .from('dropbox_files')
        .upsert(batch, {
          onConflict: 'file_path',
          ignoreDuplicates: false,
        });

      if (error) throw error;
      totalUpserted += batch.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        upserted: totalUpserted,
        total_received: files.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in log-dropbox-files:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
