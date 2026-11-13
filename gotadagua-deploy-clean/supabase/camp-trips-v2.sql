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
--  1b · camp_trips.guest_notified_at / guest_confirmed_at / guest_told_snapshot —
--      «Confirm with guest» (the guest gets the transfer details on WhatsApp).
--  2 · camp_trips.added_by_local — true when the local manager added the trip
--      from the ledger form («added by Nadith» in Transport).
--  3 · camp_trip_add_own() — the local manager cannot insert into camp_trips
--      (RLS). This definer function adds ONE free airport transfer by hand for
--      his own camp, so he can pay a driver for a staff member or a gift that
--      is not in the list.
--  4 · camp_transport_link_own() — same function as in camp-trips-own-link.sql
--      with one change: a ticked transfer may be dated up to 14 days after the
--      payment date (was: up to the payment date).
--  5–7 · (further down) driver names with a near spelling or two names, the
--      automatic link stamping trips only on an exact match, and the Monday
--      import flagging removed transfers / replacing regrouped trips. These
--      REPLACE camp_transport__link and camp_trips_import of camp-trips.sql:
--      after this file, do not re-run camp-trips.sql without re-running this one.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.camp_trips add column if not exists free_reason text;
alter table public.camp_trips add column if not exists added_by_local boolean not null default false;
-- «Confirm with guest»: when the guest was sent the details of the transfer on WhatsApp, what
-- he was told (so a later change shows «Changed — tell guest again»), and Francisco's tick
-- when the guest replied that they are right.
alter table public.camp_trips add column if not exists guest_notified_at timestamptz;
alter table public.camp_trips add column if not exists guest_confirmed_at timestamptz;
alter table public.camp_trips add column if not exists guest_told_snapshot jsonb;
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



-- ════════════════════════════════════════════════════════════════════════════
--  5 · Driver named in a payment: near spellings and two names
--      («Dylan 42000» = Dilan; «Dilan and Nishantha» = two drivers → review).
-- ════════════════════════════════════════════════════════════════════════════
-- Same word, or one letter changed / added / missing. Only for words of 4+ letters.
create or replace function public.camp_transport__near(a text, b text)
returns boolean language plpgsql immutable as $$
declare la int := length(a); lb int := length(b); i int; s text; g text;
begin
  if a = b then return true; end if;
  if least(la, lb) < 4 or abs(la - lb) > 1 then return false; end if;
  if la = lb then
    return (select count(*) from generate_series(1, la) n where substr(a, n, 1) <> substr(b, n, 1)) = 1;
  end if;
  if la < lb then s := a; g := b; else s := b; g := a; end if;
  for i in 1 .. length(g) loop
    if substr(g, 1, i - 1) || substr(g, i + 1) = s then return true; end if;
  end loop;
  return false;
end $$;

