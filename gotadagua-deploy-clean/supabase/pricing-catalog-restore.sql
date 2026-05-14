-- ════════════════════════════════════════════════════════════════════════════
--  PRICING CATALOG — restore script for Sri Lanka + Morocco
-- ════════════════════════════════════════════════════════════════════════════
--
--  Re-populates pricing_catalog with everything that was originally imported:
--
--    1. Sri Lanka Camp Tab tours (5):
--         Cooking Class · Tea Plantation Visit · River Safari ·
--         Ice Bath · Safari Yala
--
--    2. Morocco Camp Tab tours (4):
--         Souk Tour · Paradise Valley ·
--         Dunes — Sandboarding · Dunes — Camel Ride
--
--    3. Transport destinations — read live from
--         public.location_state_store
--         WHERE state_key = 'transport_presets_v1'
--       for both Sri Lanka and Morocco. Each destination becomes one
--       catalog row; destinations with a vehicles[] array (Morocco-style)
--       produce one row per (destination × vehicle) with cost = vehicle.price.
--
--  Idempotent: every insert is guarded by NOT EXISTS on a case-insensitive
--  (location_id, category, name) match. Safe to re-run any number of times.
--
--  How to run: paste into Supabase SQL Editor → Run. Verification SELECT at
--  the bottom shows the final row counts per location/category.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Sri Lanka Camp Tab tours ─────────────────────────────────────────────

insert into public.pricing_catalog
  (location_id, name, category, audience, sell_price, cost_per_guest, currency,
   notes, show_in_camp_tab, show_in_transport_picker, sort_order, active)
select
  l.id, t.name, 'Tour', 'general', t.sell_price, 0, 'LKR',
  t.notes, true, false, t.sort_order, true
from public.locations l
cross join (values
  ('Cooking Class',         6000::numeric, 'Imported from Camp Tab Tours',                101),
  ('Tea Plantation Visit',  2500::numeric, 'Imported from Camp Tab Tours',                102),
  ('River Safari',          6000::numeric, 'Imported from Camp Tab Tours',                103),
  ('Ice Bath',              3000::numeric, 'Imported from Camp Tab Tours',                104),
  ('Safari Yala',              0::numeric, 'Set the price per booking before charging',   105)
) as t(name, sell_price, notes, sort_order)
where l.slug = 'sri-lanka'
  and not exists (
    select 1 from public.pricing_catalog pc
    where pc.location_id = l.id
      and pc.category    = 'Tour'
      and lower(pc.name) = lower(t.name)
  );

-- ── 2. Morocco Camp Tab tours ───────────────────────────────────────────────

insert into public.pricing_catalog
  (location_id, name, category, audience, sell_price, cost_per_guest, currency,
   notes, show_in_camp_tab, show_in_transport_picker, sort_order, active)
select
  l.id, t.name, 'Tour', 'general', t.sell_price, 0, 'MAD',
  t.notes, true, false, t.sort_order, true
from public.locations l
cross join (values
  ('Souk Tour',             150::numeric, 'Imported from Camp Tab Tours', 101),
  ('Paradise Valley',       250::numeric, 'Imported from Camp Tab Tours', 102),
  ('Dunes — Sandboarding',  350::numeric, 'Imported from Camp Tab Tours', 103),
  ('Dunes — Camel Ride',    450::numeric, 'Imported from Camp Tab Tours', 104)
) as t(name, sell_price, notes, sort_order)
where l.slug = 'morocco'
  and not exists (
    select 1 from public.pricing_catalog pc
    where pc.location_id = l.id
      and pc.category    = 'Tour'
      and lower(pc.name) = lower(t.name)
  );

-- ── 3. Transport destinations from location_state_store ─────────────────────
--
--  Reads transport_presets_v1 JSON, walks airport[] and tuktuk[] arrays,
--  unfolds each preset into either:
--    • one row per vehicle (Morocco-style, when vehicles[] is non-empty)
--    • one single row with cost = unitPrice (Sri Lanka-style)

with src as (
  select
    l.id   as location_id,
    l.slug as slug,
    case l.slug when 'morocco' then 'MAD' else 'LKR' end as currency,
    ss.state_json as presets
  from public.locations l
  join public.location_state_store ss
    on ss.location_id = l.id
   and ss.state_key   = 'transport_presets_v1'
  where l.slug in ('sri-lanka', 'morocco')
),
all_presets as (
  select location_id, slug, currency, p as preset
  from src, jsonb_array_elements(coalesce(presets->'airport', '[]'::jsonb)) as p
  union all
  select location_id, slug, currency, p as preset
  from src, jsonb_array_elements(coalesce(presets->'tuktuk',  '[]'::jsonb)) as p
),
-- One row per (preset × vehicle) when vehicles[] is non-empty
with_vehicles as (
  select
    ap.location_id,
    ap.currency,
    (ap.preset->>'name') || ' — ' || (v->>'label') as name,
    coalesce((v->>'price')::numeric, 0)            as cost,
    (ap.preset->>'id')                             as linked_id,
    coalesce((v->>'label'), '')                    as vehicle_label,
    coalesce((v->>'capacity')::int, 0)             as capacity
  from all_presets ap,
       jsonb_array_elements(coalesce(ap.preset->'vehicles', '[]'::jsonb)) as v
  where jsonb_array_length(coalesce(ap.preset->'vehicles', '[]'::jsonb)) > 0
    and coalesce(v->>'label', '') <> ''
),
-- One row per preset when vehicles[] is empty (single unitPrice)
without_vehicles as (
  select
    location_id,
    currency,
    (preset->>'name') as name,
    coalesce((preset->>'unitPrice')::numeric, 0) as cost,
    (preset->>'id')   as linked_id,
    ''                as vehicle_label,
    0                 as capacity
  from all_presets
  where jsonb_array_length(coalesce(preset->'vehicles', '[]'::jsonb)) = 0
    and coalesce(preset->>'name', '') <> ''
),
rows_to_insert as (
  select * from with_vehicles
  union all
  select * from without_vehicles
)
insert into public.pricing_catalog
  (location_id, name, category, audience, sell_price, cost_per_guest, currency,
   notes, show_in_camp_tab, show_in_transport_picker,
   linked_transport_preset_id, sort_order, active)
select
  r.location_id,
  r.name,
  'Transport',
  'general',
  0,
  r.cost,
  r.currency,
  case when r.vehicle_label <> ''
       then 'Imported from Hub Transport presets (' || r.vehicle_label ||
            case when r.capacity > 0 then ', capacity ' || r.capacity else '' end || ')'
       else 'Imported from Hub Transport presets'
  end,
  false,  -- show_in_camp_tab
  true,   -- show_in_transport_picker
  r.linked_id,
  100 + row_number() over (partition by r.location_id order by r.name),
  true
from rows_to_insert r
where not exists (
  select 1 from public.pricing_catalog pc
  where pc.location_id = r.location_id
    and pc.category    = 'Transport'
    and lower(pc.name) = lower(r.name)
);

-- ── 4. Verify ───────────────────────────────────────────────────────────────
--  Should return 2 rows summarising what's in each location's catalog.

select
  l.slug                                              as location,
  count(*) filter (where pc.category = 'Tour')        as tours,
  count(*) filter (where pc.category = 'Transport')   as transports,
  count(*)                                            as total
from public.locations l
left join public.pricing_catalog pc on pc.location_id = l.id
where l.slug in ('sri-lanka', 'morocco')
group by l.slug
order by l.slug;
