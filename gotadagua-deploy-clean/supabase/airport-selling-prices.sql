-- ════════════════════════════════════════════════════════════════════════════
--  Airport transfer SELLING prices — Sri Lanka & Morocco
-- ════════════════════════════════════════════════════════════════════════════
--
--  The transport rows already carry COST (what we pay the driver) from the
--  initial import. This script adds the SELLING price (what we charge the
--  client per trip) taken from the user's price-list docs.
--
--  Currencies:
--    • Sri Lanka cost is in LKR, but the airport SELL price is in EUR
--      (clients book in EUR before they land). Each Sri Lanka airport row
--      gets currency switched to EUR alongside the sell price.
--    • Morocco follows the same pattern — costs in MAD, airport sells in EUR.
--
--  Idempotent: only UPDATEs rows whose sell_price is still 0 (so a user
--  who has already overridden a value isn't surprised by this script).
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Sri Lanka — Colombo (CMB) ↔ Surfcamp ──
--    Car      (1-4 pax) → 75 €
--    Minivan  (5-8)     → 90 €
--    Large Van(9-12)    → 100 €

with sri as (
  select id from public.locations where slug = 'sri-lanka' limit 1
)
update public.pricing_catalog pc
   set sell_price = v.price,
       currency   = 'EUR'
  from (values
    ('Surfcamp → Airport — Car',       75::numeric),
    ('Surfcamp → Airport — Minivan',   90::numeric),
    ('Surfcamp → Airport — Large Van',100::numeric),
    ('Airport → Surfcamp — Car',       75::numeric),
    ('Airport → Surfcamp — Minivan',   90::numeric),
    ('Airport → Surfcamp — Large Van',100::numeric)
  ) as v(row_name, price)
 where pc.location_id = (select id from sri)
   and pc.category    = 'Transport'
   and pc.name        = v.row_name
   and pc.sell_price  = 0;

-- ── Morocco — Agadir Airport (AGA) ──
--    Car     (1-4)  → 30 €
--    Minivan (5-8)  → 40 €
--    Big Van (9-15) → 65 €

with mor as (
  select id from public.locations where slug = 'morocco' limit 1
)
update public.pricing_catalog pc
   set sell_price = v.price,
       currency   = 'EUR'
  from (values
    ('Agadir Airport — Car',     30::numeric),
    ('Agadir Airport — Minivan', 40::numeric),
    ('Agadir Airport — Big Van', 65::numeric)
  ) as v(row_name, price)
 where pc.location_id = (select id from mor)
   and pc.category    = 'Transport'
   and pc.name        = v.row_name
   and pc.sell_price  = 0;

-- ── Morocco — Marrakech Airport (RAK) — longer drive, higher prices ──
--    Car     (1-4)  → 120 €
--    Minivan (5-8)  → 150 €
--    Big Van (9-15) → 220 €

with mor as (
  select id from public.locations where slug = 'morocco' limit 1
)
update public.pricing_catalog pc
   set sell_price = v.price,
       currency   = 'EUR'
  from (values
    ('Marrakech Airport — Car',     120::numeric),
    ('Marrakech Airport — Minivan', 150::numeric),
    ('Marrakech Airport — Big Van', 220::numeric)
  ) as v(row_name, price)
 where pc.location_id = (select id from mor)
   and pc.category    = 'Transport'
   and pc.name        = v.row_name
   and pc.sell_price  = 0;

-- ── Verify ────────────────────────────────────────────────────────────────

select
  l.slug         as location,
  pc.name        as route_vehicle,
  pc.capacity    as pax,
  pc.cost_per_guest as cost,
  pc.sell_price  as sell,
  pc.currency
from public.pricing_catalog pc
join public.locations l on l.id = pc.location_id
where pc.category = 'Transport'
  and pc.active   = true
  and l.slug in ('sri-lanka', 'morocco')
  and (pc.name ilike '%airport%' or pc.name ilike '%surfcamp%')
order by l.slug, pc.sort_order, pc.name;
