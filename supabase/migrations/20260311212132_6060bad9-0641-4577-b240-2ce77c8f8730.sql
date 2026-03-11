
CREATE TABLE public.chat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  request_payload jsonb NOT NULL,
  response_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.chat_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own jobs" ON public.chat_jobs FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_jobs;
