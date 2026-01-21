-- Set the search path to include extensions schema for vector operators
ALTER DATABASE postgres SET search_path TO public, extensions;

-- Also update the match_documents function with explicit schema reference
DROP FUNCTION IF EXISTS public.match_documents(vector, double precision, integer);

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
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id,
    d.content,
    d.metadata,
    d.file_path,
    d.file_name,
    1 - (d.embedding <=> query_embedding)::double precision AS similarity
  FROM public.documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;