-- ════════════════════════════════════════════════════════════════════════════
--  ROLLBACK of supabase/drinking-water-recategorise.sql (A) and
--  drinking-water-recategorise-food.sql (B, C) — puts each of the
--  18 rows back on its literal old category and business area (as found on
--  15 Nov 2026). Only touches a row that is still «Drinking water», so it is
--  idempotent and never undoes a later manual change. NOT RUN.
--  (The «Drinking water» category itself stays; deactivate it in HQ →
--  Categories if it should go too.)
-- ════════════════════════════════════════════════════════════════════════════
begin;
update ledger_entries set category = 'Drinks', business_area = 'Bar' where id = '34d0abca-858e-4279-ac05-dfb68d5b0605' and category = 'Drinking water';  -- A · 2026-11-02 · 9,000 LKR · Water Dispnser
update ledger_entries set category = 'Drinks', business_area = 'Bar' where id = '555d6283-46e6-48fe-a237-17a3318ccdde' and category = 'Drinking water';  -- A · 2026-11-14 · 9,000 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'b00c53fd-2374-4e2b-813c-7395d2b91c5a' and category = 'Drinking water';  -- B · 2026-01-09 · 16,000 LKR · Water Dispenser · Prasanna
update ledger_entries set category = 'Food', business_area = 'Food' where id = '31dffe09-5417-4477-9b3f-2fd5c16a5b54' and category = 'Drinking water';  -- B · 2026-01-09 · 5,000 LKR · Water Dispenser · Prasanna
update ledger_entries set category = 'Food', business_area = 'Food' where id = '28e89e86-259c-48e7-974b-000d458890c1' and category = 'Drinking water';  -- B · 2026-01-15 · 8,000 LKR · Water Dispenser · Prasana
update ledger_entries set category = 'Food', business_area = 'Food' where id = '35f9fdff-179d-4103-9964-b4a9adbcefe7' and category = 'Drinking water';  -- B · 2026-01-25 · 12,800 LKR · Water Dispenser · Prasana
update ledger_entries set category = 'Food', business_area = 'Food' where id = '6fe30765-3146-4f62-92bc-bb16f8691f70' and category = 'Drinking water';  -- B · 2026-02-03 · 10,000 LKR · Water Dispenser · Prasana
update ledger_entries set category = 'Food', business_area = 'Food' where id = '4ed9b590-dced-40d7-b296-c8236c8b47ae' and category = 'Drinking water';  -- B · 2026-02-22 · 13,200 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'cff04124-9df8-4e64-bb8f-d1e652a21465' and category = 'Drinking water';  -- B · 2026-03-11 · 11,200 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'dbfa740d-eb47-4259-85dc-95d8fb4d7453' and category = 'Drinking water';  -- B · 2026-03-26 · 14,100 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = '20323e5a-96d3-4d8d-8e77-71cbd6d43a07' and category = 'Drinking water';  -- B · 2026-04-20 · 6,750 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'c355c32f-96a9-4292-8f94-9b8a349e54f3' and category = 'Drinking water';  -- B · 2026-05-11 · 16,200 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = '477820bf-15cb-46e9-b930-4da15ee52dbb' and category = 'Drinking water';  -- B · 2026-06-24 · 4,500 LKR · Water Dispenser ( Bottles )
update ledger_entries set category = 'Food', business_area = 'Food' where id = '5a709885-2001-42a7-a25a-1685e82b6ca7' and category = 'Drinking water';  -- B · 2026-07-25 · 5,400 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'ce28a523-c65a-486f-ab0d-1493437fe9df' and category = 'Drinking water';  -- B · 2026-09-03 · 9,900 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'fd9823ac-26f4-418a-ad05-00e9c669f2cf' and category = 'Drinking water';  -- B · 2026-09-23 · 6,750 LKR · Water Dispenser
update ledger_entries set category = 'Food', business_area = 'Food' where id = 'e39cbb91-9187-4bd4-8c9c-703deb89fd55' and category = 'Drinking water';  -- B · 2026-10-22 · 6,750 LKR · Water Dispenser
update ledger_entries set category = 'Utilities', business_area = 'Utilities' where id = 'd3e2d2f3-2455-47e5-9673-32aa8b302d27' and category = 'Drinking water';  -- C · 2026-04-12 · 14,850 LKR · Water Dispenser
select json_build_object('still_drinking_water', (select count(*) from ledger_entries where id in (
  '34d0abca-858e-4279-ac05-dfb68d5b0605',
  '555d6283-46e6-48fe-a237-17a3318ccdde',
  'b00c53fd-2374-4e2b-813c-7395d2b91c5a',
  '31dffe09-5417-4477-9b3f-2fd5c16a5b54',
  '28e89e86-259c-48e7-974b-000d458890c1',
  '35f9fdff-179d-4103-9964-b4a9adbcefe7',
  '6fe30765-3146-4f62-92bc-bb16f8691f70',
  '4ed9b590-dced-40d7-b296-c8236c8b47ae',
  'cff04124-9df8-4e64-bb8f-d1e652a21465',
  'dbfa740d-eb47-4259-85dc-95d8fb4d7453',
  '20323e5a-96d3-4d8d-8e77-71cbd6d43a07',
  'c355c32f-96a9-4292-8f94-9b8a349e54f3',
  '477820bf-15cb-46e9-b930-4da15ee52dbb',
  '5a709885-2001-42a7-a25a-1685e82b6ca7',
  'ce28a523-c65a-486f-ab0d-1493437fe9df',
  'fd9823ac-26f4-418a-ad05-00e9c669f2cf',
  'e39cbb91-9187-4bd4-8c9c-703deb89fd55',
  'd3e2d2f3-2455-47e5-9673-32aa8b302d27'
) and category = 'Drinking water')) rollback_check;
commit;
