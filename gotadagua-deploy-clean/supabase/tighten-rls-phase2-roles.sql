-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 2 : full role-based + location-scoped access control
-- ════════════════════════════════════════════════════════════════════════════
--
--  This builds on Phase 1A/1B (DELETE gate). Phase 2 tightens INSERT and UPDATE
--  on every relevant table so that:
--
--    • OWNER / ADMIN (platform_role)        → can do ANYTHING, anywhere
--    • LOCATION_MANAGER (platform_role)     → can do anything within the
--                                              workspaces they belong to
--    • CAMP_TAB_STAFF / BAR_MAN /           → can read+write ONLY camp_tab
--      HEAD_SOCIAL_HOST (member_role)         tables for their location
--                                              (charge guests, check-outs)
--    • FINANCE (member_role)                → can read+write ledger and
--                                              monthly_cost_profiles for
--                                              their location
--    • VIEWER                               → read-only on their location
--
--  SELECT access stays permissive (any authenticated user can read) — this
--  preserves the current app behaviour and avoids accidental breakage. The
--  meaningful security gain is on writes + deletes, which is where data
--  loss / corruption happens.
--
--  Tables touched:
--    GROUP A — camp tab (anyone with can_edit incl. bar/social/camp_tab):
--      camp_weeks, camp_guests, camp_tab_items, location_menus,
--      camp_staff_directory, location_state_store
--    GROUP B — financial / operational (excludes bar/social):
--      ledger_entries, monthly_cost_profiles
--    GROUP C — instructors module (location-scoped, no bar/social):
--      instructor_directory, instructor_lessons
--    GROUP D — global / cross-location (owner+admin only):
--      bookings, partners, partner_month_status
--
--  How to apply: paste this whole file into Supabase SQL Editor and Run.
--  Idempotent. Safe to re-run.
--
--  How to roll back: each group can be re-opened by running
--  tighten-rls-phase1-rollback.sql + then re-applying phase 1A.
-- ════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
--  HELPER FUNCTIONS
-- ──────────────────────────────────────────────────────────────────────────

-- True if caller has platform_role 'owner' or 'admin' and is active.
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

