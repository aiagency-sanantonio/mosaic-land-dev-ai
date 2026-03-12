CREATE OR REPLACE FUNCTION public.get_filter_options()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'projects', (
      SELECT jsonb_agg(row_to_json(p))
      FROM (
        SELECT 
          split_part(file_path, '/', 3) AS name,
          count(*)::int AS chunk_count
        FROM documents
        WHERE file_path LIKE '/1-Projects/%'
          AND split_part(file_path, '/', 3) != ''
        GROUP BY split_part(file_path, '/', 3)
        ORDER BY split_part(file_path, '/', 3)
      ) p
    ),
    'doc_types', (
      SELECT jsonb_agg(row_to_json(d))
      FROM (
        SELECT 
          metadata->>'doc_type' AS type,
          count(*)::int AS chunk_count
        FROM documents
        WHERE metadata->>'doc_type' IS NOT NULL
        GROUP BY metadata->>'doc_type'
        ORDER BY metadata->>'doc_type'
      ) d
    ),
    'file_types', (
      SELECT jsonb_agg(row_to_json(f))
      FROM (
        SELECT 
          lower(regexp_replace(file_name, '.*\.', '')) AS extension,
          count(*)::int AS chunk_count
        FROM documents
        WHERE file_name IS NOT NULL
          AND file_name LIKE '%.%'
        GROUP BY lower(regexp_replace(file_name, '.*\.', ''))
        ORDER BY lower(regexp_replace(file_name, '.*\.', ''))
      ) f
    )
  ) INTO result;
  
  RETURN result;
END;
$$;