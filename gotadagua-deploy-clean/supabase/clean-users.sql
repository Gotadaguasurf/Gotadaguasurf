-- ═══════════════════════════════════════════════════════════
--  CLEAN ALL USERS EXCEPT YOURSELF
--
--  Step 1: Run this query to find YOUR user ID:
--    SELECT id, email FROM auth.users ORDER BY created_at;
--
--  Step 2: Replace 'YOUR-USER-ID-HERE' below with your UUID
--          then run the whole block.
-- ═══════════════════════════════════════════════════════════

-- Set your own user ID here:
do $$
declare
  keep_user_id uuid := 'YOUR-USER-ID-HERE'; -- ← paste your UUID here
begin

  -- Delete all auth users except you (cascades to platform_profiles, memberships)
  delete from auth.users
  where id <> keep_user_id;

  -- Clean workspace tables so they rebuild cleanly
  delete from public.workspace_invitations;
  delete from public.workspace_memberships where user_id <> keep_user_id;
  delete from public.platform_profiles where id <> keep_user_id;

  raise notice 'Done. All users removed except %', keep_user_id;
end;
$$;
