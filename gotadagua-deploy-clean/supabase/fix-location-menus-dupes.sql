-- ════════════════════════════════════════════════════════════════════════════
--  LOCATION_MENUS — dedup + unique guard (the "Maxime sees every tee ×3" bug)
--
--  Root cause: syncCampTabMenuToSupabase was a non-atomic DELETE+INSERT.
--  Two browsers syncing at once interleave as "A deletes, B deletes,
--  A inserts, B inserts" → the table ends with 2-3 copies of every menu
--  item. Whoever hydrates fresh from the DB (Maxime) sees the dupes,
--  each copy carrying a stock snapshot from a different moment (hence
--  "Out of stock" next to "24 left" for the same tee); a long-open tab
--  (Miguel) keeps showing its clean in-memory copy.
--
--  Client fixes shipped alongside this file:
--    • normalizeMenu dedups on every entry path (view heals immediately)
--    • sync uses upsert against the unique index below (race-proof)
--
--  This SQL: 1) removes existing duplicates keeping the first copy per
--  (location, category, name, price) — preferring a copy that still has
--  a stock value; 2) adds the unique index the upsert targets.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Dedup. Survivor per tuple = the row with stock info first (so we
--    don't orphan the stock counter), then lowest sort_order, then id.
delete from public.location_menus a
using public.location_menus b
where a.location_id  = b.location_id
  and a.category     = b.category
  and a.item_name    = b.item_name
  and a.price_local  = b.price_local
  and a.id <> b.id
  and (
    -- b outranks a → a goes
    (b.stock_qty is not null and a.stock_qty is null)
    or (
      (b.stock_qty is not null) = (a.stock_qty is not null)
      and (b.sort_order < a.sort_order
           or (b.sort_order = a.sort_order and b.id < a.id))
    )
  );

-- 2. Unique guard — the sync's upsert conflicts on exactly this tuple.
create unique index if not exists uq_location_menus_item
  on public.location_menus (location_id, category, item_name, price_local);

-- 3. Sanity: zero rows expected.
select location_id, category, item_name, price_local, count(*)
  from public.location_menus
 group by 1,2,3,4
having count(*) > 1;
