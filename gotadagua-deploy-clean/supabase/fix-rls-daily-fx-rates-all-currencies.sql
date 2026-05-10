-- ════════════════════════════════════════════════════════════════════════════
--  FIX RLS — daily_fx_rates : allow every currency (not just LKR)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why:
--    The Morocco hub fetches and writes the daily MAD/EUR rate, but the
--    existing RLS policies on daily_fx_rates only matched quote_currency='LKR'.
--    Result: every Morocco request to read or upsert MAD comes back as 403
--    (Forbidden) — visible in the browser console as:
--      POST .../rest/v1/daily_fx_rates?on_conflict=... 403 (Forbidden)
--
--    The app silently falls back to whatever rate is cached in localStorage,
--    so it doesn't crash, but the two computers don't share an authoritative
--    MAD rate and the daily Frankfurter refresh never reaches Supabase.
--
--  What changes here:
--    daily_fx_rates becomes a shared reference table (it isn't location-scoped
--    — every location's rate just lives in its own row keyed by
--    (rate_date, base_currency, quote_currency)). Policies are permissive
--    on SELECT / INSERT / UPDATE for any authenticated user, regardless of
--    the quote_currency value. DELETE stays gated to owner/admin (consistent
--    with the rest of the RLS phase-1 tightening — don't let any user wipe
--    historical FX data).
--
--  How to apply:
--    Paste this whole file into the Supabase SQL Editor and run.
--    Idempotent — safe to re-run.
--
--  How to verify after running:
--    1.  In the SQL Editor:
--          select rate_date, base_currency, quote_currency, rate
--          from daily_fx_rates
--          where quote_currency in ('LKR','MAD')
--          order by rate_date desc limit 10;
--        — should return rows for both LKR and MAD.
--
--    2.  In the browser console on gotadaguasurf.vercel.app/camp-hub/?location=morocco
--          await window.fetchFxRateForDate?.('2026-05-09')
--        — should return ~10.7 (MAD per EUR) without throwing.
--
--    3.  Reload the Morocco hub. The console should no longer log
--          Failed to load resource: ... daily_fx_rates ... 403 (Forbidden)
--
--  How to roll back (if anything breaks):
--    drop policy if exists "daily_fx_rates_select_auth" on public.daily_fx_rates;
--    drop policy if exists "daily_fx_rates_insert_auth" on public.daily_fx_rates;
--    drop policy if exists "daily_fx_rates_update_auth" on public.daily_fx_rates;
--    drop policy if exists "daily_fx_rates_delete_owner_admin" on public.daily_fx_rates;
--    — and recreate whatever the previous policies were. The previous LKR-only
--    policies are not preserved here; the assumption is that any allow-LKR
--    rule is strictly less useful than the new allow-all rule.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. Safety: make sure the table exists with the columns the app expects.
--    No-op if it already does. Edge case: a fresh Supabase project that has
--    never run this app would otherwise hit "relation does not exist".
create table if not exists public.daily_fx_rates (
  rate_date       date         not null,
  base_currency   text         not null,
  quote_currency  text         not null,
  rate            numeric      not null,
  source          text,
  created_at      timestamptz  not null default now(),
  primary key (rate_date, base_currency, quote_currency)
);

-- Enable RLS (idempotent — Postgres ignores if already enabled).
alter table public.daily_fx_rates enable row level security;

-- ── 1. Drop every previous policy on this table so we start from a clean slate.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'daily_fx_rates'
  loop
    execute format('drop policy if exists %I on public.daily_fx_rates', pol.policyname);
  end loop;
end $$;

-- ── 2. Create the new permissive policies.
--    SELECT / INSERT / UPDATE: every authenticated user. The rate table is
--    a shared reference, not per-location.
--    DELETE: only owner/admin platform roles — keeps the historical FX log
--    safe from accidental wipes.

create policy "daily_fx_rates_select_auth"
  on public.daily_fx_rates
  for select
  to authenticated
  using (true);

create policy "daily_fx_rates_insert_auth"
  on public.daily_fx_rates
  for insert
  to authenticated
  with check (true);

create policy "daily_fx_rates_update_auth"
  on public.daily_fx_rates
  for update
  to authenticated
  using (true)
  with check (true);

create policy "daily_fx_rates_delete_owner_admin"
  on public.daily_fx_rates
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.platform_profiles
      where id = auth.uid()
        and platform_role in ('owner','admin')
        and active = true
    )
  );

-- ── 3. Diagnostic: show the new policy set so the user can confirm.
--    Comment this out if you want to run the migration silently.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'daily_fx_rates'
order by cmd, policyname;
