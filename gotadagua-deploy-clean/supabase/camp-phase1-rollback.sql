-- Undo Sri Lanka Phase 1 (camp-trips.sql + camp-cash-count.sql), 13 Nov 2026.
-- Removes only what those two files created. Ledger rows are untouched,
-- except that «Cash count» adjustment rows (if any were settled) stay as they are.
begin;
drop trigger if exists camp_transport_link_ins on public.ledger_entries;
drop trigger if exists camp_transport_link_upd on public.ledger_entries;
drop policy if exists ledger_local_no_cash_count_insert on public.ledger_entries;
drop policy if exists ledger_local_no_cash_count_update on public.ledger_entries;
drop policy if exists ledger_local_no_cash_count_delete on public.ledger_entries;
drop table if exists public.camp_week_messages cascade;
drop table if exists public.camp_transport_payments cascade;
drop table if exists public.camp_trips cascade;
drop table if exists public.camp_week_guests cascade;
drop table if exists public.camp_drivers cascade;
drop table if exists public.camp_cash_counts cascade;
drop function if exists public.camp_transport_ledger_trigger() cascade;
drop function if exists public.camp_transport__link(uuid);
drop function if exists public.camp_transport_autolink(uuid);
drop function if exists public.camp_transport_link_set(uuid, uuid, uuid[], text);
drop function if exists public.camp_transport__driver_in(uuid, text);
drop function if exists public.camp_trips_pay(uuid, uuid, numeric, text, jsonb);
drop function if exists public.camp_trips_guard() cascade;
drop function if exists public.camp_trip_is_done(text, date, text);
drop function if exists public.camp_trips_can_manage(uuid);
drop function if exists public.camp_trips_go_live();
drop function if exists public.camp_cash_settle(uuid, text);
drop function if exists public.camp_cash_balance(uuid, date);
drop function if exists public.camp_cash_delta(text, text, text);
drop function if exists public.camp_cash_tolerance();
drop function if exists public.fn_camp_cash_counts_guard() cascade;
commit;
