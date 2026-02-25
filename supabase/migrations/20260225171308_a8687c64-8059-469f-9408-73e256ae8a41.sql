
-- =============================================
-- Phase 1: project_data table (structured metrics)
-- =============================================
CREATE TABLE public.project_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL,
  category TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT,
  date DATE,
  source_file_path TEXT,
  source_file_name TEXT,
  confidence NUMERIC DEFAULT 1.0,
  raw_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_data_project ON public.project_data (project_name);
CREATE INDEX idx_project_data_category ON public.project_data (category);
CREATE INDEX idx_project_data_metric ON public.project_data (metric_name);
CREATE INDEX idx_project_data_date ON public.project_data (date);
CREATE INDEX idx_project_data_source ON public.project_data (source_file_path);

ALTER TABLE public.project_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view project data"
  ON public.project_data FOR SELECT
  USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Service role can manage project data"
  ON public.project_data FOR ALL
  USING (true) WITH CHECK (true);

-- =============================================
-- Phase 2: permits_tracking table
-- =============================================
CREATE TABLE public.permits_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL,
  permit_type TEXT NOT NULL,
  permit_no TEXT,
  description TEXT,
  issued_date DATE,
  expiration_date DATE,
  status TEXT DEFAULT 'active',
  source_file_path TEXT,
  source_file_name TEXT,
  confidence NUMERIC DEFAULT 1.0,
  raw_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_permits_project ON public.permits_tracking (project_name);
CREATE INDEX idx_permits_expiration ON public.permits_tracking (expiration_date);
CREATE INDEX idx_permits_status ON public.permits_tracking (status);
CREATE INDEX idx_permits_type ON public.permits_tracking (permit_type);
CREATE INDEX idx_permits_source ON public.permits_tracking (source_file_path);

ALTER TABLE public.permits_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view permits"
  ON public.permits_tracking FOR SELECT
  USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Service role can manage permits"
  ON public.permits_tracking FOR ALL
  USING (true) WITH CHECK (true);

-- =============================================
-- Phase 3: dd_checklists table
-- =============================================
CREATE TABLE public.dd_checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL,
  checklist_item TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_date DATE,
  notes TEXT,
  source_file_path TEXT,
  source_file_name TEXT,
  confidence NUMERIC DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_dd_project ON public.dd_checklists (project_name);
CREATE INDEX idx_dd_status ON public.dd_checklists (status);
CREATE INDEX idx_dd_source ON public.dd_checklists (source_file_path);

ALTER TABLE public.dd_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dd checklists"
  ON public.dd_checklists FOR SELECT
  USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Service role can manage dd checklists"
  ON public.dd_checklists FOR ALL
  USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_project_data_updated_at
  BEFORE UPDATE ON public.project_data
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_permits_tracking_updated_at
  BEFORE UPDATE ON public.permits_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dd_checklists_updated_at
  BEFORE UPDATE ON public.dd_checklists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
