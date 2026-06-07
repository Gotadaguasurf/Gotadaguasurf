-- ════════════════════════════════════════════════════════════════════════════
--  Seed hoodie structure for Portugal + Junior Camp
-- ════════════════════════════════════════════════════════════════════════════
--
--  Same shape as the t-shirts: 4 sizes × 3 variants = 12 rows per location.
--  Base rows ("Hoodie S", "Hoodie M", …) carry the stock counter; the
--  Offer / Staff variants share it via the product-type + size grouping
--  that camp-tab-inner.html now does in merchStockLeft (see the JS update
--  shipped alongside this SQL).
--
--  Variants per size
--  ─────────────────
--    • Hoodie S/M/L/XL          — base row (carries the stock counter)
--    • Hoodie Offer S/M/L/XL    — promotional variant (shares stock)
--    • Hoodie Staff S/M/L/XL    — staff price (shares stock)
--
--  Initial values
--  ──────────────
--    • sell_price = 0           — owner sets actual EUR price in /prices
--    • alt_price  = null        — base rows can later get an Offer pill
--    • stock_qty  = null        — tracking off until owner enables it
--    • currency / sell_currency = the location's locked currency (EUR)
--    • show_in_camp_tab = true  — appears in the POS Merch grid
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
  ('Hoodie S',          410),
  ('Hoodie M',          420),
  ('Hoodie L',          430),
  ('Hoodie XL',         440),
  -- Offer variants (share size stock — owner sets alt promo price)
  ('Hoodie Offer S',    510),
  ('Hoodie Offer M',    520),
  ('Hoodie Offer L',    530),
  ('Hoodie Offer XL',   540),
  -- Staff variants (share size stock — staff discount)
  ('Hoodie Staff S',    610),
  ('Hoodie Staff M',    620),
  ('Hoodie Staff L',    630),
  ('Hoodie Staff XL',   640)
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
-- Expect 12 hoodie rows per location.
select
  l.slug,
  count(*) filter (where pc.name like 'Hoodie %' and pc.name not like '% Offer %' and pc.name not like '% Staff %') as base_rows,
  count(*) filter (where pc.name like 'Hoodie Offer %') as offer_rows,
  count(*) filter (where pc.name like 'Hoodie Staff %') as staff_rows,
  count(*) filter (where pc.name like 'Hoodie %')       as hoodie_total
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Merch'
  and l.slug in ('portugal', 'junior-camp')
group by l.slug
order by l.slug;

-- ── All merch per location (overview) ──────────────────────────────────────
select
  l.slug,
  count(*) as total_merch_rows
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Merch'
  and l.slug in ('portugal', 'junior-camp')
group by l.slug
order by l.slug;
