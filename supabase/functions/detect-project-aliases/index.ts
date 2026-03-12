import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract the project folder name from a Dropbox-style file path.
 * E.g. "/1-Projects/Sunset Ridge/Engineering/file.pdf" → "Sunset Ridge"
 */
function extractFolderProject(filePath: string): string | null {
  const match = filePath.match(/\/1-Projects\/([^/]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Normalize a project name for comparison (lowercase, collapse whitespace, strip punctuation).
 */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
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
    // Also allow authenticated Supabase users
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
    // Gather project names from all structured tables, grouped by folder
    const folderNames: Map<string, Map<string, number>> = new Map();

    const addEntry = (folderProject: string | null, projectName: string | null) => {
      if (!folderProject || !projectName || projectName.trim().length === 0) return;
      const fp = folderProject.trim();
      if (!folderNames.has(fp)) folderNames.set(fp, new Map());
      const counts = folderNames.get(fp)!;
      const name = projectName.trim();
      counts.set(name, (counts.get(name) || 0) + 1);
    };

    // 1. project_data
    const { data: pdRows } = await supabase
      .from('project_data')
      .select('project_name, source_file_path');
    for (const row of pdRows || []) {
      addEntry(extractFolderProject(row.source_file_path || ''), row.project_name);
    }

    // 2. permits_tracking
    const { data: ptRows } = await supabase
      .from('permits_tracking')
      .select('project_name, source_file_path');
    for (const row of ptRows || []) {
      addEntry(extractFolderProject(row.source_file_path || ''), row.project_name);
    }

    // 3. dd_checklists
    const { data: ddRows } = await supabase
      .from('dd_checklists')
      .select('project_name, source_file_path');
    for (const row of ddRows || []) {
      addEntry(extractFolderProject(row.source_file_path || ''), row.project_name);
    }

    // Also add the folder name itself as a name variant
    for (const [folderProject, counts] of folderNames) {
      if (!counts.has(folderProject)) {
        counts.set(folderProject, 0); // weight 0 so it only wins if no other names exist
      }
    }

    // Load existing aliases to skip duplicates
    const { data: existingAliases } = await supabase
      .from('project_aliases')
      .select('canonical_project_name, alias_name');
    const existingSet = new Set(
      (existingAliases || []).map(a => `${normalize(a.canonical_project_name)}::${normalize(a.alias_name)}`)
    );

    let aliasesCreated = 0;
    const summary: Array<{ folder: string; canonical: string; aliases: string[] }> = [];

    for (const [folderProject, counts] of folderNames) {
      const distinctNames = Array.from(counts.entries());
      if (distinctNames.length < 2) continue;

      // Pick the most frequent name as canonical
      distinctNames.sort((a, b) => b[1] - a[1]);
      const canonical = distinctNames[0][0];
      const aliases = distinctNames.slice(1).map(([name]) => name);

      const newAliases: string[] = [];
      for (const alias of aliases) {
        if (normalize(alias) === normalize(canonical)) continue;
        const key = `${normalize(canonical)}::${normalize(alias)}`;
        if (existingSet.has(key)) continue;

        const { error } = await supabase.from('project_aliases').upsert({
          canonical_project_name: canonical,
          alias_name: alias,
          alias_type: 'auto_detected',
          notes: `Auto-detected from folder "${folderProject}"`,
        }, { onConflict: 'canonical_project_name,alias_name' });

        if (!error) {
          aliasesCreated++;
          newAliases.push(alias);
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
      details: summary,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error detecting aliases:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
