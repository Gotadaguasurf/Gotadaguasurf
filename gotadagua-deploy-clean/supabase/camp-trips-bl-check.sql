-- ════════════════════════════════════════════════════════════════════════════
--  Transfer legs «checked in Bookinglayer» (Sri Lanka + Morocco, 16 Nov 2026).
--
--  Why: the Bookinglayer Guests export cannot tell whether a booking has one or two
--  airport transfer legs, nor their dates («Multiple dates · 2x Airport Transfer» and
--  «27 Nov 2026 · 1x» read the same in the «Transfers» column). The import assumes
--  arrival + departure. On 16 Nov 2026 14 of 37 upcoming bookings were wrong and were
--  fixed by hand. From now on every imported airport leg is «to check in Bookinglayer»
--  until somebody (staff with one tap in Transport, or the morning assistant through
--  camp_trips_bl_verify) has looked at the booking page.
--
--  Requires supabase/camp-trips.sql, camp-trips-v2.sql (and camp-trips-morocco.sql for
--  Morocco's currency trigger) — all live. Run this AFTER them. It REPLACES
--  camp_trips_import of camp-trips-v2.sql: after re-running camp-trips-v2.sql (or
--  camp-trips.sql), run this file again. Idempotent: safe to run again.
--  NOT run against production by the agent — Miguel runs it after his OK.
--
--  1 · camp_trips.bl_checked_at / bl_checked_by / bl_check_note.
--  2 · Backfill: the bookings checked by hand on 16 Nov 2026 and the hist2026 trips.
--  3 · camp_trips_import: new airport trips arrive unchecked; a trip whose date (or
--      kind) changes on a re-import goes back to «to check». One more change, needed so
--      the Monday import does not undo the booking page: a trip ADDED from the booking
--      page (never written by an import: last_import_at null, and checked) is skipped by
--      the three «not in the file» passes (regrouped → cancel 'split', «transfer removed»
--      flag, preset «missing»). Without it, the leg «bl:<ref>:arr:2» added by
--      camp_trips_bl_verify would be cancelled as a regroup by the next import.
--  4 · camp_trips_bl_verify(location, booking_ref, legs, note): the legs Bookinglayer
--      really has for one booking → check / cancel / flag / add its airport trips.
--  5 · camp_trips_bl_to_check(location): what the morning assistant has to look at.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Columns ───────────────────────────────────────────────────────────────
alter table public.camp_trips add column if not exists bl_checked_at timestamptz;   -- null = to check in Bookinglayer
alter table public.camp_trips add column if not exists bl_checked_by uuid;          -- auth.uid() of who checked (null = SQL / backfill)
alter table public.camp_trips add column if not exists bl_check_note text;          -- 'booking page: 1x 27 Nov', 'checked by hand'…

-- The camp's own date (no time zone column on locations; = CampConfig tz in lib/camp-config.js).
create or replace function public.camp_trips__tz(p_location uuid)
returns text language sql stable security definer set search_path = public as $$
  select case (select slug from public.locations where id = p_location) when 'morocco' then 'Africa/Casablanca' else 'Asia/Colombo' end;
$$;

-- ── 2 · Backfill (16 Nov 2026: every upcoming booking checked on its booking page) ─
--   Only rows still unchecked, so a re-run changes nothing. updated_at moves (the guard trigger).
update public.camp_trips c
   set bl_checked_at = now(), bl_check_note = 'checked on the booking page 16 Nov 2026'
  from public.locations l
 where l.id = c.location_id
   and c.bl_checked_at is null
   and c.kind in ('airport_arrival', 'airport_departure')
   and c.trip_date >= date '2026-11-13'
   and c.status not in ('cancelled', 'merged')
   and ((l.slug = 'morocco' and c.booking_ref = any (array[
          '2026-3790','2026-4020','2026-4113','2026-4233','2026-4241','2026-4325','2026-4450','2026-4479','2026-4494','2026-4626',
          '2026-4717','2026-4733','2026-4839','2026-4840','2026-4878','2026-4988','2026-5034','2026-5038','2026-5040','2026-5100',
          '2026-5117','2026-5143','2026-5151','2026-5157','2026-5173','2026-5177','2026-5195','2026-5222']))
     or (l.slug = 'sri-lanka' and c.booking_ref = any (array[
          '2026-4070','2026-4360','2026-4544','2026-4627','2026-4660','2026-4936','2026-5074'])));
-- Morocco's unpaid Let Us Tours trips of 1 Oct – 12 Nov (import_key «hist2026:…»), verified 16 Nov.
update public.camp_trips
   set bl_checked_at = now(), bl_check_note = 'checked on the booking page 16 Nov 2026'
 where bl_checked_at is null and import_key like 'hist2026:%';

-- ── 3 · The Monday import (replaces the function of camp-trips-v2.sql) ─────────
--   Copied from camp-trips-v2.sql (section 7) with the changes marked «Checked in Bookinglayer» /
--   «added from the booking page». Nothing else differs.
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
      -- a new airport trip arrives «to check in Bookinglayer» (bl_checked_at stays null)
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
      -- «Checked in Bookinglayer» (camp-trips-bl-check.sql): a new date (or kind) from the file = to check again.
      bl_checked_at = case when n_date is distinct from t.trip_date or (x->>'kind') is distinct from t.kind then null else t.bl_checked_at end,
      bl_checked_by = case when n_date is distinct from t.trip_date or (x->>'kind') is distinct from t.kind then null else t.bl_checked_by end,
      bl_check_note = case when n_date is distinct from t.trip_date or (x->>'kind') is distinct from t.kind then null else t.bl_check_note end,
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
     and not (c.last_import_at is null and c.bl_checked_at is not null)   -- added from the booking page: never the file's to replace
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
       and not (c.last_import_at is null and c.bl_checked_at is not null)   -- added from the booking page: the file never had it
       and not (v_removed_text = any(c.import_flags));
    get diagnostics v_removed = row_count;
  end if;
  -- Preset file: a future trip absent from it is a question, never an automatic cancel.
  if p_is_preset and p_export_date is not null then
    update public.camp_trips c set missing_since = p_export_date
     where c.location_id = p_location and c.source = 'bookinglayer' and c.status in ('planned','sent','confirmed')
       and c.missing_since is null and c.trip_date >= p_export_date and not (c.import_key = any(v_keys))
       and coalesce(c.booking_checkout, c.trip_date) <= p_export_date + 35
       and not (c.last_import_at is null and c.bl_checked_at is not null);  -- added from the booking page
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
-- ── 4 · The legs Bookinglayer really has for one booking ──────────────────────
--   p_legs = [{kind:'airport_arrival'|'airport_departure', date:'YYYY-MM-DD', place:'AGA'|'RAK'|'CMB'|…, pax:int}],
--   cancelled lines already removed. [] = the booking has no airport transfer at all.
--   Only the airport trips of that booking that are NOT paid are changed. Per (kind, date):
--     · trips with that kind and date (live, or done / no-show): checked (bl_checked_at/by/note); a leftover
--       «Not booked in Bookinglayer: did the driver go?» flag is removed;
--     · none live, but one cancelled by an earlier check («Not booked in Bookinglayer…»): brought back to planned;
--     · none live and one cancelled by hand (another reason): left cancelled (the camp decided), counted as checked;
--     · nothing at all (a paid trip counts as there): a planned trip is added, key bl:<ref>:<arr|dep>[:2…].
--   A trip of the booking (source bookinglayer) with no leg:
--     · not happened yet in the camp's time (later today or after) → cancelled, reason «Not booked in Bookinglayer: …»
--       (a custom reason: the Monday import keeps it cancelled), needs_resend when it was sent / confirmed;
--     · already happened (an earlier day, or today with its time passed) → kept, flag
--       «Not booked in Bookinglayer: did the driver go? If not, cancel this trip».
--   Trips added by hand (source manual) are never cancelled or flagged — only checked when they match.
create or replace function public.camp_trips_bl_verify(p_location uuid, p_booking_ref text, p_legs jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(trim(coalesce(p_booking_ref, '')), '');
  v_slug text; v_currency text; v_tz text; v_now_local timestamp; v_today date; v_uid uuid := auth.uid(); v_now timestamptz := now();
  v_flag constant text := 'Not booked in Bookinglayer: did the driver go? If not, cancel this trip';
  v_reason text; v_note text; v_auto text;
  x jsonb; t public.camp_trips%rowtype;
  v_kind text; v_date date; v_place text; v_pax int; v_dir text;
  v_checked int := 0; v_cancelled int := 0; v_flagged int := 0; v_created int := 0;
  v_hit uuid[] := '{}'; v_ids uuid[]; v_any boolean; v_tid uuid; v_sent boolean;
  v_driver uuid; v_vehicle text; v_price numeric; v_city text; v_key text; v_n int;
  v_names text; v_phone text; v_flight text; v_time text; v_checkout date; v_partner text; v_gpax int;
  v_legs text;
begin
  if not public.camp_trips_can_manage(p_location) then raise exception 'Only the camp manager or HQ can check transfers' using errcode = '42501'; end if;
  if v_ref is null then raise exception 'booking_ref is required' using errcode = '22023'; end if;
  -- A failed read must never cancel anything: the legs must be a well-formed array ([] is allowed).
  if p_legs is null or jsonb_typeof(p_legs) <> 'array' then raise exception 'p_legs must be a JSON array of legs' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_legs) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x->>'kind', '') not in ('airport_arrival', 'airport_departure') then
      raise exception 'leg %: kind must be airport_arrival or airport_departure', x using errcode = '22023';
    end if;
    if coalesce(x->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'leg %: date must be YYYY-MM-DD', x using errcode = '22023'; end if;
    perform (x->>'date')::date;
    if x ? 'pax' and jsonb_typeof(x->'pax') <> 'null' and coalesce(x->>'pax', '') !~ '^\d+$' then raise exception 'leg %: pax must be a whole number', x using errcode = '22023'; end if;
  end loop;

  select l.slug, coalesce(l.currency, 'LKR') into v_slug, v_currency from public.locations l where l.id = p_location;
  v_tz := public.camp_trips__tz(p_location);
  v_now_local := now() at time zone v_tz; v_today := v_now_local::date;
  -- The legs in words, for the notes: «arrival 27 Nov (2x), departure 4 Dec (2x)».
  select string_agg(case when e->>'kind' = 'airport_departure' then 'departure ' else 'arrival ' end
                    || to_char((e->>'date')::date, 'FMDD Mon') || coalesce(' (' || nullif(e->>'pax', '') || 'x)', ''), ', ' order by e->>'date')
    into v_legs from jsonb_array_elements(p_legs) e;
  v_reason := 'Not booked in Bookinglayer: ' || coalesce(nullif(trim(p_note), ''),
                case when v_legs is null then 'no airport transfer on the booking page' else 'booking page has ' || v_legs end);

  -- Every leg: its trips, else bring back / add one.
  for x in select * from jsonb_array_elements(p_legs) loop
    v_kind := x->>'kind'; v_date := (x->>'date')::date;
    v_place := upper(nullif(trim(coalesce(x->>'place', '')), ''));
    v_dir := case when v_kind = 'airport_departure' then 'dep' else 'arr' end;
    v_auto := 'booking page: ' || coalesce(nullif(x->>'pax', '') || 'x ', '') || to_char(v_date, 'FMDD Mon');
    v_note := coalesce(nullif(trim(p_note), ''), v_auto);

    -- a) live or happened trips with this kind and date (any source)
    select coalesce(array_agg(id), '{}') into v_ids from public.camp_trips
     where location_id = p_location and booking_ref = v_ref and kind = v_kind and trip_date = v_date
       and status in ('planned', 'sent', 'confirmed', 'done', 'no_show');
    if cardinality(v_ids) > 0 then
      update public.camp_trips set bl_checked_at = v_now, bl_checked_by = v_uid, bl_check_note = v_note,
             import_flags = array_remove(import_flags, v_flag)
       where id = any(v_ids) and payment_entry_id is null;
      get diagnostics v_n = row_count; v_checked := v_checked + v_n;
      v_hit := v_hit || v_ids; continue;
    end if;
    -- b) cancelled by an earlier check, the leg is back on the booking page → planned again
    v_tid := null;
    select id, sent_at is not null into v_tid, v_sent from public.camp_trips
     where location_id = p_location and booking_ref = v_ref and kind = v_kind and trip_date = v_date
       and status = 'cancelled' and coalesce(cancel_reason, '') like 'Not booked in Bookinglayer%' and payment_entry_id is null
     order by updated_at desc limit 1;
    if v_tid is not null then
      update public.camp_trips set status = 'planned', cancel_reason = null, needs_resend = v_sent,
             bl_checked_at = v_now, bl_checked_by = v_uid, bl_check_note = v_note, import_flags = array_remove(import_flags, v_flag)
       where id = v_tid;
      v_checked := v_checked + 1; v_hit := v_hit || v_tid; continue;
    end if;
    -- c) cancelled by hand (another reason) or paid: the leg has its trip — the camp's decision stands
    select exists (select 1 from public.camp_trips
                    where location_id = p_location and booking_ref = v_ref and kind = v_kind and trip_date = v_date
                      and (payment_entry_id is not null or (status = 'cancelled' and coalesce(cancel_reason, '') not in ('bookinglayer', 'split'))))
      into v_any;
    if v_any then
      update public.camp_trips set bl_checked_at = v_now, bl_checked_by = v_uid, bl_check_note = v_note
       where location_id = p_location and booking_ref = v_ref and kind = v_kind and trip_date = v_date
         and status = 'cancelled' and payment_entry_id is null and bl_checked_at is null;
      get diagnostics v_n = row_count; v_checked := v_checked + v_n;
      select coalesce(array_agg(id), '{}') into v_ids from public.camp_trips
       where location_id = p_location and booking_ref = v_ref and kind = v_kind and trip_date = v_date;
      v_hit := v_hit || v_ids; continue;
    end if;
    -- d) no trip for this leg: add it, as the import would have
    select id into v_driver from public.camp_drivers where location_id = p_location and active and 'airport' = any(default_for) order by created_at limit 1;
    v_place := coalesce(v_place, case when v_slug = 'morocco' then 'AGA' else 'CMB' end);
    -- Guests of the booking from the latest Guests import (names, phone, partner); the flight and time only
    -- when the guest's own arrival / departure day in the file is this leg's date.
    select string_agg(g.guest_name, ', ' order by g.guest_name), max(g.phone), max(g.check_out), max(g.partner), coalesce(nullif(count(*) filter (where g.has_transfer), 0), count(*))
      into v_names, v_phone, v_checkout, v_partner, v_gpax
      from public.camp_week_guests g where g.location_id = p_location and g.booking_ref = v_ref;
    -- People: the leg's count, else the guests of the booking in the file, else 1.
    v_pax := greatest(1, coalesce(nullif(x->>'pax', '')::int, nullif(v_gpax, 0), 1));
    v_vehicle := case when v_pax <= 4 then 'Car' when v_pax <= 8 then 'Minivan' when v_slug = 'morocco' then 'Big Van' else 'Large Van' end;
    -- Price = the driver's price in /prices (pricing_catalog.cost_per_guest of the airport row), as presetPrice() in
    -- camp-hub/transport.js: Sri Lanka «Airport → Surfcamp — Car» / «Surfcamp → Airport — Car»; Morocco «Agadir Airport — Car»
    -- (the row whose name holds the airport's city; an airport without a row, e.g. Essaouira, saves 0 like the import).
    if v_slug = 'morocco' then
      v_city := case v_place when 'AGA' then 'Agadir' when 'RAK' then 'Marrakech' when 'ESU' then 'Essaouira' else null end;
      select pc.cost_per_guest into v_price from public.pricing_catalog pc
       where pc.location_id = p_location and pc.category = 'Transport' and pc.active and pc.show_in_transport_picker
         and coalesce(pc.picker_tab, 'airport') not in ('surf', 'tours', 'tuktuk')
         and v_city is not null and strpos(lower(pc.name), lower(v_city)) > 0 and pc.name like '% — ' || v_vehicle
       order by pc.sort_order nulls last limit 1;
    else
      select pc.cost_per_guest into v_price from public.pricing_catalog pc
       where pc.location_id = p_location and pc.category = 'Transport' and pc.active and pc.show_in_transport_picker
         and pc.name = case when v_kind = 'airport_departure' then 'Surfcamp → Airport — ' else 'Airport → Surfcamp — ' end || v_vehicle
       order by pc.sort_order nulls last limit 1;
    end if;
    select f.flight, f.tm into v_flight, v_time from (
      select upper(regexp_replace(case when v_kind = 'airport_departure' then g.departure_flight else g.arrival_flight end, '\s', '', 'g')) as flight,
             substring(case when v_kind = 'airport_departure' then g.departure_time else g.arrival_time end from '^\s*(([01][0-9]|2[0-3]):[0-5][0-9])') as tm
        from public.camp_week_guests g
       where g.location_id = p_location and g.booking_ref = v_ref
         and (case when v_kind = 'airport_departure' then g.check_out else g.check_in end) = v_date) f
     order by coalesce(f.flight ~ '^[A-Z0-9]{2,3}[0-9]{1,5}$', false) desc, (f.tm is not null) desc limit 1;
    if v_flight !~ '^[A-Z0-9]{2,3}[0-9]{1,5}$' then v_flight := null; end if;
    v_key := 'bl:' || v_ref || ':' || v_dir; v_n := 1;
    while exists (select 1 from public.camp_trips where location_id = p_location and import_key = v_key) loop
      v_n := v_n + 1; v_key := 'bl:' || v_ref || ':' || v_dir || ':' || v_n;
    end loop;
    insert into public.camp_trips (location_id, kind, trip_date, trip_time, flight, place, route, purpose, guest_names, guest_phone, booking_ref, booking_checkout,
      pax, vehicle, driver_id, expected_price, currency, status, source, charge, import_key, import_flags, partner,
      bl_checked_at, bl_checked_by, bl_check_note)
    values (p_location, v_kind, v_date, v_time, v_flight, v_place,
      case when v_kind = 'airport_departure' then 'Surfcamp → Airport' else 'Airport → Surfcamp' end, 'guests',
      v_names, case when v_phone ~ '^\+[0-9]{8,15}$' then v_phone else null end, v_ref, v_checkout,
      v_pax, v_vehicle, v_driver, coalesce(v_price, 0), v_currency, 'planned', 'bookinglayer', 'bookinglayer', v_key,
      array['added from the Bookinglayer booking page (' || v_auto || ')'], v_partner,
      v_now, v_uid, v_note)
    returning id into v_tid;
    v_created := v_created + 1; v_hit := v_hit || v_tid;
  end loop;

  -- Trips of the booking that no leg covers (imported legs only; never a hand-added trip, never a paid one).
  for t in select * from public.camp_trips
            where location_id = p_location and booking_ref = v_ref and kind in ('airport_arrival', 'airport_departure')
              and source = 'bookinglayer' and payment_entry_id is null and not (id = any(v_hit))
              and status in ('planned', 'sent', 'confirmed', 'done')
            for update loop
    if t.status <> 'done' and (t.trip_date > v_today
         or (t.trip_date = v_today and coalesce(nullif(t.pickup_time, ''), nullif(t.trip_time, ''), '23:59')::time > v_now_local::time)) then
      update public.camp_trips set status = 'cancelled', cancel_reason = v_reason, needs_resend = t.status in ('sent', 'confirmed'),
             bl_checked_at = v_now, bl_checked_by = v_uid, bl_check_note = coalesce(nullif(trim(p_note), ''), 'booking page: no ' || case when t.kind = 'airport_departure' then 'departure' else 'arrival' end || ' on ' || to_char(t.trip_date, 'FMDD Mon'))
       where id = t.id;
      v_cancelled := v_cancelled + 1;
    elsif not (v_flag = any(t.import_flags)) then
      update public.camp_trips set import_flags = array_append(import_flags, v_flag) where id = t.id;
      v_flagged := v_flagged + 1;
    end if;
  end loop;

  return jsonb_build_object('checked', v_checked, 'cancelled', v_cancelled, 'flagged', v_flagged, 'created', v_created);
end $$;

-- ── 5 · What the morning assistant reads ──────────────────────────────────────
--   One row per booking with airport trips still «to check in Bookinglayer»: imported (source bookinglayer),
--   not paid, planned / sent / confirmed, dated from yesterday on (the camp's own date) — the same trips as the
--   orange line and the chip in Transport. p_location null = every camp the caller manages.
create or replace function public.camp_trips_bl_to_check(p_location uuid default null)
returns table (location_id uuid, camp text, booking_ref text, first_date date, guest_names text, trips jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_location is not null and not public.camp_trips_can_manage(p_location) then
    raise exception 'Only the camp manager or HQ can read this' using errcode = '42501';
  end if;
  return query
  select c.location_id, l.slug::text, c.booking_ref, min(c.trip_date),
         string_agg(distinct c.guest_names, ', '),
         jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'date', c.trip_date, 'time', c.trip_time, 'place', c.place,
                                      'pax', c.pax, 'guests', c.guest_names, 'status', c.status, 'import_key', c.import_key)
                   order by c.trip_date, c.kind)
    from public.camp_trips c
    join public.locations l on l.id = c.location_id
   where (p_location is null or c.location_id = p_location)
     and public.camp_trips_can_manage(c.location_id)
     and c.kind in ('airport_arrival', 'airport_departure') and c.source = 'bookinglayer'
     and c.booking_ref is not null and c.payment_entry_id is null and c.bl_checked_at is null
     and c.status in ('planned', 'sent', 'confirmed')
     and c.trip_date >= ((now() at time zone public.camp_trips__tz(c.location_id))::date - 1)
   group by c.location_id, l.slug, c.booking_ref
   order by min(c.trip_date), c.booking_ref;
end $$;

revoke all on function public.camp_trips__tz(uuid) from public, anon, authenticated;
revoke all on function public.camp_trips_import(uuid, date, boolean, text[], text[], jsonb, jsonb) from public, anon;
grant execute on function public.camp_trips_import(uuid, date, boolean, text[], text[], jsonb, jsonb) to authenticated;
revoke all on function public.camp_trips_bl_verify(uuid, text, jsonb, text) from public, anon;
grant execute on function public.camp_trips_bl_verify(uuid, text, jsonb, text) to authenticated;
revoke all on function public.camp_trips_bl_to_check(uuid) from public, anon;
grant execute on function public.camp_trips_bl_to_check(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select column_name from information_schema.columns where table_name = 'camp_trips' and column_name like 'bl_check%';     -- 3 rows
-- select l.slug, count(*) filter (where c.bl_checked_at is not null) checked, count(*) filter (where c.bl_checked_at is null) to_check
--   from public.camp_trips c join public.locations l on l.id = c.location_id
--  where c.kind like 'airport_%' and c.trip_date >= date '2026-11-13' and c.status not in ('cancelled','merged') group by 1;
-- select * from public.camp_trips_bl_to_check(null);                     -- what the morning assistant will read
-- select has_function_privilege('anon', 'public.camp_trips_bl_verify(uuid, text, jsonb, text)', 'execute');   -- false
-- Dry run of one booking (rolls back):
--   begin; select public.camp_trips_bl_verify('<location uuid>', '2026-0000', '[{"kind":"airport_arrival","date":"2026-11-27","place":"AGA","pax":2}]'); rollback;
--
-- ════════════════════════════════════════════════════════════════════════════
--  Rollback
-- ════════════════════════════════════════════════════════════════════════════
--   drop function if exists public.camp_trips_bl_verify(uuid, text, jsonb, text);
--   drop function if exists public.camp_trips_bl_to_check(uuid);
--   then run supabase/camp-trips-v2.sql again (restores its camp_trips_import, which does not know the columns), and
--   drop function if exists public.camp_trips__tz(uuid);
--   The columns can stay (unused), but then every new import leg shows «Check in Bookinglayer» in Transport; drop them
--   to switch the app's check off (the app shows it only when the column exists):
--   alter table public.camp_trips drop column if exists bl_checked_at, drop column if exists bl_checked_by, drop column if exists bl_check_note;
