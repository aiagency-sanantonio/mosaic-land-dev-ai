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

    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        // Empty body is fine
      }
    }

    const {
      extension_filter = null,
      path_prefix = null,
      not_yet_indexed = false,
      changed_since_indexed = false,
      fetch_all = false,
      limit: rawLimit = 100,
      offset: rawOffset = 0,
    } = body as {
      extension_filter?: string | null;
      path_prefix?: string | null;
      not_yet_indexed?: boolean;
      changed_since_indexed?: boolean;
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

    // --- Efficient summary using COUNT queries ---
    const { count: totalFiles, error: countError } = await supabase
      .from('dropbox_files')
      .select('*', { count: 'exact', head: true });
    if (countError) throw countError;

    const { count: indexedCount, error: indexedCountError } = await supabase
      .from('indexing_status')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success');
    if (indexedCountError) throw indexedCountError;

    const summary = {
      total_files: totalFiles ?? 0,
      indexed: indexedCount ?? 0,
      not_yet_indexed: (totalFiles ?? 0) - (indexedCount ?? 0),
    };

    // --- Fetch records ---
    let allRecords: Record<string, unknown>[] = [];

    if (not_yet_indexed) {
      if (fetch_all) {
        // Paginate through RPC to bypass the 1000-row REST API cap
        const PAGE_SIZE = 1000;
        let pageOffset = 0;
        while (true) {
          const { data: page, error: rpcError } = await supabase
            .rpc('get_unindexed_dropbox_files', {
              p_extension_filter: extension_filter ?? null,
              p_path_prefix: path_prefix ?? null,
              p_limit: PAGE_SIZE,
              p_offset: pageOffset,
            });
          if (rpcError) throw rpcError;
          allRecords.push(...(page ?? []));
          if (!page || page.length < PAGE_SIZE) break;
          pageOffset += PAGE_SIZE;
        }
      } else {
        const { data, error: rpcError } = await supabase
          .rpc('get_unindexed_dropbox_files', {
            p_extension_filter: extension_filter ?? null,
            p_path_prefix: path_prefix ?? null,
            p_limit: limit,
            p_offset: offset,
          });
        if (rpcError) throw rpcError;
        allRecords = data ?? [];
      }
    } else {
      // Standard fetch (no not_yet_indexed filter) — use database-side pagination
      const buildQuery = (pageOffset: number, pageSize: number) => {
        let q = supabase
          .from('dropbox_files')
          .select('file_path, file_name, file_extension, file_size_bytes, dropbox_id, content_hash, dropbox_modified_at, discovered_at, last_seen_at')
          .order('file_path', { ascending: true })
          .range(pageOffset, pageOffset + pageSize - 1);

        if (extension_filter) q = q.eq('file_extension', extension_filter);
        if (path_prefix) q = q.like('file_path', `${path_prefix}%`);

        return q;
      };

      if (fetch_all) {
        const PAGE_SIZE = 1000;
        let pageOffset = 0;
        while (true) {
          const { data: page, error: pageError } = await buildQuery(pageOffset, PAGE_SIZE);
          if (pageError) throw pageError;
          allRecords.push(...(page ?? []));
          if (!page || page.length < PAGE_SIZE) break;
          pageOffset += PAGE_SIZE;
        }
      } else {
        const { data: records, error: recordsError } = await buildQuery(offset, limit);
        if (recordsError) throw recordsError;
        allRecords = records ?? [];
      }
    }

    // --- Apply changed_since_indexed filter (unaffected by the above changes) ---
    if (changed_since_indexed) {
      const { data: successRecords, error: successError } = await supabase
        .from('indexing_status')
        .select('file_path, indexed_at')
        .eq('status', 'success');

      if (successError) throw successError;

      const indexedAtMap = new Map(
        (successRecords ?? []).map((r) => [r.file_path, r.indexed_at])
      );

      allRecords = allRecords.filter((r) => {
        const indexedAt = indexedAtMap.get(r.file_path as string);
        if (!indexedAt) return false;
        const dropboxModified = r.dropbox_modified_at as string | null;
        if (!dropboxModified) return false;
        return new Date(dropboxModified) > new Date(indexedAt);
      });
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

  } catch (error) {
    console.error('Error in query-dropbox-files:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
