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
    const { project_name, permit_type, days_until_expiry, status, include_expired } = await req.json();

    let query = supabase.from('permits_tracking').select('*');

    if (project_name) query = query.ilike('project_name', `%${project_name}%`);
    if (permit_type) query = query.ilike('permit_type', `%${permit_type}%`);
    if (status) query = query.eq('status', status);

    if (days_until_expiry) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + Number(days_until_expiry));
      query = query.lte('expiration_date', futureDate.toISOString().split('T')[0]);
      if (!include_expired) {
        query = query.gte('expiration_date', new Date().toISOString().split('T')[0]);
      }
    }

    const { data, error } = await query.order('expiration_date', { ascending: true }).limit(200);
    if (error) throw error;

    // Categorize results
    const now = new Date();
    const categorized = (data || []).map(permit => {
      let urgency = 'ok';
      if (permit.expiration_date) {
        const expDate = new Date(permit.expiration_date);
        const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) urgency = 'expired';
        else if (daysLeft <= 30) urgency = 'critical';
        else if (daysLeft <= 90) urgency = 'warning';
        (permit as Record<string, unknown>).days_until_expiry = daysLeft;
      }
      return { ...permit, urgency };
    });

    return new Response(JSON.stringify({
      permits: categorized,
      count: categorized.length,
      summary: {
        expired: categorized.filter(p => p.urgency === 'expired').length,
        critical: categorized.filter(p => p.urgency === 'critical').length,
        warning: categorized.filter(p => p.urgency === 'warning').length,
        ok: categorized.filter(p => p.urgency === 'ok').length,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
