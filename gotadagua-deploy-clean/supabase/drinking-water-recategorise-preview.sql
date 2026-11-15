-- ════════════════════════════════════════════════════════════════════════════
--  PREVIEW — SELECT only, writes nothing. Dry-run on 15 Nov 2026.
--  What drinking-water-recategorise.sql (grp A) and -food.sql (grp B, C) would
--  do: rows found on their old category, and before → after per camp × month ×
--  category if BOTH files run (A alone only changes «Drinks» Nov 2026:
--  229,390 → 211,390 LKR).
-- ════════════════════════════════════════════════════════════════════════════
with _dw_moves(id, grp, old_cat, old_area, new_cat, new_area, entry_date, amount_local, description) as (values
  ('34d0abca-858e-4279-ac05-dfb68d5b0605'::uuid,'A','Drinks','Bar','Drinking water','Utilities','2026-11-02'::date,9000::numeric,'Water Dispnser'),
  ('555d6283-46e6-48fe-a237-17a3318ccdde'::uuid,'A','Drinks','Bar','Drinking water','Utilities','2026-11-14'::date,9000::numeric,'Water Dispenser'),
  ('b00c53fd-2374-4e2b-813c-7395d2b91c5a'::uuid,'B','Food','Food','Drinking water','Utilities','2026-01-09'::date,16000::numeric,'Water Dispenser · Prasanna'),
  ('31dffe09-5417-4477-9b3f-2fd5c16a5b54'::uuid,'B','Food','Food','Drinking water','Utilities','2026-01-09'::date,5000::numeric,'Water Dispenser · Prasanna'),
  ('28e89e86-259c-48e7-974b-000d458890c1'::uuid,'B','Food','Food','Drinking water','Utilities','2026-01-15'::date,8000::numeric,'Water Dispenser · Prasana'),
  ('35f9fdff-179d-4103-9964-b4a9adbcefe7'::uuid,'B','Food','Food','Drinking water','Utilities','2026-01-25'::date,12800::numeric,'Water Dispenser · Prasana'),
  ('6fe30765-3146-4f62-92bc-bb16f8691f70'::uuid,'B','Food','Food','Drinking water','Utilities','2026-02-03'::date,10000::numeric,'Water Dispenser · Prasana'),
  ('4ed9b590-dced-40d7-b296-c8236c8b47ae'::uuid,'B','Food','Food','Drinking water','Utilities','2026-02-22'::date,13200::numeric,'Water Dispenser'),
  ('cff04124-9df8-4e64-bb8f-d1e652a21465'::uuid,'B','Food','Food','Drinking water','Utilities','2026-03-11'::date,11200::numeric,'Water Dispenser'),
  ('dbfa740d-eb47-4259-85dc-95d8fb4d7453'::uuid,'B','Food','Food','Drinking water','Utilities','2026-03-26'::date,14100::numeric,'Water Dispenser'),
  ('20323e5a-96d3-4d8d-8e77-71cbd6d43a07'::uuid,'B','Food','Food','Drinking water','Utilities','2026-04-20'::date,6750::numeric,'Water Dispenser'),
  ('c355c32f-96a9-4292-8f94-9b8a349e54f3'::uuid,'B','Food','Food','Drinking water','Utilities','2026-05-11'::date,16200::numeric,'Water Dispenser'),
  ('477820bf-15cb-46e9-b930-4da15ee52dbb'::uuid,'B','Food','Food','Drinking water','Utilities','2026-06-24'::date,4500::numeric,'Water Dispenser ( Bottles )'),
  ('5a709885-2001-42a7-a25a-1685e82b6ca7'::uuid,'B','Food','Food','Drinking water','Utilities','2026-07-25'::date,5400::numeric,'Water Dispenser'),
  ('ce28a523-c65a-486f-ab0d-1493437fe9df'::uuid,'B','Food','Food','Drinking water','Utilities','2026-09-03'::date,9900::numeric,'Water Dispenser'),
  ('fd9823ac-26f4-418a-ad05-00e9c669f2cf'::uuid,'B','Food','Food','Drinking water','Utilities','2026-09-23'::date,6750::numeric,'Water Dispenser'),
  ('e39cbb91-9187-4bd4-8c9c-703deb89fd55'::uuid,'B','Food','Food','Drinking water','Utilities','2026-10-22'::date,6750::numeric,'Water Dispenser'),
  ('d3e2d2f3-2455-47e5-9673-32aa8b302d27'::uuid,'C','Utilities','Utilities','Drinking water','Utilities','2026-04-12'::date,14850::numeric,'Water Dispenser')
), t as (
  select l.slug, to_char(e.entry_date, 'YYYY-MM') mon, e.category before_cat,
         coalesce(case when e.category = m.old_cat then m.new_cat end, e.category) after_cat, e.amount_local
    from ledger_entries e join locations l on l.id = e.location_id left join _dw_moves m on m.id = e.id
   where e.type = 'expense' and l.slug = 'sri-lanka' and e.category in ('Drinks','Food','Utilities','Drinking water')
)
select json_build_object(
  'listed', (select count(*) from _dw_moves),
  'on_old_category_by_group', (select json_object_agg(grp, n) from (select m.grp, count(*) n from _dw_moves m join ledger_entries e on e.id = m.id and e.category = m.old_cat group by 1) g),
  'already_moved', (select count(*) from _dw_moves m join ledger_entries e on e.id = m.id and e.category = m.new_cat),
  'missing_or_changed', (select json_agg(m.id) from _dw_moves m left join ledger_entries e on e.id = m.id
                          where e.id is null or e.category not in (m.old_cat, m.new_cat) or abs(e.amount_local - m.amount_local) > 0.01),
  'before_after', (select json_agg(x order by x.mon, x.category) from (
      select mon, c.category,
             round(sum(case when before_cat = c.category then amount_local else 0 end)) before_lkr,
             round(sum(case when after_cat  = c.category then amount_local else 0 end)) after_lkr,
             count(*) filter (where before_cat = c.category) before_n,
             count(*) filter (where after_cat  = c.category) after_n
        from t cross join (values ('Drinks'),('Food'),('Utilities'),('Drinking water')) c(category)
       group by 1, 2
      having sum(case when before_cat = c.category then amount_local else 0 end) <> sum(case when after_cat = c.category then amount_local else 0 end)) x)
) preview;
