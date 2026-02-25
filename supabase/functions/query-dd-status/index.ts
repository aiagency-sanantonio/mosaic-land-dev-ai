import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
    if (!authHeader || !expectedSecret || authHeader.replace('Bearer ', '') !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { project_name, status: filterStatus } = await req.json();

    let query = supabase.from('dd_checklists').select('*');

    if (project_name) query = query.ilike('project_name', `%${project_name}%`);
    if (filterStatus) query = query.eq('status', filterStatus);

    const { data, error } = await query.order('project_name').order('status').limit(500);
    if (error) throw error;

    // Group by project
    const byProject: Record<string, { done: number; pending: number; in_progress: number; items: typeof data }> = {};
    for (const item of data || []) {
      const pn = item.project_name;
      if (!byProject[pn]) byProject[pn] = { done: 0, pending: 0, in_progress: 0, items: [] };
      byProject[pn].items.push(item);
      if (item.status === 'done') byProject[pn].done++;
      else if (item.status === 'in_progress') byProject[pn].in_progress++;
      else byProject[pn].pending++;
    }

    return new Response(JSON.stringify({
      items: data,
      count: data?.length || 0,
      by_project: byProject,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
