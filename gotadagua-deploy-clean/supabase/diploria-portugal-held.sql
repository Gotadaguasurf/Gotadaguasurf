-- ════════════════════════════════════════════════════════════════════════════
--  Portugal Dipløria = held for the brand, not camp revenue (Miguel, 15 Nov 2026:
--  «esse dinheiro em Portugal não conta porque vamos dar à marca»).
--
--  No schema change is needed for the money rule. The Camp Tab (camp-hub) now
--  writes a paid Portugal Dipløria line as a ledger TRANSFER, never revenue:
--    sale   : type 'money_sent' · payment_method 'Cash'          (Into cash, +cash)
--             · category 'Dipløria' · source_kind 'camp_tab_per_guest' · linked_item = the SKU
--    passed : type 'money_sent' · payment_method 'Cash Out' / 'Bank Transfer' (Out of cash / Out of bank)
--             · category 'Dipløria' · source_kind 'diploria_pass'   (written from /diploria/)
--  Why that is enough:
--    · hq_overview_rollup() (supabase/one-formula.sql) sums rev_ops only for type
--      revenue/income and exp_local only for type expense → money_sent is in no P&L.
--    · camp_cash_delta() (supabase/camp-cash-count.sql) counts money_sent 'Cash' +1
--      and 'Cash Out' −1 → the cash drawer holds the 65 € until it is passed.
--    · The accountant pack reads hq_invoices / hq_bank_movements / internal_transfers,
--      never ledger_entries.
--  Owed by Portugal = paid Portugal Dipløria Camp Tab lines − passes (the two paid
--  lines of 25 Jul and 1 Oct never reached the ledger; no past row is invented).
--
--  What this file adds: Dipløria team members (workspace 'diploria') may READ the
--  Dipløria moves of a camp ledger, so /diploria/ shows «passed» and «owed» to them
--  too (today only the owner uses the page, and the owner already reads every row).
--  Same pattern as supabase/diploria-area.sql (*_select_diploria policies).
--  Writing a pass still needs edit access to the camp (ledger_entries_insert_full).
--
--  NOT RUN by the build agent. Idempotent. Needs supabase/diploria-area.sql
--  (is_diploria_member), already in production on 15 Nov 2026.
-- ════════════════════════════════════════════════════════════════════════════
begin;

drop policy if exists ledger_entries_select_diploria on public.ledger_entries;
create policy ledger_entries_select_diploria on public.ledger_entries for select to authenticated
  using (type = 'money_sent' and category = 'Dipløria' and public.is_diploria_member());

commit;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- 1. The policy is there (1 row).
select policyname, cmd from pg_policies where tablename = 'ledger_entries' and policyname = 'ledger_entries_select_diploria';

-- 2. The cash rule already counts the sale +1 and the pass −1 (expect 1, -1, 0 for Out of bank).
select public.camp_cash_delta('money_sent', 'Cash', 'camp_tab_per_guest')  as sale_into_cash,
       public.camp_cash_delta('money_sent', 'Cash Out', 'diploria_pass')   as passed_from_cash,
       public.camp_cash_delta('money_sent', 'Bank Transfer', 'diploria_pass') as passed_from_bank_cash_side;

-- 3. No Dipløria row is revenue or expense anywhere (expect 0 rows). A row here would be in a P&L.
select l.slug, e.type, e.category, e.entry_date, e.amount_eur, e.description
  from public.ledger_entries e join public.locations l on l.id = e.location_id
 where (e.category = 'Dipløria' or e.category = 'Diploria') and e.type <> 'money_sent';

-- 4. Portugal owes Dipløria: paid Camp Tab lines − passes (on 15 Nov 2026: 2 lines, 130 €, nothing passed → 130 €).
with pt as (select id from public.locations where slug = 'portugal'),
paid as (select count(*) n, coalesce(sum(price_local), 0) eur from public.camp_tab_items
          where location_id = (select id from pt) and category = 'Diploria' and paid_at is not null and price_local > 0),
open_ as (select count(*) n, coalesce(sum(price_local), 0) eur from public.camp_tab_items
          where location_id = (select id from pt) and category = 'Diploria' and paid_at is null and price_local > 0),
passed as (select count(*) n, coalesce(sum(amount_local), 0) eur from public.ledger_entries
            where location_id = (select id from pt) and type = 'money_sent' and category = 'Dipløria'
              and payment_method in ('Cash Out', 'Bank Transfer')),
held as (select count(*) n, coalesce(sum(amount_local), 0) eur from public.ledger_entries
          where location_id = (select id from pt) and type = 'money_sent' and category = 'Dipløria' and payment_method = 'Cash')
select paid.n as paid_lines, paid.eur as paid_eur, open_.n as not_paid_lines, open_.eur as not_paid_eur,
       held.n as ledger_held_rows, held.eur as ledger_held_eur,
       passed.n as passes, passed.eur as passed_eur, paid.eur - passed.eur as owed_eur
  from paid, open_, passed, held;

-- 5. Portugal in the HQ formula: the Dipløria transfers are not in rev_ops / exp_local (the pnl only reads
--    revenue/income and expense rows). Compare the pnl total with the ledger sums by type.
with p as (select r from jsonb_array_elements(public.hq_overview_rollup()->'pnl') r where r->>'slug' = 'portugal')
select (select round(sum((r->>'rev_ops')::numeric), 2) from p) as pnl_rev_ops,
       (select round(sum(amount_eur), 2) from public.ledger_entries e join public.locations l on l.id = e.location_id
         where coalesce(nullif(e.attributed_location, ''), nullif(e.paid_from, ''), l.slug) = 'portugal'
           and e.type = 'revenue' and e.source_kind is distinct from 'hq_invoice') as ledger_revenue,
       (select round(coalesce(sum(amount_eur), 0), 2) from public.ledger_entries e join public.locations l on l.id = e.location_id
         where l.slug = 'portugal' and e.type = 'money_sent' and e.category = 'Dipløria') as dipl_transfers_not_counted;
