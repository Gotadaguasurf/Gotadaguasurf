-- ════════════════════════════════════════════════════════════════════════════
--  ACCOMMODATION ROOMS — physical room inventory per location
-- ════════════════════════════════════════════════════════════════════════════
--
--  Companion to accommodation-schema.sql. The accommodation_room_types table
--  there holds room CATEGORIES used by the price matrix ("Shared Ensuite",
--  "Standard Private", "Superior Private"). This table holds individual
--  PHYSICAL rooms in the building — multiple Shared Ensuite rooms, each
--  with its own bed config and floor location. Drives the "Our Rooms"
--  inventory display the user uses to show clients what's in the camp.
--
--  How to apply: paste into Supabase SQL Editor → Run. Idempotent (IF NOT
--  EXISTS guards + ON CONFLICT DO NOTHING on the seeds).
--
--  How to undo:
--    drop table if exists public.accommodation_rooms cascade;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.accommodation_rooms (
  id           uuid          primary key default gen_random_uuid(),
  location_id  uuid          not null references public.locations(id) on delete cascade,
  name         text          not null,   -- "Shared Room Ensuite (Mixed)"
  config_text  text,                     -- "2 bunk beds · max 4 people"
  max_capacity integer       not null default 1,
  floor        text,                     -- "Ground" | "1st" | "2nd" | NULL (Sri Lanka has no floors)
  variant      text          not null default 'standard',
                                         -- 'standard' | 'shared' | 'superior' | 'rv' (drives left-border colour)
  tags         text[]        not null default '{}',
                                         -- ['shared','bath','ac','ocean','rv'] etc.
  sort_order   integer       not null default 100,
  active       boolean       not null default true,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

create index if not exists idx_accom_rooms_inv_location on public.accommodation_rooms(location_id);

-- updated_at trigger reuses the function from accommodation-schema.sql
drop trigger if exists accom_rooms_inv_touch on public.accommodation_rooms;
create trigger accom_rooms_inv_touch before update on public.accommodation_rooms
  for each row execute function public.accom_touch();

-- RLS — same posture as the rest of pricing_catalog: read+write for authenticated.
alter table public.accommodation_rooms enable row level security;

drop policy if exists accom_rooms_inv_rw on public.accommodation_rooms;
create policy accom_rooms_inv_rw on public.accommodation_rooms
  for all to authenticated using (true) with check (true);

-- Realtime
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and tablename='accommodation_rooms') then
    execute 'alter publication supabase_realtime add table public.accommodation_rooms';
  end if;
end $$;

