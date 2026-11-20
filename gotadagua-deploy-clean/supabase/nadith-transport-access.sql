-- ════════════════════════════════════════════════════════════════════════════
--  The local manager gets the full Transport page (Sri Lanka, 20 Nov 2026).
--
--  Miguel, 20 Nov 2026: Nadith (?view=local) «precisa (de acesso ao Transport)… só não
--  pode é apagar os transferes do aeroporto». Until now (camp-trips-local-pay.sql, 16 Nov)
--  he could only log / edit / remove the runs (kind 'tuktuk' / 'other') and pay drivers.
--
--  What changes:
--   1. camp_transport_can_use(loc) = camp_trips_can_manage(loc) OR is_local_manager(loc):
--      who may use the Transport page of a camp.
--   2. camp_trips_can_run(loc, kind) = camp_transport_can_use(loc), every kind (airport
--      transfers too). Same signature, so the camp_trips update / delete policies follow.
--   3. camp_trips insert policy: the «(can_manage OR source = 'manual')» clause goes, so
--      the local manager may also «Separate» a guest from a Bookinglayer transfer (that
--      insert keeps source 'bookinglayer').
--   4. camp_drivers insert / update and camp_transport_payments select: camp_transport_can_use
--      (he edits the drivers and contacts, and sees the payment links / «To check»).
--   5. camp_transport_link_set (link / unlink / explain a payment): gate is now
--      camp_transport_can_use. The body is copied from supabase/camp-trips.sql (the only
--      definition in the repo) — only the gate line differs. It still sets reviewed_by.
--   6. NEW trigger camp_trips_local_airport_guard: for the local manager (is_local_manager
--      and NOT camp_trips_can_manage — HQ members and Francisco are never touched, nor the
--      service role / the hourly Bookinglayer import), on a row whose kind starts with
--      'airport':
--        · DELETE is refused;
--        · an UPDATE that moves status INTO 'cancelled' or 'merged' is refused (a row that
--          is already cancelled may still be edited, e.g. «Mark sent» clears needs_resend);
--        · an UPDATE that changes kind away from airport is refused (no re-kind + delete).
--      'no_show' stays allowed (decision for Miguel: it is not a delete).
--
--  Not changed: camp_trips_can_manage (still gates the import, camp_week_guests,
--  camp_week_messages, reprice, the morning check), camp_trips_pay (already lets the local
--  manager pay, Cash only), camp_transport_autolink (any camp member), camp_trips_guard.
--
--  Run AFTER camp-trips.sql, camp-trips-v2.sql, camp-trips-own-link.sql,
--  camp-trips-morocco.sql, camp-trips-local-pay.sql and bl-report-ingest.sql.
--  Idempotent. NOT run by the agent: Miguel runs it after his OK — before or together with
--  the deploy of feat/nadith-transport (without it Nadith's airport edits are refused by RLS).
--
--  Pre-check (optional): the live link_set should match supabase/camp-trips.sql except the gate:
--  select pg_get_functiondef('public.camp_transport_link_set(uuid, uuid, uuid[], text)'::regprocedure);
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · Who may use the Transport page ──────────────────────────────────────
create or replace function public.camp_transport_can_use(p_location uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.camp_trips_can_manage(p_location) or public.is_local_manager(p_location);
$$;
revoke all on function public.camp_transport_can_use(uuid) from public, anon;
grant execute on function public.camp_transport_can_use(uuid) to authenticated;

-- ── 2 · Who may add / edit / remove a trip: every kind ─────────────────────
create or replace function public.camp_trips_can_run(p_location uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.camp_transport_can_use(p_location);
$$;
revoke all on function public.camp_trips_can_run(uuid, text) from public, anon;
grant execute on function public.camp_trips_can_run(uuid, text) to authenticated;

-- ── 3 · camp_trips insert: no «manual only» rule for the local manager ─────
drop policy if exists camp_trips_insert on public.camp_trips;
create policy camp_trips_insert on public.camp_trips for insert
  with check (public.camp_trips_can_run(location_id, kind) and payment_entry_id is null);
-- update / delete policies stay as in camp-trips-local-pay.sql (they call camp_trips_can_run);
-- recreated here so this file alone leaves them right.
drop policy if exists camp_trips_update on public.camp_trips;
create policy camp_trips_update on public.camp_trips for update
  using (public.camp_trips_can_run(location_id, kind))
  with check (public.camp_trips_can_run(location_id, kind));
drop policy if exists camp_trips_delete on public.camp_trips;
create policy camp_trips_delete on public.camp_trips for delete
  using (public.camp_trips_can_run(location_id, kind) and payment_entry_id is null and source = 'manual');

-- ── 4 · Drivers and payment links ───────────────────────────────────────────
drop policy if exists camp_drivers_insert on public.camp_drivers;
create policy camp_drivers_insert on public.camp_drivers for insert
  with check (public.camp_transport_can_use(location_id));
drop policy if exists camp_drivers_update on public.camp_drivers;
create policy camp_drivers_update on public.camp_drivers for update
  using (public.camp_transport_can_use(location_id))
  with check (public.camp_transport_can_use(location_id));

drop policy if exists camp_transport_payments_select on public.camp_transport_payments;
create policy camp_transport_payments_select on public.camp_transport_payments for select
  using (public.camp_transport_can_use(location_id));

-- ── 5 · Link / unlink / explain a payment (Transport → To check, Unlink payment) ─
create or replace function public.camp_transport_link_set(p_entry uuid, p_driver uuid, p_trip_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.ledger_entries%rowtype; v_sum numeric; v_n int; v_want int := coalesce(cardinality(p_trip_ids), 0); v_state text; v_reason text;
begin
  select * into e from public.ledger_entries where id = p_entry;
  if e.id is null then raise exception 'Payment not found — refresh'; end if;
  if not public.camp_transport_can_use(e.location_id) then raise exception 'Only the camp team or HQ can link payments' using errcode = '42501'; end if;
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
revoke all on function public.camp_transport_link_set(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.camp_transport_link_set(uuid, uuid, uuid[], text) to authenticated;

-- ── 6 · The one exception: the local manager never deletes / cancels an airport transfer ─
create or replace function public.camp_trips_local_airport_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.kind, '') not like 'airport%' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- HQ, Francisco and the service role (camp_trips_can_manage) are never limited here.
  if not public.is_local_manager(old.location_id) or public.camp_trips_can_manage(old.location_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only the camp manager or HQ can delete an airport transfer' using errcode = '42501';
  end if;
  if new.status in ('cancelled', 'merged') and new.status is distinct from old.status then
    raise exception 'Only the camp manager or HQ can cancel an airport transfer' using errcode = '42501';
  end if;
  if coalesce(new.kind, '') not like 'airport%' then
    raise exception 'An airport transfer cannot be turned into another kind of trip here' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.camp_trips_local_airport_guard() from public, anon;
drop trigger if exists camp_trips_local_airport_guard on public.camp_trips;
create trigger camp_trips_local_airport_guard before update or delete on public.camp_trips
  for each row execute function public.camp_trips_local_airport_guard();

commit;

-- ── Checks (run by hand after) ───────────────────────────────────────────────
-- select proname, prosecdef from pg_proc where proname in ('camp_transport_can_use', 'camp_trips_can_run', 'camp_transport_link_set', 'camp_trips_local_airport_guard');
-- select policyname, cmd, qual, with_check from pg_policies where tablename in ('camp_trips', 'camp_drivers', 'camp_transport_payments') order by tablename, cmd;
-- select tgname from pg_trigger where tgrelid = 'public.camp_trips'::regclass and not tgisinternal;   -- camp_trips_guard + camp_trips_local_airport_guard
--
-- ── Rollback (back to camp-trips-local-pay.sql) ──────────────────────────────
-- begin;
-- drop trigger if exists camp_trips_local_airport_guard on public.camp_trips;
-- drop function if exists public.camp_trips_local_airport_guard();
-- create or replace function public.camp_trips_can_run(p_location uuid, p_kind text)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select public.camp_trips_can_manage(p_location)
--       or (public.is_local_manager(p_location) and coalesce(p_kind, '') in ('tuktuk', 'other'));
-- $$;
-- drop policy if exists camp_trips_insert on public.camp_trips;
-- create policy camp_trips_insert on public.camp_trips for insert
--   with check (public.camp_trips_can_run(location_id, kind) and payment_entry_id is null
--               and (public.camp_trips_can_manage(location_id) or source = 'manual'));
-- drop policy if exists camp_drivers_insert on public.camp_drivers;
-- create policy camp_drivers_insert on public.camp_drivers for insert with check (public.camp_trips_can_manage(location_id));
-- drop policy if exists camp_drivers_update on public.camp_drivers;
-- create policy camp_drivers_update on public.camp_drivers for update using (public.camp_trips_can_manage(location_id)) with check (public.camp_trips_can_manage(location_id));
-- drop policy if exists camp_transport_payments_select on public.camp_transport_payments;
-- create policy camp_transport_payments_select on public.camp_transport_payments for select using (public.camp_trips_can_manage(location_id));
-- then re-run the camp_transport_link_set block of supabase/camp-trips.sql, and:
-- drop function if exists public.camp_transport_can_use(uuid);
-- commit;
