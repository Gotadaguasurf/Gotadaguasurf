-- ════════════════════════════════════════════════════════════════════════════
--  Sri Lanka Dipløria — the consignment boardshorts in the Camp Tab (15 Nov 2026)
--  Miguel: «uma tab como as drinks para a Dipløria … os modelos todos e tamanhos e os stocks».
--
--  38 SKUs (model × size with stock > 0) = 62 units, from the sheet «Stock Dipløria Sri Lanka».
--  Written to BOTH tables the Camp Tab reads, like Portugal's Diploria rows:
--    · pricing_catalog (the master /prices list; the hub pushes show_in_camp_tab rows to the Camp Tab)
--    · location_menus  (the Camp Tab's own copy, so the tab shows before the next catalog push)
--  Idempotent: each SKU is updated in place (location + category 'Diploria' + name) or inserted.
--  Touches only Sri Lanka's 'Diploria' rows: no other category, no other location (Portugal untouched).
--  No staff price (staff_price_local / alt_price stay null). cost_per_guest 0: consignment, see the report.
--  NOT run by the agent — run it once the prices below are filled in.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ▼▼▼ PRICE (LKR per short, every model) — Miguel, 15 Nov 2026: «20000 no camp do sri lanka todos para testar» ▼▼▼
create temp table dip_price (price_lkr numeric not null) on commit drop;
insert into dip_price values (20000);
-- ▲▲▲ PRICE ▲▲▲

-- The stock (model, size, units, sort order) — 38 rows, 62 units.
create temp table dip_stock (model text, size int, qty int, sort_order int) on commit drop;
insert into dip_stock values
  ('Retro', 28, 1, 8000),
  ('Retro', 30, 3, 8001),
  ('Retro', 32, 1, 8003),
  ('Pocket Brown', 28, 1, 8010),
  ('Pocket Brown', 30, 2, 8011),
  ('Pocket Brown', 31, 1, 8012),
  ('Pocket Brown', 32, 1, 8013),
  ('Pocket Navy', 28, 1, 8020),
  ('Pocket Navy', 30, 2, 8021),
  ('Pocket Navy', 31, 2, 8022),
  ('Pocket Navy', 34, 1, 8025),
  ('Core Burgundy', 28, 1, 8030),
  ('Core Burgundy', 30, 4, 8031),
  ('Core Burgundy', 31, 3, 8032),
  ('Core Burgundy', 32, 1, 8033),
  ('Core Burgundy', 34, 2, 8035),
  ('Core Black', 28, 1, 8040),
  ('Core Black', 30, 3, 8041),
  ('Core Black', 31, 2, 8042),
  ('Core Black', 34, 2, 8045),
  ('Core Army Green', 28, 1, 8050),
  ('Core Army Green', 30, 3, 8051),
  ('Core Army Green', 31, 3, 8052),
  ('Core Army Green', 32, 3, 8053),
  ('Essential Green', 28, 1, 8060),
  ('Essential Green', 30, 1, 8061),
  ('Essential Green', 31, 1, 8062),
  ('Essential Green', 32, 1, 8063),
  ('Essential Green', 33, 2, 8064),
  ('Essential Green', 34, 2, 8065),
  ('Essential Grey', 30, 1, 8071),
  ('Essential Grey', 31, 1, 8072),
  ('Essential Grey', 32, 1, 8073),
  ('Essential Grey', 33, 2, 8074),
  ('Essential Grey', 34, 1, 8075),
  ('Euphoria Blue', 30, 1, 8081),
  ('Euphoria Blue', 32, 1, 8083),
  ('Euphoria Blue', 34, 1, 8085);

do $$ begin
  if (select count(*) from dip_stock) <> 38 or (select sum(qty) from dip_stock) <> 62 then raise exception 'stock list is not 38 SKUs / 62 units'; end if;
  if (select count(*) from dip_price) <> 1 then raise exception 'one price, please'; end if;
end $$;

-- 1 · pricing_catalog (master)
update public.pricing_catalog c set sell_price = p.price_lkr, sell_currency = 'LKR', currency = 'LKR', stock_qty = s.qty, sort_order = s.sort_order,
       show_in_camp_tab = true, active = true, alt_price = null, alt_label = null, updated_at = now()
  from dip_stock s cross join dip_price p, public.locations l
 where l.slug = 'sri-lanka' and c.location_id = l.id and c.category = 'Diploria' and c.name = s.model || ' ' || s.size;
insert into public.pricing_catalog (location_id, name, category, audience, sell_price, sell_currency, currency, cost_per_guest, show_in_camp_tab, show_in_transport_picker, active, sort_order, stock_qty)
select l.id, s.model || ' ' || s.size, 'Diploria', 'general', p.price_lkr, 'LKR', 'LKR', 0, true, false, true, s.sort_order, s.qty
  from dip_stock s cross join dip_price p cross join public.locations l
 where l.slug = 'sri-lanka'
   and not exists (select 1 from public.pricing_catalog c where c.location_id = l.id and c.category = 'Diploria' and c.name = s.model || ' ' || s.size);

-- 2 · location_menus (the Camp Tab's copy)
update public.location_menus m set price_local = p.price_lkr, stock_qty = s.qty, sort_order = s.sort_order, active = true, staff_price_local = null
  from dip_stock s cross join dip_price p, public.locations l
 where l.slug = 'sri-lanka' and m.location_id = l.id and m.category = 'Diploria' and m.item_name = s.model || ' ' || s.size;
insert into public.location_menus (location_id, category, item_name, price_local, stock_qty, sort_order, active)
select l.id, 'Diploria', s.model || ' ' || s.size, p.price_lkr, s.qty, s.sort_order, true
  from dip_stock s cross join dip_price p cross join public.locations l
 where l.slug = 'sri-lanka'
   and not exists (select 1 from public.location_menus m where m.location_id = l.id and m.category = 'Diploria' and m.item_name = s.model || ' ' || s.size);

commit;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select count(*) skus, sum(stock_qty) units from public.pricing_catalog c join public.locations l on l.id = c.location_id where l.slug = 'sri-lanka' and c.category = 'Diploria';   -- 38 · 62
-- select count(*) skus, sum(stock_qty) units from public.location_menus m join public.locations l on l.id = m.location_id where l.slug = 'sri-lanka' and m.category = 'Diploria';    -- 38 · 62
-- select l.slug, count(*) from public.pricing_catalog c join public.locations l on l.id = c.location_id where c.category = 'Diploria' group by 1;                                       -- portugal 6 (unchanged) · sri-lanka 38
