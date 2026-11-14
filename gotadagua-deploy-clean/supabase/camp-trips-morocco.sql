-- ════════════════════════════════════════════════════════════════════════════
--  Camp trips for Morocco (14 Nov 2026) — run AFTER camp-trips.sql, camp-trips-v2.sql,
--  camp-trips-own-link.sql (all already live for Sri Lanka). Idempotent. NOT run by the
--  agent: Miguel runs it after his OK. Check queries at the bottom (SELECT only).
--
--  Morocco uses the same tables as Sri Lanka (camp_trips, camp_drivers, camp_week_guests,
--  camp_transport_payments, camp_week_messages). Nothing new is needed for the Week page,
--  the Guests import or the airport transfers. Van runs are camp_trips rows with kind
--  'other' (already allowed). Floriane's login (location_manager of Morocco, can_edit)
--  already passes camp_trips_can_manage(): no access change.
--
--  What this file changes:
--   1. In Morocco the drivers are paid by SG bank transfer. A Transport · Bank Transfer
--      line linked to its trips (Reconcile → Link trips, camp_transport_link_set) must
--      keep its trips when the line is edited later (description, amount — the SG
--      statement matcher of build/morocco-money may set the bank's amount). Today the
--      ledger trigger calls camp_transport__link(), which unlinks every non-Cash row.
--      Now: an UPDATE where the row is not Cash before nor after, still a Transport
--      expense, and linked by hand → only the totals and the state are refreshed.
--      Everything else (every Cash row, a row that becomes or stops being Cash or
--      Transport) goes through camp_transport__link() exactly as before.
--      Sri Lanka: its payments are Cash, so nothing changes there; the only difference
--      would be a Bank Transfer row linked by hand, which used to lose its link on edit.
--   2. camp_trips.currency defaults to 'LKR'. Rows of another camp (the Guests import
--      inserts without a currency) take the camp's currency (locations.currency).
--   3. Drivers for Morocco: Let Us Tours (airport) and Fathoune (vans). Optional seed,
--      the same can be done in Transport → Drivers. Phones left empty (add them there).
--
--  Not changed (noted in ma_week/REPORT.md): camp_trip_is_done() and camp_trips_go_live()
--  use Colombo time and one date for every camp. They only drive the automatic linking of
--  CASH payments, which Morocco does not use. The app computes «done» in Casablanca time.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Keep the trips of a linked bank transfer when the line is edited ────────
create or replace function public.camp_transport__refresh(p_entry uuid)
returns text language plpgsql security definer set search_path = public as $$
declare e public.ledger_entries%rowtype; v_sum numeric; v_n int; v_sig text;
begin
  select * into e from public.ledger_entries where id = p_entry;
  if e.id is null then return 'gone'; end if;
  select coalesce(sum(expected_price), 0), count(*) into v_sum, v_n from public.camp_trips where payment_entry_id = p_entry;
  v_sig := e.amount_local::text || '|' || e.entry_date::text || '|' || coalesce(e.description, '');
  update public.camp_transport_payments set
    entry_amount = e.amount_local, trips_amount = v_sum, trips_count = v_n, updated_at = now(),
    state = case when state = 'explained' and signature is not distinct from v_sig then 'explained'
                 when v_n > 0 and v_sum = e.amount_local then 'matched' else 'review' end,
    reason = case when state = 'explained' and signature is not distinct from v_sig then reason
                  when v_n > 0 and v_sum = e.amount_local then null
                  when v_n = 0 then 'no trips linked' else 'amounts differ' end,
    signature = v_sig
   where entry_id = p_entry;
  return 'refreshed';
end $$;
revoke all on function public.camp_transport__refresh(uuid) from public, anon, authenticated;

create or replace function public.camp_transport_ledger_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'UPDATE'
       and coalesce(old.payment_method, '') <> 'Cash' and coalesce(new.payment_method, '') <> 'Cash'
       and new.type = 'expense' and new.category = 'Transport'
       and exists (select 1 from public.camp_transport_payments p where p.entry_id = new.id and p.linked_by <> 'auto') then
      perform public.camp_transport__refresh(new.id);
    else
      perform public.camp_transport__link(new.id);
    end if;
  exception when others then
    raise warning 'camp_transport link skipped for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
-- The triggers camp_transport_link_ins / camp_transport_link_upd (camp-trips.sql) keep pointing at this function.

-- ── 2 · Currency of a trip = the camp's currency ────────────────────────────────
create or replace function public.camp_trips_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  select l.currency into v from public.locations l where l.id = new.location_id and l.slug <> 'sri-lanka';
  if v is not null and (new.currency is null or new.currency = 'LKR') then new.currency := v; end if;
  return new;
end $$;
drop trigger if exists camp_trips_currency on public.camp_trips;
create trigger camp_trips_currency before insert on public.camp_trips
  for each row execute function public.camp_trips_currency();

-- ── 3 · Morocco drivers (optional; Transport → Drivers does the same) ──────────
-- Let Us Tours gets the airport transfers (WhatsApp «Send transfers to»); Fathoune
-- drives the surf vans (default for van runs). Aliases = the words of the SG
-- statement / ledger lines («STE LET US TOURS SARL», «Fathoune Mounir»).
insert into public.camp_drivers (location_id, name, label, aliases, kinds, default_for, default_vehicle)
select l.id, 'Let Us Tours', 'Airport transfers', array['Let Us Tours', 'LET US TOURS', 'Letustours'], array['airport'], array['airport', 'transfers_contact'], 'Minivan'
  from public.locations l where l.slug = 'morocco'
on conflict (location_id, lower(name)) do nothing;
insert into public.camp_drivers (location_id, name, label, aliases, kinds, default_for, default_vehicle)
select l.id, 'Fathoune', 'Surf vans', array['Fathoune', 'Mounir', 'Fathoune Mounir'], array['van'], array['van', 'van_contact'], 'Van'
  from public.locations l where l.slug = 'morocco'
on conflict (location_id, lower(name)) do nothing;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select name, label, kinds, default_for, aliases from public.camp_drivers d join public.locations l on l.id = d.location_id where l.slug = 'morocco' order by name;
-- select tgname, tgenabled from pg_trigger where tgname in ('camp_transport_link_ins', 'camp_transport_link_upd', 'camp_trips_currency');
-- select currency, count(*) from public.camp_trips t join public.locations l on l.id = t.location_id where l.slug = 'morocco' group by 1;
