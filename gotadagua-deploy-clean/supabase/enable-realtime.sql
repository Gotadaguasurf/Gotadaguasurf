-- ═══════════════════════════════════════════════════════════
--  RUN THIS IN SUPABASE SQL EDITOR
--  1. Creates location_state_store (if not exists)
--  2. Adds missing columns to ledger_entries
--  3. Enables Realtime on all live-sync tables
-- ═══════════════════════════════════════════════════════════

-- 1. location_state_store (key-value JSON store per location)
create table if not exists public.location_state_store (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  state_key text not null,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (location_id, state_key)
);
create index if not exists idx_location_state_store_location_key
  on public.location_state_store (location_id, state_key);
alter table public.location_state_store enable row level security;
drop policy if exists "location_state_store_all_auth" on public.location_state_store;
create policy "location_state_store_all_auth"
  on public.location_state_store for all to authenticated
  using (true) with check (true);

-- 2. Extra columns on ledger_entries (idempotent)
alter table public.ledger_entries
  add column if not exists business_area text,
  add column if not exists fx_rate numeric(12,4),
  add column if not exists amount_eur numeric(12,4),
  add column if not exists recurring_source_id uuid,
  add column if not exists recurring_month text,
  add column if not exists source_kind text;

-- 3. Enable Realtime on all tables needed for live sync (safe - skips if already member)
do $$
declare
  t text;
  tables text[] := array[
    'location_state_store',
    'ledger_entries',
    'camp_weeks',
    'camp_guests',
    'camp_tab_items',
    'location_menus',
    'camp_staff_directory',
    'monthly_cost_profiles'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Added % to supabase_realtime', t;
    else
      raise notice '% already in supabase_realtime, skipped', t;
    end if;
  end loop;
end;
$$;
