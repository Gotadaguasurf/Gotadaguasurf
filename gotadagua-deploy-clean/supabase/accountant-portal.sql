-- ════════════════════════════════════════════════════════════════════════════
--  accountant-portal — página só de leitura para a contabilista (Goretti)
-- ════════════════════════════════════════════════════════════════════════════
--  Miguel, 6 Out 2026: "era bom ter mensal, com o link para as drives do mês
--  (partners, expenses…) e uma folha com checks do que já está e do que falta".
--
--  A página /contabilista/?k=<token> não tem login: abre com um link privado.
--  Por isso nada aqui dá acesso direto às tabelas — só três funções
--  SECURITY DEFINER que validam o token e devolvem o mínimo:
--    accountant_portal(token)              → resumo por mês + links das pastas
--    accountant_portal_month(token, mês)   → linhas do mês (despesas + vendas)
--    accountant_mark_month(token, mês, …)  → a Goretti marca o mês como visto
--  Só Water Movements (o Manjar fica só na Drive). Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Tokens (um por pessoa; desativar = active=false)
create table if not exists public.accountant_portal_tokens (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  label      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen  timestamptz
);
alter table public.accountant_portal_tokens enable row level security;
-- sem políticas: só as funções (security definer) e o service role lhe tocam

-- 2. Pastas da Drive por mês
create table if not exists public.accountant_drive_folders (
  company   text not null,          -- 'water-movements' | 'manjar' | 'partners'
  month_key text not null,          -- '2026-09' ou '*' (pasta fixa)
  folder_id text not null,
  primary key (company, month_key)
);
alter table public.accountant_drive_folders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='accountant_drive_folders' and policyname='adf_auth_all') then
    create policy adf_auth_all on public.accountant_drive_folders for all to authenticated using (true) with check (true);
  end if;
end $$;

insert into public.accountant_drive_folders (company, month_key, folder_id) values
  ('water-movements','2026-01','1fnWV3ugNEi-FzmvFYWE45iLiySAsaREM'),
  ('water-movements','2026-02','1OiLYbv19jqE6cAPwBI9_Se6GiWr4ilq-'),
  ('water-movements','2026-03','1QGmOeLTYLdPZqqBghXCRDd1ugj1_5WGF'),
  ('water-movements','2026-04','1w70LwLzpZO1Z7ygBaUG0HcTsZ9qI4d6v'),
  ('water-movements','2026-05','1NPddl5mtZCOJBCLcKBvVkxkrRls5wxsy'),
  ('water-movements','2026-06','1MhHustVDwDIbzKh2muDZAVWlqkKPjL3z'),
  ('water-movements','2026-07','1ZppBvN0Z5jW0aFKRpAqR0kW9rqGNbRTt'),
  ('water-movements','2026-08','1qJdpQYjs6c4uXKHsIyXZKgKc_6_V_3lZ'),
  ('water-movements','2026-09','10LT1OXzS9vOjAHPYnfmAwbMLDAELgbBC'),
  ('water-movements','2026-10','1WX2bR9HZJzq57USlNPW2enet_cSuEdRk'),
  ('manjar','2026-01','1RI9sO06X3dBS0GJQVy-WXi7eI6jkGma2'),
  ('manjar','2026-02','1_E4p_NsGyThAkcrxemR8R7yDYLRoqriF'),
  ('manjar','2026-03','1TPN0onYlLnErTmxQ9kuotqsaNALs0COp'),
  ('manjar','2026-04','1qk1oXHrkP-A6hi1AOUUNag6my-1xQwmp'),
  ('manjar','2026-05','101q3pnGrfupyTcmUXFs2ninmYmnKbez4'),
  ('manjar','2026-06','1FN34SR0NAvuQjBFsC_2xjyCiWwGu8ZJg'),
  ('manjar','2026-07','1bIK42K-tSEVvJxQ6kGR096KQvbEa20mm'),
  ('manjar','2026-08','1eq6OtS4_R-lQLsKoI5IE5Q1KVP5pwJO9'),
  ('manjar','2026-09','1Y7IpE5Bq1pBbYMdberBGnhW-77yf3ZNd'),
  ('manjar','2026-10','1RDGhibdH7fPy1UUataR0_BHvKN0ixL_Q'),
  ('partners','*','1uysKzoXLk2NBryHlvezCCcgVC8YMJHl2'),
  ('water-movements','*','10plNGyUBfVUnde4U9kKe-QyzllbkYGH4')
