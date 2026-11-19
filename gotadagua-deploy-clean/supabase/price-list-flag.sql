-- «PDF» switch per catalog row (19 Nov 2026, Miguel: «what is not there needs to be inactive for the PDF»).
-- pricing_catalog.in_price_list = does this row print in the price-list PDF (and the on-screen «Price list» view).
-- /prices shows it as a «PDF» On/Off switch next to «Camp Tab» and «Transport quick-add».
-- Until this file runs, the pages treat every row as on and keep today's code rule (Camp Tab price variants off).
-- Rows still print only when active and with a guest price > 0; the switch never brings a 0 € row into the PDF.
-- NOT RUN — run with Miguel's yes.

begin;

alter table public.pricing_catalog add column if not exists in_price_list boolean not null default true;
comment on column public.pricing_catalog.in_price_list is 'Printed in the price-list PDF / on-screen price list (when active and priced). Switch on /prices.';

-- Camp Tab price variants: buttons the team uses to ring a lesson at a given price («Surf Lesson - 30», «Surf Lesson - 35»),
-- not products for agencies (Portugal today). Same rule as the code fallback: a name ending in « - <number>».
update public.pricing_catalog set in_price_list = false
 where name ~ '\s-\s\d+([.,]\d+)?$';

-- Dipløria stock (sizes / colours) is a separate business, sold at the camp; it never had a PDF section.
update public.pricing_catalog set in_price_list = false
 where category = 'Diploria';

-- Rows with no guest price never print (transport presets per vehicle in Morocco, Sri Lanka tuk-tuk runs, staff / errand /
-- laundry runs, 0 € tours). Switching them off makes the /prices switch say the truth; adding a price later needs the switch on.
update public.pricing_catalog set in_price_list = false
 where active and coalesce(sell_price, 0) <= 0;

-- Morocco yoga (Miguel 19 Nov 2026: «é 10 euros mas lá em cash cobramos 100»): the PDF shows the Bookinglayer price 10 €,
-- the Camp Tab keeps charging 100 MAD cash. Two rows: the MAD one stays Camp-Tab-only, a new EUR one is PDF-only.
update public.pricing_catalog c set in_price_list = false
  from public.locations l where l.id = c.location_id and l.name = 'Morocco' and c.active and c.name = 'Yoga Lesson' and coalesce(c.sell_currency, c.currency) = 'MAD';
insert into public.pricing_catalog(location_id, name, category, audience, sell_price, cost_per_guest, currency, sell_currency, notes,
                                   active, sort_order, show_in_camp_tab, show_in_transport_picker, in_price_list)
select l.id, 'Yoga Lesson', 'Other Service', 'general', 10, 0, 'EUR', 'EUR', '1 yoga class', true, 101, false, false, true
  from public.locations l
 where l.name = 'Morocco'
   and not exists (select 1 from public.pricing_catalog c where c.location_id = l.id and c.name = 'Yoga Lesson' and c.active and coalesce(c.sell_currency, c.currency) = 'EUR');

-- check: what each camp prints after this (rows on, active, priced)
select l.name as camp, count(*) filter (where c.in_price_list and c.active and c.sell_price > 0) as printed,
       count(*) filter (where not c.in_price_list and c.active) as switched_off
  from public.pricing_catalog c join public.locations l on l.id = c.location_id
 group by l.name order by l.name;

commit;
