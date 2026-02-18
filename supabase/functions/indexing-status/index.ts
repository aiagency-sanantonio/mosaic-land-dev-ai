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

    // Parse optional filters from request body
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        // Empty body is fine — all filters are optional
      }
    }

    const {
      status_filter = null,
      path_prefix = null,
      date_from = null,
      date_to = null,
      summary_only = false,
      fetch_all = false,
      limit: rawLimit = 100,
      offset: rawOffset = 0,
    } = body as {
      status_filter?: string | null;
      path_prefix?: string | null;
      date_from?: string | null;
      date_to?: string | null;
      summary_only?: boolean;
      fetch_all?: boolean;
      limit?: number;
      offset?: number;
    };

    const limit = Math.min(Number(rawLimit) || 100, 1000);
    const offset = Number(rawOffset) || 0;


    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // --- Summary: counts per status (always returned) ---
    const { data: summaryData, error: summaryError } = await supabase
      .from('indexing_status')
      .select('status');

    if (summaryError) throw summaryError;

    const summary = { success: 0, failed: 0, skipped: 0, pending: 0, total: 0 };
    for (const row of summaryData ?? []) {
      const s = row.status as keyof typeof summary;
      if (s in summary) summary[s]++;
      summary.total++;
    }

    if (summary_only) {
      return new Response(
        JSON.stringify({ success: true, summary, records: [], total_returned: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- Helper to build a filtered query for a given page ---
    const buildQuery = (pageOffset: number, pageSize: number) => {
      let q = supabase
        .from('indexing_status')
        .select('file_path, file_name, status, chunks_created, error_message, indexed_at, created_at')
        .order('created_at', { ascending: false })
        .range(pageOffset, pageOffset + pageSize - 1);

      if (status_filter) q = q.eq('status', status_filter);
      if (path_prefix) q = q.like('file_path', `${path_prefix}%`);
      if (date_from) q = q.gte('indexed_at', date_from);
      if (date_to) {
        const endDate = date_to.length === 10 ? `${date_to}T23:59:59Z` : date_to;
        q = q.lte('indexed_at', endDate);
      }

      return q;
    };

    // --- fetch_all: loop through pages of 1000 until exhausted ---
    if (fetch_all) {
      const PAGE_SIZE = 1000;
      const allRecords: Record<string, unknown>[] = [];
      let pageOffset = 0;

      while (true) {
        const { data: page, error: pageError } = await buildQuery(pageOffset, PAGE_SIZE);
        if (pageError) throw pageError;

        allRecords.push(...(page ?? []));

        if (!page || page.length < PAGE_SIZE) break;
        pageOffset += PAGE_SIZE;
      }

      return new Response(
        JSON.stringify({
          success: true,
          summary,
          records: allRecords,
          total_returned: allRecords.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- Default paged query ---
    const { data: records, error: recordsError } = await buildQuery(offset, limit);

    if (recordsError) throw recordsError;

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        records: records ?? [],
        total_returned: records?.length ?? 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in indexing-status:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
