DROP POLICY IF EXISTS "Authenticated users can view web links" ON public.saved_web_links;

CREATE POLICY "Authenticated users can view web links"
  ON public.saved_web_links
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR auth.uid() = added_by
  );