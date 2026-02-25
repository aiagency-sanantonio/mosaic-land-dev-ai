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
    const { projects, categories } = await req.json();

    if (!projects || !Array.isArray(projects) || projects.length < 2) {
      return new Response(JSON.stringify({ error: 'Provide at least 2 project names in "projects" array' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const comparison: Record<string, Record<string, unknown>> = {};

    for (const projectName of projects) {
      // Fetch metrics
      let metricsQuery = supabase.from('project_data').select('*').ilike('project_name', `%${projectName}%`);
      if (categories) metricsQuery = metricsQuery.in('category', categories);
      const { data: metrics } = await metricsQuery.limit(200);

      // Fetch permits
      const { data: permits } = await supabase.from('permits_tracking').select('*').ilike('project_name', `%${projectName}%`).limit(100);

      // Fetch DD status
      const { data: ddItems } = await supabase.from('dd_checklists').select('*').ilike('project_name', `%${projectName}%`).limit(100);

      // Aggregate metrics by category
      const metricsByCategory: Record<string, { avg: number; sum: number; count: number; items: unknown[] }> = {};
      for (const m of metrics || []) {
        const cat = m.category;
        if (!metricsByCategory[cat]) metricsByCategory[cat] = { avg: 0, sum: 0, count: 0, items: [] };
        metricsByCategory[cat].sum += Number(m.value);
        metricsByCategory[cat].count++;
        metricsByCategory[cat].items.push(m);
      }
      for (const cat in metricsByCategory) {
        metricsByCategory[cat].avg = metricsByCategory[cat].sum / metricsByCategory[cat].count;
      }

      comparison[projectName] = {
        metrics: metricsByCategory,
        permits_count: permits?.length || 0,
        permits_expiring_soon: (permits || []).filter(p => {
          if (!p.expiration_date) return false;
          const days = (new Date(p.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          return days >= 0 && days <= 90;
        }).length,
        dd_total: ddItems?.length || 0,
        dd_done: (ddItems || []).filter(d => d.status === 'done').length,
        dd_pending: (ddItems || []).filter(d => d.status !== 'done').length,
      };
    }

    return new Response(JSON.stringify({ comparison }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
