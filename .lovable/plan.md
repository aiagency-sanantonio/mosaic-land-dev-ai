

## Why deletes fail

The UI's "delete" is a soft-delete (`UPDATE saved_web_links SET is_active = false`). The UPDATE RLS policy has a `USING` clause but no `WITH CHECK`, so Postgres re-checks the new row against the SELECT policy (`is_active = true`). Flipping `is_active` to false fails that check → "new row violates row-level security policy".

## Fix

Add an explicit `WITH CHECK` to the UPDATE policy so the post-update row only needs to belong to the user, regardless of `is_active`:

```sql
DROP POLICY "Users can update own web links" ON public.saved_web_links;

CREATE POLICY "Users can update own web links"
  ON public.saved_web_links
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = added_by)
  WITH CHECK (auth.uid() = added_by);
```

That's the entire fix — one migration, no code changes. Owner can soft-delete (or update) their own link without the SELECT-policy fallback blocking it.

## Verification

After the migration:
1. Reload `/weblinks`
2. Hover a link you added → click the trash icon
3. Toast should read "Link removed" and the card disappears

## Why not just hard-delete?

The hard-delete policy (`Users can delete own web links`) already exists and would also work. But soft-delete preserves history (e.g., `last_researched_at`, audit trail) and is what the codebase is built around. Fixing the policy is the right move.

