-- ═══════════════════════════════════════════════════════════════════════════
-- Audit 18 Nov 2026 — wave 4 (camps: camp hub, Camp Tab, Week, Transport, imports)
-- ═══════════════════════════════════════════════════════════════════════════
-- Miguel runs this file by hand in the Supabase SQL editor, after reading it.
-- It is idempotent (create or replace / if not exists). The pages work before and after it runs.
--
-- PART A — schema: run as it is.
-- PART B — data corrections: every statement is COMMENTED OUT. Each one carries the count a read-only SELECT gave on
--          18 Nov 2026; run the SELECT again, and only if the count is the same, uncomment and run the change.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PART A1 · CH-20: the «line comes from HQ» refusal in English ───────────────
-- The live trigger function (pg_get_functiondef, 18 Nov 2026) raised a Portuguese message that the camp hub puts in
-- its toast. Same body, same errcode 42501, English text. One addition: set search_path to 'public' (the live
-- function has none). Not security definer, as live; no grants.
create or replace function public.fn_ledger_mirror_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.hq_mirror', true),'') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.hq_invoice_id is not null or old.internal_transfer_id is not null then
      raise exception 'This line comes from HQ (invoice or transfer). Change or archive it in HQ, not here.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.hq_invoice_id is not null or new.hq_invoice_id is not null or old.internal_transfer_id is not null or new.internal_transfer_id is not null then
    raise exception 'This line comes from HQ (invoice or transfer). Change or archive it in HQ, not here.' using errcode = '42501';
  end if;
  return new;
end $function$;
-- (the triggers that call it are unchanged; supabase/hq-invoices-mirror-to-ledger.sql and
--  supabase/internal-transfers-mirror-to-ledger.sql still hold the Portuguese copy — re-running them brings it back.)


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — data corrections, ALL COMMENTED OUT. Run the SELECT first; uncomment only if the count matches.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B1 · HQ-02 / WEEK-01 / PRT-01 / DATA-01 / SEAM-01: Sri Lanka bookings saved as location «Unknown» ──────────
-- The importer recognises «Ahamgama» since wave 1 (lib/bl-revenue.js); the rows it saved before still say «Unknown»,
-- so they are missing from the Sri Lanka row of HQ (rollup maps by location). Read-only on 18 Nov 2026:
--   select count(*) from bookings where location = 'Unknown';                                              → 17 (net 11,794.87)
--   select count(*) from bookings where location = 'Unknown'
--     and (coalesce(raw_payload->>'locationList','') ~* 'aha[mn]gama|sri ?lanka' or coalesce(package,'') ~* 'aha[mn]gama|sri ?lanka');   → 16
-- The 17th row is not Sri Lanka by its text: look at it by hand. A daily revenue import would also fix the ones
-- still inside its 30-day window.
-- begin;
-- update bookings set location = 'Surf Camp Ahangama',
--        raw_payload = jsonb_set(coalesce(raw_payload,'{}'::jsonb), '{locationCode}', '"LK"')
--  where location = 'Unknown'
--    and (coalesce(raw_payload->>'locationList','') ~* 'aha[mn]gama|sri ?lanka' or coalesce(package,'') ~* 'aha[mn]gama|sri ?lanka');
-- -- expect: UPDATE 16
-- commit;

-- ── B2 · DATA-07 (camp hub FX): a euro location with a 330 fallback rate, and one wrong MAD day rate ─────────────
-- Read-only on 18 Nov 2026:
--   select default_fx_to_eur from locations where slug = 'wild-wednesday';                       → 330.0000 (currency EUR)
--   select rate from daily_fx_rates where quote_currency = 'MAD' and rate_date = '2026-05-21';   → 389.63 (an LKR-sized rate)
-- 10.7219 is the rate that day's Morocco ledger rows already use (audit DATA-07). UPDATE, never delete.
-- update locations set default_fx_to_eur = 1 where slug = 'wild-wednesday' and default_fx_to_eur = 330;            -- expect: UPDATE 1
-- update daily_fx_rates set rate = 10.7219 where quote_currency = 'MAD' and rate_date = '2026-05-21' and rate > 100;  -- expect: UPDATE 1
