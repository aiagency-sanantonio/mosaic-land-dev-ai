
-- Create the dropbox_files table
CREATE TABLE public.dropbox_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_path text NOT NULL UNIQUE,
  file_name text,
  file_extension text,
  file_size_bytes bigint,
  dropbox_id text,
  content_hash text,
  dropbox_modified_at timestamp with time zone,
  discovered_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dropbox_files ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view
CREATE POLICY "Authenticated users can view dropbox files"
ON public.dropbox_files
FOR SELECT
USING (auth.role() = 'authenticated');

-- Service role can manage everything
CREATE POLICY "Service role can manage dropbox files"
ON public.dropbox_files
FOR ALL
USING (true)
WITH CHECK (true);

-- Index for common query patterns
CREATE INDEX idx_dropbox_files_file_extension ON public.dropbox_files (file_extension);
CREATE INDEX idx_dropbox_files_last_seen_at ON public.dropbox_files (last_seen_at);
CREATE INDEX idx_dropbox_files_dropbox_id ON public.dropbox_files (dropbox_id);

-- Auto-update updated_at
CREATE TRIGGER update_dropbox_files_updated_at
BEFORE UPDATE ON public.dropbox_files
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
