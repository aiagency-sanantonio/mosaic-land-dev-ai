import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TERRACHAT_SYSTEM_PROMPT = `CRITICAL RULE — VERIFIED BID DATA:
1. If the context contains a section labeled "MOST RECENT VERIFIED BID SNAPSHOT", you MUST quote that section verbatim at the start of your response before any interpretation or commentary.
2. If the context contains a section labeled "VERIFIED BID DATA", you MUST lead your response with those exact figures. Never say you do not have bid data or that bid tabulations are unavailable if either section exists — they contain official contractor bids.
3. The most recent dates take priority. Always surface the most recent dated record first.
4. NEVER use phrases like "I don't have verified bid data", "no bid tabulations available", "I couldn't find bid data" or similar when VERIFIED BID DATA or MOST RECENT VERIFIED BID SNAPSHOT sections are present in the context. This is a hard rule with zero exceptions.

You are TerraChat, the AI assistant for Mosaic Land Development — a Texas land development company managing 30+ active residential projects. Be specific, always cite sources (file name, source type, date). For costs: show the source tier (bid tab vs OPC) and flag data older than 2 years. For permits: highlight EXPIRED and CRITICAL urgency prominently. If data is incomplete or conflicting, say so explicitly. Do not fabricate numbers. Texas context: MUDs, PIDs, TIRZs, TxDOT, TCEQ, TPDES, plat bonds. When answering cost questions, ALWAYS prioritize records under VERIFIED BID DATA over OTHER COST DATA. If verified bid data exists for a project, lead your answer with those figures and only reference other cost data as supplementary context. When citing sources, always include the full clickable markdown link provided in the context. Format source citations as: 📄 filename. Never cite a source without its link. If no link is available, note the filename only.`;

const CLASSIFY_SYSTEM_PROMPT = `Classify the question into exactly one type. Return ONLY valid JSON — no markdown:

AGGREGATE — cost averages, totals, comparisons across projects (e.g. "average grading cost per lot")

STATUS_LOOKUP — permits, bonds, TPDES, SWPPP, expiration dates

DOCUMENT_SEARCH — specific document content, contracts, proposals, surveys

HYBRID — needs both structured data and documents (e.g. "full status update for X project")

URL_RESEARCH — user is asking about, referencing, or wants analysis of a specific web URL. This includes:
- A message containing a URL (e.g. "what is this? https://...")
- Referencing a URL from chat history (e.g. "summarize that link", "do the same thing but with this one", "how many lots are on that page?", "can you research the first link?")
Extract the URL into the "url" field. If the URL appeared in chat history (not the current message), still extract it.

SAVED_LINK_SEARCH — user is asking about saved web links, bookmarks, or websites the team has saved (e.g. "what links do we have for Fischer Ranch", "find saved link for TCEQ", "show me vendor links", "where are the district maps again?")
Extract the core topic/entity keywords into "search_keywords" (e.g. "district maps" from "where are the district maps again?", "TCEQ" from "do we have a TCEQ link saved?").

CLARIFY — too ambiguous. For any "due diligence cost" or "DD cost" question without specified scope, set clarify_question to: "Which due diligence components do you want to include? Survey, geotechnical investigation, civil engineering, Phase I ESA, master development plan, or all of the above?"

If the chat history shows the assistant just asked a clarifying question and the user's current message is a short follow-up answer (e.g. "all", "yes", "all of the above", a project name, or a list of components), do NOT return CLARIFY. Instead, combine the original question from chat history with the user's answer and classify the combined intent as AGGREGATE, STATUS_LOOKUP, DOCUMENT_SEARCH, or HYBRID accordingly.

IMPORTANT — URL_RESEARCH vs SAVED_LINK_SEARCH priority:
- If the chat history shows the assistant previously researched or summarized a URL, and the user's follow-up question references that content (e.g. "give me the link to the first district map", "how many sections are there?", "what about district 1?"), classify as URL_RESEARCH and extract the URL from history. Do NOT classify as SAVED_LINK_SEARCH.
- SAVED_LINK_SEARCH is ONLY for when the user is asking about links saved in the team library and there is NO prior URL research in the conversation.

Return: { "query_type": "...", "project_name": "name or null", "project_names": ["name1", "name2"] or null, "clarify_question": "question to ask user or null", "url": "extracted URL or null", "search_keywords": "extracted topic keywords or null", "reasoning": "one sentence" }

If the question mentions two or more projects (e.g. "compare bids for Fischer Ranch and Clearwater"), populate "project_names" with ALL of them and set "project_name" to the first one. If only one project is mentioned, set "project_names" to null.`;

interface ClassifyResult {
  query_type: 'AGGREGATE' | 'STATUS_LOOKUP' | 'DOCUMENT_SEARCH' | 'HYBRID' | 'CLARIFY' | 'SAVED_LINK_SEARCH' | 'URL_RESEARCH';
  project_name: string | null;
  project_names: string[] | null;
  clarify_question: string | null;
  url?: string | null;
  search_keywords?: string | null;
  reasoning: string;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in classifier response');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error('Unterminated JSON object in classifier response');
}


  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const trimmedHistory = chatHistory ? chatHistory.slice(-1500) : '';
  const userContent = trimmedHistory
    ? `## Recent Chat History\n${trimmedHistory}\n\n## Current Question\n${message}`
    : message;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  console.log('classifyQuery raw response:', text);

  // Extract the first valid JSON object using brace counting (handles trailing text from LLM)
  const jsonStr = extractJsonObject(text);
  return JSON.parse(jsonStr) as ClassifyResult;
}

