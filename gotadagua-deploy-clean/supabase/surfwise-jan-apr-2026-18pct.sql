-- ════════════════════════════════════════════════════════════════════════════
--  Backfill — Surfwise always-18% rate for Jan/Feb/Mar/Apr 2026 bookings
-- ════════════════════════════════════════════════════════════════════════════
--
--  Context: Surfwise (both partner-name variants, "SURFWISE" and
--  "Surfwise Travel") has always been billed at 18%, but some bookings
--  imported earlier landed in the bookings table with a different
--  partner_commission_pct (usually 20%, the silent fallback when the
--  CSV column was blank).
--
--  This script:
--    1. Rewrites partner_commission_pct → 18 for every booking matching
--       partner_name ILIKE 'surfwise%' AND check_in_on between
--       2026-01-01 and 2026-04-30.
--    2. Recomputes commission_amount = round(total * 0.18, 2) and
--       net_amount = total - commission_amount so the partner statement
--       and the Overview dashboards stay consistent.
--
--  Idempotent: re-running is a no-op on already-corrected rows
--  (an UPDATE that doesn't change values still bumps updated_at, which
--  is fine — Realtime will just resend the row).
--
--  Scope is intentionally narrow:
--    • Only Surfwise (the partner the user confirmed is "always 18%").
--    • Only the first four months of 2026 (the window the user asked for).
--    • Future months are NOT touched — new CSV imports continue to stamp
--      whatever rate Bookinglayer sends.
--
--  How to run: paste into Supabase SQL Editor → Run. Then refresh the
--  Partners page in the app — the row totals will update via realtime.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Preview what will change (run this FIRST and eyeball the list) ─────
select booking_ref,
       partner_name,
       check_in_on,
       total,
       partner_commission_pct as old_pct,
       18                     as new_pct,
       commission_amount      as old_commission,
       round(total * 0.18, 2) as new_commission,
       net_amount             as old_net,
       round(total - round(total * 0.18, 2), 2) as new_net
  from public.bookings
 where partner_name ilike 'surfwise%'
   and check_in_on between date '2026-01-01' and date '2026-04-30'
 order by check_in_on, booking_ref;

-- ── 2. Apply the rate fix ─────────────────────────────────────────────────
update public.bookings
   set partner_commission_pct = 18,
       commission_amount      = round(total * 0.18, 2),
       net_amount             = round(total - round(total * 0.18, 2), 2),
       updated_at             = now()
 where partner_name ilike 'surfwise%'
   and check_in_on between date '2026-01-01' and date '2026-04-30';

-- ── 3. Verify — every targeted booking now reads 18% ──────────────────────
select booking_ref,
       partner_name,
       check_in_on,
       total,
       partner_commission_pct,
       commission_amount,
       net_amount
  from public.bookings
 where partner_name ilike 'surfwise%'
   and check_in_on between date '2026-01-01' and date '2026-04-30'
 order by check_in_on, booking_ref;