-- True if caller can EDIT camp tab data at this location.
-- Includes: owner/admin (global), location_manager, finance,
-- AND camp_tab_staff/bar_man/head_social_host (the camp-tab-only roles).
-- Anyone with can_edit = true on a workspace_membership matching this
-- location qualifies.
create or replace function public.can_edit_camp_tab(p_location_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_global_admin() or exists (
    select 1
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.locations  l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
    where m.user_id    = auth.uid()
      and m.active     = true
      and m.can_edit   = true
      and l.id         = p_location_id
  );
$$;

-- True if caller can EDIT financial / operational data at this location.
-- Stricter than can_edit_camp_tab — excludes the camp-tab-only roles.
-- Allowed: owner/admin (global), location_manager, finance.
create or replace function public.can_edit_finance(p_location_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_global_admin() or exists (
    select 1
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.locations  l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
    where m.user_id     = auth.uid()
      and m.active      = true
      and m.can_edit    = true
      and m.member_role in ('owner','admin','location_manager','finance')
      and l.id          = p_location_id
  );
$$;

-- True if caller can EDIT instructor / location-scoped data (excluding
-- finance + camp_tab roles). Allowed: owner/admin (global), location_manager.
create or replace function public.can_edit_location(p_location_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_global_admin() or exists (
    select 1
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    join public.locations  l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
    where m.user_id     = auth.uid()
      and m.active      = true
      and m.can_edit    = true
      and m.member_role in ('owner','admin','location_manager')
      and l.id          = p_location_id
  );
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP A — camp tab tables (bar_man / social_host CAN write)
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
    execute format('drop policy if exists "%s_insert_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role" on public.%I', t, t);
    execute format($p$
      create policy "%s_insert_role" on public.%I for insert to authenticated
      with check (public.can_edit_camp_tab(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_update_role" on public.%I for update to authenticated
      using       (public.can_edit_camp_tab(location_id))
      with check  (public.can_edit_camp_tab(location_id))
    $p$, t, t);
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP B — financial / operational (NO bar/social)
--  Tables: ledger_entries, monthly_cost_profiles
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_b text[] := array['ledger_entries','monthly_cost_profiles'];
begin
  foreach t in array group_b loop
    execute format('drop policy if exists "%s_insert_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role" on public.%I', t, t);
    execute format($p$
      create policy "%s_insert_role" on public.%I for insert to authenticated
      with check (public.can_edit_finance(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_update_role" on public.%I for update to authenticated
      using       (public.can_edit_finance(location_id))
      with check  (public.can_edit_finance(location_id))
    $p$, t, t);
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP C — instructors module (location_manager + global admin only)
--  Tables: instructor_directory, instructor_lessons
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_c text[] := array['instructor_directory','instructor_lessons'];
begin
  foreach t in array group_c loop
    execute format('drop policy if exists "%s_insert_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_role" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_role" on public.%I', t, t);
    execute format($p$
      create policy "%s_insert_role" on public.%I for insert to authenticated
      with check (public.can_edit_location(location_id))
    $p$, t, t);
    execute format($p$
      create policy "%s_update_role" on public.%I for update to authenticated
      using       (public.can_edit_location(location_id))
      with check  (public.can_edit_location(location_id))
    $p$, t, t);
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  GROUP D — global / cross-location (owner+admin only)
--  Tables: bookings, partners, partner_month_status
--  These tables don't have a location_id column (location is stored as a
--  string for partners-app legacy reasons), so location-scoped RLS isn't
--  applicable. Only owner/admin can write.
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  group_d text[] := array['bookings','partners','partner_month_status'];
begin
  foreach t in array group_d loop
    execute format('drop policy if exists "%s_insert_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_auth" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_admin" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_admin" on public.%I', t, t);
    execute format($p$
      create policy "%s_insert_admin" on public.%I for insert to authenticated
      with check (public.is_global_admin())
    $p$, t, t);
    execute format($p$
      create policy "%s_update_admin" on public.%I for update to authenticated
      using       (public.is_global_admin())
      with check  (public.is_global_admin())
    $p$, t, t);
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- After running, paste this to confirm policy counts:
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
-- Expected: every table has exactly 4 policies (select / insert / update /
-- delete). Total 13 tables × 4 = 52 policies.
--
-- ────────────────────────────────────────────────────────────────────────────
--  TEST MATRIX (run these in browser as different users)
-- ────────────────────────────────────────────────────────────────────────────
--
-- 1.  Owner (miguel@gotadaguasurf.com):
--       ✓ Add a ledger entry → succeeds
--       ✓ Delete a ledger entry → succeeds (audit_log row appears)
--       ✓ Add an item to a camp tab → succeeds
--       ✓ Edit a partner row → succeeds
--
-- 2.  Location Manager (e.g. Stephanie at Sri Lanka):
--       ✓ Add a ledger entry FOR Sri Lanka → succeeds
--       ✗ Add a ledger entry FOR Morocco → fails (RLS denies)
--       ✓ Add an item to a Sri Lanka camp tab → succeeds
--       ✗ Edit a partner row → fails (RLS denies, partners is global)
--       ✓ Delete a Sri Lanka ledger entry → succeeds
--
-- 3.  Bar Man (Sri Lanka):
--       ✗ Add a ledger entry → fails (RLS denies, ledger needs finance role)
--       ✓ Add an item to a Sri Lanka camp tab → succeeds
--       ✓ Mark a guest as paid → succeeds
--       ✗ Delete anything → fails (DELETE gated to owner/admin/location_manager)
--       ✗ Touch Morocco data → fails (location mismatch)
-- ════════════════════════════════════════════════════════════════════════════