-- Every driver named in a description. Exact names / aliases first (whole words, as before);
-- only when none is found, a near spelling of a one-word name of 5+ letters.
create or replace function public.camp_transport__drivers_in(p_location uuid, p_text text)
returns uuid[] language sql stable security definer set search_path = public as $$
  with names as (
    select d.id, lower(btrim(a)) as a
      from public.camp_drivers d, unnest(array_append(d.aliases, d.name)) a
     where d.location_id = p_location and d.active and not ('contact' = any(d.kinds) and cardinality(d.kinds) = 1)
       and coalesce(btrim(a), '') <> ''
  ), exact as (
    select distinct id from names
     where lower(coalesce(p_text, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(a, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '([^[:alnum:]]|$)')
  ), words as (
    select distinct w from regexp_split_to_table(lower(coalesce(p_text, '')), '[^[:alpha:]]+') w where length(w) >= 4
  ), near as (
    select distinct n.id from names n, words w
     where not exists (select 1 from exact) and n.a !~ '[^[:alpha:]]' and length(n.a) >= 5 and public.camp_transport__near(n.a, w.w)
  )
  select coalesce(array_agg(id order by id), '{}') from (select id from exact union select id from near) x;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  6 · The automatic link, safer (replaces the function of camp-trips.sql):
--      · trips are stamped ONLY when they add up exactly to the amount (and to the counts typed);
--        otherwise nothing is stamped and the payment goes to «Payments to review»;
--      · no driver named and nothing ticked → review («no driver named»), never matched from
--        the linked item alone; two drivers named → review («two drivers named»).
--      Nadith's ticks (camp_transport_link_own) and Francisco's links are untouched.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.camp_transport__link(p_entry uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e public.ledger_entries%rowtype;
  l public.camp_transport_payments%rowtype;
  v_sig text; v_driver uuid; v_sum numeric := 0; v_n int := 0; t record; v_ids uuid[] := '{}';
  v_txt text; v_want_arr int; v_want_dep int; v_have_arr int := 0; v_have_dep int := 0; v_reason text;
  v_named uuid[]; v_item boolean;
  v_go date := public.camp_trips_go_live();
begin
  perform set_config('app.trip_pay', 'on', true);
  select * into e from public.ledger_entries where id = p_entry;
  select * into l from public.camp_transport_payments where entry_id = p_entry;
  if e.id is null then
    delete from public.camp_transport_payments where entry_id = p_entry;
    return 'gone';
  end if;
  -- Not (or no longer) a Transport cash payment → nothing linked.
  if not (e.type = 'expense' and e.category = 'Transport' and e.payment_method = 'Cash') then
    if l.entry_id is not null then
      update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry;
      delete from public.camp_transport_payments where entry_id = p_entry;
    end if;
    return 'not_transport';
  end if;
  v_sig := e.amount_local::text || '|' || e.entry_date::text || '|' || coalesce(e.description, '');
  -- Rows made by «Pay a driver», or linked / unlinked / explained by Francisco: keep his trips, refresh the totals.
  if (l.entry_id is not null and l.linked_by <> 'auto') or (l.entry_id is null and e.source_kind = 'trip_payment') then
    if l.entry_id is null then return 'pay_pending'; end if;  -- camp_trips_pay inserts the link itself
    select coalesce(sum(expected_price), 0), count(*) into v_sum, v_n from public.camp_trips where payment_entry_id = p_entry;
    update public.camp_transport_payments set
      entry_amount = e.amount_local, trips_amount = v_sum, trips_count = v_n, signature = v_sig, updated_at = now(),
      state = case when state = 'explained' and signature is not distinct from v_sig then 'explained'
                   when v_n > 0 and v_sum = e.amount_local then 'matched' else 'review' end,
      reason = case when state = 'explained' and signature is not distinct from v_sig then reason
                    when v_n > 0 and v_sum = e.amount_local then null
                    when v_n = 0 then 'no trips linked' else 'amounts differ' end
     where entry_id = p_entry;
    return 'kept';
  end if;
  -- Old lumps (before go-live) are never linked automatically nor flagged.
  if not (e.entry_date >= v_go and (e.created_at at time zone 'Asia/Colombo')::date >= v_go) then
    if l.entry_id is not null then
      update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry;
      delete from public.camp_transport_payments where entry_id = p_entry;
    end if;
    return 'before_go_live';
  end if;
  -- Automatic: nothing changed since the last exact match → nothing to do.
  if l.entry_id is not null and l.signature is not distinct from v_sig and l.state in ('matched','explained') then
    return 'unchanged';
  end if;
  -- Who is named: exact names first, then a near spelling («Dylan» = Dilan). Two different
  -- drivers in one description («Dilan and Nishantha») = nobody: Francisco splits it.
  v_named := public.camp_transport__drivers_in(e.location_id, e.description);
  v_driver := case when cardinality(v_named) = 1 then v_named[1] end;
  v_item := coalesce(e.linked_item, '') in ('Airport', 'Transport Surf Lesson', 'Food Supply', 'Laundry');
  -- Only driver payments are reconciled: a named driver, or a driver-run linked item.
  -- Fuel, scooter, deliveries etc. (no driver, no such item) are left alone.
  if cardinality(v_named) = 0 and not v_item then
    if l.entry_id is not null then
      update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry;
      delete from public.camp_transport_payments where entry_id = p_entry;
    end if;
    return 'not_driver';
  end if;
  update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry;
  -- No name (or two names) and no ticks: never guessed from the item alone. «Olivia (Social Host)»
  -- 21.000 used to take the default driver's oldest trip of the same price and show a guest as Paid.
  if v_driver is null then
    insert into public.camp_transport_payments as p (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count, state, reason, linked_by, signature, updated_at)
    values (p_entry, e.location_id, null, e.amount_local, 0, 0, 'review',
            case when cardinality(v_named) > 1 then 'two drivers named' else 'no driver named' end, 'auto', v_sig, now())
    on conflict (entry_id) do update set driver_id = null, entry_amount = excluded.entry_amount, trips_amount = 0, trips_count = 0,
      state = 'review', reason = excluded.reason, signature = excluded.signature, updated_at = now(), note = null;
    return 'review';
  end if;
  -- Counts typed by Nadith («Dilan 1 arrival 3 departures», «11 Arrivals, 2Drops»):
  -- when present, the payment takes exactly that many of the driver's oldest unpaid
  -- arrivals / departures, and must match both the counts and the amount.
  v_txt := lower(coalesce(e.description, ''));
  v_want_arr := substring(v_txt from '(\d+)\s*x?\s*(?:arrivals?|arr\M|pick\s*-?\s*ups?)')::int;
  v_want_dep := substring(v_txt from '(\d+)\s*x?\s*(?:departures?|deps?\M|drops?|drop\s*-?\s*offs?)')::int;
  if v_driver is not null and (v_want_arr is not null or v_want_dep is not null) then
    for t in
      select id, kind, expected_price from (
        (select id, kind, expected_price, trip_date, trip_time, created_at from public.camp_trips
          where location_id = e.location_id and driver_id = v_driver and payment_entry_id is null and kind = 'airport_arrival'
            and status not in ('cancelled','no_show','merged') and public.camp_trip_is_done(status, trip_date, trip_time)
            and trip_date <= e.entry_date and trip_date >= v_go
          order by trip_date, trip_time nulls last, created_at, id limit coalesce(v_want_arr, 0))
        union all
        (select id, kind, expected_price, trip_date, trip_time, created_at from public.camp_trips
          where location_id = e.location_id and driver_id = v_driver and payment_entry_id is null and kind = 'airport_departure'
            and status not in ('cancelled','no_show','merged') and public.camp_trip_is_done(status, trip_date, trip_time)
            and trip_date <= e.entry_date and trip_date >= v_go
          order by trip_date, trip_time nulls last, created_at, id limit coalesce(v_want_dep, 0))
      ) x
    loop
      v_sum := v_sum + t.expected_price; v_n := v_n + 1; v_ids := v_ids || t.id;
      if t.kind = 'airport_arrival' then v_have_arr := v_have_arr + 1; else v_have_dep := v_have_dep + 1; end if;
    end loop;
    v_reason := case
      when v_have_arr < coalesce(v_want_arr, 0) or v_have_dep < coalesce(v_want_dep, 0) then
        'counts: ' || concat_ws(', ',
          case when v_want_arr is not null then v_have_arr || ' of ' || v_want_arr || ' arrivals found' end,
          case when v_want_dep is not null then v_have_dep || ' of ' || v_want_dep || ' departures found' end)
      when v_sum <> e.amount_local then 'counts match, amounts differ'
    end;
    -- Trips are stamped only on an exact match (counts and amount). Anything else stamps
    -- nothing: a payment in review must never leave the wrong guest showing as Paid.
    if v_reason is null and v_n > 0 then
      perform 1 from public.camp_trips where id = any(v_ids) for update;
      update public.camp_trips set payment_entry_id = p_entry where id = any(v_ids) and payment_entry_id is null;
    else
      v_sum := 0; v_n := 0;
    end if;
    insert into public.camp_transport_payments as p (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count, state, reason, linked_by, signature, updated_at)
    values (p_entry, e.location_id, v_driver, e.amount_local, v_sum, v_n,
            case when v_reason is null then 'matched' else 'review' end, v_reason, 'auto', v_sig, now())
    on conflict (entry_id) do update set driver_id = excluded.driver_id, entry_amount = excluded.entry_amount,
      trips_amount = excluded.trips_amount, trips_count = excluded.trips_count, state = excluded.state,
      reason = excluded.reason, signature = excluded.signature, updated_at = now(), note = null;
    return case when v_reason is null then 'matched' else 'review' end;
  end if;
  if v_driver is not null then
    for t in
      select id, expected_price from public.camp_trips
       where location_id = e.location_id and driver_id = v_driver and payment_entry_id is null
         and status not in ('cancelled','no_show','merged')
         and public.camp_trip_is_done(status, trip_date, trip_time)
         and trip_date <= e.entry_date and trip_date >= v_go      -- trips before go-live were paid in the old lumps
       order by trip_date, trip_time nulls last, created_at, id
       for update
    loop
      exit when v_sum + t.expected_price > e.amount_local;
      v_sum := v_sum + t.expected_price; v_n := v_n + 1; v_ids := v_ids || t.id;
    end loop;
    -- Exact sum only (see above). «Dilan 42000» for two 21.000 arrivals used to take an older
    -- 26.500 trip, stop, and leave that guest Paid and the two really paid Owed.
    if v_n > 0 and v_sum = e.amount_local then
      update public.camp_trips set payment_entry_id = p_entry where id = any(v_ids) and payment_entry_id is null;
    else
      v_reason := case when v_n = 0 then 'no unpaid trips' else 'no exact match' end;
      v_sum := 0; v_n := 0;
    end if;
  end if;
  insert into public.camp_transport_payments as p (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count, state, reason, linked_by, signature, updated_at)
  values (p_entry, e.location_id, v_driver, e.amount_local, v_sum, v_n,
          case when v_n > 0 and v_sum = e.amount_local then 'matched' else 'review' end,
          v_reason,
          'auto', v_sig, now())
  on conflict (entry_id) do update set driver_id = excluded.driver_id, entry_amount = excluded.entry_amount,
    trips_amount = excluded.trips_amount, trips_count = excluded.trips_count, state = excluded.state,
    reason = excluded.reason, signature = excluded.signature, updated_at = now(), note = null;
  return case when v_n > 0 and v_sum = e.amount_local then 'matched' else 'review' end;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
--  7 · The Monday import (replaces the function of camp-trips.sql):
--      · a booking still in the file whose trip is gone (transfer removed) is flagged — p_refs_present;
--      · a booking + direction that changed its grouping replaces its old trips (no stale duplicates);
--      · a price of 0 never overwrites a real price.
--      «Not in the file at all» stays a preset-only flag; the app now decides «preset» from the
--      Sri Lanka rows only (one row of another camp used to switch it off).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.camp_trips_import(
  p_location uuid, p_export_date date, p_is_preset boolean,
  p_refs_present text[], p_cancel_refs text[], p_trips jsonb, p_guests jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  x jsonb; t public.camp_trips%rowtype; v_key text; v_keys text[] := '{}';
  v_ins int := 0; v_upd int := 0; v_resend int := 0; v_cancel int := 0; v_missing int := 0; v_untouched int := 0; v_guests int := 0;
  v_replaced int := 0; v_removed int := 0; v_removed_text constant text := 'transfer removed in Bookinglayer — cancel it?';
  v_driver uuid; v_import uuid := gen_random_uuid(); v_now timestamptz := now();
  n_date date; n_time text; n_flight text; n_pax int; n_place text; n_guests text; n_phone text; changed boolean;
begin
  if not public.camp_trips_can_manage(p_location) then raise exception 'Only the camp manager or HQ can import' using errcode = '42501'; end if;
  select id into v_driver from public.camp_drivers where location_id = p_location and active and 'airport' = any(default_for) order by created_at limit 1;
  for x in select * from jsonb_array_elements(coalesce(p_trips, '[]'::jsonb)) loop
    v_key := x->>'key'; v_keys := v_keys || v_key;
    n_date := nullif(x->>'date','')::date; n_time := nullif(x->>'time',''); n_flight := nullif(x->>'flight','');
    n_pax := greatest(1, coalesce((x->>'pax')::int, 1)); n_place := nullif(x->>'place','');
    n_guests := nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(x->'guests','[]'::jsonb))), ', '), '');
    n_phone := nullif(x->>'phone','');
    select * into t from public.camp_trips where location_id = p_location and import_key = v_key for update;
    if t.id is null then
      insert into public.camp_trips (location_id, kind, trip_date, trip_time, flight, place, route, purpose, guest_names, guest_phone, booking_ref, booking_checkout,
        pax, vehicle, driver_id, expected_price, status, source, charge, import_key, import_flags, last_import_at, last_export_date, hq_match, partner)
      values (p_location, x->>'kind', n_date, n_time, n_flight, coalesce(n_place,'CMB'),
        case when x->>'kind' = 'airport_departure' then 'Surfcamp → Airport' else 'Airport → Surfcamp' end, 'guests',
        n_guests, n_phone, x->>'booking_ref', nullif(x->>'booking_checkout','')::date, n_pax, x->>'vehicle', v_driver,
        coalesce((x->>'expected_price')::numeric, 0), 'planned', 'bookinglayer', nullif(x->>'charge',''), v_key,
        array(select jsonb_array_elements_text(coalesce(x->'flags','[]'::jsonb))), v_now, p_export_date,
        nullif(x->>'hq_match',''), nullif(x->>'partner',''));
      v_ins := v_ins + 1; continue;
    end if;
    if t.payment_entry_id is not null or t.status in ('done','no_show','merged')
       -- cancelled by hand stays cancelled; cancelled by an import (booking cancelled, or regrouped) comes back when the file has it again
       or (t.status = 'cancelled' and coalesce(t.cancel_reason,'') not in ('bookinglayer','split'))
       or (t.last_export_date is not null and p_export_date is not null and p_export_date < t.last_export_date)
       or public.camp_trip_is_done('planned', t.trip_date, t.trip_time) then   -- already in the past (done by time)
      v_untouched := v_untouched + 1; continue;
    end if;
    -- New values: an empty value never blanks a field; a field typed by hand is kept.
    n_date   := case when 'trip_date'   = any(t.edited_fields) then t.trip_date   else coalesce(n_date, t.trip_date) end;
    n_time   := case when 'trip_time'   = any(t.edited_fields) then t.trip_time   else coalesce(n_time, t.trip_time) end;
    n_flight := case when 'flight'      = any(t.edited_fields) then t.flight      else coalesce(n_flight, t.flight) end;
    n_pax    := case when 'pax'         = any(t.edited_fields) then t.pax         else n_pax end;
    n_place  := case when 'place'       = any(t.edited_fields) then t.place       else coalesce(n_place, t.place) end;
    n_guests := case when 'guest_names' = any(t.edited_fields) then t.guest_names else coalesce(n_guests, t.guest_names) end;
    n_phone  := case when 'guest_phone' = any(t.edited_fields) then t.guest_phone else coalesce(n_phone, t.guest_phone) end;
    changed := (n_date, n_time, n_flight, n_pax, n_place) is distinct from (t.trip_date, t.trip_time, t.flight, t.pax, t.place);
    update public.camp_trips set
      status = case when t.status = 'cancelled' then 'planned' else t.status end,
      cancel_reason = case when t.status = 'cancelled' then null else t.cancel_reason end,
      trip_date = n_date, trip_time = n_time, flight = n_flight, pax = n_pax, place = n_place, guest_names = n_guests, guest_phone = n_phone,
      booking_checkout = coalesce(nullif(x->>'booking_checkout','')::date, t.booking_checkout),
      vehicle = case when 'vehicle' = any(t.edited_fields) then t.vehicle else coalesce(x->>'vehicle', t.vehicle) end,
      -- a price of 0 (prices not loaded in the browser) never replaces a real price
      expected_price = case when 'expected_price' = any(t.edited_fields) then t.expected_price else coalesce(nullif((x->>'expected_price')::numeric, 0), t.expected_price) end,
      charge = coalesce(nullif(x->>'charge',''), t.charge),
      hq_match = coalesce(nullif(x->>'hq_match',''), t.hq_match), partner = coalesce(nullif(x->>'partner',''), t.partner),
      import_flags = array(select jsonb_array_elements_text(coalesce(x->'flags','[]'::jsonb))),
      needs_resend = t.needs_resend or (t.status in ('sent','confirmed') and changed),
      missing_since = null, last_import_at = v_now, last_export_date = coalesce(p_export_date, t.last_export_date)
     where id = t.id;
    if t.status in ('sent','confirmed') and changed then v_resend := v_resend + 1; else v_upd := v_upd + 1; end if;
  end loop;
  -- Bookings cancelled / expired in the file.
  update public.camp_trips set status = 'cancelled', cancel_reason = 'bookinglayer', needs_resend = status in ('sent','confirmed')
   where location_id = p_location and booking_ref = any(coalesce(p_cancel_refs, '{}')) and source = 'bookinglayer'
     and status in ('planned','sent','confirmed') and payment_entry_id is null;
  get diagnostics v_cancel = row_count;
  -- One booking + direction changed its grouping (a couple that was two trips is one again, the
  -- whole booking split per guest, or split another way): the trips of the old grouping are
  -- replaced by the ones in this file, never left beside them. Keys are bl:<ref>:<arr|dep>[:guest].
  update public.camp_trips c set status = 'cancelled', cancel_reason = 'split', needs_resend = c.status in ('sent','confirmed')
   where c.location_id = p_location and c.source = 'bookinglayer' and c.status in ('planned','sent','confirmed') and c.payment_entry_id is null
     and c.import_key is not null and not (c.import_key = any(v_keys))
     and exists (select 1 from unnest(v_keys) k
                  where array_to_string((string_to_array(k, ':'))[1:3], ':') = array_to_string((string_to_array(c.import_key, ':'))[1:3], ':'));
  get diagnostics v_replaced = row_count;
  -- The booking is still in the file but this trip is not (the guest removed the transfer, or one
  -- direction): a question for Francisco, never an automatic cancel. Any file, preset or not.
  if p_export_date is not null then
    update public.camp_trips c set missing_since = coalesce(c.missing_since, p_export_date),
           import_flags = case when v_removed_text = any(c.import_flags) then c.import_flags else array_append(c.import_flags, v_removed_text) end
     where c.location_id = p_location and c.source = 'bookinglayer' and c.status in ('planned','sent','confirmed') and c.payment_entry_id is null
       and c.import_key is not null and not (c.import_key = any(v_keys))
       and c.booking_ref = any(coalesce(p_refs_present, '{}'))
       and c.trip_date >= p_export_date
       and not (v_removed_text = any(c.import_flags));
    get diagnostics v_removed = row_count;
  end if;
  -- Preset file: a future trip absent from it is a question, never an automatic cancel.
  if p_is_preset and p_export_date is not null then
    update public.camp_trips c set missing_since = p_export_date
     where c.location_id = p_location and c.source = 'bookinglayer' and c.status in ('planned','sent','confirmed')
       and c.missing_since is null and c.trip_date >= p_export_date and not (c.import_key = any(v_keys))
       and coalesce(c.booking_checkout, c.trip_date) <= p_export_date + 35;
    get diagnostics v_missing = row_count;
  end if;
  -- Guests of the week (staff lists).
  insert into public.camp_week_guests as g (location_id, week_start, booking_ref, guest_key, guest_name, phone, check_in, check_out,
    accommodation, bed_number, packages, activities, level, diet, allergies, nights, arrival_time, arrival_flight, departure_time, departure_flight,
    has_transfer, booking_status, booking_due, partner, hq_match, raw, import_id, updated_at)
  select p_location, nullif(y->>'week_start','')::date, y->>'booking_ref', y->>'guest_key', y->>'guest_name', nullif(y->>'phone',''),
    nullif(y->>'check_in','')::date, nullif(y->>'check_out','')::date, y->>'accommodation', y->>'bed_number', y->>'packages', y->>'activities',
    y->>'level', y->>'diet', y->>'allergies', nullif(y->>'nights','')::int, nullif(y->>'arrival_time',''), y->>'arrival_flight',
    nullif(y->>'departure_time',''), y->>'departure_flight', coalesce((y->>'has_transfer')::boolean, false), y->>'booking_status',
    nullif(y->>'booking_due','')::numeric, nullif(y->>'partner',''), nullif(y->>'hq_match',''),
    coalesce(y->'raw', '{}'::jsonb), v_import, v_now
  from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb)) y
  where coalesce(y->>'booking_ref','') <> '' and coalesce(y->>'guest_key','') <> ''
  on conflict (location_id, booking_ref, guest_key) do update set week_start = excluded.week_start, guest_name = excluded.guest_name,
    phone = coalesce(excluded.phone, g.phone), check_in = excluded.check_in, check_out = excluded.check_out, accommodation = excluded.accommodation,
    bed_number = excluded.bed_number, packages = excluded.packages, activities = excluded.activities, level = excluded.level, diet = excluded.diet,
    allergies = excluded.allergies, nights = excluded.nights, arrival_time = coalesce(excluded.arrival_time, g.arrival_time),
    arrival_flight = excluded.arrival_flight, departure_time = coalesce(excluded.departure_time, g.departure_time), departure_flight = excluded.departure_flight,
    has_transfer = excluded.has_transfer, booking_status = excluded.booking_status, booking_due = excluded.booking_due,
    partner = excluded.partner, hq_match = excluded.hq_match, raw = excluded.raw, import_id = excluded.import_id, updated_at = v_now;
  get diagnostics v_guests = row_count;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'resend', v_resend, 'cancelled', v_cancel, 'missing', v_missing + v_removed, 'replaced', v_replaced,
                            'untouched', v_untouched, 'guests', v_guests, 'import_id', v_import);
