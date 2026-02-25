import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, RefreshCw, CheckCircle2, XCircle, SkipForward, AlertTriangle, Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface IndexingJob {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  last_error: string | null;
}

interface RealStats {
  success: number;
  skipped: number;
  failed: number;
  totalDropbox: number;
  remaining: number;
}

interface ExtractionProgress {
  done: number;
  total: number;
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
  const [realStats, setRealStats] = useState<RealStats>({ success: 0, skipped: 0, failed: 0, totalDropbox: 0, remaining: 0 });
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loadingJob, setLoadingJob] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractionRunning, setExtractionRunning] = useState(false);
  const [extractResult, setExtractResult] = useState<{ processed: number; failed: number; remaining: number; totals: { metrics: number; permits: number; dd_items: number } } | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress>({ done: 0, total: 0 });
  const [extractionRate, setExtractionRate] = useState<number | null>(null);
  const stallCountRef = useRef(0);
  const lastExtractedRef = useRef(0);
  const extractionStartTimeRef = useRef<number | null>(null);
  const extractionStartCountRef = useRef(0);

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  const fetchLatestJob = useCallback(async () => {
    const { data, error } = await supabase
      .from('indexing_jobs')
      .select('id, status, started_at, completed_at, last_error')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching job:', error);
      return;
    }

    if (data && data.length > 0) {
      setJob(data[0]);
    } else {
      setJob(null);
    }
    setLoadingJob(false);
  }, []);

  const fetchRealStats = useCallback(async () => {
    const [successRes, skippedRes, failedRes, totalRes] = await Promise.all([
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success'),
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'skipped'),
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase.from('dropbox_files').select('*', { count: 'exact', head: true }),
    ]);

    if (successRes.error || skippedRes.error || failedRes.error || totalRes.error) {
      console.error('Error fetching real stats:', successRes.error, skippedRes.error, failedRes.error, totalRes.error);
      return;
    }

    const success = successRes.count ?? 0;
    const skipped = skippedRes.count ?? 0;
    const failed = failedRes.count ?? 0;
    const totalDropbox = totalRes.count ?? 0;
    const remaining = Math.max(0, totalDropbox - success - skipped - failed);

    setRealStats({ success, skipped, failed, totalDropbox, remaining });
  }, []);

  const fetchExtractionProgress = useCallback(async () => {
    const totalRes = await supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success');
    // structured_extracted column added via migration, not yet in generated types
    const doneRes = await (supabase.from('indexing_status') as any).select('*', { count: 'exact', head: true }).eq('status', 'success').eq('structured_extracted', true);
    setExtractionProgress({
      done: doneRes.count ?? 0,
      total: totalRes.count ?? 0,
    });
  }, []);

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

  useEffect(() => {
    if (user) {
      fetchLatestJob();
      fetchRealStats();
      fetchActivity();
      fetchExtractionProgress();
    }
  }, [user, fetchLatestJob, fetchRealStats, fetchActivity, fetchExtractionProgress]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const interval = setInterval(() => {
      fetchLatestJob();
      fetchRealStats();
      fetchActivity();
    }, 5000);
    return () => clearInterval(interval);
  }, [job?.status, fetchLatestJob, fetchRealStats, fetchActivity]);

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

  const triggerExtraction = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('extract-structured-data', {
        body: { force: false, batch_size: 10 },
      });
      if (error) {
        console.error('Extraction trigger error:', error.message);
        return;
      }
      if (data?.extraction_progress) {
        setExtractionProgress(data.extraction_progress);
      }
      setExtractResult(data);
    } catch (err) {
      console.error('Extraction trigger failed:', err);
    }
  }, []);

  const handleExtract = async () => {
    setExtracting(true);
    setExtractionRunning(true);
    setExtractResult(null);
    stallCountRef.current = 0;
    extractionStartTimeRef.current = Date.now();
    extractionStartCountRef.current = extractionProgress.done;
    try {
      await triggerExtraction();
      toast.success('Extraction started — polling for progress...');
    } catch (err) {
      toast.error('Extraction failed to start');
      console.error(err);
      setExtractionRunning(false);
    } finally {
      setExtracting(false);
    }
  };

  const handleStopExtraction = () => {
    setExtractionRunning(false);
    stallCountRef.current = 0;
    setExtractionRate(null);
    toast.info('Extraction polling stopped');
  };

  // Polling effect for extraction progress
  useEffect(() => {
    if (!extractionRunning) return;

    const interval = setInterval(async () => {
      await fetchExtractionProgress();
    }, 15000);

    return () => clearInterval(interval);
  }, [extractionRunning, fetchExtractionProgress]);

  // Stall detection & rate calculation
  useEffect(() => {
    if (!extractionRunning) return;

    const currentDone = extractionProgress.done;
    const total = extractionProgress.total;

    // Calculate rate
    if (extractionStartTimeRef.current && currentDone > extractionStartCountRef.current) {
      const elapsedMin = (Date.now() - extractionStartTimeRef.current) / 60000;
      const processed = currentDone - extractionStartCountRef.current;
      if (elapsedMin > 0) {
        setExtractionRate(Math.round(processed / elapsedMin));
      }
    }

    // Check if done
    if (total > 0 && currentDone >= total) {
      setExtractionRunning(false);
      stallCountRef.current = 0;
      toast.success('Extraction complete!');
      return;
    }

    // Stall detection
    if (currentDone === lastExtractedRef.current && currentDone < total) {
      stallCountRef.current += 1;
      if (stallCountRef.current >= 3) {
        console.log('Extraction stalled — auto-retriggering...');
        stallCountRef.current = 0;
        triggerExtraction();
        toast.info('Extraction stalled — auto-restarting...');
      }
    } else {
      stallCountRef.current = 0;
    }

    lastExtractedRef.current = currentDone;
  }, [extractionProgress, extractionRunning, triggerExtraction]);

  const totalDone = realStats.success + realStats.skipped + realStats.failed;
  const totalFiles = totalDone + realStats.remaining;
  const progressPercent = totalFiles > 0 ? (totalDone / totalFiles) * 100 : 0;
  const extractPercent = extractionProgress.total > 0 ? (extractionProgress.done / extractionProgress.total) * 100 : 0;

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
                  {realStats.success} processed, {realStats.skipped} skipped, {realStats.failed} failed
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
                Processing in background...
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

      {/* Structured Data Extraction */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="font-medium text-foreground flex items-center gap-2">
                <Database className="h-4 w-4" /> Structured Data Extraction
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Extract metrics, permits & DD items from already-indexed documents
              </p>
            </div>
            <div className="flex gap-2">
              {!extractionRunning ? (
                <Button onClick={handleExtract} disabled={extracting} variant="secondary" className="gap-2">
                  {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  {extracting ? 'Starting...' : 'Run Extraction'}
                </Button>
              ) : (
                <Button onClick={handleStopExtraction} variant="destructive" size="sm" className="gap-2">
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              )}
            </div>
          </div>

          {/* Extraction Progress */}
          {extractionProgress.total > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{extractionProgress.done.toLocaleString()} / {extractionProgress.total.toLocaleString()} files extracted</span>
                <span>{extractPercent < 1 && extractPercent > 0 ? extractPercent.toFixed(1) : Math.round(extractPercent)}%</span>
              </div>
              <Progress value={Math.max(extractPercent, extractionProgress.done > 0 ? 1 : 0)} className="h-2" />
              {extractionRunning && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Processing...
                  </span>
                  {extractionRate && extractionRate > 0 && (
                    <>
                      <span>~{extractionRate} files/min</span>
                      {(() => {
                        const remaining = extractionProgress.total - extractionProgress.done;
                        const etaMin = remaining / extractionRate;
                        const etaHours = Math.floor(etaMin / 60);
                        const etaRemMin = Math.round(etaMin % 60);
                        return <span>ETA: {etaHours > 0 ? `${etaHours}h ${etaRemMin}m` : `${etaRemMin}m`}</span>;
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {extractResult && !extractionRunning && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg text-sm space-y-1">
              <p><span className="font-medium">Processed:</span> {extractResult.processed} files | <span className="font-medium">Failed:</span> {extractResult.failed}</p>
              <p><span className="font-medium">Extracted:</span> {extractResult.totals.metrics} metrics, {extractResult.totals.permits} permits, {extractResult.totals.dd_items} DD items</p>
              {extractResult.remaining > 0 && (
                <p className="text-muted-foreground">{extractResult.remaining.toLocaleString()} files remaining</p>
              )}
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
          <Progress value={Math.max(progressPercent, totalDone > 0 ? 1 : 0)} className="mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{realStats.success.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Processed
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-muted-foreground">{realStats.skipped.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <SkipForward className="h-3 w-3" /> Skipped
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-destructive">{realStats.failed}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <XCircle className="h-3 w-3" /> Failed
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{realStats.remaining.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Remaining</div>
            </div>
          </div>
          {totalFiles > 0 && (
            <div className="text-xs text-muted-foreground text-center mt-4 space-y-1">
              <p>{progressPercent < 1 ? progressPercent.toFixed(1) : Math.round(progressPercent)}% complete</p>
              {isRunning && totalDone > 0 && job?.started_at && (() => {
                const elapsedMs = Date.now() - new Date(job.started_at).getTime();
                const elapsedMin = elapsedMs / 60000;
                const rate = totalDone / elapsedMin;
                const etaMin = rate > 0 ? realStats.remaining / rate : 0;
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
