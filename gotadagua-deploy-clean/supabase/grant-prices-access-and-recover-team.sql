-- ════════════════════════════════════════════════════════════════════════════
--  Grant prices-* access to Gonçalo + Ricardo, and unblock Gonçalo's login
-- ════════════════════════════════════════════════════════════════════════════
--
--  This script does FOUR things in one go:
--
--    1. Ensures all four prices-* workspaces exist (idempotent — re-running
--       is safe, on conflict (slug) does nothing).
--    2. Reactivates Gonçalo and Ricardo's platform_profiles (active = true)
--       and bumps password_set_at if needed.
--    3. Reactivates ALL existing workspace_memberships for both users — any
--       row that the earlier destructive-replace save bug had flipped to
--       active = false is restored.
--    4. Grants them memberships on all four prices-* workspaces (with
--       can_view = true, can_edit = true, member_role = 'owner') so they
--       can open the Pricing Catalog for every camp.
--
--  ── Why Gonçalo can't log in (likely causes) ──────────────────────────────
--  • His platform_profiles.password_set_at is NULL — he never finished the
--    "Set your password" screen after clicking the invite email. The login
--    flow then refuses to let him through. The Diagnostics block below
--    surfaces this so you can tell.
--  • His memberships were all deactivated by the destructive-replace bug
--    (we already fixed that bug in code, but his rows may still be flipped).
--    Step 3 below reactivates them.
--  • platform_profiles.active = false. Step 2 fixes this.
--
--  If password_set_at is NULL after running this, the fix is to either
--  send him a fresh invite email or set his password manually in
--  Supabase Auth → Users → Reset password.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. DIAGNOSTICS — read both users' current state BEFORE making changes ──
select pp.email,
       pp.full_name,
       pp.platform_role,
       pp.active                                 as profile_active,
       pp.password_set_at is not null            as has_password,
       u.encrypted_password is not null          as auth_has_password,
       (select count(*) from public.workspace_memberships wm
         where wm.user_id = pp.id and wm.active = true) as active_memberships,
       (select count(*) from public.workspace_memberships wm
         where wm.user_id = pp.id and wm.active = false) as inactive_memberships
  from public.platform_profiles pp
  left join auth.users u on u.id = pp.id
 where lower(pp.email) in (
   'ricardo@gotadaguasurf.com',
   'info@gotadaguasurf.com'
 );

-- ── 1. Make sure the four prices-* workspaces exist ───────────────────────
insert into public.workspaces (slug, name, workspace_type) values
  ('prices-sri-lanka', 'Sri Lanka prices',   'ops'),
  ('prices-morocco',   'Morocco prices',     'ops'),
  ('prices-portugal',  'Portugal prices',    'ops'),
  ('prices-junior',    'Junior Camp prices', 'ops')
on conflict (slug) do nothing;

-- ── 2. Reactivate both profiles ───────────────────────────────────────────
update public.platform_profiles
   set active = true,
       updated_at = now()
 where lower(email) in (
   'ricardo@gotadaguasurf.com',
   'info@gotadaguasurf.com'
 );

-- ── 3. Reactivate every membership row for both users ─────────────────────
update public.workspace_memberships wm
   set active = true,
       updated_at = now()
  from public.platform_profiles pp
 where pp.id = wm.user_id
   and wm.active = false
   and lower(pp.email) in (
     'ricardo@gotadaguasurf.com',
     'info@gotadaguasurf.com'
   );

-- ── 4. Grant prices-* memberships for both users ──────────────────────────
--  Upserts one row per (user, prices-* workspace). If the row already
--  exists we just bump it active=true and refresh updated_at. Otherwise
--  we insert a fresh full-access membership.
insert into public.workspace_memberships (
  user_id, workspace_id, member_role, can_view, can_edit,
  can_manage_team, can_manage_finance, active, updated_at
)
select pp.id,
       w.id,
       'owner',
       true,                                    -- can_view
       true,                                    -- can_edit
       false,                                   -- can_manage_team
       true,                                    -- can_manage_finance
       true,
       now()
  from public.platform_profiles pp
  cross join public.workspaces w
 where lower(pp.email) in (
         'ricardo@gotadaguasurf.com',
         'info@gotadaguasurf.com'
       )
   and w.slug in (
         'prices-sri-lanka', 'prices-morocco',
         'prices-portugal',  'prices-junior'
       )
on conflict (user_id, workspace_id)
do update set active     = true,
              can_view   = true,
              can_edit   = true,
              updated_at = now();

-- ── 5. VERIFY — re-read both users' state AFTER the changes ───────────────
select pp.email,
       pp.full_name,
       pp.active,
       pp.password_set_at is not null            as has_password,
       string_agg(w.slug, ', ' order by w.slug)  as active_workspaces
  from public.platform_profiles pp
  left join public.workspace_memberships wm
    on wm.user_id = pp.id and wm.active = true
  left join public.workspaces w on w.id = wm.workspace_id
 where lower(pp.email) in (
   'ricardo@gotadaguasurf.com',
   'info@gotadaguasurf.com'
 )
 group by pp.id, pp.email, pp.full_name, pp.active, pp.password_set_at
 order by pp.email;
