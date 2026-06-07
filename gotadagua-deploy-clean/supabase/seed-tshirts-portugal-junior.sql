-- ════════════════════════════════════════════════════════════════════════════
--  Seed t-shirt structure for Portugal + Junior Camp
-- ════════════════════════════════════════════════════════════════════════════
--
--  Mirrors the Sri Lanka / Morocco merch layout: 4 sizes × 3 variants =
--  12 rows per location. Each variant ending in S / M / L / XL is
--  automatically size-grouped by the POS (merchStockKey + merchStockLeft
--  in camp-tab-inner.html), so the stock counter only lives on the BASE
--  rows ("T-Shirt S", "T-Shirt M", …). Selling an "Offer" or "Staff"
--  variant of the same size decrements the base counter — exactly what
--  the user asked for: stock of the normal ones is shared with offers
--  and staff variants per size.
--
--  Variants per size
--  ─────────────────
--    • T-Shirt S/M/L/XL          — base row (carries the stock counter)
--    • T-Shirt Offer S/M/L/XL    — promotional variant (shares stock)
--    • T-Shirt Staff S/M/L/XL    — staff price (shares stock)
--
--  Initial values (placeholders — owner edits in /prices later)
--  ────────────────────────────────────────────────────────────
--    • sell_price = 0           — owner sets actual EUR price
--    • alt_price  = null        — base rows can later get an Offer pill
--    • stock_qty  = null        — tracking disabled until owner enables
--    • currency / sell_currency = the location's locked currency (EUR)
--    • show_in_camp_tab = true  — appears in the Camp Tab Merch grid
--
--  Idempotent: matches by (location, lowercase name) before inserting,
--  so re-runs are no-ops and pre-existing rows are left untouched.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.pricing_catalog (
  location_id, name, category, audience,
  sell_price, cost_per_guest,
  currency, sell_currency,
  stock_qty,
  show_in_camp_tab, show_in_transport_picker,
  active, sort_order
)
select
  l.id,
  t.name,
  'Merch',
  'general',
  0,
  0,
  coalesce(l.currency, 'EUR'),
  coalesce(l.currency, 'EUR'),
  null,
  true,
  false,
  true,
  t.sort_order
from public.locations l
cross join (values
  -- Base rows (carry stock counter for the size)
  ('T-Shirt S',          110),
  ('T-Shirt M',          120),
  ('T-Shirt L',          130),
  ('T-Shirt XL',         140),
  -- Offer variants (share size stock — owner sets alt promo price)
  ('T-Shirt Offer S',    210),
  ('T-Shirt Offer M',    220),
  ('T-Shirt Offer L',    230),
  ('T-Shirt Offer XL',   240),
  -- Staff variants (share size stock — staff discount)
  ('T-Shirt Staff S',    310),
  ('T-Shirt Staff M',    320),
  ('T-Shirt Staff L',    330),
  ('T-Shirt Staff XL',   340)
) as t(name, sort_order)
where l.slug in ('portugal', 'junior-camp')
  and not exists (
    select 1
    from public.pricing_catalog pc
    where pc.location_id = l.id
      and pc.category    = 'Merch'
      and lower(pc.name)  = lower(t.name)
  );

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect 12 rows per location (Portugal + Junior Camp). All sell_price = 0,
-- currency = EUR, show_in_camp_tab = true, active = true.
select
  l.slug,
  count(*)                                              as merch_rows,
  count(*) filter (where pc.name like 'T-Shirt %' and pc.name not like '% Offer %' and pc.name not like '% Staff %') as base_rows,
  count(*) filter (where pc.name like 'T-Shirt Offer %') as offer_rows,
  count(*) filter (where pc.name like 'T-Shirt Staff %') as staff_rows,
  count(*) filter (where pc.show_in_camp_tab)            as visible_in_pos
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Merch'
  and l.slug in ('portugal', 'junior-camp')
group by l.slug
order by l.slug;

-- ── Listagem por location (vê os 12 nomes ordenados) ───────────────────────
select
  l.slug,
  pc.name,
  pc.sell_price,
  pc.currency,
  pc.stock_qty,
  pc.sort_order
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Merch'
  and l.slug in ('portugal', 'junior-camp')
order by l.slug, pc.sort_order;
