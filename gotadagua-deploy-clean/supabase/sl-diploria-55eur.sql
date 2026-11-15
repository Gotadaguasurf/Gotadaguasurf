-- ════════════════════════════════════════════════════════════════════════════
--  Sri Lanka Dipløria — 55 EUR a short, pass-through (Miguel, 15 Nov 2026)
--
--  New rules: every model 55 EUR (not LKR). The guest pays by card straight into the Dipløria owner's
--  account; for the camp it is pass-through (no revenue, no cash, no cost). The Camp Tab (build/sl-diploria-pay)
--  shows Sri Lanka's Diploria lines in € in their own block, pays them on their own («Pay Dipløria», method
--  «Card → Dipløria») and never writes a ledger row for them.
--
--  Currency: pricing_catalog carries it (sell_currency / currency = 'EUR'). location_menus has only
--  price_local and no currency column; the Camp Tab never read a row's currency anyway (it uses the
--  location's). So Sri Lanka's Diploria lines are EUR by rule in the app (isPassThrough in
--  camp-hub/camp-tab-inner.html → «€55», camp_tab_items.currency = 'EUR'). No schema change needed.
--
--  Stock: Retro 32 is 0 now (the sheet's totals were not updated: Retro 4, size 32 = 8, total 61).
--  The row is kept active at 0, so the size grid still shows 32 greyed. 38 rows, 61 units.
--
--  Idempotent; touches only Sri Lanka's 'Diploria' rows (both tables). Refuses to run if a Sri Lanka
--  Dipløria sale already exists in camp_tab_items (those were taken at 20,000 LKR — decide them first).
--  NOT run by the agent.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- 0 · No Sri Lanka Dipløria sale may exist yet.
do $$
declare v_n int; v_list text;
begin
  select count(*), string_agg(coalesce(g.name, '?') || ' · ' || i.item_name || ' · ' || i.price_local || ' ' || coalesce(i.currency, '') || ' · ' || to_char(i.added_at, 'YYYY-MM-DD'), E'\n')
    into v_n, v_list
    from public.camp_tab_items i join public.locations l on l.id = i.location_id left join public.camp_guests g on g.id = i.guest_id
   where l.slug = 'sri-lanka' and i.category = 'Diploria';
  if v_n > 0 then raise exception 'Stop: % Sri Lanka Dipløria sale(s) already exist:%', v_n, E'\n' || v_list; end if;
end $$;

-- ▼▼▼ PRICE — 55 EUR every model ▼▼▼
create temp table dip_price (price numeric not null, currency text not null) on commit drop;
insert into dip_price values (55, 'EUR');
-- ▲▲▲ PRICE ▲▲▲

-- 1 · pricing_catalog (master): 55 EUR, Retro 32 at 0
update public.pricing_catalog c set sell_price = p.price, sell_currency = p.currency, currency = p.currency, updated_at = now()
  from dip_price p, public.locations l
 where l.slug = 'sri-lanka' and c.location_id = l.id and c.category = 'Diploria'
   and (c.sell_price, coalesce(c.sell_currency, ''), c.currency) is distinct from (p.price, p.currency, p.currency);
update public.pricing_catalog c set stock_qty = 0, updated_at = now()
  from public.locations l
 where l.slug = 'sri-lanka' and c.location_id = l.id and c.category = 'Diploria' and c.name = 'Retro 32' and c.stock_qty is distinct from 0;

-- 2 · location_menus (the Camp Tab's copy): price_local 55 (EUR by rule in the app), Retro 32 at 0
update public.location_menus m set price_local = p.price
  from dip_price p, public.locations l
 where l.slug = 'sri-lanka' and m.location_id = l.id and m.category = 'Diploria' and m.price_local is distinct from p.price;
update public.location_menus m set stock_qty = 0
  from public.locations l
 where l.slug = 'sri-lanka' and m.location_id = l.id and m.category = 'Diploria' and m.item_name = 'Retro 32' and m.stock_qty is distinct from 0;

-- 3 · The guard: 38 rows, 61 units, Retro 4, in both tables
do $$
declare a record; b record;
begin
  select count(*) n, coalesce(sum(c.stock_qty), 0) u, coalesce(sum(c.stock_qty) filter (where c.name like 'Retro %'), 0) r,
         bool_and(c.sell_price = 55 and c.currency = 'EUR') eur into a
    from public.pricing_catalog c join public.locations l on l.id = c.location_id where l.slug = 'sri-lanka' and c.category = 'Diploria' and c.active;
  select count(*) n, coalesce(sum(m.stock_qty), 0) u, coalesce(sum(m.stock_qty) filter (where m.item_name like 'Retro %'), 0) r,
         bool_and(m.price_local = 55) eur into b
    from public.location_menus m join public.locations l on l.id = m.location_id where l.slug = 'sri-lanka' and m.category = 'Diploria' and m.active;
  if a.n not in (37, 38) or a.u <> 61 or a.r <> 4 or not a.eur then raise exception 'pricing_catalog: % rows, % units, Retro %, 55 EUR % — expected 38, 61, 4', a.n, a.u, a.r, a.eur; end if;
  if b.n not in (37, 38) or b.u <> 61 or b.r <> 4 or not b.eur then raise exception 'location_menus: % rows, % units, Retro %, 55 % — expected 38, 61, 4', b.n, b.u, b.r, b.eur; end if;
end $$;

commit;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select count(*), sum(stock_qty), min(sell_price), max(sell_price), min(currency), max(currency) from public.pricing_catalog c join public.locations l on l.id = c.location_id where l.slug = 'sri-lanka' and c.category = 'Diploria';   -- 38 · 61 · 55 · 55 · EUR · EUR
-- select item_name, stock_qty from public.location_menus m join public.locations l on l.id = m.location_id where l.slug = 'sri-lanka' and m.category = 'Diploria' and item_name like 'Retro %' order by 1;                     -- 28:1 30:3 32:0
-- select count(*) from public.camp_tab_items i join public.locations l on l.id = i.location_id where l.slug = 'sri-lanka' and i.category = 'Diploria';                                                                     -- 0