on conflict (company, month_key) do update set folder_id = excluded.folder_id;

-- 3. "Não há fatura" (comissões do banco, cartão refeição, levantamentos…)
alter table public.hq_invoices add column if not exists doc_exempt_reason text;

update public.hq_invoices set doc_exempt_reason = 'Comissões bancárias (estão no extrato)'
 where doc_exempt_reason is null and drive_link is null and company ilike 'santander (comiss%';
update public.hq_invoices set doc_exempt_reason = 'Cartão refeição (lote bancário, recibos de vencimento)'
 where doc_exempt_reason is null and drive_link is null and company ilike 'cartao refeicao%';
update public.hq_invoices set doc_exempt_reason = 'Levantamento de numerário'
 where doc_exempt_reason is null and drive_link is null and company ilike 'levantamento de numer%';

-- 4. Marca "visto" da contabilista por mês
create table if not exists public.accountant_month_marks (
  month_key  text primary key,
  seen       boolean not null default false,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.accountant_month_marks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='accountant_month_marks' and policyname='amm_auth_read') then
    create policy amm_auth_read on public.accountant_month_marks for select to authenticated using (true);
  end if;
end $$;

-- 5. Funções
create or replace function public._accountant_check(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  select label into v_label from accountant_portal_tokens where token = p_token and active;
  if v_label is null then raise exception 'link inválido' using errcode = '28000'; end if;
  update accountant_portal_tokens set last_seen = now() where token = p_token;
  return v_label;
end $$;
revoke all on function public._accountant_check(text) from public, anon, authenticated;

-- Linhas da Water que contam (mesmo critério do pacote 📦 Contabilista)
create or replace view public._accountant_rows as
  select i.*, to_char(i.invoice_date, 'YYYY-MM') as month_key,
         case when i.drive_link is not null then 'ok'
              when i.doc_exempt_reason is not null then 'isento'
              else 'falta' end as doc_status
    from hq_invoices i
   where i.deleted_at is null
     and coalesce(i.is_duplicate, false) = false
     and coalesce(i.paying_company, 'water-movements') = 'water-movements'
     and i.invoice_date >= date '2026-01-01';
revoke all on public._accountant_rows from public, anon, authenticated;

create or replace function public.accountant_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_label text; v jsonb;
begin
  v_label := _accountant_check(p_token);
  with months as (
    select to_char(m, 'YYYY-MM') as month_key
      from generate_series(date '2026-01-01', date_trunc('month', current_date), interval '1 month') m
  ), agg as (
    select month_key,
           count(*)                                         as linhas,
           count(*) filter (where doc_status = 'ok')        as com_doc,
           count(*) filter (where doc_status = 'isento')    as isentas,
           count(*) filter (where doc_status = 'falta')     as em_falta,
           round(sum(coalesce(amount_eur, amount)), 2)      as total_eur,
           round(sum(coalesce(amount_eur, amount)) filter (where doc_status = 'falta'), 2) as falta_eur
      from _accountant_rows group by month_key
  ), vendas as (
    select to_char(invoice_date, 'YYYY-MM') as month_key, count(*) as n, round(sum(amount), 2) as total
      from partner_invoices where invoice_date >= date '2026-01-01' group by 1
  )
  select jsonb_build_object(
    'label', v_label,
    'generated_at', now(),
    'folders', (select jsonb_object_agg(company, folder_id) from accountant_drive_folders where month_key = '*'),
    'months', coalesce(jsonb_agg(jsonb_build_object(
        'month_key', m.month_key,
        'linhas', coalesce(a.linhas, 0), 'com_doc', coalesce(a.com_doc, 0),
        'isentas', coalesce(a.isentas, 0), 'em_falta', coalesce(a.em_falta, 0),
        'total_eur', coalesce(a.total_eur, 0), 'falta_eur', coalesce(a.falta_eur, 0),
        'vendas', coalesce(v.n, 0), 'vendas_eur', coalesce(v.total, 0),
        'water_folder', (select folder_id from accountant_drive_folders f where f.company = 'water-movements' and f.month_key = m.month_key),
        'manjar_folder', (select folder_id from accountant_drive_folders f where f.company = 'manjar' and f.month_key = m.month_key),
        'seen', coalesce(k.seen, false), 'seen_note', k.note, 'seen_at', k.updated_at
      ) order by m.month_key desc), '[]'::jsonb)
  ) into v
  from months m
  left join agg a on a.month_key = m.month_key
  left join vendas v on v.month_key = m.month_key
  left join accountant_month_marks k on k.month_key = m.month_key;
  return v;
end $$;

create or replace function public.accountant_portal_month(p_token text, p_month text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _accountant_check(p_token);
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'mês inválido'; end if;
  return jsonb_build_object(
    'month_key', p_month,
    'despesas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'data', invoice_date, 'fornecedor', company, 'nif', supplier_nif,
               'numero', invoice_number, 'descricao', left(description, 160),
               'valor', amount, 'moeda', coalesce(currency, 'EUR'), 'valor_eur', coalesce(amount_eur, amount),
               'categoria', category_name, 'link', drive_link,
               'estado', doc_status, 'motivo', doc_exempt_reason)
             order by doc_status = 'ok', invoice_date, company)
        from _accountant_rows where month_key = p_month), '[]'::jsonb),
    'vendas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'data', invoice_date, 'parceiro', partner_name, 'numero', invoice_number,
               'valor', amount, 'link', drive_link, 'reservas_de', month_key, 'pais', location)
             order by invoice_date, invoice_number)
        from partner_invoices where to_char(invoice_date, 'YYYY-MM') = p_month), '[]'::jsonb),
    'mark', (select to_jsonb(k) from accountant_month_marks k where k.month_key = p_month)
  );
