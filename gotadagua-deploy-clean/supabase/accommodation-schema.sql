-- ════════════════════════════════════════════════════════════════════════════
--  ACCOMMODATION schema — Phase B of the Pricing Catalog redesign
-- ════════════════════════════════════════════════════════════════════════════
--
--  Backs the "Accommodation" tab in /prices with a richer model than the
--  flat pricing_catalog row. The user's pricing has four dimensions:
--
--    Pack          Weekly (7 nights) · Flexible (per night)
--    Season        LOW · MID · HIGH (each spans multiple date ranges)
--    Room type     Shared Ensuite · Standard Private · Superior Private
--    Occupancy     1 person · 2 people (per-room sharing)
--
--  Each combination has a sell price (and optionally a cost price). Some
--  combinations are intentionally blank — Shared Ensuite has no "2 people"
--  rate because rooms are sold per bed.
--
--  Four tables:
--    1. accommodation_packs       — per-location, the available pack types
--    2. accommodation_seasons     — per-location, with date_ranges JSONB
--    3. accommodation_room_types  — per-location, the available room types
--    4. accommodation_prices      — the price matrix (one row per cell)
--
--  How to apply: paste into Supabase SQL Editor → Run. Idempotent
--  (IF NOT EXISTS guards + UPSERTs on the seed inserts) — safe to re-run.
--
--  How to undo (only if needed):
--    drop table if exists public.accommodation_prices     cascade;
--    drop table if exists public.accommodation_room_types cascade;
--    drop table if exists public.accommodation_seasons    cascade;
--    drop table if exists public.accommodation_packs      cascade;
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Packs ────────────────────────────────────────────────────────────────

create table if not exists public.accommodation_packs (
  id            uuid          primary key default gen_random_uuid(),
  location_id   uuid          not null references public.locations(id) on delete cascade,
  pack_key      text          not null,   -- 'weekly' | 'flexible' (free-form, scope: location)
  label         text          not null,   -- "Weekly Pack — 7 nights"
  description   text,                     -- "7 Nights · 7 Breakfasts · 5 Dinners · 1 BBQ …"
  price_basis   text          not null default 'per_person_per_week',
                                          -- 'per_person_per_week' | 'per_person_per_night'
  sort_order    integer       not null default 100,
  active        boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (location_id, pack_key)
);

create index if not exists idx_accom_packs_location on public.accommodation_packs(location_id);

-- ── 2. Seasons ──────────────────────────────────────────────────────────────
-- date_ranges is a JSONB array of {start, end} ISO-date strings. Each season
-- can span multiple non-contiguous ranges (e.g. LOW covers both shoulders).

create table if not exists public.accommodation_seasons (
  id            uuid          primary key default gen_random_uuid(),
  location_id   uuid          not null references public.locations(id) on delete cascade,
  season_key    text          not null,   -- 'low' | 'mid' | 'high'
  label         text          not null,   -- "LOW SEASON"
  color         text          not null default 'green',
                                          -- 'green' | 'amber' | 'red' for UI accents
  date_ranges   jsonb         not null default '[]'::jsonb,
                                          -- [{"start":"2026-09-27","end":"2026-10-31"}, …]
  sort_order    integer       not null default 100,
  active        boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (location_id, season_key)
);

create index if not exists idx_accom_seasons_location on public.accommodation_seasons(location_id);

-- ── 3. Room types ───────────────────────────────────────────────────────────

create table if not exists public.accommodation_room_types (
  id            uuid          primary key default gen_random_uuid(),
  location_id   uuid          not null references public.locations(id) on delete cascade,
  room_key      text          not null,   -- 'shared_ensuite' | 'standard_private' | …
  label         text          not null,   -- "Shared Room Ensuite"
  description   text,
  sort_order    integer       not null default 100,
  active        boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (location_id, room_key)
);

create index if not exists idx_accom_rooms_location on public.accommodation_room_types(location_id);

-- ── 4. Prices ───────────────────────────────────────────────────────────────
-- One row per (pack × season × room × occupancy) combination that actually
-- has a price set. Missing combinations (e.g. Shared Ensuite × 2 people) are
-- simply absent — no row needed.

create table if not exists public.accommodation_prices (
  id            uuid          primary key default gen_random_uuid(),
  location_id   uuid          not null references public.locations(id) on delete cascade,
  pack_id       uuid          not null references public.accommodation_packs(id)      on delete cascade,
  season_id     uuid          not null references public.accommodation_seasons(id)    on delete cascade,
  room_type_id  uuid          not null references public.accommodation_room_types(id) on delete cascade,
  occupancy     integer       not null,   -- 1 | 2 | 3 (per-room sharing)
  sell_price    numeric(12,2) not null default 0,
  cost_per_guest numeric(12,2) not null default 0,
  currency      text          not null default 'EUR',
  notes         text,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (location_id, pack_id, season_id, room_type_id, occupancy)
);

