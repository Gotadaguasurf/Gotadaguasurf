-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 1 : DELETE gate to owner/admin only
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why:
--    Until now every policy was `for all to authenticated using (true) with
--    check (true)` — meaning ANY logged-in user could DELETE the entire ledger,
--    drop bookings, wipe camp weeks, etc. via the Supabase REST API. The role/
--    permission system was only enforced in the browser, which is trivial to
--    bypass with DevTools.
--
--  What changes here:
--    Splits each table's "do anything" policy into 4 separate policies:
--      SELECT  → any authenticated user (unchanged)
--      INSERT  → any authenticated user (unchanged)
--      UPDATE  → any authenticated user (unchanged)
--      DELETE  → only authenticated users with platform_role IN ('owner','admin')
--                AND active = true on platform_profiles
--
--  What does NOT change here:
--    Read access. Insert/update permissions. The Edge Functions (they use
--    service_role and bypass RLS anyway). The auth flow.
--
--  How to apply:
--    Paste this whole file into the Supabase SQL Editor and run.
--    Idempotent — safe to re-run.
--
--  How to roll back (if ANY app function breaks):
--    Run the matching tighten-rls-phase1-rollback.sql file (alongside this).
-- ════════════════════════════════════════════════════════════════════════════

-- Helper predicate: caller is owner/admin and currently active
-- (we inline this in each policy because Postgres needs a stable expression)

-- ── 1. ledger_entries ──────────────────────────────────────────────────────
drop policy if exists "ledger_entries_all_auth"           on ledger_entries;
drop policy if exists "ledger_entries_select_auth"        on ledger_entries;
drop policy if exists "ledger_entries_insert_auth"        on ledger_entries;
drop policy if exists "ledger_entries_update_auth"        on ledger_entries;
drop policy if exists "ledger_entries_delete_owner_admin" on ledger_entries;
create policy "ledger_entries_select_auth"        on ledger_entries for select to authenticated using (true);
create policy "ledger_entries_insert_auth"        on ledger_entries for insert to authenticated with check (true);
create policy "ledger_entries_update_auth"        on ledger_entries for update to authenticated using (true) with check (true);
create policy "ledger_entries_delete_owner_admin" on ledger_entries for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 2. bookings ────────────────────────────────────────────────────────────
drop policy if exists "bookings_all_auth"           on bookings;
drop policy if exists "bookings_select_auth"        on bookings;
drop policy if exists "bookings_insert_auth"        on bookings;
drop policy if exists "bookings_update_auth"        on bookings;
drop policy if exists "bookings_delete_owner_admin" on bookings;
create policy "bookings_select_auth"        on bookings for select to authenticated using (true);
create policy "bookings_insert_auth"        on bookings for insert to authenticated with check (true);
create policy "bookings_update_auth"        on bookings for update to authenticated using (true) with check (true);
create policy "bookings_delete_owner_admin" on bookings for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 3. partners ────────────────────────────────────────────────────────────
drop policy if exists "partners_all_auth"           on partners;
drop policy if exists "partners_select_auth"        on partners;
drop policy if exists "partners_insert_auth"        on partners;
drop policy if exists "partners_update_auth"        on partners;
drop policy if exists "partners_delete_owner_admin" on partners;
create policy "partners_select_auth"        on partners for select to authenticated using (true);
create policy "partners_insert_auth"        on partners for insert to authenticated with check (true);
create policy "partners_update_auth"        on partners for update to authenticated using (true) with check (true);
create policy "partners_delete_owner_admin" on partners for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 4. partner_month_status ────────────────────────────────────────────────
drop policy if exists "partner_month_status_all_auth"           on partner_month_status;
drop policy if exists "partner_month_status_select_auth"        on partner_month_status;
drop policy if exists "partner_month_status_insert_auth"        on partner_month_status;
drop policy if exists "partner_month_status_update_auth"        on partner_month_status;
drop policy if exists "partner_month_status_delete_owner_admin" on partner_month_status;
create policy "partner_month_status_select_auth"        on partner_month_status for select to authenticated using (true);
create policy "partner_month_status_insert_auth"        on partner_month_status for insert to authenticated with check (true);
create policy "partner_month_status_update_auth"        on partner_month_status for update to authenticated using (true) with check (true);
create policy "partner_month_status_delete_owner_admin" on partner_month_status for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 5. camp_weeks / camp_guests / camp_tab_items ───────────────────────────
drop policy if exists "camp_weeks_all_auth"           on camp_weeks;
drop policy if exists "camp_weeks_select_auth"        on camp_weeks;
drop policy if exists "camp_weeks_insert_auth"        on camp_weeks;
drop policy if exists "camp_weeks_update_auth"        on camp_weeks;
drop policy if exists "camp_weeks_delete_owner_admin" on camp_weeks;
create policy "camp_weeks_select_auth"        on camp_weeks for select to authenticated using (true);
create policy "camp_weeks_insert_auth"        on camp_weeks for insert to authenticated with check (true);
create policy "camp_weeks_update_auth"        on camp_weeks for update to authenticated using (true) with check (true);
create policy "camp_weeks_delete_owner_admin" on camp_weeks for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

