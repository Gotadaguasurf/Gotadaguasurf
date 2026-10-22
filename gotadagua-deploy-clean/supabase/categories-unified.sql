-- ════════════════════════════════════════════════════════════════════════════
--  One category list for the whole app (Miguel, 22 Oct 2026: «bora»).
--  HQ (hq_invoice_categories) is the single source; the camp hub, Wild and
--  The Suk use the same names. Renames keep the ids, so nothing is relinked.
--
--    Food · Drinks · Salary · Benefits · Taxes · Rent · Utilities · Services ·
--    Insurances · Equipment & maintenance · Cleaning · Laundry · Transport ·
--    Tours & activities · Merchandise · Marketing · Partners · Work Trips ·
--    Other  (+ Wild · … sub-rubrics, + the two personal ones)
--
--  Mapping of the old names:
--    Setup → Equipment & maintenance      Cleaning Supplies → Cleaning
--    Activities → Tours & activities      Accounting → Services (merged)
--    camp hub: Bar → Drinks · Repairs/Supplies → Equipment & maintenance ·
--              Special → Other · Merchandising → Merchandise ·
--              Tours (expense) → Tours & activities
--  Manjar: Superbock / Super Bock / Newcoffee / Consoantes Tropicais → Drinks.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Renames in place (ids kept)
update hq_invoice_categories set name = 'Equipment & maintenance' where name = 'Setup';
update hq_invoice_categories set name = 'Cleaning'                where name = 'Cleaning Supplies';
update hq_invoice_categories set name = 'Tours & activities'      where name = 'Activities';

-- 2. New ones
insert into hq_invoice_categories (name, sort_order, is_personal, active)
select v.name, v.so, false, true
  from (values ('Drinks', 20), ('Laundry', 105), ('Merchandise', 125), ('Other', 160)) as v(name, so)
 where not exists (select 1 from hq_invoice_categories c where c.name = v.name);

-- 3. Merge Accounting into Services
update hq_invoices i
   set category_id = s.id, category_name = s.name,
       notes = coalesce(i.notes, '') || ' [categoria Accounting → Services, 22 Out 2026]'
  from hq_invoice_categories s
 where s.name = 'Services' and i.category_name = 'Accounting' and i.deleted_at is null;
update hq_invoice_categories set active = false where name = 'Accounting';
-- the two «Merch» HQ lines → Merchandise
update hq_invoices i set category_id = m.id, category_name = m.name
  from hq_invoice_categories m where m.name = 'Merchandise' and i.category_name = 'Merch' and i.deleted_at is null;

-- 4. Order
update hq_invoice_categories set sort_order = v.so
  from (values ('Food',10),('Drinks',20),('Salary',30),('Benefits',40),('Taxes',50),('Rent',60),('Utilities',70),('Services',80),('Insurances',85),
               ('Equipment & maintenance',90),('Cleaning',100),('Laundry',105),('Transport',110),('Tours & activities',120),('Merchandise',125),
               ('Marketing',130),('Partners',140),('Work Trips',150),('Other',160),
               ('Wild · DJs',171),('Wild · Som/luz',172),('Wild · Foto/vídeo',173),('Wild · Marketing',174),('Wild · Porta',175),('Wild · Comissões',176),('Wild · Outros',177),
               ('Miguel - Personal',200),('Ricardo - Personal',210)) as v(name, so)
 where hq_invoice_categories.name = v.name;

-- 5. category_name text follows the renamed ids
update hq_invoices i set category_name = c.name
  from hq_invoice_categories c
 where i.category_id = c.id and i.category_name is distinct from c.name;

-- 6. Manjar drinks
update hq_invoices i set category_id = d.id, category_name = d.name
  from hq_invoice_categories d
 where d.name = 'Drinks' and i.paying_company = 'manjar' and i.deleted_at is null
   and i.company ~* 'superbock|super bock|newcoffee|consoantes';

-- 7. Business area of a mirrored HQ line (new names + the old ones, so nothing regresses)
create or replace function public.hq_mirror_business_area(p_cat text)
returns text language sql immutable as $$
  select case
    when p_cat in ('Salary','Benefits') then 'Salaries'
    when p_cat = 'Food' then 'Food'
    when p_cat = 'Drinks' then 'Bar'
    when p_cat = 'Transport' then 'Transport'
    when p_cat = 'Laundry' then 'Laundry'
    when p_cat in ('Tours & activities','Activities','Tours') then 'Tours'
    when p_cat in ('Merchandise','Merch','Merchandising') then 'Merch'
    when p_cat like 'Wild%' then 'Wild'
    when p_cat in ('Rent','Utilities','Equipment & maintenance','Setup','Cleaning','Cleaning Supplies','Services','Insurances','Taxes','Accounting','Repairs','Supplies') then 'Utilities'
    else 'General' end;
$$;

-- 8. Mirrored ledger rows follow their HQ line (the guard lets us through with app.hq_mirror)
select set_config('app.hq_mirror', '1', true);
update ledger_entries e
   set category = coalesce(nullif(i.category_name, ''), 'Other'), business_area = public.hq_mirror_business_area(i.category_name)
  from hq_invoices i
 where e.hq_invoice_id = i.id
   and (e.category is distinct from coalesce(nullif(i.category_name, ''), 'Other') or e.business_area is distinct from public.hq_mirror_business_area(i.category_name));

-- 9. Camp-hub manual rows (expense side only; revenue names stay)
update ledger_entries set category = 'Drinks' where hq_invoice_id is null and type = 'expense' and category = 'Bar';
update ledger_entries set category = 'Equipment & maintenance' where hq_invoice_id is null and type = 'expense' and category in ('Setup','Repairs','Supplies');
update ledger_entries set category = 'Cleaning' where hq_invoice_id is null and type = 'expense' and category = 'Cleaning Supplies';
update ledger_entries set category = 'Tours & activities' where hq_invoice_id is null and type = 'expense' and category in ('Tours','Activities');
update ledger_entries set category = 'Merchandise' where hq_invoice_id is null and type = 'expense' and category in ('Merchandising','Merch');
update ledger_entries set category = 'Services' where hq_invoice_id is null and type = 'expense' and category = 'Accounting';
update ledger_entries set category = 'Other', business_area = 'General' where hq_invoice_id is null and type = 'expense' and category = 'Special';

select json_build_object(
  'cats', (select json_agg(name order by sort_order) from hq_invoice_categories where active),
  'inv_by_cat', (select json_agg(x order by x.n desc) from (select coalesce(category_name,'—') cat, count(*) n from hq_invoices where deleted_at is null group by 1) x),
  'ledger_exp_cats', (select json_agg(x order by x.n desc) from (select category, count(*) n from ledger_entries where type = 'expense' group by 1) x),
  'mismatch', (select count(*) from ledger_entries e join hq_invoices i on i.id = e.hq_invoice_id where e.category is distinct from coalesce(nullif(i.category_name,''),'Other'))
) j;