create index if not exists idx_accom_prices_location on public.accommodation_prices(location_id);
create index if not exists idx_accom_prices_pack     on public.accommodation_prices(pack_id);
create index if not exists idx_accom_prices_season   on public.accommodation_prices(season_id);

-- ── 5. updated_at triggers ──────────────────────────────────────────────────

create or replace function public.accom_touch() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists accom_packs_touch on public.accommodation_packs;
create trigger accom_packs_touch  before update on public.accommodation_packs
  for each row execute function public.accom_touch();

drop trigger if exists accom_seasons_touch on public.accommodation_seasons;
create trigger accom_seasons_touch before update on public.accommodation_seasons
  for each row execute function public.accom_touch();

drop trigger if exists accom_rooms_touch on public.accommodation_room_types;
create trigger accom_rooms_touch   before update on public.accommodation_room_types
  for each row execute function public.accom_touch();

drop trigger if exists accom_prices_touch on public.accommodation_prices;
create trigger accom_prices_touch  before update on public.accommodation_prices
  for each row execute function public.accom_touch();

-- ── 6. Row-Level Security (mirrors pricing_catalog) ─────────────────────────

alter table public.accommodation_packs      enable row level security;
alter table public.accommodation_seasons    enable row level security;
alter table public.accommodation_room_types enable row level security;
alter table public.accommodation_prices     enable row level security;

drop policy if exists accom_packs_rw    on public.accommodation_packs;
drop policy if exists accom_seasons_rw  on public.accommodation_seasons;
drop policy if exists accom_rooms_rw    on public.accommodation_room_types;
drop policy if exists accom_prices_rw   on public.accommodation_prices;

create policy accom_packs_rw   on public.accommodation_packs
  for all to authenticated using (true) with check (true);
create policy accom_seasons_rw on public.accommodation_seasons
  for all to authenticated using (true) with check (true);
create policy accom_rooms_rw   on public.accommodation_room_types
  for all to authenticated using (true) with check (true);
create policy accom_prices_rw  on public.accommodation_prices
  for all to authenticated using (true) with check (true);

-- ── 7. Realtime publication ─────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and tablename='accommodation_packs') then
    execute 'alter publication supabase_realtime add table public.accommodation_packs';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and tablename='accommodation_seasons') then
    execute 'alter publication supabase_realtime add table public.accommodation_seasons';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and tablename='accommodation_room_types') then
    execute 'alter publication supabase_realtime add table public.accommodation_room_types';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and tablename='accommodation_prices') then
    execute 'alter publication supabase_realtime add table public.accommodation_prices';
  end if;
end $$;

-- ── 8. Seed: Sri Lanka data from the user's mockups ─────────────────────────
-- Uses ON CONFLICT DO NOTHING on the unique keys so re-running keeps existing
-- edits. Date ranges come from the LOW/MID/HIGH bars in the screenshot.

-- 8a. Packs
insert into public.accommodation_packs
  (location_id, pack_key, label, description, price_basis, sort_order)
select l.id, p.pack_key, p.label, p.description, p.price_basis, p.sort_order
from public.locations l
cross join (values
  ('weekly',   'Weekly Pack — 7 nights',  '7 Nights · 7 Breakfasts · 5 Dinners · 1 BBQ · Free Surf Equipment · Camp Activities · Price per person per week', 'per_person_per_week',  10),
  ('flexible', 'Flexible Pack — per night','1 Breakfast · 1 Dinner · Free Surf Equipment · Camp Activities · Price per person per night',                  'per_person_per_night', 20)
) as p(pack_key, label, description, price_basis, sort_order)
where l.slug = 'sri-lanka'
on conflict (location_id, pack_key) do nothing;

-- 8b. Seasons (with date ranges)
insert into public.accommodation_seasons
  (location_id, season_key, label, color, date_ranges, sort_order)
select l.id, s.season_key, s.label, s.color, s.date_ranges::jsonb, s.sort_order
from public.locations l
cross join (values
  ('low',  'LOW SEASON',  'green',
     '[{"start":"2026-09-27","end":"2026-10-31"},
       {"start":"2027-05-30","end":"2027-06-06"},
       {"start":"2027-07-18","end":"2027-10-02"}]',
     10),
  ('mid',  'MID SEASON',  'amber',
     '[{"start":"2026-11-01","end":"2026-12-12"},
       {"start":"2027-04-25","end":"2027-05-29"}]',
     20),
  ('high', 'HIGH SEASON', 'red',
     '[{"start":"2026-12-13","end":"2027-04-24"}]',
     30)
) as s(season_key, label, color, date_ranges, sort_order)
where l.slug = 'sri-lanka'
on conflict (location_id, season_key) do nothing;

