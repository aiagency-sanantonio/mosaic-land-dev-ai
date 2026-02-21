import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, RefreshCw, CheckCircle2, XCircle, SkipForward, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface IndexingStats {
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  remaining: number;
  batchesCompleted: number;
}

interface IndexingJob {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  stats: IndexingStats;
  last_error: string | null;
}

interface ActivityEntry {
  file: string;
  status: string;
  timestamp: string;
}

export default function AdminIndexing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [job, setJob] = useState<IndexingJob | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loadingJob, setLoadingJob] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  // Fetch the latest job
  const fetchLatestJob = useCallback(async () => {
    const { data, error } = await supabase
      .from('indexing_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching job:', error);
      return;
    }

    if (data && data.length > 0) {
      const raw = data[0];
      setJob({
        id: raw.id,
        status: raw.status,
        started_at: raw.started_at,
        completed_at: raw.completed_at,
        stats: raw.stats as unknown as IndexingStats,
        last_error: raw.last_error,
      });
    } else {
      setJob(null);
    }
    setLoadingJob(false);
  }, []);

  // Fetch recent activity from indexing_status
  const fetchActivity = useCallback(async () => {
    const { data, error } = await supabase
      .from('indexing_status')
      .select('file_name, file_path, status, indexed_at')
      .order('indexed_at', { ascending: false })
      .limit(50);

    if (error) return;
    if (data) {
      setActivity(data.map(r => ({
        file: r.file_name || r.file_path,
        status: r.status === 'success' ? 'success' : r.status === 'skipped' ? 'skipped' : 'failed',
        timestamp: r.indexed_at ? new Date(r.indexed_at).toLocaleTimeString() : '',
      })));
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (user) {
      fetchLatestJob();
      fetchActivity();
    }
  }, [user, fetchLatestJob, fetchActivity]);

  // Poll while running
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const interval = setInterval(() => {
      fetchLatestJob();
      fetchActivity();
    }, 5000);
    return () => clearInterval(interval);
  }, [job?.status, fetchLatestJob, fetchActivity]);

  const handleStart = async () => {
    const { error } = await supabase.from('indexing_jobs').insert({
      status: 'running',
    });
    if (error) {
      toast.error('Failed to start indexing job');
      console.error(error);
      return;
    }
    toast.success('Indexing job started — it will continue in the background');
    fetchLatestJob();
  };

  const handleStop = async () => {
    if (!job) return;
    const { error } = await supabase
      .from('indexing_jobs')
      .update({ status: 'stopped', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    if (error) {
      toast.error('Failed to stop indexing job');
      return;
    }
    toast.info('Indexing stopped');
    fetchLatestJob();
  };

  const stats = job?.stats || { totalProcessed: 0, totalSkipped: 0, totalFailed: 0, remaining: 0, batchesCompleted: 0 };
  const totalDone = stats.totalProcessed + stats.totalSkipped + stats.totalFailed;
  const totalFiles = totalDone + stats.remaining;
  const progressPercent = totalFiles > 0 ? (totalDone / totalFiles) * 100 : 0;

  const isRunning = job?.status === 'running';
  const isCompleted = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
  const isStopped = job?.status === 'stopped';

  if (loading || loadingJob) return null;

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

      {/* Status Banner */}
      {job && !isRunning && (
        <Card className={`mb-6 border-l-4 ${isCompleted ? 'border-l-primary' : isFailed ? 'border-l-destructive' : 'border-l-muted-foreground'}`}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              {isCompleted && <CheckCircle2 className="h-5 w-5 text-primary" />}
              {isFailed && <XCircle className="h-5 w-5 text-destructive" />}
              {isStopped && <AlertTriangle className="h-5 w-5 text-muted-foreground" />}
              <div>
                <p className="font-medium text-foreground">
                  {isCompleted && 'Indexing complete!'}
                  {isFailed && 'Indexing failed'}
                  {isStopped && 'Indexing stopped'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {stats.totalProcessed} processed, {stats.totalSkipped} skipped, {stats.totalFailed} failed
                  {job.completed_at && ` — ${new Date(job.completed_at).toLocaleString()}`}
                </p>
              </div>
            </div>
            {job.last_error && (
              <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                {job.last_error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            {!isRunning ? (
              <Button onClick={handleStart} className="gap-2">
                <Play className="h-4 w-4" />
                {isStopped || isCompleted || isFailed ? 'Resume Indexing' : 'Start Indexing'}
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
                Processing in background — batch {stats.batchesCompleted + 1}...
              </div>
            )}
          </div>
          {isRunning && (
            <p className="mt-2 text-xs text-muted-foreground">
              You can close this page — indexing will continue on the server.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Progress */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={Math.max(progressPercent, totalDone > 0 ? 1 : 0)} className="mb-4" />
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
            <div className="text-xs text-muted-foreground text-center mt-4 space-y-1">
              <p>{progressPercent < 1 ? progressPercent.toFixed(1) : Math.round(progressPercent)}% complete — {stats.batchesCompleted} batches done</p>
              {isRunning && totalDone > 0 && job?.started_at && (() => {
                const elapsedMs = Date.now() - new Date(job.started_at).getTime();
                const elapsedMin = elapsedMs / 60000;
                const rate = totalDone / elapsedMin;
                const etaMin = rate > 0 ? stats.remaining / rate : 0;
                const etaHours = Math.floor(etaMin / 60);
                const etaRemMin = Math.round(etaMin % 60);
                return (
                  <p className="font-medium">
                    ~{rate.toFixed(0)} files/min • ETA: {etaHours > 0 ? `${etaHours}h ${etaRemMin}m` : `${etaRemMin}m`}
                  </p>
                );
              })()}
            </div>
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
