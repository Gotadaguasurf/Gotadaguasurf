-- ════════════════════════════════════════════════════════════════════════════
--  Migration — copy existing Merch from location_menus into pricing_catalog
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why
--  ───
--  Until Phase B, Camp Tab Merch was edited inside the POS itself
--  (location_menus table). Phase B moves Merch to the Pricing Catalog
--  (pricing_catalog) so the owner can edit it ONCE in /prices and the
--  Camp Tab just reads it — same architecture as Tours.
--
--  This migration copies every active Merch row from location_menus into
--  pricing_catalog with show_in_camp_tab=true so they immediately appear
--  in /prices AND keep showing in the Camp Tab POS.
--
--  Behaviour
--  ─────────
--  • Idempotent — re-running won't create duplicates. We check name +
--    location_id BEFORE inserting; existing rows are left untouched (so
--    a /prices edit made between two runs doesn't get overwritten).
--  • Reads stock_qty from location_menus into pricing_catalog.stock_qty
--    (requires add-pricing-catalog-stock-qty.sql to be run first).
--  • Sets sell_currency = the location's locked currency so the catalog
--    list shows MAD / LKR / EUR consistently.
--  • Does NOT touch location_menus — original rows survive for safety.
--    Once you've confirmed the Catalog feels right and nothing depends
--    on location_menus for Merch anymore, you can manually delete those
--    rows. Until then having both is harmless: location_menus will be
--    overridden by the catalog push in the POS (Phase B code).
--
--  Run order
--  ─────────
--    1. add-pricing-catalog-stock-qty.sql   (column for stock)
--    2. add-pricing-catalog-alt-price.sql   (columns for alt price)
--    3. THIS FILE                            (copy existing rows)
--
--  Safe to re-run anytime.
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
  'Merch',
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
where lm.category = 'Merch'
  and lm.active = true
  -- Skip rows that already exist in the catalog (by name + location) so
  -- re-runs are no-ops on previously-migrated items.
  and not exists (
    select 1
    from public.pricing_catalog pc
    where pc.location_id = lm.location_id
      and pc.category    = 'Merch'
      and lower(pc.name) = lower(lm.item_name)
  );

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Confirm every location now has its Merch in the catalog with stock.
select
  l.slug,
  count(*)                                            as merch_rows,
  count(*) filter (where pc.stock_qty is not null)    as with_stock,
  count(*) filter (where pc.show_in_camp_tab)         as visible_in_pos,
  sum(coalesce(pc.stock_qty, 0))                      as total_units_on_hand
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Merch'
group by l.slug
order by l.slug;
