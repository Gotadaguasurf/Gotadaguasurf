-- ════════════════════════════════════════════════════════════════════════════
--  «Drinking water»: a category of its own, apart from the bar (Miguel, 15 Nov
--  2026: «Meter categoria de bebidas do bar (Water dispenser meter separado)
--  … era para ter o lucro real»).
--
--  «Drinks» stays the bar-stock category (beer, spirits, mixers, soft drinks,
--  ice, limes: what is sold at the bar). The water-dispenser refills (20 L
--  bottles for guests and staff) get «Drinking water», so the camp hub's Bar
--  card = bar sales − bar drinks bought, without the water.
--
--  Why «Drinking water» and not «Water»: «Water» is already the Utilities line
--  for the water bill (UTILITIES_LINKED_ITEMS in camp-hub, «Water Bill (…)»,
--  SMAS Almada), so a «Water» category would collect the bills as well.
--
--  Business area: Food (Miguel, 15 Nov 2026: «água para beber é food»), so it
--  counts in Food / guest-day, on its own line by category.
--
--  Totals do not move: hq_overview_rollup() (one-formula.sql) sums ledger rows
--  by type / slug / source_kind and HQ invoices by category_id, so a new
--  category only adds a line to the P&L by category.
--
--  Idempotent: safe to run twice. NOT RUN — for the owner to approve.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The category (HQ is the single source of the list; the camp hub uses the same name)
insert into hq_invoice_categories (name, sort_order, is_personal, active)
select 'Drinking water', 25, false, true
 where not exists (select 1 from hq_invoice_categories where name = 'Drinking water');

-- 2. A mirrored HQ line in «Drinking water» lands in the Food area (else it fell to General)
create or replace function public.hq_mirror_business_area(p_cat text)
returns text language sql immutable as $$
  select case
    when p_cat in ('Salary','Benefits') then 'Salaries'
    when p_cat in ('Food','Drinking water') then 'Food'
    when p_cat = 'Drinks' then 'Bar'
    when p_cat = 'Transport' then 'Transport'
    when p_cat = 'Laundry' then 'Laundry'
    when p_cat in ('Tours & activities','Activities','Tours') then 'Tours'
    when p_cat in ('Merchandise','Merch','Merchandising') then 'Merch'
    when p_cat like 'Wild%' then 'Wild'
    when p_cat in ('Rent','Utilities','Equipment & maintenance','Setup','Cleaning','Cleaning Supplies','Services','Insurances','Taxes','Accounting','Repairs','Supplies') then 'Utilities'
    else 'General' end;
$$;

-- 3. Check
select json_build_object(
  'category', (select json_agg(json_build_object('name', name, 'sort_order', sort_order, 'active', active)) from hq_invoice_categories where name = 'Drinking water'),
  'area', public.hq_mirror_business_area('Drinking water'),
  'drinks_area_unchanged', public.hq_mirror_business_area('Drinks')
) j;
