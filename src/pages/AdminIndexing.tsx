import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, RefreshCw, CheckCircle2, XCircle, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ActivityEntry {
  file: string;
  status: string;
  timestamp: string;
}

interface IndexingStats {
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  remaining: number;
  batchesCompleted: number;
}

export default function AdminIndexing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<IndexingStats>({
    totalProcessed: 0, totalSkipped: 0, totalFailed: 0, remaining: 0, batchesCompleted: 0,
  });
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  const runBatchLoop = useCallback(async () => {
    setIsRunning(true);
    stopRef.current = false;
    setLastError(null);

    let cumulative = { ...stats };

    while (!stopRef.current) {
      try {
        const { data, error } = await supabase.functions.invoke('batch-index');

        if (error) {
          // Check for token-related errors
          const errMsg = error.message || 'Unknown error';
          if (errMsg.includes('401') || errMsg.includes('expired') || errMsg.includes('invalid_access_token')) {
            setLastError('Dropbox token expired. Update the token in backend secrets and click Resume.');
            toast.error('Dropbox token expired — update it and resume.');
            break;
          }
          throw error;
        }

        if (!data) throw new Error('No data returned');

        cumulative = {
          totalProcessed: cumulative.totalProcessed + (data.processed || 0),
          totalSkipped: cumulative.totalSkipped + (data.skipped || 0),
          totalFailed: cumulative.totalFailed + (data.failed || 0),
          remaining: data.remaining ?? 0,
          batchesCompleted: cumulative.batchesCompleted + 1,
        };
        setStats({ ...cumulative });

        // Add activity entries
        if (data.activity?.length) {
          const newEntries: ActivityEntry[] = data.activity.map((a: { file: string; status: string }) => ({
            file: a.file,
            status: a.status,
            timestamp: new Date().toLocaleTimeString(),
          }));
          setActivity(prev => [...newEntries, ...prev].slice(0, 200));
        }

        // Show errors from this batch
        if (data.errors?.length) {
          for (const e of data.errors) {
            console.warn(`Failed: ${e.file} — ${e.error}`);
          }
        }

        // Done!
        if (data.remaining === 0 || (data.processed === 0 && data.skipped === 0 && data.failed === 0)) {
          toast.success('Indexing complete!');
          break;
        }

        // Small delay between batches
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Batch error:', msg);
        setLastError(msg);
        toast.error(`Indexing error: ${msg}`);
        break;
      }
    }

    setIsRunning(false);
  }, [stats]);

  const handleStop = () => {
    stopRef.current = true;
  };

  const totalDone = stats.totalProcessed + stats.totalSkipped + stats.totalFailed;
  const totalFiles = totalDone + stats.remaining;
  const progressPercent = totalFiles > 0 ? (totalDone / totalFiles) * 100 : 0;

  if (loading) return null;

  return (
    <div className="min-h-screen bg-background p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bulk Indexing</h1>
          <p className="text-sm text-muted-foreground">Process Dropbox files into searchable documents</p>
        </div>
      </div>

      {/* Controls */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            {!isRunning ? (
              <Button onClick={runBatchLoop} className="gap-2">
                <Play className="h-4 w-4" />
                {stats.batchesCompleted > 0 ? 'Resume Indexing' : 'Start Indexing'}
              </Button>
            ) : (
              <Button onClick={handleStop} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />
                Stop
              </Button>
            )}
            {isRunning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Processing batch {stats.batchesCompleted + 1}...
              </div>
            )}
          </div>
          {lastError && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {lastError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={progressPercent} className="mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{stats.totalProcessed}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Processed
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-muted-foreground">{stats.totalSkipped}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <SkipForward className="h-3 w-3" /> Skipped
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-destructive">{stats.totalFailed}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <XCircle className="h-3 w-3" /> Failed
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{stats.remaining.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Remaining</div>
            </div>
          </div>
          {totalFiles > 0 && (
            <p className="text-xs text-muted-foreground text-center mt-4">
              {Math.round(progressPercent)}% complete — {stats.batchesCompleted} batches done
            </p>
          )}
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Activity Log</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No activity yet. Click Start Indexing to begin.
              </p>
            ) : (
              <div className="space-y-1">
                {activity.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50">
                    <Badge
                      variant={entry.status === 'success' ? 'default' : entry.status === 'skipped' ? 'secondary' : 'destructive'}
                      className="text-xs w-16 justify-center"
                    >
                      {entry.status}
                    </Badge>
                    <span className="text-muted-foreground text-xs">{entry.timestamp}</span>
                    <span className="truncate flex-1">{entry.file}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
