-- ════════════════════════════════════════════════════════════════════════════
--  PRICING CATALOG — add picker_tab column + backfill from state_store
-- ════════════════════════════════════════════════════════════════════════════
--
--  Phase 3 first iteration put every Transport row in the Hub's "Airport"
--  picker tab because the import collapsed location_state_store's
--  { airport: [...], tuktuk: [...] } shape into a flat list. Sri Lanka's
--  Tuk Tuk tab ended up empty.
--
--  This migration:
--    1. Adds a nullable picker_tab column to pricing_catalog
--       (values: 'airport' | 'tuktuk' | NULL → defaults to airport in code).
--    2. Backfills it by joining each existing catalog row's
--       linked_transport_preset_id against the live presets JSON in
--       location_state_store. So Sri Lanka rows that came from the
--       tuktuk[] array get picker_tab='tuktuk', rows from airport[]
--       get picker_tab='airport'.
--
--  How to run: paste into Supabase SQL Editor → Run. Idempotent.
--  Verification SELECT at the bottom shows the per-tab counts.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Add the column (no-op if it already exists)
alter table public.pricing_catalog
  add column if not exists picker_tab text;

-- 2. Backfill picker_tab from location_state_store transport_presets_v1
with src as (
  select
    l.id           as location_id,
    ss.state_json  as presets
  from public.locations l
  join public.location_state_store ss
    on ss.location_id = l.id
   and ss.state_key   = 'transport_presets_v1'
),
airport_ids as (
  select location_id, (p->>'id') as preset_id, 'airport'::text as tab
  from src,
       jsonb_array_elements(coalesce(presets->'airport', '[]'::jsonb)) as p
),
tuktuk_ids as (
  select location_id, (p->>'id') as preset_id, 'tuktuk'::text as tab
  from src,
       jsonb_array_elements(coalesce(presets->'tuktuk', '[]'::jsonb)) as p
),
all_ids as (
  select * from airport_ids
  union all
  select * from tuktuk_ids
)
update public.pricing_catalog pc
   set picker_tab = all_ids.tab
  from all_ids
 where pc.location_id                = all_ids.location_id
   and pc.linked_transport_preset_id = all_ids.preset_id
   and pc.category                   = 'Transport'
   and (pc.picker_tab is null or pc.picker_tab <> all_ids.tab);

-- 3. Default remaining nulls to 'airport' so the Hub never sees null
update public.pricing_catalog
   set picker_tab = 'airport'
 where category   = 'Transport'
   and picker_tab is null;

-- 4. Verify — should split rows nicely between airport and tuktuk
select
  l.slug                                                as location,
  count(*) filter (where pc.picker_tab = 'airport')     as airport_rows,
  count(*) filter (where pc.picker_tab = 'tuktuk')      as tuktuk_rows,
  count(*) filter (where pc.picker_tab is null)         as null_rows,
  count(*)                                              as total_transport_rows
from public.locations l
left join public.pricing_catalog pc
  on pc.location_id = l.id
 and pc.category    = 'Transport'
where l.slug in ('sri-lanka', 'morocco')
group by l.slug
order by l.slug;
