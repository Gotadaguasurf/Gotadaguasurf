-- ════════════════════════════════════════════════════════════════════════════
--  OPTIONAL, ONE-OFF · prices wrongly marked «typed by hand» (17 Nov 2026).
--
--  NOT run against production by the agent — Miguel runs it after his OK, AFTER supabase/transport-catalog-one-source.sql.
--
--  Until 17 Nov 2026 Transport's «Save» on a trip and «Separate» put 'expected_price' in camp_trips.edited_fields even
--  when the price was just the /prices price of the vehicle picked. Such a trip is skipped forever by the import's price
--  and by camp_trips_reprice. This removes the mark ONLY where the stored price IS the /prices driver cost of the trip's
--  vehicle on its route today (so it never undoes a real hand-typed price), on upcoming, unpaid, live airport trips.
--  Look first (SELECT below), then run the UPDATE.
-- ════════════════════════════════════════════════════════════════════════════
-- What would change:
-- select c.id, l.slug, c.trip_date, c.guest_names, c.vehicle, c.expected_price, c.edited_fields
--   from public.camp_trips c join public.locations l on l.id = c.location_id
--  where c.kind in ('airport_arrival', 'airport_departure') and c.payment_entry_id is null
--    and c.status in ('planned', 'sent', 'confirmed') and 'expected_price' = any(c.edited_fields)
--    and c.trip_date >= (now() at time zone public.camp_trips__tz(c.location_id))::date
--    and c.expected_price = (select pc.cost_per_guest from public.pricing_catalog pc
--          where pc.location_id = c.location_id and pc.category = 'Transport' and pc.active and coalesce(pc.picker_tab, 'airport') = 'airport'
--            and lower(trim(regexp_replace(pc.name, '\s+—\s+[^—]*$', ''))) = lower(trim(public.transport_airport_route(c.location_id, c.kind, c.place)))
--            and trim(substring(pc.name from '—\s+([^—]*)$')) = c.vehicle order by pc.sort_order nulls last limit 1);

update public.camp_trips c
   set edited_fields = array_remove(c.edited_fields, 'expected_price')
 where c.kind in ('airport_arrival', 'airport_departure') and c.payment_entry_id is null
   and c.status in ('planned', 'sent', 'confirmed') and 'expected_price' = any(c.edited_fields)
   and c.trip_date >= (now() at time zone public.camp_trips__tz(c.location_id))::date
   and c.expected_price = (select pc.cost_per_guest from public.pricing_catalog pc
         where pc.location_id = c.location_id and pc.category = 'Transport' and pc.active and coalesce(pc.picker_tab, 'airport') = 'airport'
           and lower(trim(regexp_replace(pc.name, '\s+—\s+[^—]*$', ''))) = lower(trim(public.transport_airport_route(c.location_id, c.kind, c.place)))
           and trim(substring(pc.name from '—\s+([^—]*)$')) = c.vehicle order by pc.sort_order nulls last limit 1);
