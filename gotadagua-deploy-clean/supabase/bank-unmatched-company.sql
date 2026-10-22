-- ════════════════════════════════════════════════════════════════════════════
--  hq_bank_unmatched_co — «débitos sem linha» for ANY company (22 Oct 2026,
--  one formula): the same rules as _accountant_bank_unmatched (Water /
--  Santander+CGD) but with the company as a parameter, so /suk/ (Manjar /
--  BCP) stops computing its own version in the browser.
--  Not counted: credits, fees, internal transfers, salary batches
--  («LOTE TRF CRED SEPA», «PAGAMENTO VENCIMENTOS»), rows noted «[sem fatura»,
--  «[ativo», «[financiamento», «[devolução», and any debit whose amount equals
--  one line (or the sum of one supplier's lines on one date) within −15/+5 days.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.hq_bank_unmatched_co(p_company text, p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  with inv as (
    select invoice_date, company, abs(coalesce(amount_eur, amount)) as v
      from hq_invoices
     where deleted_at is null and coalesce(paying_company, 'water-movements') = p_company
       and invoice_date between p_from - 20 and p_to + 10
  ), grp as (
    select invoice_date, company, sum(v) as v from inv group by 1, 2
  )
  select b.id, b.movement_date, b.description, b.amount
    from hq_bank_movements b
   where b.paying_company = p_company and b.amount < 0
     and b.kind in ('expense', 'other')
     and b.movement_date between p_from and p_to
     and b.hq_invoice_id is null and b.internal_transfer_id is null
     and b.description not ilike 'LOTE TRF CRED SEPA%'
     and b.description not ilike 'PAGAMENTO VENCIMENTOS%'
     and coalesce(b.notes, '') not ilike '[sem fatura%'
     and coalesce(b.notes, '') not like '[ativo%'
     and coalesce(b.notes, '') not like '[financiamento%'
     and coalesce(b.notes, '') not like '[devolução%'
     and not exists (select 1 from inv i where abs(i.v - abs(b.amount)) < 0.011
                       and i.invoice_date between b.movement_date - 15 and b.movement_date + 5)
     and not exists (select 1 from grp g where abs(g.v - abs(b.amount)) < 0.011
                       and g.invoice_date between b.movement_date - 15 and b.movement_date + 5)
$$;
revoke all on function public.hq_bank_unmatched_co(text, date, date) from public, anon;
grant execute on function public.hq_bank_unmatched_co(text, date, date) to authenticated;
select json_build_object('manjar', (select count(*) from public.hq_bank_unmatched_co('manjar', '2026-01-01', current_date)), 'water', (select count(*) from public.hq_bank_unmatched_co('water-movements', '2026-09-01', current_date))) j;
