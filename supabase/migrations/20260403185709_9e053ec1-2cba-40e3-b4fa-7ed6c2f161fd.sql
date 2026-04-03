
CREATE POLICY "Public can view messages in shared threads"
ON public.messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.shared_threads
    WHERE shared_threads.thread_id = messages.thread_id
      AND shared_threads.is_active = true
      AND shared_threads.expires_at > now()
  )
);

CREATE POLICY "Public can view shared threads"
ON public.chat_threads FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.shared_threads
    WHERE shared_threads.thread_id = chat_threads.id
      AND shared_threads.is_active = true
      AND shared_threads.expires_at > now()
  )
);