end $$;

create or replace function public.accountant_mark_month(p_token text, p_month text, p_seen boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  v_label := _accountant_check(p_token);
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'mês inválido'; end if;
  insert into accountant_month_marks (month_key, seen, note, updated_at, updated_by)
  values (p_month, p_seen, left(p_note, 500), now(), v_label)
  on conflict (month_key) do update set seen = excluded.seen, note = excluded.note,
    updated_at = now(), updated_by = excluded.updated_by;
  return (select to_jsonb(k) from accountant_month_marks k where k.month_key = p_month);
end $$;

grant execute on function public.accountant_portal(text) to anon, authenticated;
grant execute on function public.accountant_portal_month(text, text) to anon, authenticated;
grant execute on function public.accountant_mark_month(text, text, boolean, text) to anon, authenticated;

-- 6. Link da Goretti (corre uma vez; o token aparece no resultado)
insert into public.accountant_portal_tokens (label)
select 'Goretti (Escala de Palavras)'
 where not exists (select 1 from public.accountant_portal_tokens where label like 'Goretti%');

-- ════════════════════════════════════════════════════════════════════════════
--  7. Banco: débitos do Santander sem lançamento na app (Miguel, 6 Out 2026:
--     "ver o que falta exatamente do banco e as faturas")
--  Um débito conta como lançado se: está ligado (hq_invoice_id), OU há uma
--  linha com o mesmo valor entre 15 dias antes e 5 depois, OU a soma das
--  linhas do mesmo fornecedor no mesmo dia dá o valor (recibos de instrutores
--  repartidos por local). Comissões, liquidações do cartão e transferências
--  internas ficam de fora (kind ≠ expense/other).
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
     and not exists (select 1 from inv i where abs(i.v - abs(b.amount)) < 0.011
                       and i.invoice_date between b.movement_date - 15 and b.movement_date + 5)
     and not exists (select 1 from grp g where abs(g.v - abs(b.amount)) < 0.011
                       and g.invoice_date between b.movement_date - 15 and b.movement_date + 5)
$$;
revoke all on function public._accountant_bank_unmatched(date, date) from public, anon, authenticated;

create or replace function public.accountant_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_label text; v jsonb;
begin
  v_label := _accountant_check(p_token);
  with months as (
    select to_char(m, 'YYYY-MM') as month_key, m::date as d0, (m + interval '1 month - 1 day')::date as d1
      from generate_series(date '2026-01-01', date_trunc('month', current_date), interval '1 month') m
  ), agg as (
    select month_key,
           count(*)                                         as linhas,
           count(*) filter (where doc_status = 'ok')        as com_doc,
           count(*) filter (where doc_status = 'isento')    as isentas,
           count(*) filter (where doc_status = 'falta')     as em_falta,
           round(sum(coalesce(amount_eur, amount)), 2)      as total_eur,
           round(sum(coalesce(amount_eur, amount)) filter (where doc_status = 'falta'), 2) as falta_eur
      from _accountant_rows group by month_key
  ), vendas as (
    select to_char(invoice_date, 'YYYY-MM') as month_key, count(*) as n, round(sum(amount), 2) as total
      from partner_invoices where invoice_date >= date '2026-01-01' group by 1
  ), banco as (
    select to_char(movement_date, 'YYYY-MM') as month_key, count(*) as n, round(sum(-amount), 2) as total
      from _accountant_bank_unmatched(date '2026-01-01', current_date) group by 1
  ), extrato as (
    select max(movement_date) as ate from hq_bank_movements where paying_company = 'water-movements'
  )
  select jsonb_build_object(
    'label', v_label,
    'generated_at', now(),
    'extrato_ate', (select ate from extrato),
    'folders', (select jsonb_object_agg(company, folder_id) from accountant_drive_folders where month_key = '*'),
    'months', coalesce(jsonb_agg(jsonb_build_object(
        'month_key', m.month_key,
        'linhas', coalesce(a.linhas, 0), 'com_doc', coalesce(a.com_doc, 0),
        'isentas', coalesce(a.isentas, 0), 'em_falta', coalesce(a.em_falta, 0),
        'total_eur', coalesce(a.total_eur, 0), 'falta_eur', coalesce(a.falta_eur, 0),
        'vendas', coalesce(v.n, 0), 'vendas_eur', coalesce(v.total, 0),
        'banco_sem', coalesce(bk.n, 0), 'banco_sem_eur', coalesce(bk.total, 0),
        'water_folder', (select folder_id from accountant_drive_folders f where f.company = 'water-movements' and f.month_key = m.month_key),
        'manjar_folder', (select folder_id from accountant_drive_folders f where f.company = 'manjar' and f.month_key = m.month_key),
        'seen', coalesce(k.seen, false), 'seen_note', k.note, 'seen_at', k.updated_at
      ) order by m.month_key desc), '[]'::jsonb)
  ) into v
  from months m
  left join agg a on a.month_key = m.month_key
  left join vendas v on v.month_key = m.month_key
  left join banco bk on bk.month_key = m.month_key
  left join accountant_month_marks k on k.month_key = m.month_key;
  return v;
end $$;

create or replace function public.accountant_portal_month(p_token text, p_month text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d0 date; d1 date;
begin
  perform _accountant_check(p_token);
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'mês inválido'; end if;
  d0 := to_date(p_month || '-01', 'YYYY-MM-DD');
  d1 := (d0 + interval '1 month - 1 day')::date;
  return jsonb_build_object(
    'month_key', p_month,
    'despesas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'data', invoice_date, 'fornecedor', company, 'nif', supplier_nif,
               'numero', invoice_number, 'descricao', left(description, 160),
               'valor', amount, 'moeda', coalesce(currency, 'EUR'), 'valor_eur', coalesce(amount_eur, amount),
               'categoria', category_name, 'link', drive_link,
               'estado', doc_status, 'motivo', doc_exempt_reason)
             order by doc_status = 'ok', invoice_date, company)
        from _accountant_rows where month_key = p_month), '[]'::jsonb),
    'vendas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'data', invoice_date, 'parceiro', partner_name, 'numero', invoice_number,
               'valor', amount, 'link', drive_link, 'reservas_de', month_key, 'pais', location)
             order by invoice_date, invoice_number)
        from partner_invoices where to_char(invoice_date, 'YYYY-MM') = p_month), '[]'::jsonb),
    'banco', coalesce((
      select jsonb_agg(jsonb_build_object('data', movement_date, 'descricao', description, 'valor', -amount)
             order by movement_date, amount)
        from _accountant_bank_unmatched(d0, d1)), '[]'::jsonb),
    'mark', (select to_jsonb(k) from accountant_month_marks k where k.month_key = p_month)
  );
end $$;

-- 8. Links para o HQ (só membros do HQ): o do Miguel e o da Goretti
create or replace function public.accountant_hq_links()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_hq_member() then raise exception 'sem acesso' using errcode = '42501'; end if;
  insert into accountant_portal_tokens (label)
  select 'HQ (Miguel)' where not exists (select 1 from accountant_portal_tokens where label = 'HQ (Miguel)');
  return jsonb_build_object(
    'hq', (select token from accountant_portal_tokens where label = 'HQ (Miguel)' and active limit 1),
    'goretti', (select token from accountant_portal_tokens where label like 'Goretti%' and active limit 1));
end $$;
revoke all on function public.accountant_hq_links() from public, anon;
grant execute on function public.accountant_hq_links() to authenticated;
