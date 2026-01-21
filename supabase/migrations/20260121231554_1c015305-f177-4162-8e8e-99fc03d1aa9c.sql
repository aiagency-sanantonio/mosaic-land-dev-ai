-- Create indexing_status table to track file processing
CREATE TABLE public.indexing_status (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  chunks_created INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  indexed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.indexing_status ENABLE ROW LEVEL SECURITY;

-- Service role can manage indexing status
CREATE POLICY "Service role can manage indexing status"
ON public.indexing_status
FOR ALL
USING (true)
WITH CHECK (true);

-- Authenticated users can view indexing status
CREATE POLICY "Authenticated users can view indexing status"
ON public.indexing_status
FOR SELECT
USING (auth.role() = 'authenticated');

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_indexing_status_updated_at
BEFORE UPDATE ON public.indexing_status
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create match_documents_with_filters function for filtered semantic search
CREATE OR REPLACE FUNCTION public.match_documents_with_filters(
  query_embedding_text TEXT,
  match_threshold DOUBLE PRECISION DEFAULT 0.15,
  match_count INTEGER DEFAULT 20,
  filter_project TEXT DEFAULT NULL,
  filter_file_type TEXT DEFAULT NULL,
  filter_date_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  filter_date_to TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  metadata JSONB,
  file_path TEXT,
  file_name TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    d.file_path,
    d.file_name,
    1 - (d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector)::double precision AS similarity
  FROM public.documents d
  WHERE 
    1 - (d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector) > match_threshold
    AND (filter_project IS NULL OR d.metadata->>'project_name' ILIKE '%' || filter_project || '%')
    AND (filter_file_type IS NULL OR d.file_name ILIKE '%.' || filter_file_type)
    AND (filter_date_from IS NULL OR d.created_at >= filter_date_from)
    AND (filter_date_to IS NULL OR d.created_at <= filter_date_to)
  ORDER BY d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector
  LIMIT match_count;
END;
$$;