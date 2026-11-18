-- ════════════════════════════════════════════════════════════════════════════
--  Camp Tab audit fixes, 18 Nov 2026 (w3-camptab) — audit_log read policy, as it is LIVE
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why this file: Camp Tab → Activity now lists lines removed from a tab (CT-05). It reads
--  audit_log (the copy the delete trigger keeps of every removed camp_tab_items / camp_guests
--  row). Production already lets owners/admins read everything, and full-access accounts of a
--  location (not local managers) read that location's ledger / Camp Tab deletes. That policy
--  is NOT in the repo: supabase/audit-log.sql still creates the older owner/admin-only one, so
--  re-running audit-log.sql would quietly hide «removed» lines from camp managers.
--
--  What it does: re-creates exactly the live policy (read on 18 Nov 2026 from pg_policies).
--  Running it changes nothing in production today; it only puts the live rule in the repo.
--  Optional. Idempotent. The page works the same whether or not this is run.
--
--  Who may see removed lines is Miguel's decision: to also show them to local managers,
--  drop the «and not is_local_manager(...)» line below (not done here).
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "audit_log_read_owner_admin" on public.audit_log;
create policy "audit_log_read_owner_admin" on public.audit_log for select to authenticated using (
  exists (select 1 from public.platform_profiles
          where platform_profiles.id = auth.uid()
            and platform_profiles.platform_role = any (array['owner','admin','super_admin'])
            and platform_profiles.active)
  or (
    table_name = any (array['ledger_entries','camp_tab_items','camp_guests'])
    and (deleted_row->>'location_id') is not null
    and public.has_full_location_access((deleted_row->>'location_id')::uuid)
    and not public.is_local_manager((deleted_row->>'location_id')::uuid)
  )
);

-- Check (expect one row, same text as before running):
--   select policyname, qual from pg_policies where tablename = 'audit_log';
