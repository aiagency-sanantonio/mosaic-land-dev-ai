
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-uploads', 'user-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read their own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Service role full access to user-uploads"
ON storage.objects
FOR ALL
USING (bucket_id = 'user-uploads')
WITH CHECK (bucket_id = 'user-uploads');
