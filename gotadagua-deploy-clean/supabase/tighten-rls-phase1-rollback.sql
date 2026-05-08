-- ════════════════════════════════════════════════════════════════════════════
--  ROLLBACK — TIGHTEN RLS PHASE 1
-- ════════════════════════════════════════════════════════════════════════════
--  Restores the original "for all to authenticated using (true)" policy on
--  every table that tighten-rls-phase1.sql split into 4. Use only if the app
--  starts failing for a normal user role and you need to restore the old
--  permissive behaviour while you investigate.
--
--  How to apply: paste into Supabase SQL Editor and run.
-- ════════════════════════════════════════════════════════════════════════════

-- For each table: drop the 4 split policies and recreate the original "all auth" one.

do $$
declare
  t text;
  tables text[] := array[
    'ledger_entries','bookings','partners','partner_month_status',
    'camp_weeks','camp_guests','camp_tab_items',
    'monthly_cost_profiles',
    'instructor_directory','instructor_lessons',
    'location_state_store','location_menus','camp_staff_directory'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "%s_select_auth" on %I',        t, t);
    execute format('drop policy if exists "%s_insert_auth" on %I',        t, t);
    execute format('drop policy if exists "%s_update_auth" on %I',        t, t);
    execute format('drop policy if exists "%s_delete_owner_admin" on %I', t, t);
    execute format('drop policy if exists "%s_all_auth" on %I',           t, t);
    execute format('create policy "%s_all_auth" on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end;
$$;