-- 8c. Room types
insert into public.accommodation_room_types
  (location_id, room_key, label, description, sort_order)
select l.id, r.room_key, r.label, r.description, r.sort_order
from public.locations l
cross join (values
  ('shared_ensuite',    'Shared Room Ensuite',     'Shared dorm-style room with private bathroom — sold per bed.', 10),
  ('standard_private',  'Standard Private Ensuite','Private room with ensuite bathroom, standard size.',           20),
  ('superior_private',  'Superior Private Ensuite','Larger private room with ensuite bathroom and premium fit.',   30)
) as r(room_key, label, description, sort_order)
where l.slug = 'sri-lanka'
on conflict (location_id, room_key) do nothing;

-- 8d. Prices — Weekly Pack (€) per the user's mockup, all in EUR
with loc as (select id from public.locations where slug='sri-lanka' limit 1),
     pk  as (select id from public.accommodation_packs    where pack_key='weekly'           and location_id=(select id from loc)),
     pkf as (select id from public.accommodation_packs    where pack_key='flexible'         and location_id=(select id from loc)),
     low_ as (select id from public.accommodation_seasons where season_key='low'             and location_id=(select id from loc)),
     mid_ as (select id from public.accommodation_seasons where season_key='mid'             and location_id=(select id from loc)),
     hi_  as (select id from public.accommodation_seasons where season_key='high'            and location_id=(select id from loc)),
     rsh as (select id from public.accommodation_room_types where room_key='shared_ensuite'  and location_id=(select id from loc)),
     rst as (select id from public.accommodation_room_types where room_key='standard_private' and location_id=(select id from loc)),
     rsu as (select id from public.accommodation_room_types where room_key='superior_private' and location_id=(select id from loc))
insert into public.accommodation_prices
  (location_id, pack_id, season_id, room_type_id, occupancy, sell_price, currency)
values
  -- Weekly Pack
  ((select id from loc),(select id from pk),(select id from low_),(select id from rsh),1, 399, 'EUR'),
  ((select id from loc),(select id from pk),(select id from low_),(select id from rst),1, 649, 'EUR'),
  ((select id from loc),(select id from pk),(select id from low_),(select id from rst),2, 479, 'EUR'),
  ((select id from loc),(select id from pk),(select id from low_),(select id from rsu),1, 699, 'EUR'),
  ((select id from loc),(select id from pk),(select id from low_),(select id from rsu),2, 499, 'EUR'),
  ((select id from loc),(select id from pk),(select id from mid_),(select id from rsh),1, 449, 'EUR'),
  ((select id from loc),(select id from pk),(select id from mid_),(select id from rst),1, 699, 'EUR'),
  ((select id from loc),(select id from pk),(select id from mid_),(select id from rst),2, 529, 'EUR'),
  ((select id from loc),(select id from pk),(select id from mid_),(select id from rsu),1, 749, 'EUR'),
  ((select id from loc),(select id from pk),(select id from mid_),(select id from rsu),2, 549, 'EUR'),
  ((select id from loc),(select id from pk),(select id from hi_), (select id from rsh),1, 499, 'EUR'),
  ((select id from loc),(select id from pk),(select id from hi_), (select id from rst),1, 749, 'EUR'),
  ((select id from loc),(select id from pk),(select id from hi_), (select id from rst),2, 579, 'EUR'),
  ((select id from loc),(select id from pk),(select id from hi_), (select id from rsu),1, 799, 'EUR'),
  ((select id from loc),(select id from pk),(select id from hi_), (select id from rsu),2, 599, 'EUR'),
  -- Flexible Pack (per-night — values per the mockup, rounded to 2dp)
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rsh),1,  57.00, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rst),1,  92.71, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rst),2,  68.42, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rsu),1,  99.86, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rsu),2,  71.28, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rsh),1,  64.14, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rst),1,  99.85, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rst),2,  75.57, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rsu),1, 107.00, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rsu),2,  78.42, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from hi_), (select id from rsh),1,  71.29, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from hi_), (select id from rst),1, 107.00, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from hi_), (select id from rst),2,  82.71, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from hi_), (select id from rsu),1, 114.14, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from hi_), (select id from rsu),2,  85.57, 'EUR')
on conflict (location_id, pack_id, season_id, room_type_id, occupancy) do nothing;

-- ── 9. Verify ───────────────────────────────────────────────────────────────

select
  l.slug                                              as location,
  (select count(*) from public.accommodation_packs      pk where pk.location_id = l.id) as packs,
  (select count(*) from public.accommodation_seasons    s  where s.location_id  = l.id) as seasons,
  (select count(*) from public.accommodation_room_types r  where r.location_id  = l.id) as rooms,
  (select count(*) from public.accommodation_prices     p  where p.location_id  = l.id) as prices
from public.locations l
where l.slug in ('sri-lanka','morocco')
order by l.slug;
