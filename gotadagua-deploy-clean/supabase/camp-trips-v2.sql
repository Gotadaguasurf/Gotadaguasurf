-- ════════════════════════════════════════════════════════════════════════════
--  Transport: free / offered transfers, Nadith's «not in the list» transfer and
--  paying a transfer up to 14 days ahead (Sri Lanka, 13 Nov 2026).
--
--  Requires supabase/camp-trips.sql and supabase/camp-trips-own-link.sql (both
--  live). Run this BEFORE the app code that uses it is deployed. Idempotent.
--  NOT run against production by the agent — Miguel runs it after his OK.
--
--  1 · camp_trips.free_reason — a trip nobody pays us for (staff, a gift to a
--      guest, compensation). charge = 'free' + the reason. The driver is still
--      paid: a free trip is owed and linked to a payment like any other.
--      A trigger keeps charge = 'free' while a reason is set, so the Monday
--      Guests import (which rewrites charge from the file) cannot undo it.
--  2 · camp_trips.added_by_local — true when the local manager added the trip
--      from the ledger form («added by Nadith» in Transport).
--  3 · camp_trip_add_own() — the local manager cannot insert into camp_trips
--      (RLS). This definer function adds ONE free airport transfer by hand for
--      his own camp, so he can pay a driver for a staff member or a gift that
--      is not in the list.
--  4 · camp_transport_link_own() — same function as in camp-trips-own-link.sql
--      with one change: a ticked transfer may be dated up to 14 days after the
--      payment date (was: up to the payment date).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.camp_trips add column if not exists free_reason text;
alter table public.camp_trips add column if not exists added_by_local boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'camp_trips_free_reason_check' and conrelid = 'public.camp_trips'::regclass) then
    alter table public.camp_trips add constraint camp_trips_free_reason_check
      check (free_reason is null or free_reason in ('staff','gift','compensation','other'));
  end if;
end $$;

-- A reason set = the trip is free, whatever an import or an edit writes into charge.
-- To make a trip chargeable again the app clears free_reason and sets charge together.
create or replace function public.camp_trips_free_keep()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.free_reason is not null then new.charge := 'free'; end if;
  return new;
end $$;
drop trigger if exists camp_trips_free_keep on public.camp_trips;
create trigger camp_trips_free_keep before insert or update on public.camp_trips
  for each row execute function public.camp_trips_free_keep();

