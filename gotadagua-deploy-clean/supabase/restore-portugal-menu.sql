-- ════════════════════════════════════════════════════════════════════════════
--  RESTORE — Portugal POS menu, rebuilt from pricing_catalog
--
--  Portugal's location_menus was overwritten with the Sri Lanka
--  DEFAULT_MENU (26 LKR drinks, tees at 6500, Tours + Extras + Lesson +
--  Add-ons gone) after camp-tab-inner.html was opened standalone, with no
--  parent hub feeding it the catalog. See the MENU_HYDRATED guard in
--  camp-tab-inner.html, which makes that write impossible now.
--
--  Nothing was actually lost: pricing_catalog is the source of truth the
--  hub itself pushes from. This rebuilds the POS menu from it directly,
--  using the same category → tab mapping the hub uses
--  (CAMPTAB_CATEGORY_TO_TAB + the per-category loaders):
--      Tour          → Tours
--      Other Service → Add-ons
--      Merch/Extras/Drinks/Lesson → same name
--  Only rows with show_in_camp_tab = true make it into the POS.
--
--  Diploria is deliberately preserved — it lives only in location_menus
--  (no catalog rows), so it must survive the wipe.
--
--  Idempotent: re-running produces the same 20 catalog rows + Diploria.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- 1. Drop the corrupted menu. Diploria stays (not catalog-managed).
delete from public.location_menus
 where location_id = (select id from public.locations where slug = 'portugal')
   and category <> 'Diploria';

-- 2. Rebuild every POS-enabled catalog row.
insert into public.location_menus
  (id, location_id, category, item_name, price_local, stock_qty,
   description, staff_price_local, sort_order, active)
select gen_random_uuid(),
       c.location_id,
       case c.category
         when 'Tour'          then 'Tours'
         when 'Other Service' then 'Add-ons'
         else c.category
       end,
       c.name,
       c.sell_price,
       c.stock_qty,
       nullif(c.notes, ''),
       case when lower(coalesce(c.alt_label, '')) = 'staff' then c.alt_price end,
       coalesce(c.sort_order, 0),
       true
  from public.pricing_catalog c
 where c.location_id = (select id from public.locations where slug = 'portugal')
   and c.active
   and c.show_in_camp_tab
on conflict (location_id, category, item_name, price_local) do nothing;

commit;

-- Sanity — esperado:
--   Add-ons 1 · Diploria 28 · Extras 4 · Lesson 2 · Merch 8 · Tours 5
--   (48 no total, ZERO Drinks)
select category, count(*) as n, min(price_local) as preco_min, max(price_local) as preco_max
  from public.location_menus
 where location_id = (select id from public.locations where slug = 'portugal')
 group by category
 order by category;
