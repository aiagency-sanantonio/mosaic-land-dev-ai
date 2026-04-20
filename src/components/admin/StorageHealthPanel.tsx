import { useState, useEffect, useCallback } from 'react';
import { HardDrive, RefreshCw, Trash2, AlertTriangle, TrendingUp, FileWarning } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StorageStats {
  total_size_bytes: number;
  total_size_pretty: string;
  table_size_bytes: number;
  index_size_bytes: number;
  chunk_count: number;
  unique_files: number;
  chunks_last_7d: number;
  chunks_last_24h: number;
}

interface BloatedFile {
  file_path: string;
  file_name: string | null;
  chunk_count: number;
  total_content_bytes: number;
}

// Rough Lovable Cloud / Supabase storage cost: ~$0.125/GB/month for paid tiers.
const COST_PER_GB_MONTH = 0.125;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageHealthPanel() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [topFiles, setTopFiles] = useState<BloatedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, filesRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc('get_documents_storage_stats'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc('get_top_bloated_files', { p_limit: 10 }),
      ]);
      if (statsRes.error) throw statsRes.error;
      if (filesRes.error) throw filesRes.error;
      setStats(statsRes.data as StorageStats);
      setTopFiles((filesRes.data as BloatedFile[]) || []);
    } catch (err) {
      console.error('Storage stats load error:', err);
      toast.error('Failed to load storage stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const purgeFile = async (filePath: string, fileName: string | null) => {
    const label = fileName || filePath.split('/').pop() || filePath;
    if (!confirm(`Delete all chunks for "${label}"?\n\nThis frees storage immediately. The file stays in Dropbox and will be marked as skipped so it won't re-index.`)) {
      return;
    }
    setPurging(filePath);
    try {
      const { data, error } = await supabase.functions.invoke('purge-file-chunks', {
        body: { file_path: filePath },
      });
      if (error) throw error;
      toast.success(`Purged ${data?.chunks_deleted ?? 0} chunks from "${label}"`);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Purge failed: ${msg}`);
    } finally {
      setPurging(null);
    }
  };

  const totalGB = stats ? stats.total_size_bytes / (1024 * 1024 * 1024) : 0;
  const monthlyCost = totalGB * COST_PER_GB_MONTH;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-primary" />
          <CardTitle>Storage Health</CardTitle>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!stats && loading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {stats && (
          <>
            {/* Top-line stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Documents Table" value={stats.total_size_pretty} sub={`~$${monthlyCost.toFixed(2)}/mo`} />
              <StatTile label="Total Chunks" value={stats.chunk_count.toLocaleString()} sub={`${stats.unique_files.toLocaleString()} files`} />
              <StatTile label="Last 24h" value={`+${stats.chunks_last_24h.toLocaleString()}`} sub="new chunks" />
              <StatTile label="Last 7 days" value={`+${stats.chunks_last_7d.toLocaleString()}`} sub="new chunks" icon={<TrendingUp className="h-3 w-3" />} />
            </div>

            {/* Cost warning */}
            {totalGB > 5 && (
              <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Documents table is {stats.total_size_pretty}
                  </p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                    This drives most of your Cloud storage cost. Consider purging bloated files below.
                  </p>
                </div>
              </div>
            )}

            {/* Bloated files */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileWarning className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">Top 10 files by chunk count</h4>
              </div>
              <ScrollArea className="h-[280px] rounded-md border">
                <div className="divide-y">
                  {topFiles.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">No files found.</p>
                  )}
                  {topFiles.map((f) => (
                    <div key={f.file_path} className="flex items-center gap-2 p-2.5 hover:bg-muted/40">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" title={f.file_name || f.file_path}>
                          {f.file_name || f.file_path.split('/').pop()}
                        </p>
                        <p className="text-xs text-muted-foreground truncate" title={f.file_path}>
                          {f.file_path}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {f.chunk_count.toLocaleString()} chunks
                      </Badge>
                      <Badge variant="outline" className="shrink-0 hidden sm:inline-flex">
                        {formatBytes(f.total_content_bytes)}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => purgeFile(f.file_path, f.file_name)}
                        disabled={purging === f.file_path}
                        title="Purge this file's chunks"
                      >
                        <Trash2 className={`h-4 w-4 ${purging === f.file_path ? 'animate-pulse' : ''}`} />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatTile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          {icon}{sub}
        </p>
      )}
    </div>
  );
}
