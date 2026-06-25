-- ════════════════════════════════════════════════════════════════════════════
--  CRM v2 — seed team_users for the multi-user rollout
--
--  team_users.id references auth.users(id) — one row per person who logs into
--  the CRM. The app uses these for task ownership (tasks.owner_id) and per-
--  contact assignment (outreach_contacts.account_manager_id).
--
--  How this works in practice:
--    1. Every CRM login is already a Supabase auth user (magic-link / etc.).
--    2. This script inserts a team_users row for each existing auth user
--       that doesn't already have one — name + role default to safe values
--       you can rename later via Supabase Table Editor.
--    3. When the second person signs up (Supabase auth magic-link to their
--       address), re-run this script to add them.
--
--  Idempotent: on conflict (id) do nothing keeps re-runs harmless.
--
--  How to run: paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Seed team_users from auth.users for anyone not already present.
insert into public.team_users (id, full_name, email, role, active)
select
  u.id,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    split_part(u.email, '@', 1)
  ),
  u.email,
  'sales',
  true
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- 2. Backfill tasks.owner_id for any rows still NULL — assigns to the
--    first team user (alphabetical by email) so existing tasks aren't
--    "orphaned". After the new person joins, you can reassign in bulk
--    via the Tasks tab.
update public.tasks t
   set owner_id = (
     select id from public.team_users
     order by email
     limit 1
   )
 where owner_id is null;

-- 3. Backfill outreach_contacts.account_manager_id similarly — first
--    team user becomes default account manager. Reassign as needed.
update public.outreach_contacts
   set account_manager_id = (
     select id from public.team_users
     order by email
     limit 1
   )
 where account_manager_id is null;

-- 4. Verify
select id, email, full_name, role, active from public.team_users order by email;
select count(*) as tasks_with_owner from public.tasks where owner_id is not null;
select count(*) as contacts_with_account_manager from public.outreach_contacts where account_manager_id is not null;
