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

    // --- Summary counts ---
    // Total files in inventory
    const { count: totalCount, error: totalError } = await supabase
      .from('dropbox_files')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw totalError;

    // Indexed files: those with a 'success' record in indexing_status
    const { data: indexedPaths, error: indexedError } = await supabase
      .from('indexing_status')
      .select('file_path')
      .eq('status', 'success');

    if (indexedError) throw indexedError;

    const indexedSet = new Set((indexedPaths ?? []).map((r) => r.file_path));
    const totalFiles = totalCount ?? 0;
    const indexedCount = indexedSet.size;

    // Count how many dropbox files are actually in the indexed set
    // (may be less than indexedSet.size if some indexed files were removed from Dropbox)
    const summary = {
      total_files: totalFiles,
      indexed: indexedCount,
      not_yet_indexed: Math.max(0, totalFiles - indexedCount),
    };

    // --- Build the filtered query helper ---
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

    // --- Fetch records (paged or all) ---
    let allRecords: Record<string, unknown>[] = [];

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

    // --- Apply in-memory filters that require joining indexing_status ---
    if (not_yet_indexed) {
      allRecords = allRecords.filter((r) => !indexedSet.has(r.file_path as string));
    }

    if (changed_since_indexed) {
      // Get indexed records with their content_hash stored at index time (from metadata or file hash)
      // We compare dropbox content_hash against what was stored when last indexed
      // Since indexing_status doesn't store content_hash, we flag files where dropbox_modified_at
      // is after the indexed_at timestamp for successful records
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
        if (!indexedAt) return false; // Not indexed — not a "changed" file
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