function extractDateFromFilename(fileName: string | null): Date | null {
  if (!fileName) return null;
  const isoMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  const yymmddMatch = fileName.match(/^(\d{2})(\d{2})(\d{2})/) || fileName.match(/[_\-](\d{2})(\d{2})(\d{2})(?:\.|_|$)/);
  if (yymmddMatch) {
    const yy = parseInt(yymmddMatch[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    const d = new Date(`${year}-${yymmddMatch[2]}-${yymmddMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function buildDropboxUrl(filePath: string | null): string | null {
  if (!filePath) return null;
  const encoded = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `https://www.dropbox.com/home${encoded}`;
}

function getSourcePriority(filePath: string | null): { rank: number; label: string } {
  const fp = (filePath || '').toLowerCase();
  if (fp.includes('zz md_50kft') || fp.includes('recent bids') || fp.includes('average cost')) {
    return { rank: 0, label: 'HIGHEST (master cost)' };
  }
  if (fp.includes('bid tab')) {
    return { rank: 1, label: 'HIGH (bid tab)' };
  }
  if (fp.includes('opc') || fp.includes('opinion')) {
    return { rank: 3, label: 'LOW (OPC)' };
  }
  return { rank: 2, label: 'NORMAL' };
}

interface BidSummary {
  hasBids: boolean;
  topBid: { value: number; metric: string; date: string | null; source: string | null; dropboxUrl: string | null } | null;
  allBidRows: any[];
}

function isBidRelatedQuestion(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return /\b(bid|bids|bid total|bid amount|bid comparison|bid tab|contractor bid|bid result|bid tabulation)\b/.test(lowerMsg);
}

function buildDeterministicBidResponse(summary: BidSummary, projectName: string | null): string {
  if (!summary.hasBids || !summary.topBid) return '';

  const formatCurrency = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const top = summary.topBid;
  const projLabel = projectName || 'the project';

  // Group allBidRows by source_file_name to detect bid tabulations
  const bySource: Record<string, any[]> = {};
  for (const r of summary.allBidRows) {
    const key = r.source_file_name || '_unknown_';
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(r);
  }

  // Check if the top bid's source file is a multi-contractor bid tabulation
  const topSourceRows = bySource[top.source || '_unknown_'] || [];
  const isBidTab = topSourceRows.length >= 3;

  const lines: string[] = [];
  lines.push(`## Verified Bid Data for ${projLabel}\n`);

  if (isBidTab) {
    const values = topSourceRows.map((r: any) => r.value as number);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const count = topSourceRows.length;
    lines.push(`**Apparent low bid: ${formatCurrency(minVal)} (lowest of ${count} contractor bids ranging up to ${formatCurrency(maxVal)})**`);
  } else {
    lines.push(`**Most recent verified bid total: ${formatCurrency(top.value)}**`);
  }

  if (top.date) lines.push(`- **Date:** ${top.date}`);
  if (top.metric) lines.push(`- **Metric:** ${top.metric}`);
  if (top.source) {
    const link = top.dropboxUrl ? `📄 [${top.source}](${top.dropboxUrl})` : `📄 ${top.source}`;
    lines.push(`- **Source:** ${link}`);
  }

  // Show individual bids from the tabulation
  if (isBidTab) {
    const sorted = [...topSourceRows].sort((a, b) => a.value - b.value);
    lines.push('');
    lines.push('### Contractor Bids');
    lines.push('| # | Amount |');
    lines.push('|---|--------|');
    sorted.forEach((r: any, i: number) => {
      lines.push(`| ${i + 1} | ${formatCurrency(r.value)} |`);
    });
  }

  // Add other bid records from different source files
  const otherRows = summary.allBidRows.filter(r => (r.source_file_name || '_unknown_') !== (top.source || '_unknown_')).slice(0, 10);
  if (otherRows.length > 0) {
    lines.push('');
    lines.push('### Other Verified Bid Records');
    lines.push('| Date | Source | Metric | Amount |');
    lines.push('|------|--------|--------|--------|');
    for (const r of otherRows) {
      const date = r.date || 'No date';
      const src = r.source_file_name || 'Unknown';
      const srcCell = r.dropbox_url ? `[${src}](${r.dropbox_url})` : src;
      const metric = r.metric_name || '';
      const val = formatCurrency(r.value);
      lines.push(`| ${date} | ${srcCell} | ${metric} | ${val} |`);
    }
  }

  lines.push('\n*This data comes from verified bid tabulation documents in the system.*');
  return lines.join('\n');
}

function buildComparisonBidResponse(summaries: { projectName: string; summary: BidSummary }[]): string {
  const formatCurrency = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const valid = summaries.filter(s => s.summary.hasBids && s.summary.topBid);

  if (valid.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Verified Bid Comparison\n');

  // Side-by-side summary table
  lines.push('| Project | Most Recent Bid Total | Date | Source |');
  lines.push('|---------|----------------------|------|--------|');
  for (const { projectName, summary } of valid) {
    const top = summary.topBid!;
    const src = top.source
      ? (top.dropboxUrl ? `[${top.source}](${top.dropboxUrl})` : top.source)
      : 'N/A';
    lines.push(`| **${projectName}** | ${formatCurrency(top.value)} | ${top.date || 'N/A'} | 📄 ${src} |`);
  }

  // Per-project detail sections
  for (const { projectName, summary } of valid) {
    const others = summary.allBidRows.slice(1, 6);
    if (others.length > 0) {
      lines.push('');
      lines.push(`### ${projectName} — Other Bid Records`);
      lines.push('| Date | Source | Metric | Amount |');
      lines.push('|------|--------|--------|--------|');
      for (const r of others) {
        const date = r.date || 'No date';
        const src = r.source_file_name || 'Unknown';
        const srcCell = r.dropbox_url ? `[${src}](${r.dropbox_url})` : src;
        const metric = r.metric_name || '';
        const val = formatCurrency(r.value);
        lines.push(`| ${date} | ${srcCell} | ${metric} | ${val} |`);
      }
    }
  }

  // Note projects with no bids
  const missing = summaries.filter(s => !s.summary.hasBids);
  if (missing.length > 0) {
    lines.push('');
    lines.push(`> ⚠️ No verified bid data found for: ${missing.map(m => m.projectName).join(', ')}`);
  }

  lines.push('\n*This data comes from verified bid tabulation documents in the system.*');
  return lines.join('\n');
}

// ============================================================
// DEDICATED BID RETRIEVAL — queries project_data directly for
// rows whose source_file_name or source_file_path contain bid
// keywords. This is completely independent of the generic
// aggregate fetch and is NOT subject to its 500-row limit.
// ============================================================
async function retrieveVerifiedBids(projectName: string | null): Promise<BidSummary> {
  if (!projectName) return { hasBids: false, topBid: null, allBidRows: [] };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Query bid rows using BOTH filename and path signals
  // Use OR across multiple bid keyword patterns
  const bidPatterns = ['%bid tab%', '%bid comparison%', '%bid results%', '%bid proposal%', '%recent bids%', '%bid tabulation%'];

  const orFilters = bidPatterns.flatMap(p => [
    `source_file_name.ilike.${p}`,
    `source_file_path.ilike.${p}`,
  ]).join(',');

  const { data, error } = await supabase
    .from('project_data')
    .select('project_name, category, metric_name, value, unit, date, source_file_name, source_file_path, confidence')
    .ilike('project_name', `%${projectName}%`)
    .or(orFilters)
    .order('date', { ascending: false })
    .limit(100);

  if (error) {
    console.error('retrieveVerifiedBids query error:', error.message);
    return { hasBids: false, topBid: null, allBidRows: [] };
  }

  console.log(`retrieveVerifiedBids: raw rows returned=${data?.length ?? 0} for project="${projectName}"`);

  if (!data || data.length === 0) {
    // Fallback: strip unit/phase/section suffixes and retry
    const strippedName = projectName.replace(/\s+(unit|phase|section)\s+\d+.*/i, '');
    if (strippedName !== projectName) {
      console.log(`retrieveVerifiedBids: retrying with stripped name="${strippedName}"`);
      return retrieveVerifiedBids(strippedName);
    }
    return { hasBids: false, topBid: null, allBidRows: [] };
  }

  const now = new Date();
  const rows = data.map(r => {
    const priority = getSourcePriority(r.source_file_path);
    let effectiveDate: string | null = r.date;
    if (!r.date) {
      const fileDate = extractDateFromFilename(r.source_file_name);
      if (fileDate) effectiveDate = `${fileDate.toISOString().split('T')[0]} (from filename)`;
    }
    return {
      project_name: r.project_name,
      category: r.category,
      metric_name: r.metric_name,
      value: r.value,
      unit: r.unit,
      date: effectiveDate,
      source_file_name: r.source_file_name,
      source_file_path: r.source_file_path,
      dropbox_url: buildDropboxUrl(r.source_file_path),
      source_priority: priority.label,
      _rank: priority.rank,
    };
  });

  // Filter out small line-item values that aren't real bid totals
  const MIN_BID_VALUE = 100000;
  const topCandidates = rows.filter(r => r.value >= MIN_BID_VALUE);

  // Prioritize significant top-line metrics
  const significantMetrics = ['total_cost', 'bid_amount', 'estimated_cost', 'contract_amount', 'base_bid'];
  const significantRows = (topCandidates.length > 0 ? topCandidates : rows).filter(r =>
    significantMetrics.some(m => (r.metric_name || '').toLowerCase().includes(m.replace('_', ' ')) || (r.metric_name || '').toLowerCase().includes(m))
  );

  // Sort by source priority first, then date descending
  const sortedRows = (significantRows.length > 0 ? significantRows : (topCandidates.length > 0 ? topCandidates : rows)).sort((a, b) => {
    if (a._rank !== b._rank) return a._rank - b._rank;
    const dateA = a.date ? new Date(String(a.date).replace(' (from filename)', '')).getTime() : 0;
    const dateB = b.date ? new Date(String(b.date).replace(' (from filename)', '')).getTime() : 0;
    return dateB - dateA;
  });

  const topBid = sortedRows[0];
  console.log(`retrieveVerifiedBids: significant_rows=${significantRows.length}, top_bid_value=${topBid.value}, top_bid_source=${topBid.source_file_name}, top_bid_date=${topBid.date}`);

  return {
    hasBids: true,
    topBid: {
      value: topBid.value,
      metric: topBid.metric_name,
      date: topBid.date,
      source: topBid.source_file_name,
      dropboxUrl: topBid.dropbox_url,
    },
    allBidRows: sortedRows.map(({ _rank, source_file_path, ...rest }) => rest),
  };
}

async function retrieveAggregate(
  projectName: string | null,
  message: string,
  userId: string,
  threadId: string
): Promise<{ context: string; bidSummary: BidSummary }> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('project_data').select('project_name, category, metric_name, value, unit, date, source_file_name, source_file_path, confidence');
  if (projectName) {
    query = query.or(`project_name.ilike.%${projectName}%,source_file_name.ilike.%${projectName}%`);
  }
  const { data, error } = await query.order('date', { ascending: false }).limit(500);
  if (error) throw new Error(`project_data query failed: ${error.message}`);

  if (!data || data.length === 0) {
    console.log('retrieveAggregate: no structured data found, falling back to document search');
    const docContext = await retrieveDocuments(message, projectName, userId, threadId);
    return { context: docContext, bidSummary: { hasBids: false, topBid: null, allBidRows: [] } };
  }

  const now = new Date();

  const rows = (data || []).map(r => {
    const priority = getSourcePriority(r.source_file_path);

    let data_currency_flag: string | null = null;
    let effectiveDate: string | null = r.date;
    if (!r.date) {
      const fileDate = extractDateFromFilename(r.source_file_name);
      if (fileDate) {
        const ageMs = now.getTime() - fileDate.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const dateStr = fileDate.toISOString().split('T')[0];
        effectiveDate = `${dateStr} (from filename)`;
        if (ageDays > 730) {
          data_currency_flag = '⚠️ Data is over 2 years old — recommend getting fresh bids';
        } else if (ageDays > 365) {
          data_currency_flag = '⚠️ Data is 1-2 years old';
        }
      } else {
        data_currency_flag = '⚠️ No date available — cannot assess data currency';
      }
    } else {
      const ageMs = now.getTime() - new Date(r.date).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > 730) {
        data_currency_flag = '⚠️ Data is over 2 years old — recommend getting fresh bids';
      } else if (ageDays > 365) {
        data_currency_flag = '⚠️ Data is 1-2 years old';
      }
    }

    return {
      project_name: r.project_name,
      category: r.category,
      metric_name: r.metric_name,
      value: r.value,
      unit: r.unit,
      date: effectiveDate,
      source_file_name: r.source_file_name,
      dropbox_url: buildDropboxUrl(r.source_file_path),
      source_priority: priority.label,
      data_currency_flag,
      _rank: priority.rank,
    };
  });

  rows.sort((a, b) => a._rank - b._rank);

  const strip = (r: typeof rows) => r.map(({ _rank, ...rest }) => rest);
  const context = `=== COST DATA ===\n${JSON.stringify(strip(rows.slice(0, 80)))}`;

  // bidSummary is no longer computed here — it comes from retrieveVerifiedBids()
  return { context, bidSummary: { hasBids: false, topBid: null, allBidRows: [] } };
}


async function retrieveStatus(projectName: string | null, message: string): Promise<string> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let query = supabase.from('permits_tracking').select('*');
  if (projectName) {
    query = query.ilike('project_name', `%${projectName}%`);
  }

  const lowerMsg = message.toLowerCase();
  const wantsExpired = /\b(show expired|expired permits|historical|all permits|full history|past permits|every permit)\b/.test(lowerMsg);
  const now = new Date();

  if (!wantsExpired) {
    const today = now.toISOString().split('T')[0];
    query = query.gte('expiration_date', today);
  }

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  let countQuery = supabase.from('permits_tracking').select('*', { count: 'exact', head: true })
    .gte('expiration_date', ninetyDaysAgo);
  if (projectName) countQuery = countQuery.ilike('project_name', `%${projectName}%`);

  const [{ data, error }, { count: totalCount }] = await Promise.all([
    query.order('expiration_date', { ascending: true }).limit(200),
    countQuery,
  ]);

  if (error) throw new Error(`permits_tracking query failed: ${error.message}`);

  const sections: Record<string, any[]> = {
    '🚨 CRITICAL — expiring within 30 days': [],
    '⚠️ WARNING — expiring 31-90 days': [],
    '📋 UPCOMING — expiring 91 days to 1 year': [],
    '✅ OK — expiring beyond 1 year': [],
  };
  const expiredSection: any[] = [];

  for (const r of data || []) {
    const permit = {
      project_name: r.project_name,
      permit_type: r.permit_type,
      permit_no: r.permit_no,
      status: r.status,
      description: r.description,
      issued_date: r.issued_date,
      expiration_date: r.expiration_date,
      source_file_name: r.source_file_name,
      dropbox_url: buildDropboxUrl(r.source_file_path),
    };

    if (!r.expiration_date) {
      sections['📋 UPCOMING — expiring 91 days to 1 year'].push({ ...permit, days_until_expiry: null, urgency: 'UNKNOWN' });
      continue;
    }

    const exp = new Date(r.expiration_date);
    const days = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (days < 0) {
      expiredSection.push({ ...permit, days_until_expiry: days, urgency: 'EXPIRED' });
    } else if (days <= 30) {
      sections['🚨 CRITICAL — expiring within 30 days'].push({ ...permit, days_until_expiry: days, urgency: 'CRITICAL' });
    } else if (days <= 90) {
      sections['⚠️ WARNING — expiring 31-90 days'].push({ ...permit, days_until_expiry: days, urgency: 'WARNING' });
    } else if (days <= 365) {
      sections['📋 UPCOMING — expiring 91 days to 1 year'].push({ ...permit, days_until_expiry: days, urgency: 'UPCOMING' });
    } else {
      sections['✅ OK — expiring beyond 1 year'].push({ ...permit, days_until_expiry: days, urgency: 'OK' });
    }
  }

  // Build grouped output, only include non-empty sections
  const grouped: Record<string, any[]> = {};
  for (const [label, permits] of Object.entries(sections)) {
    if (permits.length > 0) grouped[label] = permits;
  }
  if (wantsExpired && expiredSection.length > 0) {
    grouped['❌ EXPIRED'] = expiredSection;
  }

  const shownCount = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);

  return JSON.stringify({
    total_permits_in_system: totalCount ?? '?',
    showing: shownCount,
    ...grouped,
    _note: wantsExpired
      ? `Showing all ${shownCount} permits including expired. ${totalCount ?? '?'} total in system.`
      : `Showing ${shownCount} active/future permits. Expired permits are hidden — ask for "show expired" or "historical permits" to include them. ${totalCount ?? '?'} total in system.`,
  });
}

async function callSearchRanked(
  query: string,
  filterProject: string | null,
  matchCount: number,
  userId: string,
  threadId: string
): Promise<any[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const webhookSecret = Deno.env.get('N8N_WEBHOOK_SECRET');
  if (!supabaseUrl || !webhookSecret) {
    throw new Error('SUPABASE_URL or N8N_WEBHOOK_SECRET not configured');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/search-ranked-documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${webhookSecret}`,
    },
    body: JSON.stringify({
      query,
      query_type: 'general',
      match_count: matchCount,
      content_max_length: 1000,
      match_threshold: 0.15,
      filter_project: filterProject,
      user_id: userId,
      thread_id: threadId,
      include_archive: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`search-ranked-documents error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.documents || [];
}

function formatDocs(docs: any[]): string {
  if (docs.length === 0) return 'No relevant documents found.';
  return docs
    .map((d: any, i: number) => {
      const dbxUrl = buildDropboxUrl(d.file_path);
      const linkPart = dbxUrl ? ` | [View in Dropbox](${dbxUrl})` : '';
      return `[Source ${i + 1}] ${d.file_name || 'Unknown'} (${d.source_type || 'document'}, ${d.document_date || 'no date'})${linkPart}\n${d.content || ''}`;
    })
    .join('\n\n');
}

async function retrieveDocuments(
  message: string,
  projectName: string | null,
  userId: string,
  threadId: string
): Promise<string> {
  // No project name — single unfiltered call
  if (!projectName) {
    const docs = await callSearchRanked(message, null, 12, userId, threadId);
    return formatDocs(docs);
  }

  // First attempt: filter by classified project name
  console.log(`retrieveDocuments: first attempt with filter_project="${projectName}"`);
  const firstDocs = await callSearchRanked(message, projectName, 12, userId, threadId);
  console.log(`retrieveDocuments: first attempt returned ${firstDocs.length} docs`);

  if (firstDocs.length >= 3) {
    return formatDocs(firstDocs);
  }

  // Fallback: unfiltered search with project name prepended to query
  console.log(`retrieveDocuments: fallback — unfiltered search with project name in query`);
  const augmentedQuery = `${projectName}: ${message}`;
  const fallbackDocs = await callSearchRanked(augmentedQuery, null, 20, userId, threadId);
  console.log(`retrieveDocuments: fallback returned ${fallbackDocs.length} docs`);

  // Merge & deduplicate by id, keeping higher-similarity hit
  const docMap = new Map<string, any>();
  for (const doc of [...firstDocs, ...fallbackDocs]) {
    const id = doc.id || doc.file_name;
    const existing = docMap.get(id);
    if (!existing || (doc.similarity ?? 0) > (existing.similarity ?? 0)) {
      docMap.set(id, doc);
    }
  }

  const merged = Array.from(docMap.values())
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 15);

  return formatDocs(merged);
}

async function synthesizeAnswer(
  message: string,
  chatHistory: string,
  context: string,
  contextType: string,
  systemAddendum: string = ''
): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const trimmedHistory = chatHistory ? chatHistory.slice(-3000) : '';

  let userContent = '';
  if (trimmedHistory) {
    userContent += `## Recent Chat History\n${trimmedHistory}\n\n`;
  }
  userContent += `## User Question\n${message}\n\n`;
  userContent += `## ${contextType}\n${context}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: TERRACHAT_SYSTEM_PROMPT + systemAddendum,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function fetchSystemKnowledge(
  supabaseClient: ReturnType<typeof createClient>,
  message: string,
  projectName: string | null
): Promise<string> {
  try {
    const { data, error } = await supabaseClient
      .from('system_knowledge')
      .select('title, content, tier, keywords')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) return '';

    const lowerMessage = message.toLowerCase();
    const lowerProject = projectName?.toLowerCase() || '';

    const filtered = data.filter((entry: any) => {
      if (entry.tier === 'reference') return false;
      if (entry.tier === 'always') return true;
      if (entry.tier === 'contextual') {
        const keywords: string[] = entry.keywords || [];
        return keywords.some((kw: string) => {
          const lkw = kw.toLowerCase();
          return lowerMessage.includes(lkw) || (lowerProject && lowerProject.includes(lkw));
        });
      }
      return false;
    });

    if (filtered.length === 0) return '';

    let result = '\n\n## SHARED TEAM KNOWLEDGE\n' +
      filtered.map((e: any) => `### ${e.title}\n${e.content}`).join('\n\n');

    if (result.length > 800) {
      result = result.slice(0, 800) + '\n[...additional knowledge truncated]';
    }

    return result;
  } catch (_e) {
    return '';
  }
}

