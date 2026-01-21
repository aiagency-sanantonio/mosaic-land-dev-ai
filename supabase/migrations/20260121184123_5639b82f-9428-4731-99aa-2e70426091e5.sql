-- Drop and recreate the match_documents function with proper vector type casting
DROP FUNCTION IF EXISTS public.match_documents(extensions.vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.78,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  content text,
  metadata jsonb,
  file_path text,
  file_name text,
  similarity double precision
)
LANGUAGE plpgsql
SET search_path = 'public, extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    d.file_path,
    d.file_name,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;