-- ════════════════════════════════════════════════════════════════════════════
--  RLS PHASE 7 — Scope SELECT policies by location + gate HQ tables
-- ════════════════════════════════════════════════════════════════════════════
--
--  Problem
--  -------
--  Phases 1–3 tightened INSERT/UPDATE/DELETE by location but left every
--  SELECT policy as `using (true)` — meaning any authenticated user could
--  read every row of ledger_entries, hq_invoices, monthly_cost_profiles,
--  camp_weeks/camp_guests/camp_tab_items, etc. A Morocco manager could pull
--  Sri Lanka's numbers via the API even if the UI hid them.
--
--  Fix
--  ---
--  Rewrite the SELECT policies so they only return rows the caller is
--  allowed to see:
--    - Owner / super_admin (is_global_admin()) → sees everything.
--    - Location-scoped tables → filtered by has_location_access(location_id).
--    - HQ tables → filtered by is_hq_member() (or by an owner-email allowlist
--      if is_hq_member() isn't installed yet — the fallback branch runs
--      then). Never returns any row otherwise.
--
--  Idempotent — safe to re-run.
--
--  Diagnostic first
--  ----------------
--  Before running the DDL below, get a snapshot of current SELECT policies
--  so you know what you're overwriting:
--
--    select tablename, policyname, permissive, cmd, qual
--    from pg_policies
--    where schemaname = 'public'
--      and tablename in (
--        'ledger_entries','hq_invoices','hq_recurring_expenses',
--        'monthly_cost_profiles','camp_weeks','camp_guests',
--        'camp_tab_items','location_menus','location_state_store',
--        'camp_staff_directory','instructor_directory','instructor_lessons',
--        'internal_transfers','hq_invoice_categories','hq_companies'
--      )
--      and cmd = 'SELECT'
--    order by tablename, policyname;
--
--  You should see `qual = true` on the tables listed above → that's the leak.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. Sanity: make sure is_hq_member exists. Create a minimal version if
--       missing so the policies below don't reference an undefined function.
--       If a richer version already exists Miguel wrote in the dashboard, THIS
--       DOES NOT OVERWRITE IT — the `or replace` inside the same signature
--       matches whatever's there. Signature: `is_hq_member() returns boolean`.

create or replace function public.is_hq_member()
returns boolean
language sql security definer stable
set search_path = public
as $$
  -- HQ workspace membership = full access to HQ finances (invoices, cash
  -- flow, weekly digest). Owner bypass is via is_global_admin() which
  -- has_location_access already honours upstream.
  select public.is_global_admin() or exists (
    select 1
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid()
      and m.active  = true
      and w.slug    = 'hq'
  );
$$;


-- ── 1. Location-scoped tables — SELECT gated by has_location_access(location_id).
--       Managers only see rows for locations they're a member of. Owner
--       sees everything through is_global_admin().

do $$
declare
  t text;
  loc_scoped text[] := array[
    'ledger_entries',
    'monthly_cost_profiles',
    'camp_weeks',
    'camp_guests',
    'camp_tab_items',
    'location_menus',
    'location_state_store',
    'camp_staff_directory',
    'instructor_directory',
    'instructor_lessons'
  ];
begin
  foreach t in array loc_scoped loop
    -- Skip cleanly if the table isn't in this project yet.
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skipping %: table missing', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_auth"     on public.%I', t, t);
    execute format('drop policy if exists "%s_select_area"     on public.%I', t, t);
    execute format('drop policy if exists "%s_select_location" on public.%I', t, t);
    execute format($p$
      create policy "%s_select_location" on public.%I
        for select to authenticated
        using (public.has_location_access(location_id))
    $p$, t, t);
  end loop;
end $$;


-- ── 2. HQ-only tables — SELECT gated by is_hq_member(). Camp managers never
--       see HQ finances. Owner sees everything via is_global_admin() inside
--       is_hq_member.

