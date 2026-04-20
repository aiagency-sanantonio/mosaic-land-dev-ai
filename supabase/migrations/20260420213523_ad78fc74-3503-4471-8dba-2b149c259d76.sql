CREATE OR REPLACE FUNCTION public.get_documents_storage_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_size_bytes', pg_total_relation_size('public.documents'),
    'total_size_pretty', pg_size_pretty(pg_total_relation_size('public.documents')),
    'table_size_bytes', pg_relation_size('public.documents'),
    'index_size_bytes', pg_indexes_size('public.documents'),
    'chunk_count', (SELECT count(*) FROM public.documents),
    'unique_files', (SELECT count(DISTINCT file_path) FROM public.documents WHERE file_path IS NOT NULL),
    'chunks_last_7d', (SELECT count(*) FROM public.documents WHERE created_at >= now() - interval '7 days'),
    'chunks_last_24h', (SELECT count(*) FROM public.documents WHERE created_at >= now() - interval '24 hours')
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_bloated_files(p_limit integer DEFAULT 10)
RETURNS TABLE(file_path text, file_name text, chunk_count bigint, total_content_bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    file_path,
    max(file_name) AS file_name,
    count(*)::bigint AS chunk_count,
    sum(length(content))::bigint AS total_content_bytes
  FROM public.documents
  WHERE file_path IS NOT NULL
  GROUP BY file_path
  ORDER BY chunk_count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_documents_storage_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_bloated_files(integer) TO authenticated;