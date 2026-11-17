-- ════════════════════════════════════════════════════════════════════════════
--  /prices = the ONE place for transport vehicles, seats, driver cost and guest price (17 Nov 2026).
--
--  NOT run against production by the agent — Miguel runs it after his OK.
--  RUN ORDER:  1) this file   2) supabase/camp-trips-bl-check.sql (again: its camp_trips_bl_verify now calls
--              transport_vehicle_for, and its camp_trips_import stores paid_lines / guest_eur)
--              3) optional: supabase/transport-catalog-reprice-trigger.sql (reprice automatically on a /prices change)
--              4) optional: supabase/transport-catalog-cleanup-edited-price.sql (one-off, see that file)
--  Idempotent: safe to run again.
--
--  Before: the vehicle list and seats were written in four places that disagreed (lib/camp-config.js, the camp hub,
--  camp-hub/index.html seed presets, camp_trips_bl_verify: «pax <= 3 Car / <= 8 Minivan / else Big|Large Van»),
--  prices were found by exact row NAME (a renamed /prices row gave price 0), and nothing followed a /prices change.
--
--  1 · pricing_catalog.covers_pax (people one paid transfer covers: «€80 / 3 persons» → 3; NOT the seats) and
--      pricing_catalog.bl_product (a Bookinglayer product title that always gets this vehicle, e.g. the surfboards one).
--      Airport rows get covers_pax = 3 (Sri Lanka and Morocco, Miguel 17 Nov 2026). Sri Lanka's airport Minivan rows get
--      bl_product «Airport Transfer (with surfboards)» — CHECK the exact product title in Bookinglayer.
--      Capacity is NOT changed here: Miguel sets Car = 3 (and the Sri Lanka Minivan guest price €95) in /prices himself.
--  2 · camp_trips.pax may be empty (Morocco van runs carry no head count from 17 Nov 2026); camp_trips.paid_lines /
--      guest_eur (what the guests paid for the transfer, from the camp report's «Final price incl. tax»).
--  3 · transport_airport_route(location, kind, place) → the /prices route of an airport trip (Sri Lanka by direction,
--      Morocco by airport city) — the same rule as lib/transport-catalog.js airportRoute.
--  4 · transport_vehicle_for(location, tab, route, pax, product) → vehicle, capacity, cost, over_capacity: the
--      bl_product row is the smallest allowed; then the smallest vehicle whose CAPACITY COLUMN holds the people (the
--      «capacity N» note only when the column is empty); more people than the largest → the largest, over_capacity
--      true (never price 0) — the same rule as GuestsTrips.pickVehicle (lib/guests-trips.js).
--  5 · camp_trips_reprice(location) → follow /prices on trips that may still change: from the camp's own today, not
--      paid, planned / sent / confirmed, price not typed by hand ('expected_price' not in edited_fields).
--        · airport trips: vehicle re-picked for the people (kept when typed by hand: 'vehicle' in edited_fields), price
--          = that vehicle's cost; a sent / confirmed trip whose vehicle changes gets needs_resend.
--        · Morocco van runs (kind 'other'): vehicle kept (chosen when logged), price = the cost of the /prices row
--          «<route> — <vehicle>» on the surf / tours tabs. «Paradise + Souk» (two rows added up) has no row of its own
--          and is LEFT ALONE, as are Sri Lanka's tuk-tuk runs (single-price routes) — change those by hand.
--        · never a paid trip, never a past trip (Sri Lanka never changes past trips).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · /prices columns ─────────────────────────────────────────────────────
alter table public.pricing_catalog add column if not exists covers_pax integer check (covers_pax is null or covers_pax > 0);
alter table public.pricing_catalog add column if not exists bl_product text;
comment on column public.pricing_catalog.covers_pax is 'Transport: people one paid transfer covers («€80 / 3 persons» → 3). Not the seats (capacity).';
comment on column public.pricing_catalog.bl_product is 'Transport: Bookinglayer product title that always gets this vehicle (e.g. «Airport Transfer (with surfboards)»).';
comment on column public.pricing_catalog.capacity is 'Transport: seats. The apps pick the smallest vehicle whose capacity holds the people.';

update public.pricing_catalog
   set covers_pax = 3
 where category = 'Transport' and covers_pax is null and coalesce(picker_tab, 'airport') = 'airport'
   and location_id in (select id from public.locations where slug in ('sri-lanka', 'morocco'));

update public.pricing_catalog
   set bl_product = 'Airport Transfer (with surfboards)'
 where category = 'Transport' and bl_product is null and coalesce(picker_tab, 'airport') = 'airport'
   and name like '% — Minivan'
   and location_id = (select id from public.locations where slug = 'sri-lanka');

-- ── 2 · camp_trips columns ──────────────────────────────────────────────────
alter table public.camp_trips alter column pax drop not null;            -- the check (pax > 0) stays: empty or ≥ 1
alter table public.camp_trips add column if not exists paid_lines integer;   -- paid transfer lines of the trip (camp report)
alter table public.camp_trips add column if not exists guest_eur numeric(10,2);   -- € the guests paid for this transfer (camp report)

-- ── 3 · The /prices route of an airport trip ────────────────────────────────
create or replace function public.transport_airport_route(p_location uuid, p_kind text, p_place text)
returns text language sql stable security definer set search_path = public as $$
  with loc as (select slug from public.locations where id = p_location),
  cat_rows as (
    select regexp_replace(pc.name, '\s+—\s+[^—]*$', '') as route, pc.sort_order
      from public.pricing_catalog pc
     where pc.location_id = p_location and pc.category = 'Transport' and pc.active and pc.show_in_transport_picker
       and coalesce(pc.picker_tab, 'airport') = 'airport')
  select r.route from cat_rows r, loc
   where case when loc.slug = 'morocco'
              then strpos(lower(r.route), lower(case upper(coalesce(nullif(trim(p_place), ''), 'AGA'))
                                                   when 'AGA' then 'Agadir' when 'RAK' then 'Marrakech' when 'ESU' then 'Essaouira' else '§' end)) > 0
              else r.route ~* case when p_kind = 'airport_departure' then '→\s*airport' else 'airport\s*→' end end
   order by r.sort_order nulls last limit 1;
$$;

-- ── 4 · The one vehicle rule ────────────────────────────────────────────────
create or replace function public.transport_vehicle_for(p_location uuid, p_tab text, p_route text, p_pax integer, p_product text default null)
returns table (vehicle text, capacity integer, cost numeric, over_capacity boolean)
language sql stable security definer set search_path = public as $$
  with cat_rows as (
    select trim(substring(pc.name from '—\s+([^—]*)$')) as vehicle,
           coalesce(pc.capacity, nullif(substring(pc.notes from '(?i)capacity\s*(\d+)'), '')::int) as cap,
           coalesce(pc.cost_per_guest, 0) as cost, pc.bl_product, pc.sort_order
      from public.pricing_catalog pc
     where pc.location_id = p_location and pc.category = 'Transport' and pc.active and pc.show_in_transport_picker
       and coalesce(pc.picker_tab, 'airport') = coalesce(p_tab, 'airport')
       and pc.name ~ '—'
       and lower(trim(regexp_replace(pc.name, '\s+—\s+[^—]*$', ''))) = lower(trim(p_route))),
  floor_ as (
    select min(cap) as c from cat_rows
     where p_product is not null and bl_product is not null
       and lower(regexp_replace(trim(bl_product), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_product), '\s+', ' ', 'g'))),
  fit as (
    select r.vehicle, r.cap, r.cost from cat_rows r, floor_ f
     where r.cap is not null and r.cap >= greatest(coalesce(p_pax, 1), 1) and (f.c is null or r.cap >= f.c)
     order by r.cap, r.sort_order nulls last limit 1),
  big as (select r.vehicle, r.cap, r.cost from cat_rows r where r.cap is not null order by r.cap desc, r.sort_order nulls last limit 1)
  select vehicle, cap, cost, false from fit
  union all
  select vehicle, cap, cost, true from big where not exists (select 1 from fit)
  limit 1;
