-- 11 Nov 2026 — Miguel: «não está bué confuso ter 2 linhas? por mim quando se
-- levanta dinheiro vai direto para a caixa, não é preciso ter outra linha».
--
-- On 10 Nov every cash withdrawal in the camp ledgers became a PAIR of
-- transfer rows of the same day and amount:
--     payment_method 'Bank Transfer'  («… — out of bank»,  bank −)
--     payment_method 'Cash'           («… — into cash»,    cash +)
-- The camp hub now stores a withdrawal as ONE row, payment_method
-- 'ATM Withdrawal' (bank − and cash + in the same line; the ledger's payment
-- filter lists it under Cash as + and under Bank Transfer as −).
--
-- This file converts the existing pairs, in every location:
--   • keeps the BANK half (the older row, loaded from the bank statement),
--     sets payment_method = 'ATM Withdrawal' and drops the trailing
--     «— out of bank» from its description;
--   • deletes the CASH half.
--
-- What is a pair: two ledger_entries of type 'money_sent', same location_id,
-- same entry_date, same amount_local and currency, one 'Bank Transfer' and
-- one 'Cash', whose descriptions are the same text once «— out of bank» /
-- «— into cash» is taken off. Rows are matched 1:1 (row_number inside each
-- location + day + amount + text), so two withdrawals of the same day and
-- amount give two single rows, and a third unmatched half stays as it is.
--
-- What is NOT touched: lone rows. A lone 'Bank Transfer' transfer is money
-- that left the bank to outside (e.g. the loan of 14 Sep 2026); a lone 'Cash'
-- transfer is money into cash from outside (e.g. the opening cash of 1 Jan
-- 2026). 'HQ Transfer', 'Cash Deposit', 'Cash Out', rows mirrored from HQ
-- (hq_invoice_id / internal_transfer_id) and every expense / revenue row are
-- never read as halves.
--
-- Bank and Cash of every location must be identical before and after — the
-- file checks it inside the transaction and rolls everything back if a single
-- figure moves.
--
-- HOW TO RUN
--   Step 1 (read-only) can be run alone, as many times as wanted.
--   Steps 2–4 are one transaction: run the whole file, or from «begin;» down.
--   The last statement (after the commit) lists what each ledger holds now.
--   After it, reload any open camp hub tab (it keeps the old pair in memory).
--   Deploy the camp hub change first: the old page labels a single row
--   «ATM withdrawal» and counts it right, but its payment filter does not
--   list it under Cash.

-- ════════════════════════════════════════════════════════════════════════
-- STEP 1 — PREVIEW (read-only). One line per pair that will be converted.
-- ════════════════════════════════════════════════════════════════════════
with halves as (
  select e.id, e.location_id, e.entry_date, e.amount_local, e.currency, e.payment_method,
         e.description, e.created_at,
         lower(btrim(regexp_replace(coalesce(e.description,''), '\s*[—–-]\s*(out of bank|into cash)\s*$', '', 'i'))) as base_text,
         row_number() over (
           partition by e.location_id, e.entry_date, e.amount_local, e.currency, e.payment_method,
                        lower(btrim(regexp_replace(coalesce(e.description,''), '\s*[—–-]\s*(out of bank|into cash)\s*$', '', 'i')))
           order by e.created_at, e.id) as rn
  from public.ledger_entries e
  where e.type = 'money_sent'
    and e.payment_method in ('Bank Transfer','Cash')
    and e.hq_invoice_id is null and e.internal_transfer_id is null
)
select l.slug, b.entry_date, b.amount_local, b.currency,
       b.id as keep_bank_row, c.id as delete_cash_row,
       b.description as description_now,
       coalesce(nullif(btrim(regexp_replace(coalesce(b.description,''), '\s*[—–-]\s*out of bank\s*$', '', 'i')), ''), 'Cash withdrawal') as description_after
from halves b
join halves c on c.location_id = b.location_id and c.entry_date = b.entry_date
             and c.amount_local = b.amount_local and c.currency = b.currency
             and c.base_text = b.base_text and c.rn = b.rn
             and c.payment_method = 'Cash'
join public.locations l on l.id = b.location_id
where b.payment_method = 'Bank Transfer'
order by l.slug, b.entry_date, b.amount_local, b.created_at;

-- ════════════════════════════════════════════════════════════════════════
-- STEPS 2–4 — CONVERT, inside one transaction.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- Bank and Cash per location, by the camp hub's own rule (ledgerDrawerDelta
-- in camp-hub/index.html). A view, so it is recomputed every time it is read.
create temp view _atm_drawers as
select l.slug,
  sum(e.amount_local * case
    when e.type = 'expense' and (lower(coalesce(e.source_kind,'')) = 'hq_invoice' or e.payment_method = 'HQ Paid') then 0
    when e.type = 'expense' and e.payment_method in ('Card','Bank Transfer','HQ Transfer') then -1
    when e.type = 'revenue' and e.payment_method in ('Card','Bank Transfer') then 1
    when e.type = 'money_sent' and e.payment_method in ('ATM Withdrawal','Bank Transfer') then -1
    when e.type = 'money_sent' and e.payment_method in ('Cash','Cash Out') then 0
    when e.type = 'money_sent' then 1            -- HQ Transfer, Cash Deposit, legacy rows without a kind
    else 0 end) as bank_local,
  sum(e.amount_local * case
    when e.type = 'expense' and (lower(coalesce(e.source_kind,'')) = 'hq_invoice' or e.payment_method = 'HQ Paid') then 0
    when e.type = 'expense' and e.payment_method in ('Cash','Camp Cash') then -1
    when e.type = 'revenue' and e.payment_method in ('Card','Bank Transfer') then 0
    when e.type = 'revenue' then 1
    when e.type = 'money_sent' and e.payment_method in ('ATM Withdrawal','Cash') then 1
    when e.type = 'money_sent' and e.payment_method in ('Cash Deposit','Cash Out') then -1
    else 0 end) as cash_local,
  count(*) as n_rows