-- ── The local manager adds one free airport transfer that is not in the list ─
--   Who: anyone with access to the camp (the local manager included) or HQ.
--   What: an airport arrival / departure, source 'manual', charge 'free' with a
--   reason, dated from go-live to 14 days after the payment date (the same window
--   camp_transport_link_own accepts, so the link that follows cannot fail on the date).
--   The default airport driver and the price sent by the form (the /prices car
--   price) are stamped; created_by = the caller; added_by_local when he is the
--   local manager. Returns the new row.
create or replace function public.camp_trip_add_own(
  p_location uuid, p_kind text, p_date date, p_name text, p_free_reason text,
  p_price numeric default 0, p_note text default null, p_entry_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_driver uuid; v_row public.camp_trips%rowtype;
  v_today date := (now() at time zone 'Asia/Colombo')::date;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null or not (public.has_location_access(p_location) or public.is_hq_member()) then
    raise exception 'No access to this camp' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('airport_arrival', 'airport_departure') then raise exception 'Only an airport arrival or departure'; end if;
  if v_name is null then raise exception 'Type the name'; end if;
  if length(v_name) > 120 then raise exception 'The name is too long'; end if;
  if p_free_reason is null or p_free_reason not in ('staff', 'gift', 'compensation', 'other') then raise exception 'Pick the reason'; end if;
  if p_date is null or p_date < public.camp_trips_go_live() or p_date > coalesce(p_entry_date, v_today) + 14 then
    raise exception 'The date must be between % and 14 days after the payment', public.camp_trips_go_live();
  end if;
  if coalesce(p_price, 0) < 0 or coalesce(p_price, 0) > 200000 then raise exception 'The price is out of range'; end if;
  select id into v_driver from public.camp_drivers
   where location_id = p_location and active and 'airport' = any(default_for) order by created_at limit 1;
  insert into public.camp_trips (location_id, kind, trip_date, place, route, purpose, guest_names, pax, vehicle, driver_id,
    expected_price, status, source, charge, free_reason, notes, added_by_local, created_by)
  values (p_location, p_kind, p_date, 'CMB',
    case when p_kind = 'airport_departure' then 'Surfcamp → Airport' else 'Airport → Surfcamp' end,
    case when p_free_reason = 'staff' then 'staff' else 'guests' end,
    v_name, 1, 'Car', v_driver, coalesce(p_price, 0), 'planned', 'manual', 'free', p_free_reason,
    nullif(btrim(coalesce(p_note, '')), ''), public.is_local_manager(p_location), auth.uid())
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ── Nadith's pick, now up to 14 days ahead of the payment date ──────────────
create or replace function public.camp_transport_link_own(p_entry uuid, p_trip_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.ledger_entries%rowtype;
  l public.camp_transport_payments%rowtype;
  v_ids uuid[]; v_want int; v_ok int; v_sum numeric; v_n int; v_state text; v_driver uuid; v_manage boolean;
  v_go date := public.camp_trips_go_live();
begin
  v_ids := array(select distinct x from unnest(coalesce(p_trip_ids, '{}'::uuid[])) as x where x is not null);
  v_want := coalesce(cardinality(v_ids), 0);
  -- Nothing ticked = nothing to do: the automatic link stays as it is (never an unlink).
  if v_want = 0 then return jsonb_build_object('state', 'unchanged', 'trips', 0); end if;

  select * into e from public.ledger_entries where id = p_entry;
  if e.id is null then raise exception 'Payment not found — refresh'; end if;
  if not (public.has_location_access(e.location_id) or public.is_hq_member()) then
    raise exception 'No access to this camp' using errcode = '42501';
  end if;
  v_manage := public.camp_trips_can_manage(e.location_id);
  if not (e.type = 'expense' and e.category = 'Transport') then
    raise exception 'Only a Transport expense can pay trips';
  end if;
  if not v_manage and not (e.payment_method = 'Cash' and e.created_by = auth.uid() and e.created_at > now() - interval '24 hours') then
    raise exception 'Only your own Cash Transport payment of the last 24 hours' using errcode = '42501';
  end if;
  select * into l from public.camp_transport_payments where entry_id = p_entry for update;
  if not v_manage and l.entry_id is not null
     and (l.linked_by = 'pay' or (l.linked_by = 'manual' and l.reviewed_by is not null)) then
    raise exception 'The camp manager already linked this payment' using errcode = '42501';
  end if;

  perform set_config('app.trip_pay', 'on', true);
  perform 1 from public.camp_trips where id = any(v_ids) or payment_entry_id = p_entry order by id for update;
  -- Every ticked trip: this camp's airport transfer, not cancelled, from go-live up to
  -- 14 days after the payment date (he may pay ahead: on 13 Nov the form said «No unpaid
  -- airport transfers» while the 14 Nov trips existed), and unpaid — or already on this entry.
  select count(*) into v_ok from public.camp_trips
   where id = any(v_ids) and location_id = e.location_id
     and kind in ('airport_arrival', 'airport_departure')
     and status not in ('cancelled', 'no_show', 'merged')
     and trip_date >= v_go and trip_date <= e.entry_date + 14
     and (payment_entry_id is null or payment_entry_id = p_entry);
  if v_ok <> v_want then raise exception 'Some transfers were already paid or are not this camp''s — refresh'; end if;

  update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry and not (id = any(v_ids));
  update public.camp_trips set payment_entry_id = p_entry where id = any(v_ids) and payment_entry_id is null;
  select coalesce(sum(expected_price), 0), count(*) into v_sum, v_n from public.camp_trips where payment_entry_id = p_entry;
  if v_n <> v_want then raise exception 'Some transfers were already paid — refresh'; end if;
  -- The driver: the one driver of the ticked trips (none when they are mixed;
  -- the one the trigger found when no ticked trip has a driver).
  select case count(distinct driver_id) when 0 then l.driver_id when 1 then (array_agg(driver_id))[1] end into v_driver
    from public.camp_trips where id = any(v_ids) and driver_id is not null;
  v_state := case when v_sum = e.amount_local then 'matched' else 'review' end;

  insert into public.camp_transport_payments as p (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count,
    state, reason, note, linked_by, signature, reviewed_by, reviewed_at, updated_at)
  values (p_entry, e.location_id, v_driver, e.amount_local, v_sum, v_n,
    v_state, case when v_state = 'matched' then null else 'amounts differ' end, null, 'manual',
    e.amount_local::text || '|' || e.entry_date::text || '|' || coalesce(e.description, ''),
    case when v_manage then auth.uid() end, case when v_manage then now() end, now())
  on conflict (entry_id) do update set driver_id = excluded.driver_id, entry_amount = excluded.entry_amount,
    trips_amount = excluded.trips_amount, trips_count = excluded.trips_count, state = excluded.state, reason = excluded.reason,
    note = null, linked_by = 'manual', signature = excluded.signature, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, updated_at = now();
  return jsonb_build_object('state', v_state, 'trips', v_n, 'trips_amount', v_sum, 'amount', e.amount_local);
end $$;


revoke all on function public.camp_trips_free_keep() from public, anon, authenticated;
revoke all on function public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date) from public, anon;
grant execute on function public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date) to authenticated;
revoke all on function public.camp_transport_link_own(uuid, uuid[]) from public, anon;
grant execute on function public.camp_transport_link_own(uuid, uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select column_name from information_schema.columns where table_name = 'camp_trips' and column_name in ('free_reason','added_by_local');   -- 2 rows
-- select proname, prosecdef from pg_proc where proname in ('camp_trip_add_own','camp_transport_link_own','camp_trips_free_keep');           -- 3 rows
-- select has_function_privilege('anon', 'public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date)', 'execute');          -- false
-- select tgname from pg_trigger where tgrelid = 'public.camp_trips'::regclass and not tgisinternal;                                         -- camp_trips_free_keep, camp_trips_guard
-- Rollback:
--   drop trigger if exists camp_trips_free_keep on public.camp_trips; drop function if exists public.camp_trips_free_keep();
--   drop function if exists public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date);
--   then run supabase/camp-trips-own-link.sql again (the picker goes back to «up to the payment date»).
--   The two columns can stay (unused) or: alter table public.camp_trips drop column free_reason, drop column added_by_local;