-- ── Seed: Sri Lanka rooms (taken from the user's pricing-doc HTML) ─────────
-- Sri Lanka has no floor grouping — all rooms render in one grid.

insert into public.accommodation_rooms
  (location_id, name, config_text, max_capacity, floor, variant, tags, sort_order)
select l.id, r.name, r.config_text, r.max_capacity, r.floor, r.variant, r.tags::text[], r.sort_order
from public.locations l
cross join (values
  ('Shared Room Ensuite (Mixed)',         '2 bunk beds · max 4 people',         4, NULL, 'shared',   '{shared,bath,ac}',                10),
  ('Shared Room Ensuite (Mixed)',         '2 bunk beds · max 4 people',         4, NULL, 'shared',   '{shared,bath,ac}',                20),
  ('Shared Room Ensuite (Female Only)',   '3 bunk beds · max 6 people',         6, NULL, 'shared',   '{shared,bath,ac}',                30),
  ('Standard Private Ensuite',            'King size twin/double · max 2 people', 2, NULL, 'standard', '{bath,ac}',                       40),
  ('Standard Private Ensuite',            'King size twin/double · max 2 people', 2, NULL, 'standard', '{bath,ac}',                       50),
  ('Superior Private Ensuite',            'King size double · max 2 people',    2, NULL, 'superior', '{ocean,bath,ac}',                 60),
  ('Superior Private Ensuite',            'King size double · max 2 people',    2, NULL, 'superior', '{ocean,bath,ac}',                 70),
  ('Superior Private Ensuite',            'King size double · max 2 people',    2, NULL, 'superior', '{ocean,bath,ac}',                 80)
) as r(name, config_text, max_capacity, floor, variant, tags, sort_order)
where l.slug = 'sri-lanka'
  and not exists (
    select 1 from public.accommodation_rooms ex
    where ex.location_id = l.id and ex.name = r.name and ex.sort_order = r.sort_order
  );

-- ── Seed: Morocco rooms (organised by floor) ───────────────────────────────

insert into public.accommodation_rooms
  (location_id, name, config_text, max_capacity, floor, variant, tags, sort_order)
select l.id, r.name, r.config_text, r.max_capacity, r.floor, r.variant, r.tags::text[], r.sort_order
from public.locations l
cross join (values
  -- Ground Floor
  ('Double Ensuite Room (Riad View)', '2 singles or 1 double · max 2 people',                 2, 'Ground', 'rv',       '{rv,bath}',          10),
  ('Double Ensuite Room (Riad View)', '2 singles or 1 double · max 2 people',                 2, 'Ground', 'rv',       '{rv,bath}',          20),
  ('Double Ensuite Room',             '2 singles or 1 double · max 2 people',                 2, 'Ground', 'standard', '{bath}',             30),
  ('Double Ensuite Room',             '2 singles or 1 double · max 2 people',                 2, 'Ground', 'standard', '{bath}',             40),
  ('Double Ensuite Room',             '2 singles or 1 double · max 2 people',                 2, 'Ground', 'standard', '{bath}',             50),
  -- 1st Floor
  ('Shared Ensuite Room — Female Only', '3 bunk beds · max 6 people',                         6, '1st',    'shared',   '{shared,bath}',      60),
  ('Family Room Ensuite',               '1 double/twin + 1 bunk bed · max 4 people',          4, '1st',    'standard', '{bath}',             70),
  ('Double Ensuite Room (Riad View)',   '2 singles or 1 double · max 2 people',               2, '1st',    'rv',       '{rv,bath}',          80),
  ('Shared Ensuite Room (Riad View)',   '2 bunk beds · max 4 people',                         4, '1st',    'shared',   '{shared,rv,bath}',   90),
  ('Triple Ensuite Room',               '3 singles or 1 double + 1 single · max 3 people',    3, '1st',    'standard', '{bath}',            100),
  -- 2nd Floor
  ('Triple Ensuite Room (Riad View)',   '3 singles or 1 double + 1 single · max 3 people',    3, '2nd',    'rv',       '{rv,bath}',         110),
  ('Triple Ensuite Room',               '3 singles or 1 double + 1 single · max 3 people',    3, '2nd',    'standard', '{bath}',            120),
  ('Shared Ensuite Room',               '4 bunk beds · max 8 people',                         8, '2nd',    'shared',   '{shared,bath}',     130)
) as r(name, config_text, max_capacity, floor, variant, tags, sort_order)
where l.slug = 'morocco'
  and not exists (
    select 1 from public.accommodation_rooms ex
    where ex.location_id = l.id and ex.name = r.name and ex.sort_order = r.sort_order
  );

-- ── Verify ─────────────────────────────────────────────────────────────────

select
  l.slug                                                        as location,
  count(r.*)                                                    as total_rooms,
  count(r.*) filter (where r.floor is not null)                 as rooms_with_floor,
  count(r.*) filter (where 'shared'   = any(r.tags))            as shared_rooms,
  count(r.*) filter (where 'rv'       = any(r.tags))            as riad_view,
  count(r.*) filter (where 'ocean'    = any(r.tags))            as ocean_view
from public.locations l
left join public.accommodation_rooms r on r.location_id = l.id
where l.slug in ('sri-lanka','morocco')
group by l.slug
order by l.slug;
