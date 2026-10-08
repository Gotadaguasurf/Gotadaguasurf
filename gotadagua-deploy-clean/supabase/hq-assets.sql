-- ════════════════════════════════════════════════════════════════════════════
--  hq_assets + hq_asset_income — área "Assets" do HQ (Miguel, 8 Out 2026:
--  "bora fazer essa área de imóveis/investimentos... mete o total... e também
--  a renda que nos pagam").
--
--  Fora do P&L: comprar um imóvel ou a carrinha não é despesa do mês. A loja
--  de investimento, as casas em leasing (CGD e Santander), a casa do sócio
--  que arrendamos e a carrinha do Junior Camp ficam aqui com o custo total.
--  Os pagamentos de leasing/renda NÃO se repetem aqui: a aba soma as linhas
--  de hq_invoices (categoria Rent) cujo `company` bate com `expense_match`.
--  As rendas que nos pagam (ex.: inquilino da loja, entram na CGD) vivem em
--  hq_asset_income. Soft-delete como o resto do HQ.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.hq_assets (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'property' check (kind in ('property','vehicle','equipment','other')),
  holding         text not null default 'owned'    check (holding in ('owned','leasing','rented')),
  name            text not null,
  address         text,
  location_slug   text,
  acquired_on     date,
  purchase_price  numeric(12,2),
  imt             numeric(12,2),
  stamp_duty      numeric(12,2),
  other_costs     numeric(12,2),
  lender          text,
  contract_no     text,
  down_payment    numeric(12,2),
  monthly_payment numeric(12,2),
  term_end        date,
  residual_value  numeric(12,2),
  debt_amount     numeric(12,2),
  debt_as_of      date,
  expense_match   text,          -- padrão ilike para hq_invoices.company (categoria Rent)
  tenant          text,
  monthly_rent    numeric(12,2), -- renda que NOS pagam
  drive_link      text,
  notes           text,
  sort_order      int not null default 100,
  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      text
);

create table if not exists public.hq_asset_income (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.hq_assets(id),
  received_on date not null,
  amount      numeric(12,2) not null,
  payer       text,
  bank        text default 'cgd',
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  text,
  deleted_at  timestamptz,
  deleted_by  text
);
create index if not exists hq_asset_income_asset_idx on public.hq_asset_income(asset_id, received_on);

alter table public.hq_assets enable row level security;
alter table public.hq_asset_income enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='hq_assets' and policyname='hq_assets_members') then
    create policy hq_assets_members on public.hq_assets for all to authenticated
      using (public.is_hq_member()) with check (public.is_hq_member());
  end if;
  if not exists (select 1 from pg_policies where tablename='hq_asset_income' and policyname='hq_asset_income_members') then
    create policy hq_asset_income_members on public.hq_asset_income for all to authenticated
      using (public.is_hq_member()) with check (public.is_hq_member());
  end if;
end $$;