from public.ledger_entries e
join public.locations l on l.id = e.location_id
group by l.slug;

-- STEP 2 — snapshot of the balances, and the list of pairs (same rule as the preview).
create temp table _atm_before on commit drop as select * from _atm_drawers;

create temp table _atm_pairs on commit drop as
with halves as (
  select e.id, e.location_id, e.entry_date, e.amount_local, e.currency, e.payment_method, e.created_at,
         lower(btrim(regexp_replace(coalesce(e.description,''), '\s*[—–-]\s*(out of bank|into cash)\s*$', '', 'i'))) as base_text,
         row_number() over (
           partition by e.location_id, e.entry_date, e.amount_local, e.currency, e.payment_method,
                        lower(btrim(regexp_replace(coalesce(e.description,''), '\s*[—–-]\s*(out of bank|into cash)\s*$', '', 'i')))
           order by e.created_at, e.id) as rn
  from public.ledger_entries e
  where e.type = 'money_sent'
    and e.payment_method in ('Bank Transfer','Cash')
    and e.hq_invoice_id is null and e.internal_transfer_id is null
)
select b.id as bank_id, c.id as cash_id, b.location_id
from halves b
join halves c on c.location_id = b.location_id and c.entry_date = b.entry_date
             and c.amount_local = b.amount_local and c.currency = b.currency
             and c.base_text = b.base_text and c.rn = b.rn
             and c.payment_method = 'Cash'
where b.payment_method = 'Bank Transfer';

-- Every row may sit in one pair only.
do $$
begin
  if (select count(*) from _atm_pairs) <> (select count(distinct bank_id) from _atm_pairs)
     or (select count(*) from _atm_pairs) <> (select count(distinct cash_id) from _atm_pairs)
     or exists (select 1 from _atm_pairs a join _atm_pairs b on a.bank_id = b.cash_id) then
    raise exception 'ATM pairs: a row was matched twice — nothing was changed';
  end if;
end $$;

-- STEP 3 — the bank half becomes the single row; the cash half goes.
update public.ledger_entries e
   set payment_method = 'ATM Withdrawal',
       description = coalesce(nullif(btrim(regexp_replace(coalesce(e.description,''), '\s*[—–-]\s*out of bank\s*$', '', 'i')), ''), 'Cash withdrawal')
  from _atm_pairs p
 where e.id = p.bank_id;

delete from public.ledger_entries e
 using _atm_pairs p
 where e.id = p.cash_id;

-- STEP 4 — CHECK. Bank and Cash of every location are the same as before,
-- and each location lost exactly one row per pair. Anything else: roll back.
do $$
declare v_bad text;
begin
  select string_agg(coalesce(a.slug, b.slug) || ' (bank ' || coalesce(b.bank_local,0) || ' → ' || coalesce(a.bank_local,0)
                    || ', cash ' || coalesce(b.cash_local,0) || ' → ' || coalesce(a.cash_local,0) || ')', '; ')
    into v_bad
    from _atm_before b
    full join _atm_drawers a on a.slug = b.slug
   where a.slug is null or b.slug is null
      or a.bank_local is distinct from b.bank_local
      or a.cash_local is distinct from b.cash_local
      or a.n_rows is distinct from b.n_rows - (select count(*) from _atm_pairs p join public.locations l on l.id = p.location_id where l.slug = b.slug);
  if v_bad is not null then
    raise exception 'ATM pairs: balances moved — rolled back. %', v_bad;
  end if;
end $$;

-- Result, per location: balances before and after (identical), pairs converted,
-- and how many one-drawer transfer rows are left as they were (lone rows).
select b.slug,
       b.bank_local as bank_before, a.bank_local as bank_after,
       b.cash_local as cash_before, a.cash_local as cash_after,
       (select count(*) from _atm_pairs p join public.locations l on l.id = p.location_id where l.slug = b.slug) as pairs_converted,
       (select count(*) from public.ledger_entries e join public.locations l on l.id = e.location_id
         where l.slug = b.slug and e.type = 'money_sent' and e.payment_method = 'Bank Transfer') as lone_out_of_bank_left,
       (select count(*) from public.ledger_entries e join public.locations l on l.id = e.location_id
         where l.slug = b.slug and e.type = 'money_sent' and e.payment_method = 'Cash') as lone_into_cash_left
  from _atm_before b
  join _atm_drawers a on a.slug = b.slug
 order by b.slug;

drop view _atm_drawers;
commit;

-- After the commit: what the ledgers hold now. pairs_left must be 0.
select l.slug,
       count(*) filter (where e.payment_method = 'ATM Withdrawal') as cash_withdrawals_one_row,
       count(*) filter (where e.payment_method = 'Bank Transfer')  as lone_out_of_bank,
       count(*) filter (where e.payment_method = 'Cash')           as lone_into_cash,
       (select count(*) from public.ledger_entries b
          join public.ledger_entries c on c.location_id = b.location_id and c.entry_date = b.entry_date
               and c.amount_local = b.amount_local and c.type = 'money_sent' and c.payment_method = 'Cash'
               and c.description ~* '[—–-]\s*into cash\s*$'
         where b.location_id = l.id and b.type = 'money_sent' and b.payment_method = 'Bank Transfer'
           and b.description ~* '[—–-]\s*out of bank\s*$') as pairs_left
  from public.locations l
  join public.ledger_entries e on e.location_id = l.id and e.type = 'money_sent'
 group by l.slug, l.id
 order by l.slug;
