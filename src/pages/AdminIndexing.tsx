import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ArrowLeft, Play, Square, RefreshCw, CheckCircle2, XCircle, SkipForward, AlertTriangle, Database, Loader2, PauseCircle, ChevronDown, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [killSwitchId, setKillSwitchId] = useState<string | null>(null);
  const [realStats, setRealStats] = useState<RealStats>({ success: 0, skipped: 0, failed: 0, totalDropbox: 0, remaining: 0 });
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loadingJob, setLoadingJob] = useState(true);
  const [zzScanning, setZzScanning] = useState(false);
  const [zzResult, setZzResult] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionRunning, setExtractionRunning] = useState(false);
  const [extractResult, setExtractResult] = useState<{ processed: number; failed: number; remaining: number; totals: { metrics: number; permits: number; dd_items: number } } | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress>({ done: 0, total: 0 });
  const [extractionRate, setExtractionRate] = useState<number | null>(null);
  const stallCountRef = useRef(0);
  const lastExtractedRef = useRef(0);
  const extractionStartTimeRef = useRef<number | null>(null);
  const extractionStartCountRef = useRef(0);

  // OCR state
  const [ocrStarting, setOcrStarting] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrEligible, setOcrEligible] = useState<number | null>(null);
  const [ocrCompleted, setOcrCompleted] = useState(0);
  const [ocrInsufficient, setOcrInsufficient] = useState(0);
  const [ocrFailed, setOcrFailed] = useState(0);
  const [ocrRate, setOcrRate] = useState<number | null>(null);
  const [ocrElapsedSeconds, setOcrElapsedSeconds] = useState(0);
  const [ocrInitialEligible, setOcrInitialEligible] = useState<number | null>(null);
  const ocrStallCountRef = useRef(0);
  const lastOcrProcessedRef = useRef(0);
  const ocrStartTimeRef = useRef<number | null>(null);
  const ocrStartCountRef = useRef(0);

  // Collapsible states
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showIndexingDetails, setShowIndexingDetails] = useState(false);
  const [showOcrDetails, setShowOcrDetails] = useState(false);
  const [showExtractionDetails, setShowExtractionDetails] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  const fetchKillSwitchStatus = useCallback(async () => {
    const { data, error } = await supabase
      .from('indexing_jobs')
      .select('id, status')
      .eq('status', 'stopped')
      .limit(1);
    if (!error && data && data.length > 0) {
      setKillSwitchActive(true);
      setKillSwitchId(data[0].id);
    } else {
      setKillSwitchActive(false);
      setKillSwitchId(null);
    }
  }, []);

  const fetchLatestJob = useCallback(async () => {
    const { data, error } = await supabase
      .from('indexing_jobs')
      .select('id, status, started_at, completed_at, last_error')
      .neq('status', 'stopped')
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
    if (successRes.error || skippedRes.error || failedRes.error || totalRes.error) return;
    const success = successRes.count ?? 0;
    const skipped = skippedRes.count ?? 0;
    const failed = failedRes.count ?? 0;
    const totalDropbox = totalRes.count ?? 0;
    const remaining = Math.max(0, totalDropbox - success - skipped - failed);
    setRealStats({ success, skipped, failed, totalDropbox, remaining });
  }, []);

  const fetchExtractionProgress = useCallback(async () => {
    const totalRes = await supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success');
    const doneRes = await (supabase.from('indexing_status') as any).select('*', { count: 'exact', head: true }).eq('status', 'success').eq('structured_extracted', true);
    setExtractionProgress({ done: doneRes.count ?? 0, total: totalRes.count ?? 0 });
  }, []);

  const fetchOcrEligible = useCallback(async () => {
    const ocrErrors = [
      'Scanned/image-only PDF - no extractable text',
      ...['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'gif', 'webp'].map(e => `Non-vectorizable format: .${e}`),
    ];
    const [remainingRes, completedRes, insufficientRes, failedRes] = await Promise.all([
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'skipped').in('error_message', ocrErrors),
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'success').contains('metadata', { ocr_source: 'openai' }),
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'skipped').eq('error_message', 'OCR returned insufficient text (< 20 chars)'),
      supabase.from('indexing_status').select('*', { count: 'exact', head: true }).eq('status', 'failed').like('error_message', 'OCR failed%'),
    ]);
    setOcrEligible(remainingRes.count ?? 0);
    setOcrCompleted(completedRes.count ?? 0);
    setOcrInsufficient(insufficientRes.count ?? 0);
    setOcrFailed(failedRes.count ?? 0);
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
      fetchKillSwitchStatus();
      fetchLatestJob();
      fetchRealStats();
      fetchActivity();
      fetchExtractionProgress();
      fetchOcrEligible();
    }
  }, [user, fetchKillSwitchStatus, fetchLatestJob, fetchRealStats, fetchActivity, fetchExtractionProgress, fetchOcrEligible]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const interval = setInterval(() => {
      fetchLatestJob();
      fetchRealStats();
      fetchActivity();
    }, 5000);
    return () => clearInterval(interval);
  }, [job?.status, fetchLatestJob, fetchRealStats, fetchActivity]);

  const handleResumeProcessing = async () => {
    if (!killSwitchId) return;
    const { error } = await supabase.from('indexing_jobs').delete().eq('id', killSwitchId);
    if (error) {
      toast.error('Failed to resume processing');
      return;
    }
    setKillSwitchActive(false);
    setKillSwitchId(null);
    toast.success('Processing resumed — kill switch deactivated');
    fetchKillSwitchStatus();
  };

  const handlePauseAll = async () => {
    const { error } = await supabase.from('indexing_jobs').insert({
      status: 'stopped',
      stats: { reason: 'manual_pause' },
    });
    if (error) {
      toast.error('Failed to pause processing');
      return;
    }
    toast.success('All processing paused');
    fetchKillSwitchStatus();
  };

  const handleStart = async () => {
    if (killSwitchActive) {
      toast.error('Cannot start — processing is globally paused. Resume first.');
      return;
    }
    const { error } = await supabase.from('indexing_jobs').insert({ status: 'running' });
    if (error) {
      toast.error('Failed to start indexing job');
      return;
    }
    toast.success('Indexing job started');
    fetchLatestJob();
  };

  const handleStop = async () => {
    if (!job) return;
    const { error } = await supabase
      .from('indexing_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
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
      if (error) { console.error('Extraction trigger error:', error.message); return; }
      if (data?.extraction_progress) setExtractionProgress(data.extraction_progress);
      setExtractResult(data);
    } catch (err) { console.error('Extraction trigger failed:', err); }
  }, []);

  const handleExtract = async () => {
    if (killSwitchActive) { toast.error('Cannot start — processing is globally paused'); return; }
    setExtracting(true);
    setExtractionRunning(true);
    setExtractResult(null);
    stallCountRef.current = 0;
    extractionStartTimeRef.current = Date.now();
    extractionStartCountRef.current = extractionProgress.done;
    try {
      await triggerExtraction();
      toast.success('Extraction started');
    } catch { toast.error('Extraction failed to start'); setExtractionRunning(false); }
    finally { setExtracting(false); }
  };

  const handleStopExtraction = () => {
    setExtractionRunning(false);
    stallCountRef.current = 0;
    setExtractionRate(null);
    toast.info('Extraction stopped');
  };

  useEffect(() => {
    if (!extractionRunning) return;
    const interval = setInterval(() => fetchExtractionProgress(), 15000);
    return () => clearInterval(interval);
  }, [extractionRunning, fetchExtractionProgress]);

  useEffect(() => {
    if (!extractionRunning) return;
    const currentDone = extractionProgress.done;
    const total = extractionProgress.total;
    if (extractionStartTimeRef.current && currentDone > extractionStartCountRef.current) {
      const elapsedMin = (Date.now() - extractionStartTimeRef.current) / 60000;
      const processed = currentDone - extractionStartCountRef.current;
      if (elapsedMin > 0) setExtractionRate(Math.round(processed / elapsedMin));
    }
    if (total > 0 && currentDone >= total) {
      setExtractionRunning(false);
      toast.success('Extraction complete!');
      return;
    }
    if (currentDone === lastExtractedRef.current && currentDone < total) {
      stallCountRef.current += 1;
      if (stallCountRef.current >= 3) {
        stallCountRef.current = 0;
        triggerExtraction();
        toast.info('Extraction stalled — auto-restarting...');
      }
    } else { stallCountRef.current = 0; }
    lastExtractedRef.current = currentDone;
  }, [extractionProgress, extractionRunning, triggerExtraction]);

  // OCR handlers
  const triggerOcr = useCallback(async (testMode = false) => {
    try {
      const { data, error } = await supabase.functions.invoke('ocr-process', {
        body: testMode ? { test_mode: true, test_limit: 50, batch_size: 5 } : { batch_size: 5 },
      });
      if (error) { console.error('OCR trigger error:', error.message); return; }
    } catch (err) { console.error('OCR trigger failed:', err); }
  }, []);

  const handleStartOcr = async (testMode = false) => {
    if (killSwitchActive) { toast.error('Cannot start — processing is globally paused'); return; }
    setOcrStarting(true);
    setOcrRunning(true);
    setOcrElapsedSeconds(0);
    setOcrInitialEligible(ocrEligible);
    ocrStallCountRef.current = 0;
    ocrStartTimeRef.current = Date.now();
    ocrStartCountRef.current = 0;
    try {
      await triggerOcr(testMode);
      toast.success(testMode ? 'OCR test started (50 files)...' : 'OCR processing started...');
    } catch { toast.error('OCR failed to start'); setOcrRunning(false); }
    finally { setOcrStarting(false); }
  };

  const handleStopOcr = () => {
    setOcrRunning(false);
    ocrStallCountRef.current = 0;
    setOcrRate(null);
    setOcrInitialEligible(null);
    toast.info('OCR stopped');
  };

  useEffect(() => {
    if (!ocrRunning) return;
    const interval = setInterval(() => setOcrElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [ocrRunning]);

  useEffect(() => {
    if (!ocrRunning) return;
    const interval = setInterval(async () => { await fetchOcrEligible(); await fetchRealStats(); }, 15000);
    return () => clearInterval(interval);
  }, [ocrRunning, fetchOcrEligible, fetchRealStats]);

  useEffect(() => {
    if (!ocrRunning || ocrEligible === null) return;
    if (ocrStartTimeRef.current) {
      if (ocrStartCountRef.current === 0 && ocrEligible > 0) ocrStartCountRef.current = ocrEligible;
      const processed = ocrStartCountRef.current - ocrEligible;
      if (processed > 0) {
        const elapsedMin = (Date.now() - ocrStartTimeRef.current) / 60000;
        if (elapsedMin > 0) setOcrRate(Math.round(processed / elapsedMin));
      }
    }
    if (ocrEligible === 0) { setOcrRunning(false); toast.success('OCR complete!'); return; }
    if (ocrEligible === lastOcrProcessedRef.current) {
      ocrStallCountRef.current += 1;
      if (ocrStallCountRef.current >= 3) { ocrStallCountRef.current = 0; triggerOcr(); toast.info('OCR stalled — auto-restarting...'); }
    } else { ocrStallCountRef.current = 0; }
    lastOcrProcessedRef.current = ocrEligible;
  }, [ocrEligible, ocrRunning, triggerOcr]);

  // Computed values
  const totalDone = realStats.success + realStats.skipped + realStats.failed;
  const indexingPercent = realStats.totalDropbox > 0 ? (totalDone / realStats.totalDropbox) * 100 : 0;
  const extractPercent = extractionProgress.total > 0 ? (extractionProgress.done / extractionProgress.total) * 100 : 0;
  const ocrRemaining = ocrEligible ?? 0;
  const ocrTotalAll = ocrCompleted + ocrRemaining + ocrInsufficient + ocrFailed;
  const ocrPercent = ocrTotalAll > 0 ? ((ocrCompleted + ocrInsufficient + ocrFailed) / ocrTotalAll) * 100 : 0;
  const isRunning = job?.status === 'running';

  if (loading || loadingJob) return null;

  const formatPercent = (p: number) => p < 1 && p > 0 ? p.toFixed(1) : Math.round(p).toString();

  const getStageStatus = (stage: 'index' | 'ocr' | 'extract') => {
    if (killSwitchActive) return 'paused';
    if (stage === 'index') return isRunning ? 'running' : indexingPercent >= 99.5 ? 'complete' : 'idle';
    if (stage === 'ocr') return ocrRunning ? 'running' : ocrRemaining === 0 && ocrCompleted > 0 ? 'complete' : 'idle';
    if (stage === 'extract') return extractionRunning ? 'running' : extractPercent >= 99.5 ? 'complete' : 'idle';
    return 'idle';
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
      running: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Running', className: 'bg-primary/15 text-primary border-primary/30' },
      paused: { icon: <PauseCircle className="h-3 w-3" />, label: 'Paused', className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
      complete: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Complete', className: 'bg-green-500/15 text-green-600 border-green-500/30' },
      idle: { icon: null, label: 'Idle', className: 'bg-muted text-muted-foreground border-border' },
    };
    const c = config[status] || config.idle;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>
        {c.icon}{c.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Processing Pipeline</h1>
          <p className="text-sm text-muted-foreground">Index → OCR → Extract</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { fetchRealStats(); fetchExtractionProgress(); fetchOcrEligible(); fetchKillSwitchStatus(); toast.info('Refreshed'); }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Kill Switch Banner */}
      {killSwitchActive ? (
        <div className="mb-6 p-4 rounded-lg border-2 border-orange-500/50 bg-orange-500/10 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <PauseCircle className="h-5 w-5 text-orange-500" />
            <div>
              <p className="font-semibold text-foreground">All Processing Paused</p>
              <p className="text-sm text-muted-foreground">Kill switch is active — no background jobs will run</p>
            </div>
          </div>
          <Button onClick={handleResumeProcessing} className="gap-2">
            <Play className="h-4 w-4" /> Resume Processing
          </Button>
        </div>
      ) : (
        <div className="mb-6 p-3 rounded-lg border border-green-500/30 bg-green-500/10 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium text-foreground">Processing Enabled</span>
          </div>
          <Button variant="outline" size="sm" onClick={handlePauseAll} className="gap-2 text-orange-600 border-orange-300 hover:bg-orange-50">
            <PauseCircle className="h-4 w-4" /> Pause All
          </Button>
        </div>
      )}

      {/* Pipeline Overview — 3 Stage Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Stage 1: Indexing */}
        <Card className={`${getStageStatus('index') === 'running' ? 'border-primary/50 shadow-md' : ''}`}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1. Indexing</span>
              <StatusBadge status={getStageStatus('index')} />
            </div>
            <div className="text-2xl font-bold text-foreground mb-1">
              {realStats.success.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ {realStats.totalDropbox.toLocaleString()}</span>
            </div>
            <Progress value={Math.max(indexingPercent, totalDone > 0 ? 1 : 0)} className="h-2 mb-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatPercent(indexingPercent)}% indexed</span>
              <span>{realStats.skipped.toLocaleString()} skipped</span>
            </div>
          </CardContent>
        </Card>

        {/* Stage 2: OCR */}
        <Card className={`${getStageStatus('ocr') === 'running' ? 'border-primary/50 shadow-md' : ''}`}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2. OCR</span>
              <StatusBadge status={getStageStatus('ocr')} />
            </div>
            <div className="text-2xl font-bold text-foreground mb-1">
              {ocrCompleted.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ {ocrTotalAll.toLocaleString()}</span>
            </div>
            <Progress value={Math.max(ocrPercent, ocrCompleted > 0 ? 1 : 0)} className="h-2 mb-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{ocrPercent > 0 ? `${formatPercent(ocrPercent)}%` : '—'}</span>
              <span>{ocrRemaining.toLocaleString()} remaining</span>
            </div>
          </CardContent>
        </Card>

        {/* Stage 3: Extraction */}
        <Card className={`${getStageStatus('extract') === 'running' ? 'border-primary/50 shadow-md' : ''}`}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">3. Extraction</span>
              <StatusBadge status={getStageStatus('extract')} />
            </div>
            <div className="text-2xl font-bold text-foreground mb-1">
              {extractionProgress.done.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ {extractionProgress.total.toLocaleString()}</span>
            </div>
            <Progress value={Math.max(extractPercent, extractionProgress.done > 0 ? 1 : 0)} className="h-2 mb-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatPercent(extractPercent)}%</span>
              <span>{(extractionProgress.total - extractionProgress.done).toLocaleString()} remaining</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ZZ MD_50KFT Scanner */}
      <Card className="mb-3">
        <CardHeader className="py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> ZZ MD_50KFT Scanner
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <Button
            onClick={async () => {
              setZzScanning(true);
              setZzResult(null);
              try {
                const { data, error } = await supabase.functions.invoke('scan-zz-folder', { body: {} });
                if (error) throw error;
                setZzResult(
                  `✅ Scan complete\n\nTotal entries found: ${data.total_entries_found}\nFiles registered: ${data.total_registered}\nFolders skipped: ${data.skipped_folders}\nZip/oversize skipped: ${data.skipped_zip_or_oversize}\n\nFiles:\n${(data.file_names || []).join('\n')}`
                );
                toast.success(`Registered ${data.total_registered} files`);
                fetchRealStats();
              } catch (err: any) {
                setZzResult(`❌ Error: ${err.message || 'Unknown error'}`);
                toast.error('ZZ folder scan failed');
              } finally {
                setZzScanning(false);
              }
            }}
            disabled={zzScanning}
            size="sm"
            className="gap-2 mb-3"
          >
            {zzScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {zzScanning ? 'Scanning...' : 'Scan & Register ZZ Folder'}
          </Button>
          {zzResult && (
            <textarea
              readOnly
              value={zzResult}
              className="w-full h-48 text-xs font-mono bg-muted border border-border rounded-md p-3 text-foreground resize-y"
            />
          )}
        </CardContent>
      </Card>

      {/* Detail Sections */}
      <div className="space-y-3">
        {/* Indexing Details */}
        <Collapsible open={showIndexingDetails} onOpenChange={setShowIndexingDetails}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" /> Indexing Details
                  </CardTitle>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showIndexingDetails ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-xl font-bold text-primary">{realStats.success.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><CheckCircle2 className="h-3 w-3" /> Success</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-muted-foreground">{realStats.skipped.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><SkipForward className="h-3 w-3" /> Skipped</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-destructive">{realStats.failed}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><XCircle className="h-3 w-3" /> Failed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-foreground">{realStats.remaining.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Remaining</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isRunning ? (
                    <Button onClick={handleStart} disabled={killSwitchActive} size="sm" className="gap-2">
                      <Play className="h-4 w-4" /> Start Indexing
                    </Button>
                  ) : (
                    <Button onClick={handleStop} variant="destructive" size="sm" className="gap-2">
                      <Square className="h-4 w-4" /> Stop
                    </Button>
                  )}
                  {isRunning && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Processing in background...
                    </span>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* OCR Details */}
        <Collapsible open={showOcrDetails} onOpenChange={setShowOcrDetails}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Eye className="h-4 w-4" /> OCR Details
                  </CardTitle>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showOcrDetails ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4">
                <p className="text-xs text-muted-foreground mb-3">
                  Extract text from scanned PDFs & images using OpenAI Vision
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-xl font-bold text-primary">{ocrCompleted.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><CheckCircle2 className="h-3 w-3" /> Success</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-muted-foreground">{ocrRemaining.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><SkipForward className="h-3 w-3" /> Remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-muted-foreground">{ocrInsufficient.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" /> Insufficient</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-destructive">{ocrFailed.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><XCircle className="h-3 w-3" /> Failed</div>
                  </div>
                </div>
                {ocrRunning && (
                  <div className="mb-3 p-3 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-4 flex-wrap text-sm">
                    <span className="flex items-center gap-2 font-medium text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" /> Running
                    </span>
                    <span className="text-muted-foreground">{Math.floor(ocrElapsedSeconds / 60)}m {ocrElapsedSeconds % 60}s</span>
                    {ocrRate && ocrRate > 0 && <span className="text-muted-foreground">~{ocrRate} files/min</span>}
                    {ocrRate && ocrRate > 0 && ocrEligible !== null && ocrEligible > 0 && (() => {
                      const etaMin = ocrEligible / ocrRate;
                      const h = Math.floor(etaMin / 60);
                      const m = Math.round(etaMin % 60);
                      return <span className="text-muted-foreground">ETA: {h > 0 ? `${h}h ${m}m` : `${m}m`}</span>;
                    })()}
                  </div>
                )}
                <div className="flex gap-2">
                  {!ocrRunning ? (
                    <>
                      <Button onClick={() => handleStartOcr(true)} disabled={killSwitchActive || ocrStarting || ocrEligible === 0} variant="outline" size="sm" className="gap-2">
                        {ocrStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Test (50)
                      </Button>
                      <Button onClick={() => handleStartOcr(false)} disabled={killSwitchActive || ocrStarting || ocrEligible === 0} variant="secondary" size="sm" className="gap-2">
                        {ocrStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Run Full OCR
                      </Button>
                    </>
                  ) : (
                    <Button onClick={handleStopOcr} variant="destructive" size="sm" className="gap-2">
                      <Square className="h-4 w-4" /> Stop
                    </Button>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Extraction Details */}
        <Collapsible open={showExtractionDetails} onOpenChange={setShowExtractionDetails}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" /> Extraction Details
                  </CardTitle>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showExtractionDetails ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4">
                <p className="text-xs text-muted-foreground mb-3">
                  Extract metrics, permits & DD items from indexed documents
                </p>
                {extractionRunning && (
                  <div className="mb-3 p-3 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-4 flex-wrap text-sm">
                    <span className="flex items-center gap-2 font-medium text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" /> Running
                    </span>
                    {extractionRate && extractionRate > 0 && (
                      <>
                        <span className="text-muted-foreground">~{extractionRate} files/min</span>
                        {(() => {
                          const remaining = extractionProgress.total - extractionProgress.done;
                          const etaMin = remaining / extractionRate;
                          const h = Math.floor(etaMin / 60);
                          const m = Math.round(etaMin % 60);
                          return <span className="text-muted-foreground">ETA: {h > 0 ? `${h}h ${m}m` : `${m}m`}</span>;
                        })()}
                      </>
                    )}
                  </div>
                )}
                {extractResult && !extractionRunning && (
                  <div className="mb-3 p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                    <p><span className="font-medium">Last run:</span> {extractResult.processed} processed, {extractResult.failed} failed</p>
                    <p><span className="font-medium">Extracted:</span> {extractResult.totals.metrics} metrics, {extractResult.totals.permits} permits, {extractResult.totals.dd_items} DD items</p>
                  </div>
                )}
                <div className="flex gap-2">
                  {!extractionRunning ? (
                    <Button onClick={handleExtract} disabled={killSwitchActive || extracting} variant="secondary" size="sm" className="gap-2">
                      {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                      {extracting ? 'Starting...' : 'Run Extraction'}
                    </Button>
                  ) : (
                    <Button onClick={handleStopExtraction} variant="destructive" size="sm" className="gap-2">
                      <Square className="h-4 w-4" /> Stop
                    </Button>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Activity Log */}
        <Collapsible open={showActivityLog} onOpenChange={setShowActivityLog}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" /> Activity Log
                  </CardTitle>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showActivityLog ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4">
                <ScrollArea className="h-64">
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
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
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}
