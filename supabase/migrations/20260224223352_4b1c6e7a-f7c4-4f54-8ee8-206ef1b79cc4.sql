
CREATE OR REPLACE FUNCTION public.match_documents_filtered_v2(
  query_embedding_text text DEFAULT NULL,
  match_threshold double precision DEFAULT 0.15,
  match_count integer DEFAULT 15,
  filter_project text DEFAULT NULL,
  filter_doc_type text DEFAULT NULL,
  filter_file_type text DEFAULT NULL,
  filter_date_from timestamp with time zone DEFAULT NULL,
  filter_date_to timestamp with time zone DEFAULT NULL
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
STABLE
SET search_path TO ''
AS $function$
BEGIN
  IF query_embedding_text IS NOT NULL AND query_embedding_text != '' THEN
    -- Embedding-based search with optional filters
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
      AND (filter_project IS NULL OR d.file_path ILIKE '%/' || filter_project || '/%')
      AND (filter_doc_type IS NULL OR d.metadata->>'doc_type' ILIKE filter_doc_type)
      AND (filter_file_type IS NULL OR d.file_name ILIKE '%.' || filter_file_type)
      AND (filter_date_from IS NULL OR d.created_at >= filter_date_from)
      AND (filter_date_to IS NULL OR d.created_at <= filter_date_to)
    ORDER BY d.embedding OPERATOR(extensions.<=>) query_embedding_text::extensions.vector
    LIMIT match_count;
  ELSE
    -- Browse mode: no embedding, return recent documents matching filters
    RETURN QUERY
    SELECT
      d.id,
      d.content,
      d.metadata,
      d.file_path,
      d.file_name,
      0::double precision AS similarity
    FROM public.documents d
    WHERE
      (filter_project IS NULL OR d.file_path ILIKE '%/' || filter_project || '/%')
      AND (filter_doc_type IS NULL OR d.metadata->>'doc_type' ILIKE filter_doc_type)
      AND (filter_file_type IS NULL OR d.file_name ILIKE '%.' || filter_file_type)
      AND (filter_date_from IS NULL OR d.created_at >= filter_date_from)
      AND (filter_date_to IS NULL OR d.created_at <= filter_date_to)
    ORDER BY d.created_at DESC
    LIMIT match_count;
  END IF;
END;
$function$;
