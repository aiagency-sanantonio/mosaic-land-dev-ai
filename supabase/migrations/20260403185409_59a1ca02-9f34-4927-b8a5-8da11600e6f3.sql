
CREATE TABLE public.shared_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  share_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '60 days',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own shared threads"
ON public.shared_threads FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can delete own shared threads"
ON public.shared_threads FOR DELETE
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "Users can view own shared threads"
ON public.shared_threads FOR SELECT
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "Public can view active shared threads"
ON public.shared_threads FOR SELECT
TO anon
USING (is_active = true AND expires_at > now());
