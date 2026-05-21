-- ════════════════════════════════════════════════════════════════════════════
--  FINAL HEAL — ledger_entries currency + fx_rate + amount_eur
--               using actual Frankfurter rates per date
-- ════════════════════════════════════════════════════════════════════════════
--
--  Source of rates: the Frankfurter API responses captured during the user's
--  earlier healAllFxRatesToLive() run (visible in the browser console):
--
--    MAD per EUR:
--      2026-05-12 → 10.7305
--      2026-05-13 → 10.7239
--      2026-05-14 → 10.7210
--      2026-05-15 → 10.7275
--      2026-05-16 → 10.7221
--      2026-05-17 → 10.7175
--      2026-05-18 → 10.7267
--      2026-05-19 → 10.7102
--      2026-05-20 → 10.7213
--      2026-05-21 → 10.7219
--
--    LKR per EUR:
--      2026-05-16 → 380.36
--      2026-05-21 → 389.63
--      2026-05-31 → 390.49
--
--  This script:
--    1. Force-sets currency = location's locked currency (Morocco → MAD,
--       Sri Lanka → LKR) regardless of what's stamped now. Catches the
--       legacy bug where some Morocco rows were stamped 'LKR'.
--    2. Force-sets fx_rate = the Frankfurter rate for the entry's date.
--       For dates outside the table above we fall back to the location's
--       average rate (10.72 MAD or 385 LKR) — close enough for any
--       entry not yet captured.
--    3. Recomputes amount_eur = round(amount_local / fx_rate, 2).
--
--  amount_local is NEVER touched. That's the user-typed source of truth.
--
--  Idempotent. Safe to re-run.
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Preview every Morocco + Sri Lanka non-EUR row, showing the diff ────
select
  l.slug              as location,
  le.id,
  le.entry_date,
  le.category,
  le.description,
  le.amount_local,
  le.currency         as old_ccy,
  le.fx_rate          as old_fx,
  le.amount_eur       as old_eur,
  case l.slug
    when 'morocco'   then 'MAD'
    when 'sri-lanka' then 'LKR'
    else le.currency
  end                 as new_ccy,
  case
    when l.slug='morocco' and le.entry_date='2026-05-12' then 10.7305
    when l.slug='morocco' and le.entry_date='2026-05-13' then 10.7239
    when l.slug='morocco' and le.entry_date='2026-05-14' then 10.7210
    when l.slug='morocco' and le.entry_date='2026-05-15' then 10.7275
    when l.slug='morocco' and le.entry_date='2026-05-16' then 10.7221
    when l.slug='morocco' and le.entry_date='2026-05-17' then 10.7175
    when l.slug='morocco' and le.entry_date='2026-05-18' then 10.7267
    when l.slug='morocco' and le.entry_date='2026-05-19' then 10.7102
    when l.slug='morocco' and le.entry_date='2026-05-20' then 10.7213
    when l.slug='morocco' and le.entry_date='2026-05-21' then 10.7219
    when l.slug='morocco'                                 then 10.72
    when l.slug='sri-lanka' and le.entry_date='2026-05-16' then 380.36
    when l.slug='sri-lanka' and le.entry_date='2026-05-21' then 389.63
    when l.slug='sri-lanka' and le.entry_date='2026-05-31' then 390.49
    when l.slug='sri-lanka'                                 then 385
    else le.fx_rate
  end                 as new_fx,
  round(
    le.amount_local::numeric / case
      when l.slug='morocco' and le.entry_date='2026-05-12' then 10.7305
      when l.slug='morocco' and le.entry_date='2026-05-13' then 10.7239
      when l.slug='morocco' and le.entry_date='2026-05-14' then 10.7210
      when l.slug='morocco' and le.entry_date='2026-05-15' then 10.7275
      when l.slug='morocco' and le.entry_date='2026-05-16' then 10.7221
      when l.slug='morocco' and le.entry_date='2026-05-17' then 10.7175
      when l.slug='morocco' and le.entry_date='2026-05-18' then 10.7267
      when l.slug='morocco' and le.entry_date='2026-05-19' then 10.7102
      when l.slug='morocco' and le.entry_date='2026-05-20' then 10.7213
      when l.slug='morocco' and le.entry_date='2026-05-21' then 10.7219
      when l.slug='morocco'                                 then 10.72
      when l.slug='sri-lanka' and le.entry_date='2026-05-16' then 380.36
      when l.slug='sri-lanka' and le.entry_date='2026-05-21' then 389.63
      when l.slug='sri-lanka' and le.entry_date='2026-05-31' then 390.49
      when l.slug='sri-lanka'                                 then 385
      else le.fx_rate
    end,
    2
  )                   as new_eur
