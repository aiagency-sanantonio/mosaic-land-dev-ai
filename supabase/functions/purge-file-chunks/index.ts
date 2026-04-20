import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the caller is an authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    const filePath = (body?.file_path || '').toString().trim();
    if (!filePath) {
      return new Response(JSON.stringify({ error: 'file_path required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Count first so we can report
    const { count: before } = await admin
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('file_path', filePath);

    const { error: delErr } = await admin
      .from('documents')
      .delete()
      .eq('file_path', filePath);

    if (delErr) throw delErr;

    // Mark as skipped so it doesn't get re-indexed
    await admin.from('indexing_status').upsert({
      file_path: filePath,
      status: 'skipped',
      error_message: 'Manually purged from admin storage panel',
      chunks_created: 0,
      indexed_at: null,
    }, { onConflict: 'file_path' });

    return new Response(JSON.stringify({
      success: true,
      file_path: filePath,
      chunks_deleted: before ?? 0,
      purged_by: user.email || user.id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('purge-file-chunks error:', msg);
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