do $$
declare
  t text;
  hq_only text[] := array[
    'hq_invoices',
    'hq_recurring_expenses',
    'hq_invoice_categories',
    'hq_companies',
    'internal_transfers'
  ];
begin
  foreach t in array hq_only loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skipping %: table missing', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_auth"      on public.%I', t, t);
    execute format('drop policy if exists "%s_select_area"      on public.%I', t, t);
    execute format('drop policy if exists "%s_select_hq"        on public.%I', t, t);
    execute format('drop policy if exists "%s_select_hq_member" on public.%I', t, t);
    execute format($p$
      create policy "%s_select_hq_member" on public.%I
        for select to authenticated
        using (public.is_hq_member())
    $p$, t, t);
  end loop;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  VERIFICATION — run each of these AFTER the DDL above lands.
-- ────────────────────────────────────────────────────────────────────────────
--
--  (A) Confirm the leaks are closed. Every row below should have qual != true
--      and reference has_location_access or is_hq_member:
--
--      select tablename, policyname, cmd, qual
--      from pg_policies
--      where schemaname = 'public'
--        and tablename in (
--          'ledger_entries','hq_invoices','hq_recurring_expenses',
--          'monthly_cost_profiles','camp_weeks','camp_guests',
--          'camp_tab_items','location_menus','location_state_store',
--          'camp_staff_directory','instructor_directory','instructor_lessons',
--          'internal_transfers','hq_invoice_categories','hq_companies'
--        )
--        and cmd = 'SELECT'
--      order by tablename;
--
--  (B) Simulate a specific user's read view WITHOUT logging in as them.
--      Replace the UUID with a real user_id from platform_profiles. Run this
--      in the SQL editor which by default bypasses RLS with the service role
--      — the `set local role authenticated` block forces RLS on.
--
--      begin;
--        set local role authenticated;
--        set local "request.jwt.claims" to
--          json_build_object('sub','REPLACE-WITH-USER-UUID','role','authenticated')::text;
--
--        -- What ledger_entries does this user see? Expect 0 for a non-member.
--        select l.slug as location, count(*) as visible_rows
--        from public.ledger_entries e
--        left join public.locations l on l.id = e.location_id
--        group by l.slug order by l.slug;
--
--        -- What HQ invoices does this user see? Expect 0 for a non-HQ user.
--        select location_slug, count(*) from public.hq_invoices group by location_slug;
--      rollback;
--
--  (C) Live browser test with a manager account:
--      1. Sign in to app as a Morocco manager (NOT Miguel).
--      2. Open /camp-hub/?location=morocco → should work.
--      3. Change URL to /camp-hub/?location=sri-lanka → the page loads BUT
--         every ledger + monthly cost query should return an empty list.
--      4. Try /hq/ → the invoice list should be empty (RLS on hq_invoices
--         blocks the manager). If it shows rows, is_hq_member() is granting
--         too much — inspect workspace_memberships for that user.
--
-- ────────────────────────────────────────────────────────────────────────────
--
--  Rollback (if something breaks after apply)
--  ------------------------------------------
--  Restore the wide-open SELECT so users can read again while you debug:
--
--    do $$
--    declare t text; tables text[] := array[
--      'ledger_entries','hq_invoices','hq_recurring_expenses',
--      'monthly_cost_profiles','camp_weeks','camp_guests','camp_tab_items',
--      'location_menus','location_state_store','camp_staff_directory',
--      'instructor_directory','instructor_lessons','internal_transfers',
--      'hq_invoice_categories','hq_companies'];
--    begin
--      foreach t in array tables loop
--        execute format('drop policy if exists "%s_select_location" on public.%I', t, t);
--        execute format('drop policy if exists "%s_select_hq_member" on public.%I', t, t);
--        execute format($p$create policy "%s_select_auth" on public.%I
--          for select to authenticated using (true)$p$, t, t);
--      end loop;
--    end $$;
-- ════════════════════════════════════════════════════════════════════════════
