

# Fix: alias_type CHECK constraint blocking all inserts

## Problem
The `project_aliases` table has a CHECK constraint limiting `alias_type` to only: `owner_name`, `old_name`, `phase_name`, `abbreviation`.

The `detect-project-aliases` function (and the `process-document` hook) insert with `alias_type = 'auto_detected'`, which violates this constraint. Every upsert silently fails.

## Solution

1. **Migration**: Drop the CHECK constraint and either remove it entirely or add `'auto_detected'` to the allowed values. Adding it is safer since the constraint may be intentional for manual entries.

```sql
ALTER TABLE public.project_aliases DROP CONSTRAINT project_aliases_alias_type_check;
ALTER TABLE public.project_aliases ADD CONSTRAINT project_aliases_alias_type_check 
  CHECK (alias_type = ANY (ARRAY['owner_name','old_name','phase_name','abbreviation','auto_detected']));
```

Also drop the duplicate unique constraint (there are two identical ones):
```sql
ALTER TABLE public.project_aliases DROP CONSTRAINT project_aliases_canonical_project_name_alias_name_key;
```

2. **No code changes needed** — both `detect-project-aliases` and `process-document` already use `'auto_detected'` correctly.

## Files
- **New migration** — ALTER the CHECK constraint

