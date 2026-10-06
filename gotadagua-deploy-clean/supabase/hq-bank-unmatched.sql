-- ════════════════════════════════════════════════════════════════════════════
--  hq_bank_unmatched — o mesmo cálculo do portal do contabilista
--  (_accountant_bank_unmatched), mas chamável pelos membros do HQ, para a
--  tab «Fecho do mês» e o Excel do contabilista («Banco sem lançamento»).
--  6 Out 2026: os lotes «LOTE TRF CRED SEPA+» (salários e cartões refeição)
--  ficam de fora — na app estão lançados por pessoa, com os recibos de
--  vencimento, e nunca somam o lote linha a linha (Miguel: «temos em todos
--  os meses os recibos de vencimento»).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._accountant_bank_unmatched(p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  with inv as (
    select invoice_date, company, abs(coalesce(amount_eur, amount)) as v
      from hq_invoices
     where deleted_at is null and coalesce(paying_company, 'water-movements') = 'water-movements'
       and invoice_date between p_from - 20 and p_to + 10
  ), grp as (
    select invoice_date, company, sum(v) as v from inv group by 1, 2
  )
  select b.id, b.movement_date, b.description, b.amount
    from hq_bank_movements b
   where b.paying_company = 'water-movements' and b.amount < 0
     and b.kind in ('expense', 'other')
     and b.movement_date between p_from and p_to
     and b.hq_invoice_id is null and b.internal_transfer_id is null
     and b.description not ilike 'LOTE TRF CRED SEPA%'
     and not exists (select 1 from inv i where abs(i.v - abs(b.amount)) < 0.011
                       and i.invoice_date between b.movement_date - 15 and b.movement_date + 5)
     and not exists (select 1 from grp g where abs(g.v - abs(b.amount)) < 0.011
                       and g.invoice_date between b.movement_date - 15 and b.movement_date + 5)
$$;
revoke all on function public._accountant_bank_unmatched(date, date) from public, anon, authenticated;

create or replace function public.hq_bank_unmatched(p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  select * from public._accountant_bank_unmatched(p_from, p_to)
$$;
revoke all on function public.hq_bank_unmatched(date, date) from public, anon;
grant execute on function public.hq_bank_unmatched(date, date) to authenticated;
