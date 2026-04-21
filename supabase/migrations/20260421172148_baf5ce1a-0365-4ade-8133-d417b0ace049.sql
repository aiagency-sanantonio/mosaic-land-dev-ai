DROP POLICY IF EXISTS "Users can update own web links" ON public.saved_web_links;

CREATE POLICY "Users can update own web links"
  ON public.saved_web_links
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = added_by)
  WITH CHECK (auth.uid() = added_by);