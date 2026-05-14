-- ════════════════════════════════════════════════════════════════════════════
--  FIX — separate cost vs sell currencies for airport transfer rows
-- ════════════════════════════════════════════════════════════════════════════
--
--  The previous airport-selling-prices.sql migration set BOTH the cost and
--  the sell price to EUR currency on the airport rows. That broke the
--  display: a 250 MAD car cost now read "€250" in the UI, suggesting we
--  pay drivers in EUR (we don't) and producing nonsense margin numbers
--  (cost in MAD ≠ price in EUR, so subtraction was meaningless).
--
--  This migration:
--    1. Adds a sell_currency column to pricing_catalog so a single row
--       can hold a cost in MAD/LKR AND a sell price in EUR.
--    2. Restores currency (the COST currency) to the location's local
--       money for every airport row that was switched.
--    3. Sets sell_currency = 'EUR' on those rows so the selling price
--       formats correctly without changing the stored number.
--
--  Idempotent. Re-runs are safe.
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Schema — new column, nullable. When NULL, the UI falls back to
--    `currency` (so non-airport rows that price both cost and sell in
--    the same currency don't have to set it).
alter table public.pricing_catalog
  add column if not exists sell_currency text;

-- 2. Sri Lanka airport rows — cost is in LKR, sell in EUR
with sri as (select id from public.locations where slug = 'sri-lanka' limit 1)
update public.pricing_catalog pc
   set currency      = 'LKR',
       sell_currency = 'EUR'
 where pc.location_id = (select id from sri)
   and pc.category    = 'Transport'
   and pc.name in (
     'Surfcamp → Airport — Car',
     'Surfcamp → Airport — Minivan',
     'Surfcamp → Airport — Large Van',
     'Airport → Surfcamp — Car',
     'Airport → Surfcamp — Minivan',
     'Airport → Surfcamp — Large Van'
   );

-- 3. Morocco airport rows — cost is in MAD, sell in EUR
with mor as (select id from public.locations where slug = 'morocco' limit 1)
update public.pricing_catalog pc
   set currency      = 'MAD',
       sell_currency = 'EUR'
 where pc.location_id = (select id from mor)
   and pc.category    = 'Transport'
   and pc.name in (
     'Agadir Airport — Car',
     'Agadir Airport — Minivan',
     'Agadir Airport — Big Van',
     'Marrakech Airport — Car',
     'Marrakech Airport — Minivan',
     'Marrakech Airport — Big Van'
   );

-- 4. Verify — every airport row with its cost currency, sell currency, and amounts.

select
  l.slug                    as location,
  pc.name                   as route_vehicle,
  pc.cost_per_guest         as cost,
  pc.currency               as cost_ccy,
  pc.sell_price             as sell,
  coalesce(pc.sell_currency, pc.currency) as sell_ccy,
  pc.show_in_transport_picker as in_picker
from public.pricing_catalog pc
join public.locations l on l.id = pc.location_id
where pc.category = 'Transport'
  and (pc.name ilike '%airport%' or pc.name ilike '%surfcamp%')
order by l.slug, pc.sort_order, pc.name;