$$;

-- ── 5 · Follow /prices on the trips that may still change ───────────────────
-- camp_trips__reprice: no permission check (also called by the optional trigger); camp_trips_reprice: the door for people.
create or replace function public.camp_trips__reprice(p_location uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone public.camp_trips__tz(p_location))::date;
  t public.camp_trips%rowtype; v_route text; v_veh text; v_cost numeric; v_n int := 0;
begin
  for t in select * from public.camp_trips c
            where c.location_id = p_location and c.trip_date >= v_today and c.payment_entry_id is null
              and c.status in ('planned', 'sent', 'confirmed') and not ('expected_price' = any(coalesce(c.edited_fields, '{}')))
            for update loop
    v_veh := null; v_cost := null;
    if t.kind in ('airport_arrival', 'airport_departure') then
      v_route := public.transport_airport_route(p_location, t.kind, t.place);
      if v_route is null then continue; end if;   -- no /prices route (e.g. Essaouira): left as it is
      if 'vehicle' = any(coalesce(t.edited_fields, '{}')) then
        v_veh := t.vehicle;
        select pc.cost_per_guest into v_cost from public.pricing_catalog pc
         where pc.location_id = p_location and pc.category = 'Transport' and pc.active and pc.show_in_transport_picker
           and coalesce(pc.picker_tab, 'airport') = 'airport'
           and lower(trim(regexp_replace(pc.name, '\s+—\s+[^—]*$', ''))) = lower(trim(v_route))
           and trim(substring(pc.name from '—\s+([^—]*)$')) = t.vehicle
         order by pc.sort_order nulls last limit 1;
      else
        select tv.vehicle, tv.cost into v_veh, v_cost from public.transport_vehicle_for(p_location, 'airport', v_route, coalesce(t.pax, 1)) tv;
      end if;
    elsif t.kind = 'other' and t.vehicle is not null and t.route is not null then
      v_veh := t.vehicle;
      select pc.cost_per_guest into v_cost from public.pricing_catalog pc
       where pc.location_id = p_location and pc.category = 'Transport' and pc.active and pc.show_in_transport_picker
         and pc.picker_tab in ('surf', 'tours')
         and lower(pc.name) = lower(t.route || ' — ' || t.vehicle)
       order by pc.sort_order nulls last limit 1;
    end if;
    if v_veh is null or v_cost is null or v_cost <= 0 then continue; end if;   -- never a price of 0
    if v_veh is distinct from t.vehicle or v_cost is distinct from t.expected_price then
      update public.camp_trips
         set vehicle = v_veh, expected_price = v_cost,
             needs_resend = t.needs_resend or (t.status in ('sent', 'confirmed') and v_veh is distinct from t.vehicle)
       where id = t.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.camp_trips_reprice(p_location uuid)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not public.camp_trips_can_manage(p_location) then raise exception 'Only the camp manager or HQ can reprice' using errcode = '42501'; end if;
  return public.camp_trips__reprice(p_location);
