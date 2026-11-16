-- ════════════════════════════════════════════════════════════════════════════
--  Morocco surf vans and tours: Mounir Travel Tours (Mounir Fathoune) prices per vehicle
--  from October 2026 (menu sent by Floriane on WhatsApp, 16 Nov 2026). Idempotent.
--  VAN 04 = Car (4), VAN 08 = Minivan (8), VAN 14/15 = Big Van (15). cost_per_guest = vehicle price.
--
--    Surf Taghazout 17km  300 / 500 / 700   (was 700 / 800 / 900)
--    Tamri Anza Surf      400 / 600 / 800   (new rows «Tamri / Anza — …», picker surf)
--    Imsouane Surf        800 / 900 / 1200  (unchanged)
--    Paradise Valley      500 / 700 / 800   (was 700 / 800 / 900)
--    Timlalin Dunes       500 / 700 / 800   (was 700 / 800 / 900)
--    Souk City Tour       300 / 400 / 600   (was 400 / 500 / 700)
--
--  Not changed: airport rows (Let Us Tours, Agadir 250 / 300 / 500). Mounir's menu says 200 / 300 / 500
--  for the airport, but the airport goes with Let Us Tours.
--  Driver Fathoune: phone from the menu, alias «Mounir Travel Tours».
--  Rollback at the bottom.
-- ════════════════════════════════════════════════════════════════════════════

update public.pricing_catalog c set cost_per_guest = v.cost, updated_at = now()
  from (values
    ('Surf — Car', 300), ('Surf — Minivan', 500), ('Surf — Big Van', 700),
    ('Paradise Valley — Car', 500), ('Paradise Valley — Minivan', 700), ('Paradise Valley — Big Van', 800),
    ('Dunes — Car', 500), ('Dunes — Minivan', 700), ('Dunes — Big Van', 800),
    ('Souk — Car', 300), ('Souk — Minivan', 400), ('Souk — Big Van', 600)
  ) as v(name, cost), public.locations l
 where l.slug = 'morocco' and c.location_id = l.id and c.category = 'Transport' and c.name = v.name;

insert into public.pricing_catalog (location_id, name, category, sell_price, cost_per_guest, currency, show_in_camp_tab, show_in_transport_picker, picker_tab, capacity, active, sort_order, notes)
select l.id, 'Tamri / Anza — ' || v.veh, 'Transport', 0, v.cost, 'MAD', false, true, 'surf', v.cap, true, v.so, 'Mounir Travel Tours, from October 2026 (capacity ' || v.cap || ')'
  from public.locations l, (values ('Car', 400, 4, 2101), ('Minivan', 600, 8, 2102), ('Big Van', 800, 15, 2103)) as v(veh, cost, cap, so)
 where l.slug = 'morocco'
   and not exists (select 1 from public.pricing_catalog c where c.location_id = l.id and c.name = 'Tamri / Anza — ' || v.veh);

update public.camp_drivers d set phone = '+212616070401',
       aliases = (select array_agg(distinct a) from unnest(d.aliases || array['Mounir Travel Tours']) a)
  from public.locations l
 where l.slug = 'morocco' and d.location_id = l.id and d.name = 'Fathoune';

-- ── Check (SELECT only) ──────────────────────────────────────────────────────
-- select c.name, c.cost_per_guest, c.picker_tab from public.pricing_catalog c join public.locations l on l.id = c.location_id
--  where l.slug = 'morocco' and c.category = 'Transport' and c.picker_tab in ('surf', 'tours') order by c.picker_tab, c.name;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- update public.pricing_catalog c set cost_per_guest = v.cost, updated_at = now()
--   from (values ('Surf — Car', 700), ('Surf — Minivan', 800), ('Surf — Big Van', 900),
--     ('Paradise Valley — Car', 700), ('Paradise Valley — Minivan', 800), ('Paradise Valley — Big Van', 900),
--     ('Dunes — Car', 700), ('Dunes — Minivan', 800), ('Dunes — Big Van', 900),
--     ('Souk — Car', 400), ('Souk — Minivan', 500), ('Souk — Big Van', 700)) as v(name, cost), public.locations l
--  where l.slug = 'morocco' and c.location_id = l.id and c.category = 'Transport' and c.name = v.name;
-- delete from public.pricing_catalog c using public.locations l where l.slug = 'morocco' and c.location_id = l.id and c.name like 'Tamri / Anza — %';
-- update public.camp_drivers d set phone = null, aliases = array['Fathoune', 'Mounir', 'Fathoune Mounir'] from public.locations l
--  where l.slug = 'morocco' and d.location_id = l.id and d.name = 'Fathoune';
