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
  -- machine key derived from label (lowercase, underscored). Used as
  -- the tab identifier in the client and can never collide with a
  -- system area since we validate on insert.
  key text not null unique,
  label text not null,
  -- Which pricing_catalog.category values feed this tab. Usually one
  -- entry matching the label, but the array shape lets a single tab
  -- collect multiple related categories if the owner ever needs that.
  cats jsonb not null default '[]'::jsonb,
  -- Optional inline SVG string for a custom icon. Null → no icon
  -- shown, matching the fallback behaviour of AREA_ICONS.
  icon text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