end $$;

revoke all on function public.camp_trips__reprice(uuid) from public, anon, authenticated;
revoke all on function public.camp_trips_reprice(uuid) from public, anon;
grant execute on function public.camp_trips_reprice(uuid) to authenticated;
revoke all on function public.transport_airport_route(uuid, text, text) from public, anon;
grant execute on function public.transport_airport_route(uuid, text, text) to authenticated;
revoke all on function public.transport_vehicle_for(uuid, text, text, integer, text) from public, anon;
grant execute on function public.transport_vehicle_for(uuid, text, text, integer, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select l.slug, pc.name, pc.capacity, pc.covers_pax, pc.bl_product, pc.cost_per_guest, pc.currency, pc.sell_price, pc.sell_currency
--   from public.pricing_catalog pc join public.locations l on l.id = pc.location_id
--  where pc.category = 'Transport' and pc.active order by l.slug, pc.picker_tab, pc.sort_order;
-- select public.transport_airport_route(l.id, 'airport_arrival', 'CMB') from public.locations l where l.slug = 'sri-lanka';   -- Airport → Surfcamp
-- select * from public.transport_vehicle_for((select id from public.locations where slug = 'sri-lanka'), 'airport', 'Airport → Surfcamp', 4);
--   -- with Car capacity 4 (today) → Car; after Miguel sets Car = 3 → Minivan. 9 people → Minivan, over_capacity true.
-- Dry run of the repricing (rolls back):
--   begin; select public.camp_trips_reprice((select id from public.locations where slug = 'morocco')); rollback;
--
-- ════════════════════════════════════════════════════════════════════════════
--  Rollback
-- ════════════════════════════════════════════════════════════════════════════
--   drop function if exists public.camp_trips_reprice(uuid); drop function if exists public.camp_trips__reprice(uuid);
--   then run the PREVIOUS supabase/camp-trips-bl-check.sql (git) — its camp_trips_bl_verify does not call these:
--   drop function if exists public.transport_vehicle_for(uuid, text, text, integer, text);
--   drop function if exists public.transport_airport_route(uuid, text, text);
--   The columns can stay (the apps read them when present). pax NOT NULL again only after filling the empty ones:
--   update public.camp_trips set pax = 1 where pax is null; alter table public.camp_trips alter column pax set not null;
