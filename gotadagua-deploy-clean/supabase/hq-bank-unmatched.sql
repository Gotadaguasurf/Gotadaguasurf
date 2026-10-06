-- ════════════════════════════════════════════════════════════════════════════
--  hq_bank_unmatched — o mesmo cálculo do portal do contabilista
--  (_accountant_bank_unmatched), mas chamável pelos membros do HQ, para o
--  Excel do contabilista trazer a folha «Banco sem lançamento».
--  (Miguel, 6 Out 2026: Excel com checklist do que falta.)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.hq_bank_unmatched(p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  select * from public._accountant_bank_unmatched(p_from, p_to)
$$;
revoke all on function public.hq_bank_unmatched(date, date) from public, anon;
grant execute on function public.hq_bank_unmatched(date, date) to authenticated;
