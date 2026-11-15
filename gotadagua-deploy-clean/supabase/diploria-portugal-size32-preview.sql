-- ════════════════════════════════════════════════════════════════════════════
--  PROPOSAL, NOT RUN: map the three old model-named Portugal Dipløria lines to «Size 32»
--
--  Portugal's catalog is sizes only («Size 28…34», 42 units, opening moves dated
--  15 Nov 2026). Three Camp Tab lines still carry the old model names, all size 32:
--    25 Jul  «Core Army Green 32»  paid 65 €
--     5 Aug  «Core Burgundy 32»    not paid
--     5 Aug  «Pocket Brown 32»     not paid
--  /diploria/ counts them as sales (money) but not against stock (no SKU of that
--  name), so «Size 32» shows 4 left of 4.
--
--  DECIDE FIRST (Miguel): was the 15 Nov opening figure of «Size 32» (4) a physical
--  count made AFTER these sales?
--    · YES (counted on the shelf in Nov) → do NOT rename: the 4 already exclude the
--      shorts sold in Jul/Aug; renaming would take them off a second time (4 → 1).
--      The same is true of «Size 31» (sold 1 Oct, 9 opening → 8 left now).
--    · NO (the 4 came from an older sheet, before the sales) → rename: 4 → 1 left.
--  Renaming changes only item_name; price, paid state and the money (owed 130 €) do not move.
--
--  Part 1 is a SELECT preview (safe). Part 2 is the change, commented out.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Part 1: preview (SELECT only) ─────────────────────────────────────────────
with pt as (select id from public.locations where slug = 'portugal'),
lines as (
  select i.id, i.item_name, i.price_local, i.added_at::date as added, i.paid_at::date as paid,
         'Size ' || substring(i.item_name from '(\d{2})\s*$') as proposed_sku
    from public.camp_tab_items i
   where i.location_id = (select id from pt) and i.category = 'Diploria'
     and i.item_name !~* '^size \d{2}$'
)
select * from lines order by added;

-- «left» per Portugal size today vs after the rename (= Σ moves − Camp Tab lines with that exact name).
with pt as (select id from public.locations where slug = 'portugal'),
mv as (select lower(btrim(sku)) k, sum(qty) stock from public.diploria_stock_moves where location_id = (select id from pt) group by 1),
now_ as (select lower(btrim(item_name)) k, count(*) n from public.camp_tab_items
          where location_id = (select id from pt) and category = 'Diploria' group by 1),
after_ as (select lower(case when item_name ~* '^size \d{2}$' then btrim(item_name)
                             else 'Size ' || substring(item_name from '(\d{2})\s*$') end) k, count(*) n
             from public.camp_tab_items where location_id = (select id from pt) and category = 'Diploria' group by 1)
select initcap(mv.k) as sku, mv.stock,
       mv.stock - coalesce(now_.n, 0)   as left_now,
       mv.stock - coalesce(after_.n, 0) as left_after_rename
  from mv left join now_ on now_.k = mv.k left join after_ on after_.k = mv.k
 order by mv.k;

-- ── Part 2: the change (commented out — run only after Miguel says «renomeia») ───
-- begin;
-- update public.camp_tab_items i
--    set item_name = 'Size ' || substring(i.item_name from '(\d{2})\s*$')
--  where i.location_id = (select id from public.locations where slug = 'portugal')
--    and i.category = 'Diploria'
--    and i.item_name in ('Core Army Green 32', 'Core Burgundy 32', 'Pocket Brown 32');   -- expect 3 rows
-- commit;
-- The Camp Tab re-reads camp_tab_items on boot and on realtime changes. A device left open with the old
-- state only writes a line back when that line changes there (dirty upsert): reload the Portugal Camp Tab
-- after running, especially before anyone pays the two August lines.
