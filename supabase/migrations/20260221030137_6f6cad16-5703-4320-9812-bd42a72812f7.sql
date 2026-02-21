
-- Create indexing_jobs table
CREATE TABLE public.indexing_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{"totalProcessed": 0, "totalSkipped": 0, "totalFailed": 0, "remaining": 0, "batchesCompleted": 0}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.indexing_jobs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view jobs
CREATE POLICY "Authenticated users can view indexing jobs"
ON public.indexing_jobs FOR SELECT
USING (auth.role() = 'authenticated'::text);

-- Authenticated users can insert jobs (start indexing)
CREATE POLICY "Authenticated users can insert indexing jobs"
ON public.indexing_jobs FOR INSERT
WITH CHECK (auth.role() = 'authenticated'::text);

-- Authenticated users can update jobs (stop indexing)
CREATE POLICY "Authenticated users can update indexing jobs"
ON public.indexing_jobs FOR UPDATE
USING (auth.role() = 'authenticated'::text);

-- Service role can manage all jobs
CREATE POLICY "Service role can manage indexing jobs"
ON public.indexing_jobs FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_indexing_jobs_updated_at
BEFORE UPDATE ON public.indexing_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
