-- ════════════════════════════════════════════════════════════════════════════
--  pricing_areas — owner-defined custom tabs in /prices
--
--  System areas (Accommodation, Surf, Tours, Transfers, Merch, Extras,
--  Drinks, Add-ons, Costs) stay hardcoded in the client — they're the
--  stable backbone of the catalog. This table holds ADDITIONAL tabs the
--  owner creates from /prices ("Rentals", "Wetsuits", "Yoga", etc.).
--
--  Shared across every location: the owner wants the same tab set
--  everywhere, and per-location visibility is already handled by
--  LOCATION_TAB_CONFIG on the POS side.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.pricing_areas (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  cats jsonb not null default '[]'::jsonb,
  icon text,
  sort_order integer not null default 100,
  -- Hidden flag: true means this key belongs to a SYSTEM area the owner
  -- has chosen to hide from /prices and the POS. Deleting the row
  -- restores the system area (system areas stay hardcoded in the
  -- client, we just track a "is currently hidden" opinion here).
  -- Custom areas never set hidden=true; they're deleted outright.
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotent for deployments that already ran the table create without
-- the hidden column.
alter table public.pricing_areas
  add column if not exists hidden boolean not null default false;

-- RLS: readable by anyone authenticated, editable by anyone
-- authenticated. Same policy as pricing_catalog since /prices is
-- already an admin-only surface.
alter table public.pricing_areas enable row level security;
drop policy if exists "pricing_areas readable to authenticated" on public.pricing_areas;
create policy "pricing_areas readable to authenticated"
  on public.pricing_areas for select to authenticated using (true);
drop policy if exists "pricing_areas writable by authenticated" on public.pricing_areas;
create policy "pricing_areas writable by authenticated"
  on public.pricing_areas for all to authenticated using (true) with check (true);

-- Verify
select 'pricing_areas' as label, count(*) from public.pricing_areas;
