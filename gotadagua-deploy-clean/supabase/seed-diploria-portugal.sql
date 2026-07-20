-- ════════════════════════════════════════════════════════════════════════════
--  DIPLORIA — boardshort stock for the Portugal camp POS
--
--  New POS tab (Portugal only) holding the Diploria boardshort line:
--  colour × waist-size SKUs at €65 each. Stock snapshot "FTR 06/07":
--  28 SKUs, 45 units.
--
--  Stock model is STANDALONE — the item name IS the SKU, so each
--  colour+size keeps its own counter (unlike Merch, where "T-Shirt
--  Offer L" borrows from "T-Shirt L" stock). See diploriaStockLeft in
--  camp-tab-inner.html.
--
--  Upserts on the (location_id, category, item_name, price_local) unique
--  index, so re-running refreshes stock instead of duplicating. To
--  restock later: change the quantity here and re-run, or edit it
--  directly in the POS menu editor.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.location_menus
  (id, location_id, category, item_name, price_local, stock_qty,
   description, staff_price_local, sort_order, active)
select gen_random_uuid(),
       (select id from public.locations where slug = 'portugal'),
       'Diploria', v.item_name, 65, v.stock_qty,
       null, null, v.sort_order, true
from (values
  ('Retro 28', 2, 4010),
  ('Retro 30', 2, 4020),
  ('Retro 31', 2, 4030),
  ('Pocket Brown 28', 1, 4040),
  ('Pocket Brown 30', 2, 4050),
  ('Pocket Brown 31', 1, 4060),
  ('Pocket Brown 32', 2, 4070),
  ('Pocket Navy 31', 2, 4080),
  ('Pocket Navy 32', 1, 4090),
  ('Pocket Navy 33', 1, 4100),
  ('Pocket Navy 34', 1, 4110),
  ('Core Burgundy 28', 2, 4120),
  ('Core Burgundy 30', 2, 4130),
  ('Core Burgundy 31', 1, 4140),
  ('Core Burgundy 32', 1, 4150),
  ('Core Black 28', 2, 4160),
  ('Core Black 30', 2, 4170),
  ('Core Black 31', 2, 4180),
  ('Core Black 32', 1, 4190),
  ('Core Black 33', 1, 4200),
  ('Core Black 34', 1, 4210),
  ('Core Army Green 28', 2, 4220),
  ('Core Army Green 30', 2, 4230),
  ('Core Army Green 31', 1, 4240),
  ('Core Army Green 32', 2, 4250),
  ('Core Army Green 33', 1, 4260),
  ('Essential Green 30', 3, 4270),
  ('Essential Grey 30', 2, 4280)
) as v(item_name, stock_qty, sort_order)
on conflict (location_id, category, item_name, price_local)
do update set stock_qty  = excluded.stock_qty,
              sort_order = excluded.sort_order,
              active     = true;

-- Sanity: esperado 28 SKUs / 45 units / preco 65
select count(*) as skus, sum(stock_qty) as units, min(price_local) as preco
  from public.location_menus
 where category = 'Diploria'
   and location_id = (select id from public.locations where slug = 'portugal');
