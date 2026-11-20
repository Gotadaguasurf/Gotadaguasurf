-- ════════════════════════════════════════════════════════════════════════════
--  Tour transfers: what we charge the guests (20 Nov 2026)
--  NOT run against production by the agent — Miguel runs it after his OK.
--
--  Miguel: «era fixe se quiser montar um tour Galle poder ter o preço de transporte que vai para os drivers e depois o
--  que cobramos, que é o dinheiro de lucro para nós».
--
--  1 · camp_trips.guest_price: what we charge each guest for a tour transfer (Transport → Tours → «We charge per
--      person»), in the camp's own currency (the trip's currency, LKR in Sri Lanka). Null = not charged / not known:
--      the app then shows no profit for that trip. Profit = pax × guest_price − expected_price (the driver).
--      Display only — nothing writes it to the ledger (a Camp Tab tour already has its revenue line there).
--
--  Nothing else needs changing:
--    · camp_trips_guard (camp-trips.sql) freezes only payment_entry_id and, on a paid trip, expected_price / driver_id /
--      status / kind / trip_date — the charge stays editable after the driver is paid.
--    · camp_trips_local_airport_guard (nadith-transport-access.sql) only looks at airport rows.
--    · the insert / update policies are row policies (camp_trips_can_run) and the table grant covers every column.
--    · camp_trips_import and camp_trips_bl_verify name their columns, so they never touch this one.
--  Until this file is run the app saves a tour transfer without the charge, with no error (camp-hub/transport.js NEW_COLS).
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.camp_trips add column if not exists guest_price numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'camp_trips_guest_price_check' and conrelid = 'public.camp_trips'::regclass) then
    alter table public.camp_trips add constraint camp_trips_guest_price_check check (guest_price is null or guest_price >= 0);
  end if;
end $$;

comment on column public.camp_trips.guest_price is
  'Tour transfer: what we charge each guest, per person, in the camp''s currency (the trip''s currency). Null = not charged / not known. Profit = pax × guest_price − expected_price. Display only.';

commit;

-- The API sees the new column straight away (else the app keeps saving without it until the schema cache reloads).
notify pgrst, 'reload schema';

-- ── Checks (run by hand after) ───────────────────────────────────────────────
-- select column_name, data_type, numeric_precision, numeric_scale from information_schema.columns
--  where table_schema = 'public' and table_name = 'camp_trips' and column_name = 'guest_price';   -- numeric 12,2
-- select tour_name, trip_date, pax, guest_price, expected_price, pax * guest_price - expected_price as profit
--   from public.camp_trips where purpose = 'tour' and kind = 'other' order by trip_date desc limit 20;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- alter table public.camp_trips drop constraint if exists camp_trips_guest_price_check;
-- alter table public.camp_trips drop column if exists guest_price;
-- notify pgrst, 'reload schema';
