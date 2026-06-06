-- ════════════════════════════════════════════════════════════════════════════
--  Pricing Catalog — Merch stock tracking
--  Adds pricing_catalog.stock_qty so Merch rows carry their on-hand count
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why
--  ───
--  Merch (T-Shirts, hats, etc.) is finally getting a Pricing Catalog tab
--  so the owner can manage prices in ONE place (same way Tours are
--  managed today). Merch needs one extra field that Tours don't:
--  how many units are on hand.
--
--  Behaviour
--  ─────────
--    • stock_qty is a non-negative integer.
--    • NULL is allowed and means "stock tracking disabled" — Tours and
--      every non-Merch row simply leave it null forever; nothing reads it
--      for those categories.
--    • The owner decrements stock_qty manually when stock arrives
--      / leaves (Phase A). A future phase may auto-decrement when a
--      guest charges the item to their Camp Tab.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.pricing_catalog
  add column if not exists stock_qty integer;

-- Optional sanity constraint — stock can't be negative. Wrap in DO so
-- a re-run after a prior add doesn't error out on the duplicate
-- constraint name.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pricing_catalog_stock_qty_nonneg'
  ) then
    alter table public.pricing_catalog
      add constraint pricing_catalog_stock_qty_nonneg
      check (stock_qty is null or stock_qty >= 0);
  end if;
end $$;

-- ── Quick visibility into Merch stock per location ─────────────────────────
-- Run this after adding the first Merch rows from /prices to confirm
-- everything saved cleanly.
select
  l.slug,
  pc.name,
  pc.sell_price,
  pc.currency,
  pc.stock_qty,
  pc.show_in_camp_tab,
  pc.active
from public.pricing_catalog pc
join public.locations       l on l.id = pc.location_id
where pc.category = 'Merch'
order by l.slug, pc.sort_order;
