-- ════════════════════════════════════════════════════════════════════════════
--  PRICING CATALOG — add capacity column + backfill from notes
-- ════════════════════════════════════════════════════════════════════════════
--
--  After the Tour↔Transport linkages went live, Morocco tours started
--  showing wildly negative margins:
--    Souk Tour sell 150 MAD vs Souk — Car cost 400 MAD → -250 margin
--  The 400 MAD is the FULL CAR cost (4 passengers), not per-guest.
--  Divide by capacity (4) and the real per-guest transport cost is
--  100 MAD, giving a healthy 33 % margin.
--
--  This migration:
--    1. Adds a nullable integer column "capacity" to pricing_catalog.
--    2. Backfills it for Transport rows whose notes carry the
--       "capacity N" suffix (every Morocco vehicle row written by the
--       initial import). Sri Lanka tuk-tuk presets have no capacity in
--       their notes — we leave those NULL, which the /prices UI treats
--       as a per-trip price (effectively capacity = 1).
--
--  How to run: paste into the Supabase SQL Editor → Run. Idempotent —
--  ADD COLUMN IF NOT EXISTS, and the UPDATE only writes where notes
--  matched the regex AND the column was still NULL.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Add the column
alter table public.pricing_catalog
  add column if not exists capacity integer;

-- 2. Backfill from notes. Pattern in import notes is:
--      "Imported from Hub Transport presets (Car, capacity 4)"
--      "Imported from Hub Transport presets (Minivan, capacity 8)"
--      "Imported from Hub Transport presets (Big Van, capacity 15)"
update public.pricing_catalog
   set capacity = greatest(1,
       (regexp_match(notes, 'capacity\s+(\d+)','i'))[1]::int
   )
 where category = 'Transport'
   and capacity is null
   and notes ~* 'capacity\s+\d+';

-- 3. Verify — show every Transport row with its capacity and per-guest cost
select
  l.slug                                              as location,
  pc.name                                             as transport,
  pc.cost_per_guest                                   as raw_cost,
  pc.capacity                                         as capacity,
  case
    when pc.capacity is not null and pc.capacity > 0
      then round(pc.cost_per_guest / pc.capacity, 2)
    else pc.cost_per_guest
  end                                                 as per_guest_cost
from public.pricing_catalog pc
join public.locations l on l.id = pc.location_id
where pc.category = 'Transport'
  and pc.active   = true
  and l.slug in ('sri-lanka','morocco')
order by l.slug, pc.sort_order, pc.name;
