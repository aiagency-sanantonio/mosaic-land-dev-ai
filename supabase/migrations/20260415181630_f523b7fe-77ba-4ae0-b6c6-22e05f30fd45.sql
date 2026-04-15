
CREATE TABLE public.saved_web_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  project_name text,
  categories text[] NOT NULL DEFAULT '{}',
  notes text,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  last_researched_at timestamptz
);

ALTER TABLE public.saved_web_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view web links"
  ON public.saved_web_links FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Authenticated users can insert web links"
  ON public.saved_web_links FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = added_by);

CREATE POLICY "Users can update own web links"
  ON public.saved_web_links FOR UPDATE TO authenticated
  USING (auth.uid() = added_by);

CREATE POLICY "Users can delete own web links"
  ON public.saved_web_links FOR DELETE TO authenticated
  USING (auth.uid() = added_by);

CREATE POLICY "Service role manages web links"
  ON public.saved_web_links FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_saved_web_links_updated_at
  BEFORE UPDATE ON public.saved_web_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_saved_web_links_project ON public.saved_web_links (project_name);
CREATE INDEX idx_saved_web_links_categories ON public.saved_web_links USING GIN (categories);
