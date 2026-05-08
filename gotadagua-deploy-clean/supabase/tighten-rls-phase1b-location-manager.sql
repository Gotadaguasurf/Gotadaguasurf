-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 1B : extend DELETE to location_manager on camp tables
-- ════════════════════════════════════════════════════════════════════════════
--
--  Phase 1A allowed only owner+admin to DELETE on every table. Location
--  managers run a specific camp day-to-day and need to fix bad ledger
--  entries, remove a guest typo from a closed week, etc. without bothering
--  the owner.
--
--  This script splits the 13 tables into TWO groups:
--
--    GROUP A — operational, location-bound
--      Anyone with platform_role IN ('owner','admin','location_manager')
--      can DELETE. Use case: fix typos in the camp's ledger, remove a wrong
--      camp tab item, clean up a stale staff entry.
--      Tables: ledger_entries, camp_weeks, camp_guests, camp_tab_items,
--              location_state_store, location_menus, camp_staff_directory,
--              monthly_cost_profiles, instructor_directory, instructor_lessons
--
--    GROUP B — cross-location, financially sensitive
--      Only owner+admin can DELETE. Location managers must NOT delete a
--      partner row, a booking, or a partner status because those affect
--      commission calculations across every location.
--      Tables: bookings, partners, partner_month_status
--
--  All deletes — both groups — continue to write to audit_log via the
--  trigger installed in audit-log.sql, so even owner deletes are tracked.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Group A: location_manager allowed ──────────────────────────────────────
do $$
declare
  t text;
  group_a text[] := array[
    'ledger_entries',
    'camp_weeks','camp_guests','camp_tab_items',
    'monthly_cost_profiles',
    'instructor_directory','instructor_lessons',
    'location_state_store','location_menus','camp_staff_directory'
  ];
begin
  foreach t in array group_a loop
    execute format('drop policy if exists "%s_delete_owner_admin"   on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_managers"      on public.%I', t, t);
    execute format($p$
      create policy "%s_delete_managers" on public.%I for delete to authenticated using (
        exists (select 1 from public.platform_profiles
                where id = auth.uid()
                  and platform_role in ('owner','admin','location_manager')
                  and active = true)
      )
    $p$, t, t);
  end loop;
end;
$$;

-- ── Group B: still owner+admin only ────────────────────────────────────────
-- (no change needed — phase-1a policies already enforce this. Re-asserted
--  here so this script is self-contained and idempotent.)
do $$
declare
  t text;
  group_b text[] := array['bookings','partners','partner_month_status'];
begin
  foreach t in array group_b loop
    execute format('drop policy if exists "%s_delete_owner_admin" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_managers"    on public.%I', t, t);
    execute format($p$
      create policy "%s_delete_owner_admin" on public.%I for delete to authenticated using (
        exists (select 1 from public.platform_profiles
                where id = auth.uid()
                  and platform_role in ('owner','admin')
                  and active = true)
      )
    $p$, t, t);
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Verification — run after applying:
--
--    select tablename, policyname,
--           case when qual like '%location_manager%' then 'A: managers'
--                else 'B: owner+admin only' end as scope
--    from pg_policies
--    where schemaname='public'
--      and (policyname like '%delete_owner_admin' or policyname like '%delete_managers')
--    order by scope, tablename;
--
--  Expected: 10 rows in scope "A: managers", 3 rows in scope "B: owner+admin
--  only", total 13.
-- ════════════════════════════════════════════════════════════════════════════
