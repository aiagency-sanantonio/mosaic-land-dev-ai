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
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.name)), '[]'::jsonb)
      FROM (
        SELECT DISTINCT split_part(file_path, '/', 3) AS name
        FROM documents
        WHERE file_path LIKE '/1-Projects/%'
          AND split_part(file_path, '/', 3) != ''
        ORDER BY name
      ) p
    ),
    'doc_types', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', d.type)), '[]'::jsonb)
      FROM (
        SELECT DISTINCT metadata->>'doc_type' AS type
        FROM documents
        WHERE metadata->>'doc_type' IS NOT NULL
        ORDER BY type
      ) d
    ),
    'file_types', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('extension', f.extension)), '[]'::jsonb)
      FROM (
        SELECT DISTINCT lower(regexp_replace(file_name, '.*\.', '')) AS extension
        FROM documents
        WHERE file_name IS NOT NULL
          AND file_name LIKE '%.%'
        ORDER BY extension
      ) f
    )
  ) INTO result;
  
  RETURN result;
END;
$$;