-- 22 Out 2026 — Miguel: «um só valor para cada número; nada que viva só num
-- browser». A % de comissão de vendas da Surf School (separador Vendas)
-- estava em localStorage (ss_sales_commission_pct): cada telemóvel mostrava
-- uma comissão diferente. Passa a viver aqui, uma linha por chave. A página
-- surf-school/ lê o valor ao abrir (e ao abrir o separador Vendas) e grava
-- (upsert) quando um gestor o muda; localStorage fica só como cache.
--
-- Leitura: qualquer login. Escrita: super_admin ou membro da workspace
-- surf-school com can_edit — a mesma regra que apaga rentals
-- (has_full_location_access, de tighten-rls-phase3-area-based.sql).
--
-- Idempotente; correr no SQL editor do Supabase.

create table if not exists public.surf_school_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.surf_school_settings is
  'Definições partilhadas da Surf School, uma linha por chave. sales_commission_pct = % de comissão dos vendedores (separador Vendas).';

alter table public.surf_school_settings enable row level security;

grant select, insert, update, delete on public.surf_school_settings to authenticated;

-- Qualquer login lê (a página carrega o valor para toda a gente).
drop policy if exists surf_school_settings_select on public.surf_school_settings;
create policy surf_school_settings_select on public.surf_school_settings
  for select to authenticated
  using (true);

-- Só quem tem edição plena na Surf School escreve.
drop policy if exists surf_school_settings_insert on public.surf_school_settings;
create policy surf_school_settings_insert on public.surf_school_settings
  for insert to authenticated
  with check (public.has_full_location_access((select id from public.locations where slug = 'surf-school')));

drop policy if exists surf_school_settings_update on public.surf_school_settings;
create policy surf_school_settings_update on public.surf_school_settings
  for update to authenticated
  using      (public.has_full_location_access((select id from public.locations where slug = 'surf-school')))
  with check (public.has_full_location_access((select id from public.locations where slug = 'surf-school')));

drop policy if exists surf_school_settings_delete on public.surf_school_settings;
create policy surf_school_settings_delete on public.surf_school_settings
  for delete to authenticated
  using (public.has_full_location_access((select id from public.locations where slug = 'surf-school')));

-- Valor inicial = o que a página assumia quando não havia nada guardado (0 %).
-- Só entra se a chave ainda não existir; nunca pisa um valor já definido.
insert into public.surf_school_settings (key, value)
values ('sales_commission_pct', '0'::jsonb)
on conflict (key) do nothing;

-- Sanity check
select key, value, updated_at from public.surf_school_settings order by key;