drop policy if exists "camp_guests_all_auth"           on camp_guests;
drop policy if exists "camp_guests_select_auth"        on camp_guests;
drop policy if exists "camp_guests_insert_auth"        on camp_guests;
drop policy if exists "camp_guests_update_auth"        on camp_guests;
drop policy if exists "camp_guests_delete_owner_admin" on camp_guests;
create policy "camp_guests_select_auth"        on camp_guests for select to authenticated using (true);
create policy "camp_guests_insert_auth"        on camp_guests for insert to authenticated with check (true);
create policy "camp_guests_update_auth"        on camp_guests for update to authenticated using (true) with check (true);
create policy "camp_guests_delete_owner_admin" on camp_guests for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

drop policy if exists "camp_tab_items_all_auth"           on camp_tab_items;
drop policy if exists "camp_tab_items_select_auth"        on camp_tab_items;
drop policy if exists "camp_tab_items_insert_auth"        on camp_tab_items;
drop policy if exists "camp_tab_items_update_auth"        on camp_tab_items;
drop policy if exists "camp_tab_items_delete_owner_admin" on camp_tab_items;
create policy "camp_tab_items_select_auth"        on camp_tab_items for select to authenticated using (true);
create policy "camp_tab_items_insert_auth"        on camp_tab_items for insert to authenticated with check (true);
create policy "camp_tab_items_update_auth"        on camp_tab_items for update to authenticated using (true) with check (true);
create policy "camp_tab_items_delete_owner_admin" on camp_tab_items for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 6. monthly_cost_profiles ───────────────────────────────────────────────
drop policy if exists "monthly_cost_profiles_all_auth"           on monthly_cost_profiles;
drop policy if exists "monthly_cost_profiles_select_auth"        on monthly_cost_profiles;
drop policy if exists "monthly_cost_profiles_insert_auth"        on monthly_cost_profiles;
drop policy if exists "monthly_cost_profiles_update_auth"        on monthly_cost_profiles;
drop policy if exists "monthly_cost_profiles_delete_owner_admin" on monthly_cost_profiles;
create policy "monthly_cost_profiles_select_auth"        on monthly_cost_profiles for select to authenticated using (true);
create policy "monthly_cost_profiles_insert_auth"        on monthly_cost_profiles for insert to authenticated with check (true);
create policy "monthly_cost_profiles_update_auth"        on monthly_cost_profiles for update to authenticated using (true) with check (true);
create policy "monthly_cost_profiles_delete_owner_admin" on monthly_cost_profiles for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 7. instructor_directory / instructor_lessons ───────────────────────────
drop policy if exists "instructor_directory_all_auth"           on instructor_directory;
drop policy if exists "instructor_directory_select_auth"        on instructor_directory;
drop policy if exists "instructor_directory_insert_auth"        on instructor_directory;
drop policy if exists "instructor_directory_update_auth"        on instructor_directory;
drop policy if exists "instructor_directory_delete_owner_admin" on instructor_directory;
create policy "instructor_directory_select_auth"        on instructor_directory for select to authenticated using (true);
create policy "instructor_directory_insert_auth"        on instructor_directory for insert to authenticated with check (true);
create policy "instructor_directory_update_auth"        on instructor_directory for update to authenticated using (true) with check (true);
create policy "instructor_directory_delete_owner_admin" on instructor_directory for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

