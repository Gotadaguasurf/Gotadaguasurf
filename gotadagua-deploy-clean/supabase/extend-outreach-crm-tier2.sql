-- ════════════════════════════════════════════════════════════════════════════
--  EXTEND OUTREACH CRM — Tier 2 additions
--
--  Adds deal-tracking columns to outreach_contacts and a new
--  outreach_saved_views table so the user can persist filter combinations
--  (e.g. "Hot leads in Portugal") as named views.
--
--  Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Deal columns on outreach_contacts ────────────────────────────────────
alter table public.outreach_contacts
  add column if not exists deal_value numeric,            -- € estimated value if closed
  add column if not exists probability integer,           -- 0-100, % chance of close
  add column if not exists expected_close_date date,      -- when we expect it to close
  add column if not exists lost_reason text;              -- free-form why-we-lost

-- Optional constraint: probability between 0 and 100.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_contacts_probability_chk'
  ) then
    alter table public.outreach_contacts
      add constraint outreach_contacts_probability_chk
      check (probability is null or (probability >= 0 and probability <= 100));
  end if;
end$$;

-- Indexes for pipeline-value queries and expected-close calendars.
create index if not exists idx_outreach_contacts_expected_close
  on public.outreach_contacts(expected_close_date)
  where expected_close_date is not null;

create index if not exists idx_outreach_contacts_deal_value
  on public.outreach_contacts(deal_value)
  where deal_value is not null;

-- ── 2. outreach_saved_views ─────────────────────────────────────────────────
-- Persists filter+preset combinations the user wants to return to. The
-- `filters` jsonb holds: { preset, status, country, segment, search }.
-- We deliberately do NOT scope by user — single-operator app right now.
create table if not exists public.outreach_saved_views (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  filters      jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text
);

create unique index if not exists uq_outreach_saved_views_name
  on public.outreach_saved_views(lower(name));

create or replace function public.outreach_saved_views_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_outreach_saved_views_updated_at on public.outreach_saved_views;
create trigger trg_outreach_saved_views_updated_at
  before update on public.outreach_saved_views
  for each row execute function public.outreach_saved_views_set_updated_at();

alter table public.outreach_saved_views enable row level security;

drop policy if exists "authenticated full access on outreach_saved_views"
  on public.outreach_saved_views;
create policy "authenticated full access on outreach_saved_views"
  on public.outreach_saved_views
  for all to authenticated
  using (true) with check (true);

-- ── Verification ────────────────────────────────────────────────────────────
--    select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='outreach_contacts'
--      and column_name in ('deal_value','probability','expected_close_date','lost_reason');
--    -- 4 rows expected.
--
--    select count(*) from public.outreach_saved_views;
--    -- 0 rows expected (empty until user saves a view).
