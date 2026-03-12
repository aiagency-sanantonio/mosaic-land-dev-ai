import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractFolderProject(filePath: string): string | null {
  const match = filePath.match(/\/1-Projects\/([^/]+)/i);
  return match ? match[1].trim() : null;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function isLikelyNoise(name: string): boolean {
  if (name.length > 80) return true;
  const noisePatterns = /acres field notes|attachment|exhibit|appendix|schedule|untitled/i;
  return noisePatterns.test(name);
}

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
): Promise<any[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: any[] = [];
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE - 1);
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Auth check
  const authHeader = req.headers.get('Authorization');
  const expectedSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
  if (!authHeader || !expectedSecret || authHeader.replace('Bearer ', '') !== expectedSecret) {
    const token = authHeader?.replace('Bearer ', '');
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  try {
    // folder -> Set of extracted project names
    const folderNames: Map<string, Set<string>> = new Map();

    const addEntry = (folderProject: string | null, projectName: string | null) => {
      if (!folderProject || !projectName || projectName.trim().length === 0) return;
      if (isLikelyNoise(projectName.trim())) return;
      const fp = folderProject.trim();
      if (!folderNames.has(fp)) folderNames.set(fp, new Set());
      folderNames.get(fp)!.add(projectName.trim());
    };

    // Fetch all rows with pagination
    const [pdRows, ptRows, ddRows] = await Promise.all([
      fetchAll(supabase, 'project_data', 'project_name, source_file_path'),
      fetchAll(supabase, 'permits_tracking', 'project_name, source_file_path'),
      fetchAll(supabase, 'dd_checklists', 'project_name, source_file_path'),
    ]);

    for (const row of pdRows) addEntry(extractFolderProject(row.source_file_path || ''), row.project_name);
    for (const row of ptRows) addEntry(extractFolderProject(row.source_file_path || ''), row.project_name);
    for (const row of ddRows) addEntry(extractFolderProject(row.source_file_path || ''), row.project_name);

    // Load existing aliases to skip duplicates
    const existingAliases = await fetchAll(supabase, 'project_aliases', 'canonical_project_name, alias_name');
    const existingSet = new Set(
      existingAliases.map((a: any) => `${normalize(a.canonical_project_name)}::${normalize(a.alias_name)}`)
    );

    let aliasesCreated = 0;
    const summary: Array<{ folder: string; canonical: string; aliases: string[] }> = [];

    for (const [folderProject, names] of folderNames) {
      // Canonical = folder name. All extracted names that differ become aliases.
      const canonical = folderProject;
      const newAliases: string[] = [];

      for (const name of names) {
        if (normalize(name) === normalize(canonical)) continue;
        const key = `${normalize(canonical)}::${normalize(name)}`;
        if (existingSet.has(key)) continue;

        const { error } = await supabase.from('project_aliases').upsert({
          canonical_project_name: canonical,
          alias_name: name,
          alias_type: 'auto_detected',
          notes: `Auto-detected from folder "${folderProject}"`,
        }, { onConflict: 'canonical_project_name,alias_name' });

        if (!error) {
          aliasesCreated++;
          newAliases.push(name);
          existingSet.add(key);
        }
      }

      if (newAliases.length > 0) {
        summary.push({ folder: folderProject, canonical, aliases: newAliases });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      aliases_created: aliasesCreated,
      folders_scanned: folderNames.size,
      rows_fetched: { project_data: pdRows.length, permits_tracking: ptRows.length, dd_checklists: ddRows.length },
      details: summary,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error detecting aliases:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
