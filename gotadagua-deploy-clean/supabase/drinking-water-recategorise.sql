-- ════════════════════════════════════════════════════════════════════════════
--  Past water-dispenser rows → «Drinking water» (Miguel, 15 Nov 2026: «para
--  trás tira o water dispenser do bar para ver os profits reais»).
--
--  Run AFTER supabase/drinking-water-category.sql. NOT RUN — the coordinator
--  reviews and runs it. Rollback: supabase/drinking-water-recategorise-rollback.sql
--
--  Searched on 15 Nov 2026 over every camp and every date (ledger_entries,
--  type = expense, description ~ dispens|dispnser|mineral|eau|aqua|bottle +
--  water…). Only Sri Lanka has water-dispenser rows; Morocco «2 bottles» /
--  «3 bottles» (Utilities, 105 / 165 MAD) are gas bottles (same price as
--  «Gas bottle» 51 MAD), Portugal «Água» rows are the SMAS water bill.
--
--    A  2 rows   Drinks → Drinking water   18,000 LKR  (the bar card's cost drops by this)
--    B 15 rows   Food   → Drinking water  146,550 LKR  (Food control drops by this; bar unchanged)
--    C  1 row    Utilities → Drinking water 14,850 LKR (area stays Utilities)
--    Not moved: hardware (New Water Dispenser 42,399 · Repair 1,800 · Cover 1,000 ·
--      Bottle Stand · 60 Water Glasses · Water Bowser) and the AMBIGUOUS list
--      at the bottom (Miguel decides).
--
--  Idempotent: every update matches id AND the old category, so a second run
--  changes nothing. No HQ-mirrored row is touched (all are manual, hq_invoice_id
--  null), so tr_ledger_mirror_guard does not apply. amount_* never change, so
--  hq_overview_rollup() totals are identical before and after.
-- ════════════════════════════════════════════════════════════════════════════

begin;

drop table if exists _dw_moves;
create temp table _dw_moves (id uuid primary key, grp text, old_cat text, old_area text, new_cat text, new_area text, entry_date date, amount_local numeric, description text);
insert into _dw_moves values
  -- A · Drinks/Bar → Drinking water/Utilities
  ('34d0abca-858e-4279-ac05-dfb68d5b0605','A','Drinks','Bar','Drinking water','Utilities','2026-11-02', 9000,'Water Dispnser'),
  ('555d6283-46e6-48fe-a237-17a3318ccdde','A','Drinks','Bar','Drinking water','Utilities','2026-11-14', 9000,'Water Dispenser'),
  -- B · Food/Food → Drinking water/Utilities
  ('b00c53fd-2374-4e2b-813c-7395d2b91c5a','B','Food','Food','Drinking water','Utilities','2026-01-09',16000,'Water Dispenser · Prasanna'),
  ('31dffe09-5417-4477-9b3f-2fd5c16a5b54','B','Food','Food','Drinking water','Utilities','2026-01-09', 5000,'Water Dispenser · Prasanna'),
  ('28e89e86-259c-48e7-974b-000d458890c1','B','Food','Food','Drinking water','Utilities','2026-01-15', 8000,'Water Dispenser · Prasana'),
  ('35f9fdff-179d-4103-9964-b4a9adbcefe7','B','Food','Food','Drinking water','Utilities','2026-01-25',12800,'Water Dispenser · Prasana'),
  ('6fe30765-3146-4f62-92bc-bb16f8691f70','B','Food','Food','Drinking water','Utilities','2026-02-03',10000,'Water Dispenser · Prasana'),
  ('4ed9b590-dced-40d7-b296-c8236c8b47ae','B','Food','Food','Drinking water','Utilities','2026-02-22',13200,'Water Dispenser'),
  ('cff04124-9df8-4e64-bb8f-d1e652a21465','B','Food','Food','Drinking water','Utilities','2026-03-11',11200,'Water Dispenser'),
  ('dbfa740d-eb47-4259-85dc-95d8fb4d7453','B','Food','Food','Drinking water','Utilities','2026-03-26',14100,'Water Dispenser'),
  ('20323e5a-96d3-4d8d-8e77-71cbd6d43a07','B','Food','Food','Drinking water','Utilities','2026-04-20', 6750,'Water Dispenser'),
  ('c355c32f-96a9-4292-8f94-9b8a349e54f3','B','Food','Food','Drinking water','Utilities','2026-05-11',16200,'Water Dispenser'),
  ('477820bf-15cb-46e9-b930-4da15ee52dbb','B','Food','Food','Drinking water','Utilities','2026-06-24', 4500,'Water Dispenser ( Bottles )'),
  ('5a709885-2001-42a7-a25a-1685e82b6ca7','B','Food','Food','Drinking water','Utilities','2026-07-25', 5400,'Water Dispenser'),
  ('ce28a523-c65a-486f-ab0d-1493437fe9df','B','Food','Food','Drinking water','Utilities','2026-09-03', 9900,'Water Dispenser'),
  ('fd9823ac-26f4-418a-ad05-00e9c669f2cf','B','Food','Food','Drinking water','Utilities','2026-09-23', 6750,'Water Dispenser'),
  ('e39cbb91-9187-4bd4-8c9c-703deb89fd55','B','Food','Food','Drinking water','Utilities','2026-10-22', 6750,'Water Dispenser'),
  -- C · Utilities/Utilities → Drinking water/Utilities
  ('d3e2d2f3-2455-47e5-9673-32aa8b302d27','C','Utilities','Utilities','Drinking water','Utilities','2026-04-12',14850,'Water Dispenser');

-- 0. Guard: the category must exist first (drinking-water-category.sql)
do $$ begin
  if not exists (select 1 from hq_invoice_categories where name = 'Drinking water') then
    raise exception 'Run supabase/drinking-water-category.sql first';
  end if;
end $$;

-- 1. PRE-CHECK — what the list finds now (still on the old category = to move; on the new = already moved)
select json_build_object(
  'listed', (select count(*) from _dw_moves),
  'to_move', (select count(*) from _dw_moves m join ledger_entries e on e.id = m.id and e.category = m.old_cat),
  'already_moved', (select count(*) from _dw_moves m join ledger_entries e on e.id = m.id and e.category = m.new_cat),
  'missing_or_changed', (select json_agg(m.id) from _dw_moves m left join ledger_entries e on e.id = m.id
                          where e.id is null or e.category not in (m.old_cat, m.new_cat) or abs(e.amount_local - m.amount_local) > 0.01)
) pre_check;

-- 2. BEFORE / AFTER per camp × month × category (simulated — nothing written yet)
with t as (
  select l.slug, to_char(e.entry_date, 'YYYY-MM') mon, e.category before_cat,
         coalesce(case when e.category = m.old_cat then m.new_cat end, e.category) after_cat,
         e.amount_local, e.amount_eur
    from ledger_entries e join locations l on l.id = e.location_id left join _dw_moves m on m.id = e.id
   where e.type = 'expense' and l.slug in (select distinct l2.slug from _dw_moves m2 join ledger_entries e2 on e2.id = m2.id join locations l2 on l2.id = e2.location_id)
     and e.category in ('Drinks','Food','Utilities','Drinking water')
)
select json_agg(x order by x.slug, x.mon, x.category) before_after from (
  select slug, mon, c.category,
         round(sum(case when before_cat = c.category then amount_local else 0 end)) before_local,
         round(sum(case when after_cat  = c.category then amount_local else 0 end)) after_local,
         count(*) filter (where before_cat = c.category) before_n,
         count(*) filter (where after_cat  = c.category) after_n
    from t cross join (values ('Drinks'),('Food'),('Utilities'),('Drinking water')) c(category)
   group by 1, 2, 3
  having sum(case when before_cat = c.category then amount_local else 0 end) <> sum(case when after_cat = c.category then amount_local else 0 end)
) x;

-- 3. APPLY (idempotent: id + old category)
update ledger_entries e
   set category = m.new_cat, business_area = m.new_area
  from _dw_moves m
 where e.id = m.id and e.category = m.old_cat and e.hq_invoice_id is null;

-- 4. POST-CHECK — every listed row now «Drinking water»; ledger totals by type unchanged
select json_build_object(
  'moved', (select count(*) from _dw_moves m join ledger_entries e on e.id = m.id and e.category = 'Drinking water' and e.business_area = 'Utilities'),
  'still_old', (select json_agg(m.id) from _dw_moves m join ledger_entries e on e.id = m.id where e.category <> 'Drinking water'),
  'water_rows_left_in_drinks', (select json_agg(json_build_object('id', e.id, 'date', e.entry_date, 'desc', e.description))
                                  from ledger_entries e where e.type = 'expense' and e.category = 'Drinks' and e.description ~* 'dispens|dispnser')
) post_check;

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
--       update ledger_entries set category = 'Drinking water', business_area = 'Utilities'
--        where id in ('4e198225-13a9-4125-89c4-c78eb8a51db4','297a8f3b-e7ca-42d8-b27b-20c915b28978','dce4501f-f20a-4fd3-a88e-f83770f26ac4')
--          and category = 'Equipment & maintenance';
--
--  b) Mixed / not bar stock but filed under Drinks (not water, so not moved):
--       6484c0d4-6d57-494b-a28a-fecf5a99742a  sri-lanka  2026-06-12  1,830 LKR  Soft Drinks & Cookies   (part food)
--       6f573939-567c-43cb-ab4a-c398b261e96a  sri-lanka  2026-11-10  1,260 LKR  Samahan                (herbal remedy, not bar stock)
--       5aa3ef92-5df3-4e82-a223-d0ce557331de  morocco    2026-07-26     70 MAD  bread                  (Food)
-- ════════════════════════════════════════════════════════════════════════════