from public.ledger_entries le
join public.locations       l on l.id = le.location_id
where l.slug in ('morocco','sri-lanka')
  and le.currency <> 'EUR'
order by l.slug, le.entry_date desc, le.id;

-- ── 2. Apply the heal ─────────────────────────────────────────────────────
update public.ledger_entries le
   set currency = case l.slug
                    when 'morocco'   then 'MAD'
                    when 'sri-lanka' then 'LKR'
                    else le.currency
                  end,
       fx_rate = case
         when l.slug='morocco' and le.entry_date='2026-05-12' then 10.7305
         when l.slug='morocco' and le.entry_date='2026-05-13' then 10.7239
         when l.slug='morocco' and le.entry_date='2026-05-14' then 10.7210
         when l.slug='morocco' and le.entry_date='2026-05-15' then 10.7275
         when l.slug='morocco' and le.entry_date='2026-05-16' then 10.7221
         when l.slug='morocco' and le.entry_date='2026-05-17' then 10.7175
         when l.slug='morocco' and le.entry_date='2026-05-18' then 10.7267
         when l.slug='morocco' and le.entry_date='2026-05-19' then 10.7102
         when l.slug='morocco' and le.entry_date='2026-05-20' then 10.7213
         when l.slug='morocco' and le.entry_date='2026-05-21' then 10.7219
         when l.slug='morocco'                                 then 10.72
         when l.slug='sri-lanka' and le.entry_date='2026-05-16' then 380.36
         when l.slug='sri-lanka' and le.entry_date='2026-05-21' then 389.63
         when l.slug='sri-lanka' and le.entry_date='2026-05-31' then 390.49
         when l.slug='sri-lanka'                                 then 385
         else le.fx_rate
       end,
       amount_eur = round(
         le.amount_local::numeric / case
           when l.slug='morocco' and le.entry_date='2026-05-12' then 10.7305
           when l.slug='morocco' and le.entry_date='2026-05-13' then 10.7239
           when l.slug='morocco' and le.entry_date='2026-05-14' then 10.7210
           when l.slug='morocco' and le.entry_date='2026-05-15' then 10.7275
           when l.slug='morocco' and le.entry_date='2026-05-16' then 10.7221
           when l.slug='morocco' and le.entry_date='2026-05-17' then 10.7175
           when l.slug='morocco' and le.entry_date='2026-05-18' then 10.7267
           when l.slug='morocco' and le.entry_date='2026-05-19' then 10.7102
           when l.slug='morocco' and le.entry_date='2026-05-20' then 10.7213
           when l.slug='morocco' and le.entry_date='2026-05-21' then 10.7219
           when l.slug='morocco'                                 then 10.72
           when l.slug='sri-lanka' and le.entry_date='2026-05-16' then 380.36
           when l.slug='sri-lanka' and le.entry_date='2026-05-21' then 389.63
           when l.slug='sri-lanka' and le.entry_date='2026-05-31' then 390.49
           when l.slug='sri-lanka'                                 then 385
           else le.fx_rate
         end,
         2
       )
  from public.locations l
 where l.id = le.location_id
   and l.slug in ('morocco','sri-lanka')
   and le.currency <> 'EUR';

-- ── 3. Verify — Morocco sample should show MAD + sensible EUR ─────────────
select
  l.slug,
  le.entry_date,
  le.category,
  le.description,
  le.amount_local,
  le.currency,
  le.fx_rate,
  le.amount_eur
from public.ledger_entries le
join public.locations       l on l.id = le.location_id
where l.slug = 'morocco'
order by le.entry_date desc
limit 25;
