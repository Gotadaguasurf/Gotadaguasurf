-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 3 : area-based access control (the simple model)
-- ════════════════════════════════════════════════════════════════════════════
--
--  This SUPERSEDES Phase 1B and Phase 2 — you don't need to run those.
--  Phase 1A (DELETE gate) and audit-log.sql remain in place; Phase 3 just
--  rewrites the policies on top.
--
--  Mental model (matches the area-pill UI in /index.html settings):
--
--    ┌──────────────────────┬────────────────────────────────────────────────┐
--    │ Area pill ticked     │ workspace_memberships row                      │
--    ├──────────────────────┼────────────────────────────────────────────────┤
--    │ "SRI LANKA"          │ workspace=sri-lanka, can_edit=true (FULL)      │
--    │ "SRI LANKA — CAMP    │ workspace=sri-lanka, can_edit=false            │
--    │  TAB"                │   (camp tab only, no ledger / monthly costs)   │
--    │ "PARTNERS"           │ workspace=partners, can_edit=true              │
--    │ etc.                 │                                                │
--    └──────────────────────┴────────────────────────────────────────────────┘
--
--  Plus: platform_profiles.platform_role = 'owner' | 'admin' grants global
--  access regardless of the pill checks (owners / admins always see and do
--  everything across all locations).
--
--  Resulting access matrix per table category:
--
--    GLOBAL OWNERS (platform_role owner/admin)        → ALL on every table
--    LOCATION FULL (any can_edit=true membership)     → SELECT/INSERT/UPDATE/DELETE
--                                                        on every table for that
--                                                        location
--    LOCATION CAMP TAB ONLY (can_edit=false           → SELECT/INSERT/UPDATE on
--      membership on a camp workspace)                  camp tab tables only;
--                                                        cannot touch ledger /
--                                                        monthly costs / instructors
--    NO MEMBERSHIP                                    → blocked
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
--  HELPER FUNCTIONS
-- ──────────────────────────────────────────────────────────────────────────

-- Caller has platform_role 'owner' or 'admin' and is active.
create or replace function public.is_global_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.platform_profiles
    where id = auth.uid()
      and platform_role in ('owner','admin')
      and active = true
  );
$$;

-- Caller has ANY active workspace_membership for this location.
-- Returns true for both "SRI LANKA" and "SRI LANKA — CAMP TAB" pill access.
-- Used to grant camp tab read/write to bar/social/host roles.
create or replace function public.has_location_access(p_location_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_global_admin() or exists (
    select 1
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.locations  l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
    where m.user_id = auth.uid()
      and m.active  = true
      and l.id      = p_location_id
  );
$$;

-- Caller has FULL (can_edit=true) workspace_membership for this location.
-- Used to grant ledger / monthly costs / instructors / DELETE access to
-- only the "SRI LANKA" pill — NOT the "SRI LANKA — CAMP TAB" pill.
create or replace function public.has_full_location_access(p_location_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_global_admin() or exists (
    select 1
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.locations  l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
    where m.user_id  = auth.uid()
      and m.active   = true
      and m.can_edit = true
      and l.id       = p_location_id
  );
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP A — camp tab tables (full access AND camp-tab-only pills can write)
--  Tables: camp_weeks, camp_guests, camp_tab_items, location_menus,
--          camp_staff_directory, location_state_store
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_a text[] := array[
    'camp_weeks','camp_guests','camp_tab_items',
    'location_menus','camp_staff_directory','location_state_store'
  ];
begin
  foreach t in array group_a loop
    -- drop every previous variant
    execute format('drop policy if exists "%s_all_auth"            on public.%I', t, t);
    execute format('drop policy if exists "%s_select_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_owner_admin"  on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_managers"     on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role"         on public.%I', t, t);
    -- create the 4 area-based policies
    execute format('create policy "%s_select_auth" on public.%I for select to authenticated using (true)', t, t);
    execute format($p$
      create policy "%s_insert_area" on public.%I for insert to authenticated
      with check (public.has_location_access(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_update_area" on public.%I for update to authenticated
      using       (public.has_location_access(location_id))
      with check  (public.has_location_access(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_delete_full" on public.%I for delete to authenticated
      using (public.has_full_location_access(location_id))
    $p$, t, t);
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP B — financial / operational (camp-tab-only blocked)
--  Tables: ledger_entries, monthly_cost_profiles
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_b text[] := array['ledger_entries','monthly_cost_profiles'];
begin
  foreach t in array group_b loop
    execute format('drop policy if exists "%s_all_auth"            on public.%I', t, t);
    execute format('drop policy if exists "%s_select_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_owner_admin"  on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_managers"     on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role"         on public.%I', t, t);
    execute format('create policy "%s_select_auth" on public.%I for select to authenticated using (true)', t, t);
    execute format($p$
      create policy "%s_insert_full" on public.%I for insert to authenticated
      with check (public.has_full_location_access(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_update_full" on public.%I for update to authenticated
      using       (public.has_full_location_access(location_id))
      with check  (public.has_full_location_access(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_delete_full" on public.%I for delete to authenticated
      using (public.has_full_location_access(location_id))
    $p$, t, t);
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP C — instructors module (full pill only)
--  Tables: instructor_directory, instructor_lessons
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_c text[] := array['instructor_directory','instructor_lessons'];
begin
  foreach t in array group_c loop
    execute format('drop policy if exists "%s_all_auth"            on public.%I', t, t);
    execute format('drop policy if exists "%s_select_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_owner_admin"  on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_managers"     on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role"         on public.%I', t, t);
    execute format('create policy "%s_select_auth" on public.%I for select to authenticated using (true)', t, t);
    execute format($p$
      create policy "%s_insert_full" on public.%I for insert to authenticated
      with check (public.has_full_location_access(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_update_full" on public.%I for update to authenticated
      using       (public.has_full_location_access(location_id))
      with check  (public.has_full_location_access(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_delete_full" on public.%I for delete to authenticated
      using (public.has_full_location_access(location_id))
    $p$, t, t);
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP D — global / cross-location (owner+admin only)
--  Tables: bookings, partners, partner_month_status
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_d text[] := array['bookings','partners','partner_month_status'];
begin
  foreach t in array group_d loop
    execute format('drop policy if exists "%s_all_auth"            on public.%I', t, t);
    execute format('drop policy if exists "%s_select_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth"         on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_owner_admin"  on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_managers"     on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role"         on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role"         on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_admin"        on public.%I', t, t);
    execute format('drop policy if exists "%s_update_admin"        on public.%I', t, t);
    execute format('create policy "%s_select_auth" on public.%I for select to authenticated using (true)', t, t);
    execute format($p$
      create policy "%s_insert_admin" on public.%I for insert to authenticated
      with check (public.is_global_admin())
    $p$, t, t);
    execute format($p$
      create policy "%s_update_admin" on public.%I for update to authenticated
      using       (public.is_global_admin())
      with check  (public.is_global_admin())
    $p$, t, t);
    execute format($p$
      create policy "%s_delete_admin" on public.%I for delete to authenticated
      using (public.is_global_admin())
    $p$, t, t);
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- After running, paste this to confirm every protected table has 4 policies:
--
--   select tablename, count(*) as policy_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in (
--       'camp_weeks','camp_guests','camp_tab_items',
--       'location_menus','camp_staff_directory','location_state_store',
--       'ledger_entries','monthly_cost_profiles',
--       'instructor_directory','instructor_lessons',
--       'bookings','partners','partner_month_status'
--     )
--   group by tablename order by tablename;
--
-- Expected: 13 rows, each with policy_count = 4. Total 52 policies.
-- ════════════════════════════════════════════════════════════════════════════
