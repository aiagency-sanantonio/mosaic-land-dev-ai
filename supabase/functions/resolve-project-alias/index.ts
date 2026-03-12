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
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
    if (!authHeader || !expectedSecret || authHeader.replace('Bearer ', '') !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { project_term } = await req.json();
    if (!project_term) {
      return new Response(JSON.stringify({ error: 'project_term is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const term = project_term.trim();

    // Search both canonical and alias columns
    const { data: rows, error } = await supabase
      .from('project_aliases')
      .select('*')
      .or(`alias_name.ilike.%${term}%,canonical_project_name.ilike.%${term}%`);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({
          canonical_name: term,
          aliases: [],
          resolved: false,
          message: 'No aliases found — using term as-is',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by canonical name
    const canonical = rows[0].canonical_project_name;
    const aliases = rows.map((r: any) => ({
      alias_name: r.alias_name,
      alias_type: r.alias_type,
      notes: r.notes,
    }));

    return new Response(
      JSON.stringify({
        canonical_name: canonical,
        aliases,
        resolved: true,
        all_names: [canonical, ...aliases.map((a: any) => a.alias_name)],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in resolve-project-alias:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
