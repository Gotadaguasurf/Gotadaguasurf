-- ════════════════════════════════════════════════════════════════════════════
--  Nadith picks the transfers he is paying (Sri Lanka, 13 Nov 2026).
--
--  When the local manager enters a Cash «Transport» expense with linked item
--  «Airport» in the ledger, the Quick add form shows «Which transfers is this
--  for?» (camp-hub/paylink.js). After the ledger row is saved the hub calls
--  camp_transport_link_own(entry, trip ids) with the transfers he ticked.
--
--  The ledger trigger (camp_transport__link, supabase/camp-trips.sql) has
--  already run on the insert and may have stamped the driver's oldest trips
--  on this entry as 'auto'. This function replaces that guess with his pick:
--    · trips on this entry that he did not tick are released;
--    · the ticked trips are stamped (only if unpaid or already on this entry —
--      never a trip paid by another entry);
--    · camp_transport_payments gets linked_by = 'manual' (the live check allows
--      only auto / manual / pay), so the trigger's «kept» branch keeps his trips
--      on every later edit and camp_transport_autolink never touches it again.
--    · reviewed_by stays NULL when the local manager linked it: that is how
--      Transport → Reconcile tells «linked by Nadith» from «linked by hand»
--      (camp_transport_link_set and camp_trips_pay always set reviewed_by).
--  state = matched when the ticked trips add up to the amount, else review
--  with reason 'amounts differ' → Francisco sees it in «Payments to review».
--
--  Who may call it
--    · anyone with access to the camp (has_location_access) for an entry that
--      is a Cash Transport expense of that camp, created by the caller within
--      the last 24 hours;
--    · or a camp manager / HQ (camp_trips_can_manage — NOT has_full_location_access:
--      the local manager has can_edit = true too) for any Transport expense.
--  The local manager cannot overwrite a link Francisco or «Pay a driver» made.
--
--  Requires supabase/camp-trips.sql (live since 13 Nov). Idempotent.
--  NOT run against production by the agent — Miguel runs it after his OK.
-- ════════════════════════════════════════════════════════════════════════════

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
  -- Every ticked trip: this camp's airport transfer, not cancelled, between go-live
  -- and the payment date, and unpaid — or already on this entry (the automatic link).
  select count(*) into v_ok from public.camp_trips
   where id = any(v_ids) and location_id = e.location_id
     and kind in ('airport_arrival', 'airport_departure')
     and status not in ('cancelled', 'no_show', 'merged')
     and trip_date >= v_go and trip_date <= e.entry_date
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

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default (pg_default_acl): revoke, then grant to logged-in users only.
revoke all on function public.camp_transport_link_own(uuid, uuid[]) from public, anon;
grant execute on function public.camp_transport_link_own(uuid, uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select proname, prosecdef from pg_proc where proname = 'camp_transport_link_own';          -- 1 row, true
-- select has_function_privilege('anon', 'public.camp_transport_link_own(uuid, uuid[])', 'execute');   -- false
-- After Nadith's first pick:
-- select entry_id, state, reason, trips_count, trips_amount, entry_amount, linked_by, reviewed_by is null as by_local
--   from public.camp_transport_payments where linked_by = 'manual' order by updated_at desc limit 10;
-- Rollback: drop function if exists public.camp_transport_link_own(uuid, uuid[]);
