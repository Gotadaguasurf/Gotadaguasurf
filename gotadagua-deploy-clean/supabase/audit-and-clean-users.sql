-- ════════════════════════════════════════════════════════════════════════════
--  AUDIT + CLEAN USERS — keep only miguel@gotadaguasurf.com
-- ════════════════════════════════════════════════════════════════════════════
--
--  This file is split into THREE blocks. Run them ONE AT A TIME and read each
--  result before moving on. Nothing is deleted until you run Block 3 — Block 1
--  and 2 are read-only audits.
--
--  Replace KEEP_EMAIL on line 11 if your owner email is different.
-- ════════════════════════════════════════════════════════════════════════════

-- Configure once — your owner email (kept; everyone else removed)
-- ============================================================================

-- Use this everywhere downstream:
--   '\set' is psql-only. Inside Supabase SQL Editor we just hard-code
--   the email below. Edit this line and re-run if needed.

-- ════════════════════════════════════════════════════════════════════════════
--  BLOCK 1 — AUDIT: who exists in the DB right now? (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--  Run this first. It shows every auth user, their platform profile, and
--  whether they have any active workspace memberships. Confirm the list
--  matches what you expect before any cleanup.

-- All authenticated users
select
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  pp.platform_role,
  pp.active                                       as profile_active,
  (select count(*) from public.workspace_memberships m where m.user_id = u.id and m.active = true) as active_memberships,
  case when u.email = 'miguel@gotadaguasurf.com'  then '✓ KEEP'
       else                                            '✗ DELETE' end  as action
from auth.users u
left join public.platform_profiles pp on pp.id = u.id
order by u.created_at desc;

-- ════════════════════════════════════════════════════════════════════════════
--  BLOCK 2 — AUDIT: what invitations exist (pending and past)? (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--  Lists every invitation. Pending/sent ones with no matching auth.user are
--  candidates for cleanup too — they were sent but never accepted.

select
  i.id,
  i.email,
  i.status,
  i.platform_role,
  i.created_at,
  i.expires_at,
  case when i.expires_at < now() then 'expired' else 'live' end as expires
from public.workspace_invitations i
order by i.created_at desc;

-- ════════════════════════════════════════════════════════════════════════════
--  BLOCK 3 — CLEANUP: delete everyone except your owner email
-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ DESTRUCTIVE. Read the audit blocks above first.
--
--  What this does, in order:
--    1. Cancel every pending/sent invitation (they're stale; you'll re-send).
--    2. Delete workspace_memberships for every non-owner user.
--    3. Delete platform_profiles for every non-owner user.
--    4. Delete auth.users for every non-owner user (cascades any leftover
--       FK references thanks to the schema's ON DELETE CASCADE).
--    5. Re-verify by counting what's left.
--
--  Wrapped in a transaction so if anything fails, nothing is committed.

do $$
declare
  keep_email text  := 'miguel@gotadaguasurf.com';   -- ← edit if your owner email is different
  keep_id    uuid;
  invites_canceled  int;
  memberships_del   int;
  profiles_del      int;
  users_del         int;
begin
  -- Resolve the keeper's UUID
  select id into keep_id from auth.users where email = keep_email;
  if keep_id is null then
    raise exception 'Owner email % not found in auth.users — aborting (no changes made)', keep_email;
  end if;

  -- 1. Cancel every invitation (pending or otherwise). User will re-send fresh.
  update public.workspace_invitations
     set status = 'canceled', updated_at = now()
   where status in ('pending','sent');
  get diagnostics invites_canceled = row_count;

  -- 2. Wipe non-owner workspace_memberships
  delete from public.workspace_memberships where user_id <> keep_id;
  get diagnostics memberships_del = row_count;

  -- 3. Wipe non-owner platform_profiles
  delete from public.platform_profiles where id <> keep_id;
  get diagnostics profiles_del = row_count;

  -- 4. Wipe non-owner auth.users (CASCADE clears any leftover FKs)
  delete from auth.users where id <> keep_id;
  get diagnostics users_del = row_count;

  raise notice
    'Cleanup complete. Kept: % (%). Deleted: % invitations, % memberships, % profiles, % auth users.',
    keep_email, keep_id, invites_canceled, memberships_del, profiles_del, users_del;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  BLOCK 4 — POST-CLEANUP VERIFICATION (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--  Run after Block 3 to confirm only the owner remains. Should show 1 user.

select
  count(*) filter (where email = 'miguel@gotadaguasurf.com')             as owner_present,
  count(*)                                                                as auth_users_total,
  (select count(*) from public.platform_profiles)                         as platform_profiles_total,
  (select count(*) from public.workspace_memberships where active = true) as active_memberships_total,
  (select count(*) from public.workspace_invitations where status in ('pending','sent')) as pending_invites
from auth.users;

-- Expected after cleanup:
--   owner_present                = 1
--   auth_users_total             = 1
--   platform_profiles_total      = 1
--   active_memberships_total     = ≥ 1   (you keep your own memberships)
--   pending_invites              = 0   (all canceled, fresh start for new sends)
