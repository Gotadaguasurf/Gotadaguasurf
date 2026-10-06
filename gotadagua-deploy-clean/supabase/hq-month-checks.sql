-- ════════════════════════════════════════════════════════════════════════════
--  hq_month_checks — os checks manuais do «Fecho do mês» (HQ): o que o
--  sistema não consegue saber sozinho (e-Fatura conferido, pacote enviado à
--  Goretti, Drive arrumada). Um registo por mês × item; quem e quando.
--  Miguel, 6 Out 2026.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.hq_month_checks (
  month_key text not null,
  item      text not null,
  done_at   timestamptz,
  done_by   text,
  note      text,
  updated_at timestamptz not null default now(),
  primary key (month_key, item)
);
alter table public.hq_month_checks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='hq_month_checks' and policyname='hmc_auth_all') then
    create policy hmc_auth_all on public.hq_month_checks for all to authenticated using (true) with check (true);
  end if;
end $$;
