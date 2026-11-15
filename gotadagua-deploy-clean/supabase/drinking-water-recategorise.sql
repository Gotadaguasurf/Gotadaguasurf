-- ════════════════════════════════════════════════════════════════════════════
--  Past water-dispenser rows OUT OF THE BAR → «Drinking water» (Miguel, 15 Nov
--  2026: «para trás tira o water dispenser do bar para ver os profits reais»).
--
--  Run AFTER supabase/drinking-water-category.sql. Preview first (SELECT only):
--  supabase/drinking-water-recategorise-preview.sql. Rollback (both files):
--  supabase/drinking-water-recategorise-rollback.sql. NOT RUN — never executed
--  against production; only the preview's SELECTs were dry-run (15 Nov 2026).
--
--  Searched 15 Nov 2026 over every camp and every date (ledger_entries,
--  expense, description ~ dispens|dispnser|mineral|eau|aqua|water bottle…):
--  only 2 water-dispenser rows were ever filed under «Drinks» (the bar), both
--  Sri Lanka, Nov 2026, 18,000 LKR. The other 16 dispenser refills sit in Food
--  (15) and Utilities (1) — they never touched the bar margin; moving them is a
--  separate choice: supabase/drinking-water-recategorise-food.sql.
--  Morocco «2 bottles» / «3 bottles» (Utilities, 105 / 165 MAD) are gas
--  bottles; Portugal «Água» rows are the SMAS water bill. Not touched.
--
--    A  2 rows  Drinks/Bar → Drinking water/Utilities  18,000 LKR (bar cost −18,000)
--
--  Idempotent: each update matches id AND the old category (and hq_invoice_id
--  null), so a second run changes nothing. amount_* never change, so
--  hq_overview_rollup() (one-formula.sql: ledger summed by type / slug /
--  source_kind) gives the same totals before and after.
--  The final SELECT is the only output (q.py prints the last statement):
--  moved count, anything not moved, and before → after per camp × month ×
--  category (before rebuilt from the listed old category).
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop table if exists _dw_moves;
create temp table _dw_moves (id uuid primary key, grp text, old_cat text, old_area text, new_cat text, new_area text, entry_date date, amount_local numeric, description text);
insert into _dw_moves values
  ('34d0abca-858e-4279-ac05-dfb68d5b0605','A','Drinks','Bar','Drinking water','Utilities','2026-11-02',  9000,'Water Dispnser'),
  ('555d6283-46e6-48fe-a237-17a3318ccdde','A','Drinks','Bar','Drinking water','Utilities','2026-11-14',  9000,'Water Dispenser');

do $$ begin
  if not exists (select 1 from hq_invoice_categories where name = 'Drinking water') then
    raise exception 'Run supabase/drinking-water-category.sql first';
  end if;
end $$;

update ledger_entries e
   set category = m.new_cat, business_area = m.new_area
  from _dw_moves m
 where e.id = m.id and e.category = m.old_cat and e.hq_invoice_id is null;

with t as (
  select l.slug, to_char(e.entry_date, 'YYYY-MM') mon, e.category after_cat,
         coalesce(case when m.id is not null and e.category = m.new_cat then m.old_cat end, e.category) before_cat, e.amount_local
    from ledger_entries e join locations l on l.id = e.location_id left join _dw_moves m on m.id = e.id
   where e.type = 'expense' and l.slug = 'sri-lanka' and e.category in ('Drinks','Food','Utilities','Drinking water')
)
select json_build_object(
  'listed', (select count(*) from _dw_moves),
  'now_drinking_water', (select count(*) from _dw_moves m join ledger_entries e on e.id = m.id and e.category = 'Drinking water' and e.business_area = 'Utilities'),
  'not_moved', (select json_agg(json_build_object('id', m.id, 'category_now', e.category)) from _dw_moves m left join ledger_entries e on e.id = m.id where e.id is null or e.category <> 'Drinking water'),
  'water_rows_left_in_drinks', (select json_agg(json_build_object('id', e.id, 'date', e.entry_date, 'desc', e.description)) from ledger_entries e where e.type = 'expense' and e.category = 'Drinks' and e.description ~* 'dispens|dispnser'),
  'before_after', (select json_agg(x order by x.mon, x.category) from (
      select mon, c.category,
             round(sum(case when before_cat = c.category then amount_local else 0 end)) before_lkr,
             round(sum(case when after_cat  = c.category then amount_local else 0 end)) after_lkr
        from t cross join (values ('Drinks'),('Food'),('Utilities'),('Drinking water')) c(category)
       group by 1, 2
      having sum(case when before_cat = c.category then amount_local else 0 end) <> sum(case when after_cat = c.category then amount_local else 0 end)) x)
) result;

commit;

-- Mixed rows in «Drinks» and the ambiguous Equipment rows: see the bottom of
-- supabase/drinking-water-recategorise-food.sql (not moved; Miguel decides).
