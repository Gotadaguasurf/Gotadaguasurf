-- ════════════════════════════════════════════════════════════════════════════
--  Migration — copy existing Drinks from location_menus into pricing_catalog
-- ════════════════════════════════════════════════════════════════════════════
--
--  Mirror of migrate-merch-to-pricing-catalog.sql for the Drinks category.
--  Same shape, same idempotency rules:
--    • Copies every active Drinks row from location_menus into
--      pricing_catalog with show_in_camp_tab=true.
--    • Skips rows that already exist (matched by location + name) so
--      re-runs after a user edit don't overwrite the catalog version.
--    • Does NOT delete from location_menus — the original rows survive
--      as a fallback until the Drinks-from-catalog wiring is confirmed
--      working everywhere.
--
--  Pre-reqs (run these first if you haven't):
--    1. add-pricing-catalog-stock-qty.sql   (column for stock)
--    2. add-pricing-catalog-alt-price.sql   (columns for alt price)
--
--  Idempotent. Safe to re-run.
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
  lm.location_id,
  lm.item_name,
  'Drinks',
  'general',
  coalesce(lm.price_local, 0),
  0,                                  -- cost unknown; owner can edit later
  coalesce(l.currency, 'EUR'),
  coalesce(l.currency, 'EUR'),
  lm.stock_qty,
  true,                               -- visible in Camp Tab POS
  false,
  true,
  100 + row_number() over (
    partition by lm.location_id
    order by lm.item_name
  )
from public.location_menus lm
join public.locations       l on l.id = lm.location_id
where lm.category = 'Drinks'
  and lm.active = true
  -- Skip rows that already exist in the catalog (by name + location) so
  -- re-runs are no-ops on previously-migrated items.
  and not exists (
    select 1
    from public.pricing_catalog pc
    where pc.location_id = lm.location_id
      and pc.category    = 'Drinks'
      and lower(pc.name) = lower(lm.item_name)
  );

-- ── Verify ─────────────────────────────────────────────────────────────────
select
  l.slug,
  count(*)                                            as drink_rows,
  count(*) filter (where pc.stock_qty is not null)    as with_stock,
  count(*) filter (where pc.show_in_camp_tab)         as visible_in_pos,
  sum(coalesce(pc.stock_qty, 0))                      as total_units_on_hand
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Drinks'
group by l.slug
order by l.slug;
