
-- 1. project_aliases
CREATE TABLE public.project_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_project_name text NOT NULL,
  alias_name text NOT NULL,
  alias_type text CHECK (alias_type IN ('owner_name', 'old_name', 'phase_name', 'abbreviation')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_project_name, alias_name)
);
ALTER TABLE public.project_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view aliases" ON public.project_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage aliases" ON public.project_aliases FOR ALL USING (true) WITH CHECK (true);

-- 2. user_profiles_extended
CREATE TABLE public.user_profiles_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role_title text,
  company_context_summary text,
  drafting_preferences text,
  preferred_projects text[],
  notes_for_ai text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
ALTER TABLE public.user_profiles_extended ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own extended profile" ON public.user_profiles_extended FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own extended profile" ON public.user_profiles_extended FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own extended profile" ON public.user_profiles_extended FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own extended profile" ON public.user_profiles_extended FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 3. retrieval_logs
CREATE TABLE public.retrieval_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  thread_id uuid,
  question text,
  query_type text,
  normalized_project text,
  top_sources jsonb,
  source_type_breakdown jsonb,
  archive_included boolean DEFAULT false,
  answer_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.retrieval_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own retrieval logs" ON public.retrieval_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage retrieval logs" ON public.retrieval_logs FOR ALL USING (true) WITH CHECK (true);

-- 4. answer_feedback
CREATE TABLE public.answer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid,
  user_id uuid NOT NULL,
  thread_id uuid,
  rating text CHECK (rating IN ('up', 'down')),
  feedback_text text,
  expected_source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.answer_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own feedback" ON public.answer_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own feedback" ON public.answer_feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 5. concept_scopes
CREATE TABLE public.concept_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_name text NOT NULL UNIQUE,
  keywords text[] NOT NULL DEFAULT '{}',
  doc_types text[] NOT NULL DEFAULT '{}',
  default_included boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.concept_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view concept scopes" ON public.concept_scopes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage concept scopes" ON public.concept_scopes FOR ALL USING (true) WITH CHECK (true);

-- Seed concept_scopes
INSERT INTO public.concept_scopes (scope_name, keywords, doc_types, default_included) VALUES
  ('engineering_proposals', ARRAY['engineering', 'civil engineering', 'MEP', 'structural'], ARRAY['proposal', 'scope of work', 'engineering report'], true),
  ('geotechnical', ARRAY['geotechnical', 'geotech', 'soil', 'boring', 'subsurface'], ARRAY['proposal', 'report', 'investigation'], true),
  ('surveying', ARRAY['survey', 'surveying', 'ALTA', 'boundary', 'topographic'], ARRAY['proposal', 'report', 'plat'], true),
  ('civil_planning', ARRAY['civil', 'land planning', 'site plan', 'grading', 'drainage', 'utilities'], ARRAY['proposal', 'plan', 'report'], true),
  ('phase_1_environmental', ARRAY['phase 1', 'phase I', 'environmental', 'ESA', 'environmental site assessment'], ARRAY['proposal', 'report', 'assessment'], true),
  ('opc_estimates', ARRAY['OPC', 'opinion of probable cost', 'estimate', 'cost estimate', 'budget'], ARRAY['estimate', 'OPC', 'spreadsheet'], true),
  ('master_planning', ARRAY['master plan', 'MDP', 'master development plan', 'conceptual plan'], ARRAY['plan', 'report', 'presentation'], true),
  ('land_acquisition', ARRAY['acquisition', 'purchase', 'land purchase', 'closing', 'title'], ARRAY['contract', 'agreement', 'title report'], false);
