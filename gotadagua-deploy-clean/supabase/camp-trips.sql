-- ════════════════════════════════════════════════════════════════════════════
--  Camp trips — airport transfers, tuk-tuk runs and the driver payments that
--  pay for them (Sri Lanka, 13 Nov 2026). Design: sl_design/trips.md + the
--  decisions of 13 Nov (BUILD.md and the coordinator's overrides).
--
--  Who does what
--    · Francisco (location manager, full view) imports the Bookinglayer Guests
--      export every Monday in camp hub → Transport → Next week, sends the
--      transfers on WhatsApp, logs the tuk-tuk runs and reconciles.
--    · Nadith (local manager, ?view=local) keeps paying the drivers exactly as
--      today: a Cash «Transport» expense in the ledger («Dilan 152000»). He never
--      touches a trip. A trigger on ledger_entries links that payment to the
--      driver's unpaid trips automatically (camp_transport__link).
--    · A payment the trigger cannot match exactly goes to «Payments to review»
--      (camp_transport_payments.state = 'review') for Francisco.
--
--  Done is automatic: a planned / sent / confirmed trip whose date and time
--  (Colombo) have passed counts as done (camp_trip_is_done). Tuk-tuk runs are
--  saved as done. Francisco can still mark no-show or cancel.
--
--  Tables: camp_drivers, camp_trips, camp_transport_payments, camp_week_guests.
--  Idempotent: safe to run again. NOT run against production by the agent —
--  Miguel runs it after his OK. Check queries at the bottom (SELECT only).
-- ════════════════════════════════════════════════════════════════════════════

-- Go-live: Transport cash expenses created before this date are old lumps and
-- are never linked or flagged (keep in step with TRIPS_GO_LIVE in camp-hub/transport.js).
create or replace function public.camp_trips_go_live()
returns date language sql immutable as $$ select date '2026-11-16' $$;

-- ── Drivers and contacts ────────────────────────────────────────────────────
create table if not exists public.camp_drivers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  label text,                                    -- 'Airport van', 'Tuk-tuk', 'Camp manager'
  phone text check (phone is null or phone ~ '^\+[0-9]{8,15}$'),   -- E.164, for wa.me
  aliases text[] not null default '{}',          -- words that name him in a ledger description
  kinds text[] not null default '{}',            -- {'airport','tuktuk','other','contact'}
  default_for text[] not null default '{}',      -- {'airport'} / {'tuktuk'} / {'transfers_contact'}
  default_vehicle text,                          -- Car / Minivan / Large Van / Tuk-tuk
  price_overrides jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.camp_drivers add column if not exists aliases text[] not null default '{}';
alter table public.camp_drivers add column if not exists default_vehicle text;
create unique index if not exists camp_drivers_name on public.camp_drivers(location_id, lower(name));

-- ── Trips ───────────────────────────────────────────────────────────────────
create table if not exists public.camp_trips (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  kind text not null check (kind in ('airport_arrival','airport_departure','tuktuk','other')),
  trip_date date not null,                       -- Colombo date, as entered / imported (never UTC)
  trip_time text check (trip_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),     -- Colombo time, text
  pickup_time text check (pickup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  flight text, place text,
  route text,                                    -- transport preset name: 'Ahangama', 'River Safari', 'Airport → Surfcamp'
  from_place text, to_place text,
  purpose text check (purpose in ('guests','surf','food','laundry','staff','errand','tour','other')),
  tour_name text,
  guest_names text, guest_phone text,
  booking_ref text, booking_checkout date,
  pax int not null default 1 check (pax > 0),
  vehicle text,                                  -- Car / Minivan / Large Van / Tuk-tuk
  driver_id uuid references public.camp_drivers(id),
  expected_price numeric(12,2) not null default 0,
  currency text not null default 'LKR',
  status text not null default 'planned' check (status in ('planned','sent','confirmed','done','cancelled','no_show','merged')),
  merged_into uuid references public.camp_trips(id),
  source text not null default 'manual' check (source in ('bookinglayer','manual')),
  charge text check (charge in ('bookinglayer','camp_tab','free')),
  import_key text,
  import_flags text[] not null default '{}',
  edited_fields text[] not null default '{}',    -- typed by hand; a re-import never overwrites them
  last_import_at timestamptz, last_export_date date, missing_since date, cancel_reason text,
  sent_snapshot jsonb, sent_at timestamptz, sent_by uuid, confirmed_at timestamptz,
  needs_resend boolean not null default false,
  notes text,
  payment_entry_id uuid references public.ledger_entries(id) on delete set null,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.camp_trips add column if not exists guest_phone text;
-- HQ cross-check (13 Nov: the Guests file is the source for upcoming weeks; HQ bookings only
-- hold past and current stays). ok = the ref is live in HQ bookings · missing = not there yet.
alter table public.camp_trips add column if not exists hq_match text check (hq_match in ('ok','missing'));
alter table public.camp_trips add column if not exists partner text;        -- partner booking: the guest is not charged by us
create unique index if not exists camp_trips_key on public.camp_trips(location_id, import_key) where import_key is not null;
create index if not exists camp_trips_day on public.camp_trips(location_id, trip_date);
create index if not exists camp_trips_payment on public.camp_trips(payment_entry_id) where payment_entry_id is not null;
create index if not exists camp_trips_driver_unpaid on public.camp_trips(driver_id, trip_date) where payment_entry_id is null;

-- ── One row per Transport cash expense the link logic has looked at ─────────
--   state  matched   = the linked trips add up to the amount
--          review    = no driver named / no unpaid trips / amounts differ → Francisco
--          explained = Francisco accepted the difference with a note
--   linked_by auto (trigger) · manual (Francisco linked/unlinked) · pay («Pay a driver»)
create table if not exists public.camp_transport_payments (
  entry_id uuid primary key references public.ledger_entries(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  driver_id uuid references public.camp_drivers(id),
  entry_amount numeric(12,2) not null default 0,
  trips_amount numeric(12,2) not null default 0,
  trips_count int not null default 0,
  state text not null default 'review' check (state in ('matched','review','explained')),
  reason text,
  note text,
  linked_by text not null default 'auto' check (linked_by in ('auto','manual','pay')),
  signature text,                                -- amount|date|description last linked (idempotency)
  reviewed_by uuid, reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists camp_transport_payments_loc on public.camp_transport_payments(location_id, state);

-- ── Guests of the weekly import (for the staff lists built next) ────────────
create table if not exists public.camp_week_guests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  week_start date,                               -- Saturday of the Sat–Fri week of the check-in
  booking_ref text not null,
  guest_key text not null,                       -- lower(guest name): the key with booking_ref
  guest_name text not null,
  phone text,
  check_in date, check_out date,                 -- Colombo dates from the file
  accommodation text, bed_number text, packages text, activities text, level text,
  diet text, allergies text, nights int,
  arrival_time text, arrival_flight text, departure_time text, departure_flight text,
  has_transfer boolean not null default false,
  booking_status text,
  booking_due numeric(12,2),
  partner text,                                  -- from HQ when matched, else Guests «Booking due» > 0
  hq_match text check (hq_match in ('ok','missing')),
  raw jsonb not null default '{}',
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.camp_week_guests add column if not exists booking_due numeric(12,2);
alter table public.camp_week_guests add column if not exists partner text;
alter table public.camp_week_guests add column if not exists hq_match text check (hq_match in ('ok','missing'));
create unique index if not exists camp_week_guests_key on public.camp_week_guests(location_id, booking_ref, guest_key);
create index if not exists camp_week_guests_week on public.camp_week_guests(location_id, week_start);

-- ════════════════════════════════════════════════════════════════════════════
--  Helpers
-- ════════════════════════════════════════════════════════════════════════════
-- «Done» without anyone pressing Done: the time has passed in Colombo.
create or replace function public.camp_trip_is_done(p_status text, p_date date, p_time text)
returns boolean language sql stable set search_path = public as $$
  select p_status = 'done'
      or (p_status in ('planned','sent','confirmed')
          and (p_date + coalesce(nullif(p_time,''),'23:59')::time) < (now() at time zone 'Asia/Colombo'));
$$;

-- Francisco / Miguel / HQ: full access to the camp and not its local manager.
create or replace function public.camp_trips_can_manage(p_location uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.has_full_location_access(p_location) and not public.is_local_manager(p_location))
      or public.is_hq_member();
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Guard on camp_trips: a payment link changes only inside the link functions
--  (or when the paying ledger row is deleted); a paid trip is frozen.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.camp_trips_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pay boolean := coalesce(current_setting('app.trip_pay', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if not v_pay and (old.payment_entry_id is not null or old.source <> 'manual') then
      raise exception 'Only an unpaid trip added by hand can be deleted — cancel it instead.' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.payment_entry_id is distinct from old.payment_entry_id and not v_pay then
    -- the FK «on delete set null» when the paying ledger row is deleted
    if not (new.payment_entry_id is null and not exists (select 1 from public.ledger_entries where id = old.payment_entry_id)) then
      raise exception 'A trip is paid or un-paid only through Transport (link) — not by editing it.' using errcode = '42501';
    end if;
  end if;
  if old.payment_entry_id is not null and new.payment_entry_id is not distinct from old.payment_entry_id and not v_pay and not public.is_hq_member()
     and (new.expected_price, new.driver_id, new.status, new.kind, new.trip_date) is distinct from (old.expected_price, old.driver_id, old.status, old.kind, old.trip_date) then
    raise exception 'This trip is paid — unlink the payment first.' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists camp_trips_guard on public.camp_trips;
create trigger camp_trips_guard before update or delete on public.camp_trips
  for each row execute function public.camp_trips_guard();

-- ════════════════════════════════════════════════════════════════════════════
--  Driver named in a ledger description («Dilan 152000», «Sampath For Tuk Tuks»).
--  Longest alias wins; two different drivers with the same best length = none.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.camp_transport__driver_in(p_location uuid, p_text text)
returns uuid language sql stable security definer set search_path = public as $$
  with hits as (
    select d.id, max(length(a)) as len
      from public.camp_drivers d, unnest(array_append(d.aliases, d.name)) a
     where d.location_id = p_location and d.active and not ('contact' = any(d.kinds) and cardinality(d.kinds) = 1)
       and coalesce(a,'') <> ''
       and lower(coalesce(p_text,'')) ~ ('(^|[^[:alnum:]])' || regexp_replace(lower(a), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '([^[:alnum:]]|$)')
     group by d.id
  ), best as (select max(len) as len from hits)
  select case when (select count(*) from hits, best where hits.len = best.len) = 1
              then (select hits.id from hits, best where hits.len = best.len) end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  The link logic for ONE ledger row. Internal: called by the ledger trigger
--  and by the RPCs below, never directly by a client (execute revoked).
--  Safe to call any number of times; a trip is only ever stamped while its
--  payment_entry_id is null, under a row lock.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.camp_transport__link(p_entry uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  e public.ledger_entries%rowtype;
  l public.camp_transport_payments%rowtype;
  v_sig text; v_driver uuid; v_sum numeric := 0; v_n int := 0; t record; v_ids uuid[] := '{}';
  v_txt text; v_want_arr int; v_want_dep int; v_have_arr int := 0; v_have_dep int := 0; v_reason text;
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
  v_driver := public.camp_transport__driver_in(e.location_id, e.description);
  -- No name typed: the airport is Dilan's run and the camp errands are Sampath's,
  -- so the linked item picks the default driver for that kind (Transport → Drivers).
  if v_driver is null and coalesce(e.linked_item, '') in ('Airport', 'Transport Surf Lesson', 'Food Supply', 'Laundry') then
    select id into v_driver from public.camp_drivers
     where location_id = e.location_id and active
       and (case when e.linked_item = 'Airport' then 'airport' else 'tuktuk' end) = any(default_for)
     order by created_at limit 1;
  end if;
  -- Only driver payments are reconciled: a named driver, or a driver-run linked item.
  -- Fuel, scooter, deliveries etc. (no driver, no such item) are left alone.
  if v_driver is null and coalesce(e.linked_item, '') not in ('Airport', 'Transport Surf Lesson', 'Food Supply', 'Laundry') then
    if l.entry_id is not null then
      update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry;
      delete from public.camp_transport_payments where entry_id = p_entry;
    end if;
    return 'not_driver';
  end if;
  update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry;
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
    if v_n > 0 then
      perform 1 from public.camp_trips where id = any(v_ids) for update;
      update public.camp_trips set payment_entry_id = p_entry where id = any(v_ids) and payment_entry_id is null;
    end if;
    v_reason := case
      when v_have_arr < coalesce(v_want_arr, 0) or v_have_dep < coalesce(v_want_dep, 0) then
        'counts: ' || concat_ws(', ',
          case when v_want_arr is not null then v_have_arr || ' of ' || v_want_arr || ' arrivals found' end,
          case when v_want_dep is not null then v_have_dep || ' of ' || v_want_dep || ' departures found' end)
      when v_sum <> e.amount_local then 'counts match, amounts differ'
    end;
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
    if v_n > 0 then
      update public.camp_trips set payment_entry_id = p_entry where id = any(v_ids) and payment_entry_id is null;
    end if;
  end if;
  insert into public.camp_transport_payments as p (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count, state, reason, linked_by, signature, updated_at)
  values (p_entry, e.location_id, v_driver, e.amount_local, v_sum, v_n,
          case when v_n > 0 and v_sum = e.amount_local then 'matched' else 'review' end,
          case when v_driver is null then 'no driver named'
               when v_n = 0 then 'no unpaid trips'
               when v_sum <> e.amount_local then 'amounts differ' end,
          'auto', v_sig, now())
  on conflict (entry_id) do update set driver_id = excluded.driver_id, entry_amount = excluded.entry_amount,
    trips_amount = excluded.trips_amount, trips_count = excluded.trips_count, state = excluded.state,
    reason = excluded.reason, signature = excluded.signature, updated_at = now(), note = null;
  return case when v_n > 0 and v_sum = e.amount_local then 'matched' else 'review' end;
end $$;

-- Ledger trigger: runs only for Transport rows whose money fields changed, and
-- can never make Nadith's save fail (any error is swallowed into a warning).
create or replace function public.camp_transport_ledger_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.camp_transport__link(new.id);
  exception when others then
    raise warning 'camp_transport link skipped for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists camp_transport_link_ins on public.ledger_entries;
create trigger camp_transport_link_ins after insert on public.ledger_entries
  for each row when (new.type = 'expense' and new.category = 'Transport' and new.payment_method = 'Cash')
  execute function public.camp_transport_ledger_trigger();
drop trigger if exists camp_transport_link_upd on public.ledger_entries;
create trigger camp_transport_link_upd after update on public.ledger_entries
  for each row when ((new.category = 'Transport' or old.category = 'Transport')
    and (old.type, old.category, old.payment_method, old.amount_local, old.entry_date, old.description)
        is distinct from (new.type, new.category, new.payment_method, new.amount_local, new.entry_date, new.description))
  execute function public.camp_transport_ledger_trigger();

-- ════════════════════════════════════════════════════════════════════════════
--  RPCs
-- ════════════════════════════════════════════════════════════════════════════
-- Sweep: link every Transport cash row of the camp not yet looked at, and retry
-- the automatic ones still in review (trips may have been imported since).
-- Anyone with access to the camp may run it: it only does what the trigger does.
create or replace function public.camp_transport_autolink(p_location uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v text; v_out jsonb := '{}'::jsonb;
begin
  if not (public.has_location_access(p_location) or public.is_hq_member()) then
    raise exception 'No access to this camp' using errcode = '42501';
  end if;
  for r in
    select e.id from public.ledger_entries e
      left join public.camp_transport_payments p on p.entry_id = e.id
     where e.location_id = p_location and e.type = 'expense' and e.category = 'Transport' and e.payment_method = 'Cash'
       and e.entry_date >= public.camp_trips_go_live() and (e.created_at at time zone 'Asia/Colombo')::date >= public.camp_trips_go_live()
       and (p.entry_id is null or (p.linked_by = 'auto' and p.state = 'review'))
     order by e.entry_date, e.created_at
  loop
    v := public.camp_transport__link(r.id);
    v_out := jsonb_set(v_out, array[v], to_jsonb(coalesce((v_out->>v)::int, 0) + 1));
  end loop;
  return v_out;
end $$;

-- Francisco sets the trips of one payment by hand: link (ids), unlink (empty
-- array) or explain (same ids + a note). The note accepts a difference.
create or replace function public.camp_transport_link_set(p_entry uuid, p_driver uuid, p_trip_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.ledger_entries%rowtype; v_sum numeric; v_n int; v_want int := coalesce(cardinality(p_trip_ids), 0); v_state text; v_reason text;
begin
  select * into e from public.ledger_entries where id = p_entry;
  if e.id is null then raise exception 'Payment not found — refresh'; end if;
  if not public.camp_trips_can_manage(e.location_id) then raise exception 'Only the camp manager or HQ can link payments' using errcode = '42501'; end if;
  if not (e.type = 'expense' and e.category = 'Transport') then raise exception 'Only a Transport expense can pay trips'; end if;
  perform set_config('app.trip_pay', 'on', true);
  perform 1 from public.camp_trips where id = any(coalesce(p_trip_ids, '{}')) or payment_entry_id = p_entry for update;
  update public.camp_trips set payment_entry_id = null where payment_entry_id = p_entry and not (id = any(coalesce(p_trip_ids, '{}')));
  update public.camp_trips set payment_entry_id = p_entry
   where id = any(coalesce(p_trip_ids, '{}')) and location_id = e.location_id and payment_entry_id is null
     and status not in ('cancelled','no_show','merged');
  select coalesce(sum(expected_price), 0), count(*) into v_sum, v_n from public.camp_trips where payment_entry_id = p_entry;
  if v_n <> v_want then raise exception 'Some trips were already paid or cancelled — refresh'; end if;
  v_state := case when v_n > 0 and v_sum = e.amount_local then 'matched' when coalesce(p_note, '') <> '' then 'explained' else 'review' end;
  v_reason := case when v_state = 'matched' then null when v_state = 'explained' then null when v_n = 0 then 'unlinked' else 'amounts differ' end;
  insert into public.camp_transport_payments as p (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count, state, reason, note, linked_by, signature, reviewed_by, reviewed_at, updated_at)
  values (p_entry, e.location_id, p_driver, e.amount_local, v_sum, v_n, v_state, v_reason, nullif(p_note, ''), 'manual',
          e.amount_local::text || '|' || e.entry_date::text || '|' || coalesce(e.description, ''), auth.uid(), now(), now())
  on conflict (entry_id) do update set driver_id = excluded.driver_id, entry_amount = excluded.entry_amount, trips_amount = excluded.trips_amount,
    trips_count = excluded.trips_count, state = excluded.state, reason = excluded.reason, note = excluded.note, linked_by = 'manual',
    signature = excluded.signature, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = now();
  return jsonb_build_object('state', v_state, 'trips', v_n, 'trips_amount', v_sum, 'amount', e.amount_local);
end $$;

-- «Pay a driver» (Francisco / Miguel): one Cash Transport row per linked item,
-- each linked to its trips, in one transaction. p_entries = ledger rows built
-- by the hub (ledgerEntryToDbRow shape) with an extra "trip_ids" array each.
-- A difference between the typed amount and the trips needs a note; it sits on
-- the largest row, whose link is then 'explained'.
create or replace function public.camp_trips_pay(p_location uuid, p_driver uuid, p_typed_amount numeric, p_diff_note text, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; r public.ledger_entries%rowtype; v_rows jsonb := '[]'::jsonb; v_total numeric := 0; v_trips numeric := 0;
        v_ids uuid[]; v_n int; v_sum numeric; v_largest uuid; v_largest_amt numeric := -1;
begin
  if not public.camp_trips_can_manage(p_location) then raise exception 'Only the camp manager or HQ can pay from Transport' using errcode = '42501'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then raise exception 'Nothing to pay'; end if;
  perform set_config('app.trip_pay', 'on', true);
  for x in select * from jsonb_array_elements(p_entries) loop
    v_total := v_total + coalesce((x->>'amount_local')::numeric, 0);
    if coalesce((x->>'amount_local')::numeric, 0) > v_largest_amt then v_largest_amt := (x->>'amount_local')::numeric; v_largest := (x->>'id')::uuid; end if;
  end loop;
  if v_total <> p_typed_amount then raise exception 'The rows (%) do not add up to the amount typed (%)', v_total, p_typed_amount; end if;
  select coalesce(sum(t.expected_price), 0) into v_trips from public.camp_trips t
   where t.id in (select ti.v::uuid from jsonb_array_elements(p_entries) as en(e), jsonb_array_elements_text(coalesce(en.e->'trip_ids', '[]'::jsonb)) as ti(v));
  if v_trips <> p_typed_amount and coalesce(p_diff_note, '') = '' then
    raise exception 'The amount differs from the trips by % — say why', p_typed_amount - v_trips;
  end if;
  v_trips := 0;
  for x in select * from jsonb_array_elements(p_entries) loop
    r := jsonb_populate_record(null::public.ledger_entries, x - 'trip_ids');
    r.id := coalesce(r.id, gen_random_uuid()); r.location_id := p_location; r.type := 'expense'; r.category := 'Transport';
    r.payment_method := 'Cash'; r.source_kind := 'trip_payment'; r.business_area := coalesce(r.business_area, 'Transport');
    r.created_at := now(); r.created_by := auth.uid(); r.hq_invoice_id := null; r.internal_transfer_id := null;
    r.is_comp := false; r.currency := coalesce(r.currency, 'LKR'); r.amount_local := coalesce(r.amount_local, 0);
    r.entry_date := coalesce(r.entry_date, (now() at time zone 'Asia/Colombo')::date);
    insert into public.ledger_entries select r.*;
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(coalesce(x->'trip_ids', '[]'::jsonb));
    v_ids := coalesce(v_ids, '{}');
    perform 1 from public.camp_trips where id = any(v_ids) for update;
    update public.camp_trips set payment_entry_id = r.id
     where id = any(v_ids) and location_id = p_location and driver_id = p_driver and payment_entry_id is null
       and status not in ('cancelled','no_show','merged') and public.camp_trip_is_done(status, trip_date, trip_time);
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_ids) then raise exception 'Some trips were already paid — refresh'; end if;
    select coalesce(sum(expected_price), 0) into v_sum from public.camp_trips where payment_entry_id = r.id;
    v_trips := v_trips + v_sum;
    insert into public.camp_transport_payments (entry_id, location_id, driver_id, entry_amount, trips_amount, trips_count, state, reason, note, linked_by, signature, reviewed_by, reviewed_at)
    values (r.id, p_location, p_driver, r.amount_local, v_sum, v_n,
            case when v_sum = r.amount_local then 'matched' else 'explained' end, null,
            case when v_sum = r.amount_local then null else nullif(p_diff_note, '') end, 'pay',
            r.amount_local::text || '|' || r.entry_date::text || '|' || coalesce(r.description, ''), auth.uid(), now());
    v_rows := v_rows || to_jsonb(r);
  end loop;
  if v_trips <> p_typed_amount and coalesce(p_diff_note, '') = '' then
    raise exception 'The amount differs from the trips by % — say why', p_typed_amount - v_trips;
  end if;
  return jsonb_build_object('rows', v_rows, 'trips_amount', v_trips, 'amount', p_typed_amount);
end $$;

-- Monday import of the Bookinglayer Guests export (security invoker: the
-- table policies apply — Francisco / HQ only). The Guests file is the source
-- for upcoming weeks: p_trips = GuestsTrips.parse() trips and p_guests =
-- guestRows() of confirmed / deposit paid / paid rows, each with hq_match
-- ('ok' = live in HQ bookings, 'missing' = not there yet). Refs HQ has as
-- cancelled come in p_cancel_refs (with the file's own cancelled rows).
-- Rules = trips.md §1.6.
create or replace function public.camp_trips_import(
  p_location uuid, p_export_date date, p_is_preset boolean,
  p_refs_present text[], p_cancel_refs text[], p_trips jsonb, p_guests jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  x jsonb; t public.camp_trips%rowtype; v_key text; v_keys text[] := '{}';
  v_ins int := 0; v_upd int := 0; v_resend int := 0; v_cancel int := 0; v_missing int := 0; v_untouched int := 0; v_guests int := 0;
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
       or (t.status = 'cancelled' and coalesce(t.cancel_reason,'') <> 'bookinglayer')
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
      expected_price = case when 'expected_price' = any(t.edited_fields) then t.expected_price else coalesce((x->>'expected_price')::numeric, t.expected_price) end,
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
  -- A booking that split into one trip per guest: the old whole-booking trip goes.
  update public.camp_trips c set status = 'cancelled', cancel_reason = 'split', needs_resend = c.status in ('sent','confirmed')
   where c.location_id = p_location and c.source = 'bookinglayer' and c.status in ('planned','sent','confirmed') and c.payment_entry_id is null
     and not (c.import_key = any(v_keys)) and exists (select 1 from unnest(v_keys) k where k like c.import_key || ':%');
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
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'resend', v_resend, 'cancelled', v_cancel, 'missing', v_missing,
                            'untouched', v_untouched, 'guests', v_guests, 'import_id', v_import);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  RLS — Nadith (local manager) may read trips but never write them; his
--  payments are linked by the definer functions above.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.camp_drivers enable row level security;
alter table public.camp_trips enable row level security;
alter table public.camp_transport_payments enable row level security;
alter table public.camp_week_guests enable row level security;

drop policy if exists camp_drivers_select on public.camp_drivers;
create policy camp_drivers_select on public.camp_drivers for select using (public.has_location_access(location_id) or public.is_hq_member());
drop policy if exists camp_drivers_insert on public.camp_drivers;
create policy camp_drivers_insert on public.camp_drivers for insert with check (public.camp_trips_can_manage(location_id));
drop policy if exists camp_drivers_update on public.camp_drivers;
create policy camp_drivers_update on public.camp_drivers for update using (public.camp_trips_can_manage(location_id)) with check (public.camp_trips_can_manage(location_id));

drop policy if exists camp_trips_select on public.camp_trips;
create policy camp_trips_select on public.camp_trips for select using (public.has_location_access(location_id) or public.is_hq_member());
drop policy if exists camp_trips_insert on public.camp_trips;
create policy camp_trips_insert on public.camp_trips for insert with check (public.camp_trips_can_manage(location_id) and payment_entry_id is null);
drop policy if exists camp_trips_update on public.camp_trips;
create policy camp_trips_update on public.camp_trips for update using (public.camp_trips_can_manage(location_id)) with check (public.camp_trips_can_manage(location_id));
drop policy if exists camp_trips_delete on public.camp_trips;
create policy camp_trips_delete on public.camp_trips for delete using (public.camp_trips_can_manage(location_id) and payment_entry_id is null and source = 'manual');

drop policy if exists camp_transport_payments_select on public.camp_transport_payments;
create policy camp_transport_payments_select on public.camp_transport_payments for select using (public.camp_trips_can_manage(location_id));

drop policy if exists camp_week_guests_select on public.camp_week_guests;
create policy camp_week_guests_select on public.camp_week_guests for select using (public.camp_trips_can_manage(location_id));
drop policy if exists camp_week_guests_insert on public.camp_week_guests;
create policy camp_week_guests_insert on public.camp_week_guests for insert with check (public.camp_trips_can_manage(location_id));
drop policy if exists camp_week_guests_update on public.camp_week_guests;
create policy camp_week_guests_update on public.camp_week_guests for update using (public.camp_trips_can_manage(location_id)) with check (public.camp_trips_can_manage(location_id));

grant select, insert, update on public.camp_drivers to authenticated;
grant select, insert, update, delete on public.camp_trips to authenticated;
grant select on public.camp_transport_payments to authenticated;
grant select, insert, update on public.camp_week_guests to authenticated;

-- Definer functions: no anonymous calls; the internal ones not callable at all.
-- Supabase's default privileges grant EXECUTE on every new public function to anon and
-- authenticated directly (pg_default_acl, checked 13 Nov 2026), so revoke from those roles too.
revoke all on function public.camp_transport__link(uuid) from public, anon, authenticated;
revoke all on function public.camp_transport__driver_in(uuid, text) from public, anon, authenticated;
revoke all on function public.camp_transport_ledger_trigger() from public, anon, authenticated;
revoke all on function public.camp_trips_guard() from public, anon, authenticated;
revoke all on function public.camp_transport_autolink(uuid) from public, anon;
revoke all on function public.camp_transport_link_set(uuid, uuid, uuid[], text) from public, anon;
revoke all on function public.camp_trips_pay(uuid, uuid, numeric, text, jsonb) from public, anon;
revoke all on function public.camp_trips_import(uuid, date, boolean, text[], text[], jsonb, jsonb) from public, anon;
revoke all on function public.camp_trips_can_manage(uuid) from public, anon;
grant execute on function public.camp_transport_autolink(uuid) to authenticated;
grant execute on function public.camp_transport_link_set(uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.camp_trips_pay(uuid, uuid, numeric, text, jsonb) to authenticated;
grant execute on function public.camp_trips_import(uuid, date, boolean, text[], text[], jsonb, jsonb) to authenticated;
grant execute on function public.camp_trips_can_manage(uuid) to authenticated;
grant execute on function public.camp_trip_is_done(text, date, text) to authenticated;

-- Live updates on two phones (same as the ledger).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'camp_trips') then
    execute 'alter publication supabase_realtime add table public.camp_trips';
  end if;
end $$;

-- ── Seed: Sri Lanka drivers (phones to be filled in Transport → Drivers) and
--    the «Send transfers to» contact, Nadith. Nothing is overwritten on a re-run.
insert into public.camp_drivers (location_id, name, label, aliases, kinds, default_for)
select l.id, v.name, v.label, v.aliases, v.kinds, v.default_for
  from public.locations l,
       (values ('Dilan', 'Airport van', array['Dilan'], array['airport','other'], array['airport']),
               ('Sampath', 'Tuk-tuk', array['Sampath','Sampath tuk tuk','Sampath tuktuk'], array['tuktuk'], array['tuktuk']),
               ('Nishantha', 'Alex Transportation', array['Nishantha','Alex Transportation'], array['airport'], array[]::text[]),
               ('Nadith', 'Camp manager', array[]::text[], array['contact'], array['transfers_contact'])) as v(name, label, aliases, kinds, default_for)
 where l.slug = 'sri-lanka'
on conflict (location_id, lower(name)) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select table_name from information_schema.tables where table_schema = 'public'
--   and table_name in ('camp_drivers','camp_trips','camp_transport_payments','camp_week_guests');            -- 4 rows
-- select name, label, aliases, default_for from public.camp_drivers d join public.locations l on l.id = d.location_id
--  where l.slug = 'sri-lanka' order by name;                                                                    -- Dilan, Nadith, Nishantha, Sampath
-- select tgname from pg_trigger where tgrelid = 'public.ledger_entries'::regclass and tgname like 'camp_transport_link_%';  -- 2 rows
-- select tablename, policyname, cmd from pg_policies where tablename like 'camp_trip%' or tablename in ('camp_drivers','camp_transport_payments','camp_week_guests') order by 1, 3;
-- After the first Monday import:
-- select status, count(*) from public.camp_trips group by 1;
-- select state, reason, count(*) from public.camp_transport_payments group by 1, 2;
