import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  filters?: (q: any) => any,
): Promise<any[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: any[] = [];
  while (true) {
    let query = supabase.from(table).select(columns);
    if (filters) query = filters(query);
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');

    if (!authHeader || !expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all rows with pagination
    const [projectRows, docTypeRows, fileTypeRows] = await Promise.all([
      fetchAll(supabase, 'documents', 'file_path', (q: any) => q.like('file_path', '/1-Projects/%')),
      fetchAll(supabase, 'documents', 'metadata', (q: any) => q.not('metadata->doc_type', 'is', null)),
      fetchAll(supabase, 'documents', 'file_name', (q: any) => q.not('file_name', 'is', null)),
    ]);

    // Extract unique project names from file paths
    const projectCounts = new Map<string, number>();
    for (const row of projectRows) {
      const path = row.file_path as string;
      if (path?.startsWith('/1-Projects/')) {
        const parts = path.split('/');
        if (parts.length >= 4 && parts[2]) {
          const name = parts[2];
          projectCounts.set(name, (projectCounts.get(name) || 0) + 1);
        }
      }
    }

    // Extract unique doc types
    const docTypeCounts = new Map<string, number>();
    for (const row of docTypeRows) {
      const docType = row.metadata?.doc_type as string;
      if (docType) {
        docTypeCounts.set(docType, (docTypeCounts.get(docType) || 0) + 1);
      }
    }

    // Extract unique file extensions
    const extCounts = new Map<string, number>();
    for (const row of fileTypeRows) {
      const name = row.file_name as string;
      if (name) {
        const match = name.match(/\.([^.]+)$/);
        if (match) {
          const ext = match[1].toLowerCase();
          extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
        }
      }
    }

    const projects = Array.from(projectCounts.entries())
      .map(([name, count]) => ({ name, chunk_count: count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const doc_types = Array.from(docTypeCounts.entries())
      .map(([type, count]) => ({ type, chunk_count: count }))
      .sort((a, b) => a.type.localeCompare(b.type));

    const file_types = Array.from(extCounts.entries())
      .map(([extension, count]) => ({ extension, chunk_count: count }))
      .sort((a, b) => a.extension.localeCompare(b.extension));

    return new Response(JSON.stringify({
      success: true,
      total_rows_fetched: { projects: projectRows.length, doc_types: docTypeRows.length, file_types: fileTypeRows.length },
      projects,
      doc_types,
      file_types,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error listing filter options:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
