-- ════════════════════════════════════════════════════════════════════════════
--  Heal — ledger_entries currency + fx_rate by location
-- ════════════════════════════════════════════════════════════════════════════
--
--  The user reported MAD 87 expenses showing as €0.22 (should be ~€8.29).
--  Root cause: a chunk of Morocco ledger_entries was stamped with the LKR
--  rate (~388) instead of the MAD rate (~10.5) because the session that
--  created them had LOCAL_CURRENCY='LKR' active when the user logged the
--  Morocco operation.
--
--  Symptom in DB: ledger_entries rows where location matches Morocco
--  (slug='morocco') but currency='LKR' and fx_rate >> 100.
--
--  This script:
--    1. Previews every affected row (review first, run step 2 only when
--       the list looks right).
--    2. Force-sets currency = location.currency and fx_rate = the locked
--       rate for that location's currency. amount_local stays UNTOUCHED
--       (that's the user-typed number).
--    3. Recomputes amount_eur from amount_local / fx_rate so reports
--       (Overview, Weekly P&L, etc.) show the right numbers.
--
--  Locked rates match camp-hub/index.html FX_PINNED_PER_EUR:
--    Sri Lanka (LKR): 330 per EUR
--    Morocco   (MAD): 10.5 per EUR
--    Portugal  (EUR): 1
--    Junior    (EUR): 1
--
--  Idempotent. Re-runs are safe (rows already-healed produce no changes).
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Preview — rows whose stamped currency doesn't match their location ──
select
  l.slug                                  as location,
  l.currency                              as loc_ccy,
  le.id                                   as ledger_id,
  le.entry_date,
  le.category,
  le.description,
  le.amount_local,
  le.currency                             as stamped_ccy,
  le.fx_rate                              as stamped_fx,
  le.amount_eur                           as stamped_eur,
  -- what the heal will set:
  case
    when l.slug = 'sri-lanka' then 330
    when l.slug = 'morocco'   then 10.5
    when l.slug = 'portugal'  then 1
    when l.slug = 'junior'    then 1
    else le.fx_rate
  end                                     as new_fx,
  case
    when l.slug = 'sri-lanka' then round(le.amount_local::numeric / 330,   2)
    when l.slug = 'morocco'   then round(le.amount_local::numeric / 10.5,  2)
    when l.slug = 'portugal'  then le.amount_local
    when l.slug = 'junior'    then le.amount_local
    else le.amount_eur
  end                                     as new_eur
from public.ledger_entries le
join public.locations       l on l.id = le.location_id
where le.currency is not null
  and le.currency <> 'EUR'
  and le.currency <> l.currency
order by l.slug, le.entry_date desc, le.id;

-- ── 2. Apply the heal — currency + fx_rate aligned to the location ─────────
update public.ledger_entries le
   set currency   = l.currency,
       fx_rate    = case
                      when l.slug = 'sri-lanka' then 330
                      when l.slug = 'morocco'   then 10.5
                      when l.slug = 'portugal'  then 1
                      when l.slug = 'junior'    then 1
                      else le.fx_rate
                    end,
       amount_eur = case
                      when l.slug = 'sri-lanka' then round(le.amount_local::numeric / 330,   2)
                      when l.slug = 'morocco'   then round(le.amount_local::numeric / 10.5,  2)
                      when l.slug = 'portugal'  then le.amount_local
                      when l.slug = 'junior'    then le.amount_local
                      else le.amount_eur
                    end
  from public.locations l
 where l.id = le.location_id
   and le.currency is not null
   and le.currency <> 'EUR'
   and le.currency <> l.currency;

-- ── 3. Also heal rows where currency matches the location but fx_rate has
--       drifted far from the locked rate (>50% off). Same shape of fix.
update public.ledger_entries le
   set fx_rate    = case
                      when l.slug = 'sri-lanka' then 330
                      when l.slug = 'morocco'   then 10.5
                      else le.fx_rate
                    end,
       amount_eur = case
                      when l.slug = 'sri-lanka' then round(le.amount_local::numeric / 330,   2)
                      when l.slug = 'morocco'   then round(le.amount_local::numeric / 10.5,  2)
                      else le.amount_eur
                    end
  from public.locations l
 where l.id = le.location_id
   and le.currency = l.currency
   and le.currency <> 'EUR'
   and (
     (l.slug = 'sri-lanka' and abs(le.fx_rate - 330)  / 330  > 0.5) or
     (l.slug = 'morocco'   and abs(le.fx_rate - 10.5) / 10.5 > 0.5)
   );

-- ── 4. Verify — sample of Morocco rows should now show currency='MAD',
--       fx_rate=10.5, amount_eur = amount_local / 10.5.
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
  and le.currency <> 'EUR'
order by le.entry_date desc
limit 30;