drop policy if exists "instructor_lessons_all_auth"           on instructor_lessons;
drop policy if exists "instructor_lessons_select_auth"        on instructor_lessons;
drop policy if exists "instructor_lessons_insert_auth"        on instructor_lessons;
drop policy if exists "instructor_lessons_update_auth"        on instructor_lessons;
drop policy if exists "instructor_lessons_delete_owner_admin" on instructor_lessons;
create policy "instructor_lessons_select_auth"        on instructor_lessons for select to authenticated using (true);
create policy "instructor_lessons_insert_auth"        on instructor_lessons for insert to authenticated with check (true);
create policy "instructor_lessons_update_auth"        on instructor_lessons for update to authenticated using (true) with check (true);
create policy "instructor_lessons_delete_owner_admin" on instructor_lessons for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 8. location_state_store ────────────────────────────────────────────────
drop policy if exists "location_state_store_all_auth"           on location_state_store;
drop policy if exists "location_state_store_select_auth"        on location_state_store;
drop policy if exists "location_state_store_insert_auth"        on location_state_store;
drop policy if exists "location_state_store_update_auth"        on location_state_store;
drop policy if exists "location_state_store_delete_owner_admin" on location_state_store;
create policy "location_state_store_select_auth"        on location_state_store for select to authenticated using (true);
create policy "location_state_store_insert_auth"        on location_state_store for insert to authenticated with check (true);
create policy "location_state_store_update_auth"        on location_state_store for update to authenticated using (true) with check (true);
create policy "location_state_store_delete_owner_admin" on location_state_store for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ── 9. location_menus / camp_staff_directory ───────────────────────────────
drop policy if exists "location_menus_all_auth"           on location_menus;
drop policy if exists "location_menus_select_auth"        on location_menus;
drop policy if exists "location_menus_insert_auth"        on location_menus;
drop policy if exists "location_menus_update_auth"        on location_menus;
drop policy if exists "location_menus_delete_owner_admin" on location_menus;
create policy "location_menus_select_auth"        on location_menus for select to authenticated using (true);
create policy "location_menus_insert_auth"        on location_menus for insert to authenticated with check (true);
create policy "location_menus_update_auth"        on location_menus for update to authenticated using (true) with check (true);
create policy "location_menus_delete_owner_admin" on location_menus for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

drop policy if exists "camp_staff_directory_all_auth"           on camp_staff_directory;
drop policy if exists "camp_staff_directory_select_auth"        on camp_staff_directory;
drop policy if exists "camp_staff_directory_insert_auth"        on camp_staff_directory;
drop policy if exists "camp_staff_directory_update_auth"        on camp_staff_directory;
drop policy if exists "camp_staff_directory_delete_owner_admin" on camp_staff_directory;
create policy "camp_staff_directory_select_auth"        on camp_staff_directory for select to authenticated using (true);
create policy "camp_staff_directory_insert_auth"        on camp_staff_directory for insert to authenticated with check (true);
create policy "camp_staff_directory_update_auth"        on camp_staff_directory for update to authenticated using (true) with check (true);
create policy "camp_staff_directory_delete_owner_admin" on camp_staff_directory for delete to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);

-- ════════════════════════════════════════════════════════════════════════════
--  Verification — run after applying:
--    select tablename, policyname, cmd, qual
--    from pg_policies
--    where schemaname='public' and policyname like '%delete_owner_admin'
--    order by tablename;
--  Expected: one row per table from the list above, all with cmd = 'DELETE'.
-- ════════════════════════════════════════════════════════════════════════════
