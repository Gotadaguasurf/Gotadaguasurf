-- ════════════════════════════════════════════════════════════════════════════
--  OPTIONAL, separate decision: the other past water-dispenser refills (filed
--  under Food / Utilities) → «Drinking water». Not about the bar margin.
--
--  Run AFTER supabase/drinking-water-category.sql. Preview first (SELECT only):
--  supabase/drinking-water-recategorise-preview.sql. Rollback (both files):
--  supabase/drinking-water-recategorise-rollback.sql. NOT RUN — never executed
--  against production; only the preview's SELECTs were dry-run (15 Nov 2026).
--
--  These never counted against the bar. Moving them makes the Food control
--  card honest (water is not food) and puts all the dispenser cost in one
--  place: Food −146,550 LKR over Jan–Oct 2026, Utilities −14,850 (Apr).
--
--    B 15 rows  Food/Food → Drinking water/Food          146,550 LKR
--    C  1 row   Utilities/Utilities → Drinking water/Food 14,850 LKR
--  Not moved: hardware (New Water Dispenser 42,399 · Repair 1,800 · Cover
--  1,000 · Bottle Stand · 60 Water Glasses · Water Bowser) and the AMBIGUOUS
--  rows listed at the bottom.
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
  ('b00c53fd-2374-4e2b-813c-7395d2b91c5a','B','Food','Food','Drinking water','Food','2026-01-09', 16000,'Water Dispenser · Prasanna'),
  ('31dffe09-5417-4477-9b3f-2fd5c16a5b54','B','Food','Food','Drinking water','Food','2026-01-09',  5000,'Water Dispenser · Prasanna'),
  ('28e89e86-259c-48e7-974b-000d458890c1','B','Food','Food','Drinking water','Food','2026-01-15',  8000,'Water Dispenser · Prasana'),
  ('35f9fdff-179d-4103-9964-b4a9adbcefe7','B','Food','Food','Drinking water','Food','2026-01-25', 12800,'Water Dispenser · Prasana'),
  ('6fe30765-3146-4f62-92bc-bb16f8691f70','B','Food','Food','Drinking water','Food','2026-02-03', 10000,'Water Dispenser · Prasana'),
  ('4ed9b590-dced-40d7-b296-c8236c8b47ae','B','Food','Food','Drinking water','Food','2026-02-22', 13200,'Water Dispenser'),
  ('cff04124-9df8-4e64-bb8f-d1e652a21465','B','Food','Food','Drinking water','Food','2026-03-11', 11200,'Water Dispenser'),
  ('dbfa740d-eb47-4259-85dc-95d8fb4d7453','B','Food','Food','Drinking water','Food','2026-03-26', 14100,'Water Dispenser'),
  ('20323e5a-96d3-4d8d-8e77-71cbd6d43a07','B','Food','Food','Drinking water','Food','2026-04-20',  6750,'Water Dispenser'),
  ('c355c32f-96a9-4292-8f94-9b8a349e54f3','B','Food','Food','Drinking water','Food','2026-05-11', 16200,'Water Dispenser'),
  ('477820bf-15cb-46e9-b930-4da15ee52dbb','B','Food','Food','Drinking water','Food','2026-06-24',  4500,'Water Dispenser ( Bottles )'),
  ('5a709885-2001-42a7-a25a-1685e82b6ca7','B','Food','Food','Drinking water','Food','2026-07-25',  5400,'Water Dispenser'),
  ('ce28a523-c65a-486f-ab0d-1493437fe9df','B','Food','Food','Drinking water','Food','2026-09-03',  9900,'Water Dispenser'),
  ('fd9823ac-26f4-418a-ad05-00e9c669f2cf','B','Food','Food','Drinking water','Food','2026-09-23',  6750,'Water Dispenser'),
  ('e39cbb91-9187-4bd4-8c9c-703deb89fd55','B','Food','Food','Drinking water','Food','2026-10-22',  6750,'Water Dispenser'),
  ('d3e2d2f3-2455-47e5-9673-32aa8b302d27','C','Utilities','Utilities','Drinking water','Food','2026-04-12', 14850,'Water Dispenser');

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
  'now_drinking_water', (select count(*) from _dw_moves m join ledger_entries e on e.id = m.id and e.category = 'Drinking water' and e.business_area = 'Food'),
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

-- ════════════════════════════════════════════════════════════════════════════
--  AMBIGUOUS — NOT moved. For Miguel.
--
--  a) «Water Dispenser» filed under Equipment & maintenance. The amounts fit
--     refills at 400–450 LKR per 20 L bottle (7,200 = 16 × 450; 11,200 is the
--     same as the Food refill of 11 Mar, and «Prassana» is the refill
--     supplier), but they could be a dispenser machine:
--       4e198225-13a9-4125-89c4-c78eb8a51db4  2026-02-10  11,200  Water Dispenser · Prassana
--       297a8f3b-e7ca-42d8-b27b-20c915b28978  2026-03-01  10,000  Water Dispenser
--       dce4501f-f20a-4fd3-a88e-f83770f26ac4  2026-10-08   7,200  Water Dispenser
--     If they are refills, run:
--       update ledger_entries set category = 'Drinking water', business_area = 'Food'
--        where id in ('4e198225-13a9-4125-89c4-c78eb8a51db4','297a8f3b-e7ca-42d8-b27b-20c915b28978','dce4501f-f20a-4fd3-a88e-f83770f26ac4')
--          and category = 'Equipment & maintenance';
--
--  b) Mixed / not bar stock but filed under Drinks (not water, so not moved):
--       6484c0d4-6d57-494b-a28a-fecf5a99742a  sri-lanka  2026-06-12  1,830 LKR  Soft Drinks & Cookies   (part food)
--       6f573939-567c-43cb-ab4a-c398b261e96a  sri-lanka  2026-11-10  1,260 LKR  Samahan                (herbal remedy, not bar stock)
--       5aa3ef92-5df3-4e82-a223-d0ce557331de  morocco    2026-07-26     70 MAD  bread                  (Food)
-- ════════════════════════════════════════════════════════════════════════════