// ── URL detection helpers ──
function extractPublicUrls(message: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = message.match(urlRegex) || [];
  return matches.filter((url) => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      // Reject private/local addresses
      if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
      if (/^127\./.test(hostname)) return false;
      if (/^10\./.test(hostname)) return false;
      if (/^192\.168\./.test(hostname)) return false;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
      if (/^169\.254\./.test(hostname)) return false;
      if (hostname === '[::1]') return false;
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return true;
    } catch {
      return false;
    }
  });
}

async function summarizeUrlWithPerplexity(opts: {
  url: string;
  userMessage: string;
  chatHistory: string;
}): Promise<{ text: string; citations: string[] }> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  if (!PERPLEXITY_API_KEY) {
    throw new Error('PERPLEXITY_API_KEY is not configured');
  }

  const hasFollowUpQuestion = opts.userMessage.trim() && !opts.userMessage.trim().startsWith('http');

  const systemPrompt = `You are a research analyst. The user has shared a URL. Your job is to:
1. Fetch and analyze the content at the provided URL
2. Search the web for additional relevant context about the topic
3. ${hasFollowUpQuestion ? 'Answer the user\'s specific question about the page content directly and precisely.' : 'Return a well-structured, grounded summary'}

Format your response EXACTLY as:

## Summary
[Concise overview of the URL content and what it covers]

## Key Findings
- [Most important finding 1]
- [Most important finding 2]
- [Continue as needed]

## Notes & Risks
- [Any caveats, biases, outdated info, or risks worth noting]

## Sources
- List the original URL and any additional sources you referenced

Be factual and cite specific details. If the URL is inaccessible, say so clearly and provide what you can find about the topic from other sources.`;

  const userPrompt = hasFollowUpQuestion
    ? `Analyze this URL: ${opts.url}\n\nUser's question about this page: ${opts.userMessage.trim()}`
    : `Please analyze this URL: ${opts.url}`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Perplexity API error:', response.status, errText);
    throw new Error(`Perplexity API error [${response.status}]: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || 'Unable to analyze the URL.';
  const citations: string[] = data.citations || [];

  // Append citations if not already in the content
  let finalText = content;
  if (citations.length > 0 && !content.includes('## Sources')) {
    finalText += '\n\n## Sources\n' + citations.map((c: string, i: number) => `- [Source ${i + 1}](${c})`).join('\n');
  }

  return { text: finalText, citations };
}

// ── "Remember This" command detection ──
function detectRememberCommand(msg: string): { isRemember: boolean; content: string } {
  const match = msg.match(/^(?:remember this:|remember that:|save this:|save this knowledge:)\s*(.+)/is);
  if (match && match[1].trim().length > 0) {
    return { isRemember: true, content: match[1].trim() };
  }
  return { isRemember: false, content: '' };
}

function extractTitle(content: string): string {
  const max = 60;
  if (content.length <= max) return content;
  const trimmed = content.slice(0, max);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 20 ? trimmed.slice(0, lastSpace) : trimmed) + '…';
}

// ── "Save this link" command detection ──
function detectSaveLinkCommand(msg: string): boolean {
  return /^(?:save this link|save that link|save this url|bookmark this)/i.test(msg.trim());
}

// ── Search saved web links ──
async function searchSavedLinks(
  supabaseAdmin: any,
  searchKeywords: string | null,
  projectName: string | null
): Promise<string> {
  let q = supabaseAdmin
    .from('saved_web_links')
    .select('name, url, project_name, categories, notes, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(20);

  // Apply filters: prefer search_keywords from classifier, fall back to project_name
  if (projectName) {
    q = q.ilike('project_name', `%${projectName}%`);
  }

  const { data: allData, error } = await q;
  if (error) {
    console.error('searchSavedLinks error:', error);
    return 'I encountered an error searching the saved links.';
  }

  // Client-side keyword filtering for better multi-keyword matching
  let filtered = allData || [];
  if (searchKeywords && !projectName) {
    const keywords = searchKeywords.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    if (keywords.length > 0) {
      filtered = filtered.filter((link: any) => {
        const haystack = `${link.name} ${link.project_name || ''} ${link.url} ${(link.categories || []).join(' ')} ${link.notes || ''}`.toLowerCase();
        return keywords.some(kw => haystack.includes(kw));
      });
    }
  }

  if (filtered.length === 0) {
    return 'No saved web links found matching your query. You can add links from the **Web Links** page or by using the "Save this link" button after a URL research.';
  }

  let md = `## Saved Web Links\n\nFound **${filtered.length}** link(s):\n\n`;
  for (const link of filtered) {
    md += `### [${link.name}](${link.url})\n`;
    if (link.project_name) md += `**Project:** ${link.project_name}\n`;
    if (link.categories?.length) md += `**Categories:** ${link.categories.join(', ')}\n`;
    if (link.notes) md += `${link.notes}\n`;
    md += `*Added ${new Date(link.created_at).toLocaleDateString()}*\n\n`;
  }
  return md;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { threadId, userId, message, chatHistory, job_id, callback_url, uploaded_document } = body;

    console.log('chat-rag received:', JSON.stringify({ threadId, userId, message, job_id, callback_url }));

    // ── Early intercept: "Remember This" command ──
    const { isRemember, content: rememberContent } = detectRememberCommand(message);
    if (isRemember) {
      console.log('REMEMBER command detected, saving to system_knowledge');
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const title = extractTitle(rememberContent);
      const tier = 'always';
      const keywords: string[] = [];

      const { error: insertErr } = await supabaseAdmin.from('system_knowledge').insert({
        title,
        content: rememberContent,
        tier,
        keywords,
        is_active: true,
        created_by: userId || null,
      });

      const confirmationMsg = insertErr
        ? `I tried to save that knowledge but hit an error: ${insertErr.message}`
        : `✅ Got it — I've saved that knowledge and will use it in future conversations.\n\n**Title:** ${title}\n**Tier:** ${tier}`;

      if (callback_url && job_id) {
        await fetch(callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id, response: confirmationMsg }),
        });
      }

      return new Response(
        JSON.stringify({ success: true, response: confirmationMsg }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Early intercept: URL Research ──
    const detectedUrls = extractPublicUrls(message);
    if (detectedUrls.length > 0) {
      const targetUrl = detectedUrls[0];
      console.log('URL_RESEARCH mode triggered for:', targetUrl);

      try {
        const research = await summarizeUrlWithPerplexity({
          url: targetUrl,
          userMessage: message,
          chatHistory: chatHistory || '',
        });

        const responseText = research.text;

        if (callback_url && job_id) {
          await fetch(callback_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              job_id,
              response: responseText,
            }),
          });
        }

        // Log for analytics
        const supabaseAdmin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabaseAdmin.from('retrieval_logs').insert({
          thread_id: threadId || null,
          user_id: userId || null,
          question: message,
          query_type: 'URL_RESEARCH',
          top_sources: research.citations.map((c: string) => ({ url: c })),
        }).then(({ error }) => {
          if (error) console.error('Failed to log URL_RESEARCH:', error);
        });

        return new Response(
          JSON.stringify({ success: true, query_type: 'URL_RESEARCH' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (urlErr) {
        console.error('URL_RESEARCH failed, falling through to normal pipeline:', urlErr);
        // Fall through to normal classification if Perplexity fails
      }
    }

    // ── Early intercept: "Save this link" command ──
    if (detectSaveLinkCommand(message)) {
      console.log('SAVE_LINK command detected');
      // Extract the most recent URL from chat history
      const historyUrls = extractPublicUrls(chatHistory || '');
      const lastUrl = historyUrls.length > 0 ? historyUrls[historyUrls.length - 1] : null;

      const responseText = lastUrl
        ? `I found the most recently discussed URL:\n\n**${lastUrl}**\n\nPlease use the **"Save this link"** button below the URL research response, or visit the **Web Links** page to save it with a name, project, and categories.`
        : `I couldn't find a recently researched URL in this conversation. Please paste a URL first, then ask me to save it. You can also save links directly from the **Web Links** page.`;

      if (callback_url && job_id) {
        await fetch(callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id, response: responseText }),
        });
      }

      return new Response(
        JSON.stringify({ success: true, query_type: 'SAVE_LINK_COMMAND' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch user profile and classify in parallel
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [profileResult, classification, systemKnowledge] = await Promise.all([
      supabase
        .from('user_profiles_extended')
        .select('display_name, role_title, preferred_projects')
        .eq('user_id', userId)
        .maybeSingle(),
      classifyQuery(message, chatHistory || ''),
      fetchSystemKnowledge(supabase, message, null),
    ]);

    console.log('classification:', JSON.stringify(classification));

    const profile = profileResult.data;
    if (profile) {
      const profileLines: string[] = [];
      if (profile.display_name) profileLines.push(`User: ${profile.display_name}`);
      if (profile.role_title) profileLines.push(`Role: ${profile.role_title}`);
      if (profile.preferred_projects?.length) {
        profileLines.push(`Preferred projects: ${profile.preferred_projects.join(', ')}`);
      }
      // No mutation needed — synthesizeAnswer already uses TERRACHAT_SYSTEM_PROMPT;
      // we'll pass profile context as part of the chat history prefix instead.
      if (profileLines.length > 0) {
        const profileContext = `[User Profile]\n${profileLines.join('\n')}\n\n`;
        // Prepend to chatHistory so synthesizeAnswer includes it
        body.chatHistory = profileContext + (chatHistory || '');
      }
    }

    let systemAddendum = '';
    if (profile?.preferred_projects?.length) {
      systemAddendum = `\n\nThis user works primarily with these projects: ${profile.preferred_projects.join(', ')}. When answering general questions that don't mention a specific project, prioritize data from these projects first.`;
    }

    // Append shared team knowledge (already fetched in parallel with message-based matching)
    // Re-fetch with project_name now that classification is complete
    const { query_type, project_name, project_names, clarify_question, url: classifiedUrl, search_keywords } = classification;
    let knowledgeText = systemKnowledge;
    if (project_name && !knowledgeText) {
      knowledgeText = await fetchSystemKnowledge(supabase, message, project_name);
    }
    if (knowledgeText) {
      systemAddendum += knowledgeText;
      console.log(`systemKnowledge injected: length=${knowledgeText.length}`);
    }
    const hasUploadedDocument = typeof uploaded_document === 'string' && uploaded_document.trim().length > 0;

    // CLARIFY — return the clarify question directly, no retrieval
    // But if system knowledge was injected, fall through to LLM synthesis
    if (query_type === 'CLARIFY' && !hasUploadedDocument && !knowledgeText) {
      const response = clarify_question || 'Could you please provide more details about your question?';

      if (callback_url && job_id) {
        await fetch(callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id, response }),
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // URL_RESEARCH via classifier (handles URLs from chat history that pre-classifier missed)
    if (query_type === 'URL_RESEARCH' && classifiedUrl) {
      console.log('URL_RESEARCH (classifier) triggered for:', classifiedUrl);
      try {
        const research = await summarizeUrlWithPerplexity({
          url: classifiedUrl,
          userMessage: message,
          chatHistory: chatHistory || '',
        });

        const responseText = research.text;

        if (callback_url && job_id) {
          await fetch(callback_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id, response: responseText }),
          });
        }

        await supabase.from('retrieval_logs').insert({
          thread_id: threadId || null,
          user_id: userId || null,
          question: message,
          query_type: 'URL_RESEARCH',
          top_sources: research.citations.map((c: string) => ({ url: c })),
        });

        return new Response(
          JSON.stringify({ success: true, query_type: 'URL_RESEARCH' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (urlErr) {
        console.error('URL_RESEARCH (classifier) failed, falling through:', urlErr);
      }
    }

    // SAVED_LINK_SEARCH — query saved_web_links using classifier-extracted keywords
    if (query_type === 'SAVED_LINK_SEARCH') {
      console.log('SAVED_LINK_SEARCH query detected, search_keywords:', search_keywords);
      const response = await searchSavedLinks(supabase, search_keywords || null, project_name);

      if (callback_url && job_id) {
        await fetch(callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id, response }),
        });
      }

      await supabase.from('retrieval_logs').insert({
        thread_id: threadId || null,
        user_id: userId || null,
        question: message,
        query_type: 'SAVED_LINK_SEARCH',
        normalized_project: project_name || null,
      });

      return new Response(
        JSON.stringify({ success: true, query_type: 'SAVED_LINK_SEARCH' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Retrieve context based on query type
    let context = '';
    let contextType = 'Retrieved Documents';
    let bidSummary: BidSummary = { hasBids: false, topBid: null, allBidRows: [] };
    let multiProjectBidSummaries: { projectName: string; summary: BidSummary }[] = [];

    // For AGGREGATE, HYBRID, or DOCUMENT_SEARCH queries, run dedicated bid retrieval
    const bidQuestion = isBidRelatedQuestion(message);
    const needsBidCheck = bidQuestion && (query_type === 'AGGREGATE' || query_type === 'HYBRID' || query_type === 'DOCUMENT_SEARCH') && !hasUploadedDocument;

    // Determine if this is a multi-project bid comparison
    const isMultiProjectBid = needsBidCheck && project_names && project_names.length > 1;

    if (isMultiProjectBid) {
      // Parallel bid retrieval for all projects
      console.log(`multi-project bid retrieval: projects=${JSON.stringify(project_names)}`);
      const results = await Promise.all(
        project_names.map(async (pn) => ({
          projectName: pn,
          summary: await retrieveVerifiedBids(pn),
        }))
      );
      multiProjectBidSummaries = results;
      // Set bidSummary to the first project's result for fallback compatibility
      bidSummary = results[0]?.summary || { hasBids: false, topBid: null, allBidRows: [] };
      console.log(`multi-project bid results: ${results.map(r => `${r.projectName}=${r.summary.hasBids}(${r.summary.allBidRows.length} rows)`).join(', ')}`);
    } else if (needsBidCheck) {
      // Single project bid retrieval
      bidSummary = await retrieveVerifiedBids(project_name);
      console.log(`dedicated bid retrieval: hasBids=${bidSummary.hasBids}, topBid=${bidSummary.topBid?.value ?? 'none'}, rows=${bidSummary.allBidRows.length}`);
    }

    if (hasUploadedDocument) {
      // Cap uploaded document context to 15,000 chars — summaries are ~3-5k so this is generous
      const cappedDoc = uploaded_document.length > 15000
        ? uploaded_document.slice(0, 15000) + '\n\n[... document truncated due to length ...]'
        : uploaded_document;
      console.log(`uploaded_document: original_length=${uploaded_document.length}, capped_length=${cappedDoc.length}`);
      context = `=== USER UPLOADED DOCUMENT ===\n${cappedDoc}\n=== END UPLOADED DOCUMENT ===`;
      contextType = 'User Uploaded Document';
      systemAddendum += '\n\nA USER UPLOADED DOCUMENT is present in the context. These are pre-processed structured summaries of the uploaded documents, containing the key figures, dates, parties, and scope items. Treat them as the primary source for answering the question. Reference them directly in your answer.';
    } else if (query_type === 'AGGREGATE') {
      const result = await retrieveAggregate(project_name, message, userId, threadId);
      context = result.context;
      contextType = 'Structured Cost Data';
    } else if (query_type === 'STATUS_LOOKUP') {
      context = await retrieveStatus(project_name, message);
      contextType = 'Permit Status Data';
      systemAddendum += '\n\nWhen permit records are missing a permit number, flag them with ⚠️ INCOMPLETE RECORD and note that the data may have been extracted incorrectly from the source document. Do not treat incomplete records as fully reliable.';
    } else if (query_type === 'DOCUMENT_SEARCH') {
      context = await retrieveDocuments(message, project_name, userId, threadId);
      contextType = 'Retrieved Documents';
    } else if (query_type === 'HYBRID') {
      const [aggResult, docResult] = await Promise.allSettled([
        retrieveAggregate(project_name, message, userId, threadId),
        retrieveDocuments(message, project_name, userId, threadId),
      ]);

      const parts: string[] = [];
      if (aggResult.status === 'fulfilled') {
        parts.push(`## Structured Cost Data\n${aggResult.value.context}`);
      }
      if (docResult.status === 'fulfilled') parts.push(`## Retrieved Documents\n${docResult.value}`);
      context = parts.join('\n\n');
      contextType = 'Combined Data';
    } else {
      // CLARIFY that fell through due to system knowledge — no retrieval needed
      context = '';
      contextType = 'General Knowledge';
    }

    console.log(`context retrieved (${contextType}), length=${context.length}`);

    // Log total payload size for debugging
    const totalPayloadSize = (body.chatHistory || '').length + context.length + message.length;
    console.log(`total_payload_estimate: chatHistory=${(body.chatHistory || '').length}, context=${context.length}, message=${message.length}, total=${totalPayloadSize}`);

    // ============================================================
    // DETERMINISTIC SHORT-CIRCUIT: If dedicated bid retrieval found
    // verified bids, return a code-built answer. LLM not involved.
    // ============================================================
    console.log(`bid_question=${bidQuestion}, has_verified_bids=${bidSummary.hasBids}, top_bid=${bidSummary.topBid?.value ?? 'none'}`);

    let answer: string;

    if (isMultiProjectBid && multiProjectBidSummaries.some(s => s.summary.hasBids)) {
      console.log(`DETERMINISTIC MULTI-PROJECT BID MODE: Bypassing LLM. projects=${multiProjectBidSummaries.map(s => s.projectName).join(', ')}`);
      answer = buildComparisonBidResponse(multiProjectBidSummaries);
    } else if (bidSummary.hasBids && bidSummary.topBid) {
      console.log(`DETERMINISTIC BID MODE: Bypassing LLM. top_bid=${bidSummary.topBid.value}, source=${bidSummary.topBid.source}`);
      answer = buildDeterministicBidResponse(bidSummary, project_name);
    } else {
      // Normal LLM synthesis path — wrapped in try-catch for resilience
      try {
        answer = await synthesizeAnswer(message, body.chatHistory || '', context, contextType, systemAddendum);
      } catch (synthError) {
        console.error('LLM synthesis failed:', synthError);
        answer = 'I encountered an error while processing your request. This may be due to the size of the documents in this conversation. Please try asking your question in a new chat thread, or with fewer attached documents.';
      }

      // Defensive check: if answer claims no bids but we might have missed them
      const claimsMissing = /(?:don[\u2019']?t have|do not have|no |couldn[\u2019']?t find|not available|unable to (?:find|locate)|without|lack).{0,120}(?:bid data|contractor bids?|bid tabulation|tabulated contractor bids|verified bid|bid information|bid total|bid result|bid comparison)/i.test(answer);

      if (bidQuestion && claimsMissing && !bidSummary.hasBids) {
        // Last resort: try dedicated bid retrieval even if we didn't before
        console.warn('DEFENSIVE: LLM claims no bids. Running late dedicated bid retrieval as fallback.');
        const lateBidSummary = await retrieveVerifiedBids(project_name);
        if (lateBidSummary.hasBids && lateBidSummary.topBid) {
          console.warn(`DEFENSIVE OVERRIDE: Found ${lateBidSummary.allBidRows.length} bid rows via late retrieval. Using deterministic response.`);
          answer = buildDeterministicBidResponse(lateBidSummary, project_name);
        }
      }
    }

    // POST result to callback
    if (callback_url && job_id) {
      await fetch(callback_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id, response: answer }),
      });
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in chat-rag:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});