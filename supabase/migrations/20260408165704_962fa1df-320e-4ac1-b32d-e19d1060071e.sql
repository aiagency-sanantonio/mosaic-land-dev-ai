CREATE TABLE public.system_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  tier text NOT NULL DEFAULT 'always',
  keywords text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage system knowledge"
  ON public.system_knowledge FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage system knowledge"
  ON public.system_knowledge FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_system_knowledge_updated_at
  BEFORE UPDATE ON public.system_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();