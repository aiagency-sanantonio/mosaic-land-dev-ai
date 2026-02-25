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
    const { category, metric_name, project_name, date_from, date_to, aggregation } = await req.json();

    let query = supabase.from('project_data').select('*');

    if (category) query = query.ilike('category', `%${category}%`);
    if (metric_name) query = query.ilike('metric_name', `%${metric_name}%`);
    if (project_name) query = query.ilike('project_name', `%${project_name}%`);
    if (date_from) query = query.gte('date', date_from);
    if (date_to) query = query.lte('date', date_to);

    const { data, error } = await query.order('date', { ascending: false }).limit(500);
    if (error) throw error;

    // Compute aggregations if requested
    let result: Record<string, unknown> = { rows: data, count: data?.length || 0 };

    if (aggregation && data && data.length > 0) {
      const values = data.map(r => Number(r.value)).filter(v => !isNaN(v));
      result.aggregation = {
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };

      // Group by project if multiple projects
      const byProject: Record<string, number[]> = {};
      for (const row of data) {
        const pn = row.project_name || 'Unknown';
        if (!byProject[pn]) byProject[pn] = [];
        byProject[pn].push(Number(row.value));
      }
      result.by_project = Object.entries(byProject).map(([name, vals]) => ({
        project_name: name,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
        sum: vals.reduce((a, b) => a + b, 0),
        count: vals.length,
      }));
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
