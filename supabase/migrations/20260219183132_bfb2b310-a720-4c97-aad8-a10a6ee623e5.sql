CREATE OR REPLACE FUNCTION public.get_unindexed_dropbox_files(
  p_extension_filter text DEFAULT NULL,
  p_path_prefix text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  file_path text,
  file_name text,
  file_extension text,
  file_size_bytes bigint,
  dropbox_id text,
  content_hash text,
  dropbox_modified_at timestamptz,
  discovered_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    df.file_path,
    df.file_name,
    df.file_extension,
    df.file_size_bytes,
    df.dropbox_id,
    df.content_hash,
    df.dropbox_modified_at,
    df.discovered_at,
    df.last_seen_at
  FROM dropbox_files df
  LEFT JOIN indexing_status ist ON df.file_path = ist.file_path AND ist.status = 'success'
  WHERE ist.file_path IS NULL
    AND (p_extension_filter IS NULL OR df.file_extension = p_extension_filter)
    AND (p_path_prefix IS NULL OR df.file_path LIKE p_path_prefix || '%')
  ORDER BY df.file_path ASC
  LIMIT CASE WHEN p_limit = 0 THEN NULL ELSE p_limit END
  OFFSET p_offset;
$$;