-- ════════════════════════════════════════════════════════════════════════════
--  Driver payments, one door (16 Nov 2026) — run AFTER camp-trips.sql, camp-trips-v2.sql,
--  camp-trips-own-link.sql and camp-trips-morocco.sql. Idempotent. Checks and a rollback
--  at the bottom. NOT run by the agent: Miguel runs it after his OK.
--
--  Miguel, 16 Nov 2026: «sim, avança com a proposta dos motoristas». «Pay a driver» in
--  Transport is the one door to pay a driver; in Sri Lanka Nadith (?view=local) has it as
--  his «Drivers» tab, so he can log the tuk-tuk runs and pay from what is owed.
--
--  What changes:
--   1. camp_trips_can_run(loc, kind) = camp_trips_can_manage(loc), or the camp's local
--      manager for a run (kind 'tuktuk' / 'other'). The camp_trips insert / update / delete
--      policies use it, so Nadith can log, edit and remove runs — never an airport transfer
--      (those come from the Bookinglayer import). Delete stays «unpaid and added by hand»;
--      the camp_trips_guard trigger still freezes a paid trip and the payment link.
--   2. camp_trips_pay:
--      · the gate is camp_trips_can_manage OR is_local_manager (Nadith pays);
--      · payment_method comes from the payload, Cash or Bank Transfer (Morocco pays Fathoune
--        and Let Us Tours by SG transfer), always Cash for the local manager, and his rows are
--        always the camp's own (paid_from = the camp);
--      · an airport transfer may be paid up to 14 days after the payment date even if it has
--        not happened yet (agreed 13 Nov for «Which transfers is this for?», which this
--        replaces). Runs must be done.
--  Not changed: camp_trips_can_manage (it still gates the import, link_set, the drivers and
--  camp_transport_payments), camp_transport_link_set, everything else.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Who may log a run ─────────────────────────────────────────────────────
create or replace function public.camp_trips_can_run(p_location uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.camp_trips_can_manage(p_location)
      or (public.is_local_manager(p_location) and coalesce(p_kind, '') in ('tuktuk', 'other'));
$$;
revoke all on function public.camp_trips_can_run(uuid, text) from public, anon;
grant execute on function public.camp_trips_can_run(uuid, text) to authenticated;

drop policy if exists camp_trips_insert on public.camp_trips;
create policy camp_trips_insert on public.camp_trips for insert
  with check (public.camp_trips_can_run(location_id, kind) and payment_entry_id is null
              and (public.camp_trips_can_manage(location_id) or source = 'manual'));
drop policy if exists camp_trips_update on public.camp_trips;
create policy camp_trips_update on public.camp_trips for update
  using (public.camp_trips_can_run(location_id, kind))
  with check (public.camp_trips_can_run(location_id, kind));
drop policy if exists camp_trips_delete on public.camp_trips;
create policy camp_trips_delete on public.camp_trips for delete
  using (public.camp_trips_can_run(location_id, kind) and payment_entry_id is null and source = 'manual');

-- ── 2 · Pay a driver ─────────────────────────────────────────────────────────
create or replace function public.camp_trips_pay(p_location uuid, p_driver uuid, p_typed_amount numeric, p_diff_note text, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; r public.ledger_entries%rowtype; v_rows jsonb := '[]'::jsonb; v_total numeric := 0; v_trips numeric := 0;
        v_ids uuid[]; v_n int; v_sum numeric; v_largest uuid; v_largest_amt numeric := -1;
        v_manage boolean := public.camp_trips_can_manage(p_location);
        v_local boolean := (not public.camp_trips_can_manage(p_location)) and public.is_local_manager(p_location);
        v_slug text := (select slug from public.locations where id = p_location);
begin
  if not (v_manage or v_local) then raise exception 'Only the camp team can pay from Transport' using errcode = '42501'; end if;
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
    r.payment_method := case when v_local then 'Cash' when r.payment_method in ('Cash', 'Bank Transfer') then r.payment_method else 'Cash' end;
    r.source_kind := 'trip_payment'; r.business_area := coalesce(r.business_area, 'Transport');
    r.created_at := now(); r.created_by := auth.uid(); r.hq_invoice_id := null; r.internal_transfer_id := null;
    r.is_comp := false; r.currency := coalesce(r.currency, 'LKR'); r.amount_local := coalesce(r.amount_local, 0);
    r.entry_date := coalesce(r.entry_date, (now() at time zone 'Asia/Colombo')::date);
    if v_local then r.paid_from := v_slug; r.attributed_location := v_slug; end if;   -- his cash, never an HQ line
    insert into public.ledger_entries select r.*;
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(coalesce(x->'trip_ids', '[]'::jsonb));
    v_ids := coalesce(v_ids, '{}');
    perform 1 from public.camp_trips where id = any(v_ids) for update;
    update public.camp_trips set payment_entry_id = r.id
     where id = any(v_ids) and location_id = p_location and driver_id = p_driver and payment_entry_id is null
       and status not in ('cancelled','no_show','merged')
       and (public.camp_trip_is_done(status, trip_date, trip_time)
            or (kind in ('airport_arrival', 'airport_departure') and trip_date >= public.camp_trips_go_live() and trip_date <= r.entry_date + 14));
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
revoke all on function public.camp_trips_pay(uuid, uuid, numeric, text, jsonb) from public, anon;
grant execute on function public.camp_trips_pay(uuid, uuid, numeric, text, jsonb) to authenticated;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select policyname, cmd, qual, with_check from pg_policies where tablename = 'camp_trips' order by cmd;     -- insert/update/delete use camp_trips_can_run
-- select proname, prosecdef from pg_proc where proname in ('camp_trips_can_run', 'camp_trips_pay');          -- both security definer
-- select has_function_privilege('anon', 'public.camp_trips_can_run(uuid, text)', 'execute');                  -- false
-- select prosrc like '%is_local_manager%' from pg_proc where proname = 'camp_trips_pay';                      -- true

-- ── Rollback (the camp-trips.sql versions) ───────────────────────────────────
-- drop policy if exists camp_trips_insert on public.camp_trips;
-- create policy camp_trips_insert on public.camp_trips for insert with check (public.camp_trips_can_manage(location_id) and payment_entry_id is null);
-- drop policy if exists camp_trips_update on public.camp_trips;
-- create policy camp_trips_update on public.camp_trips for update using (public.camp_trips_can_manage(location_id)) with check (public.camp_trips_can_manage(location_id));
-- drop policy if exists camp_trips_delete on public.camp_trips;
-- create policy camp_trips_delete on public.camp_trips for delete using (public.camp_trips_can_manage(location_id) and payment_entry_id is null and source = 'manual');
-- then re-run the camp_trips_pay block of supabase/camp-trips.sql, and: drop function if exists public.camp_trips_can_run(uuid, text);
