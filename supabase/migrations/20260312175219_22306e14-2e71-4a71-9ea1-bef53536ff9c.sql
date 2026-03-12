ALTER TABLE public.project_aliases DROP CONSTRAINT IF EXISTS project_aliases_alias_type_check;
ALTER TABLE public.project_aliases ADD CONSTRAINT project_aliases_alias_type_check 
  CHECK (alias_type = ANY (ARRAY['owner_name','old_name','phase_name','abbreviation','auto_detected']));
ALTER TABLE public.project_aliases DROP CONSTRAINT IF EXISTS project_aliases_canonical_project_name_alias_name_key;