end $$;


revoke all on function public.camp_trips_free_keep() from public, anon, authenticated;
revoke all on function public.camp_transport__near(text, text) from public, anon, authenticated;
revoke all on function public.camp_transport__drivers_in(uuid, text) from public, anon, authenticated;
revoke all on function public.camp_transport__link(uuid) from public, anon, authenticated;
revoke all on function public.camp_trips_import(uuid, date, boolean, text[], text[], jsonb, jsonb) from public, anon;
grant execute on function public.camp_trips_import(uuid, date, boolean, text[], text[], jsonb, jsonb) to authenticated;
revoke all on function public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date) from public, anon;
grant execute on function public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date) to authenticated;
revoke all on function public.camp_transport_link_own(uuid, uuid[]) from public, anon;
grant execute on function public.camp_transport_link_own(uuid, uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select column_name from information_schema.columns where table_name = 'camp_trips' and column_name in ('free_reason','added_by_local','guest_notified_at','guest_confirmed_at','guest_told_snapshot');   -- 5 rows
-- select proname, prosecdef from pg_proc where proname in ('camp_trip_add_own','camp_transport_link_own','camp_trips_free_keep');           -- 3 rows
-- select has_function_privilege('anon', 'public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date)', 'execute');          -- false
-- select tgname from pg_trigger where tgrelid = 'public.camp_trips'::regclass and not tgisinternal;                                         -- camp_trips_free_keep, camp_trips_guard
-- Rollback (sections 1–4):
--   drop trigger if exists camp_trips_free_keep on public.camp_trips; drop function if exists public.camp_trips_free_keep();
--   drop function if exists public.camp_trip_add_own(uuid, text, date, text, text, numeric, text, date);
--   then run supabase/camp-trips-own-link.sql again (the picker goes back to «up to the payment date»).
--   Sections 5–7: run supabase/camp-trips.sql again (it restores camp_transport__link and camp_trips_import), then
--     drop function if exists public.camp_transport__drivers_in(uuid, text); drop function if exists public.camp_transport__near(text, text);
--   The two columns can stay (unused) or: alter table public.camp_trips drop column free_reason, drop column added_by_local;
