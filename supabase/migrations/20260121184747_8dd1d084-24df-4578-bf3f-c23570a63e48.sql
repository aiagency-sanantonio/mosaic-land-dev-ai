-- Create a wrapper function that accepts text and casts to vector
DROP FUNCTION IF EXISTS public.match_documents_text(text, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_documents_text(
  query_embedding_text text,
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
SET search_path = ''
AS $$
  SELECT
    d.id,
    d.content,
    d.metadata,
    d.file_path,
    d.file_name,
    1 - (d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector)::double precision AS similarity
  FROM public.documents d
  WHERE 1 - (d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector) > match_threshold
  ORDER BY d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector
  LIMIT match_count;
$$;