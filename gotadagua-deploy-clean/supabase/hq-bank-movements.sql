-- hq_bank_movements — the Santander statement, line by line.
--
-- Why: the statement was only ever kept in scratch files, so the app could
-- not show it or hand it to the accountant. Every line of `Movimentos_DO.xls`
-- lands here untouched; expenses stay in hq_invoices and camp funding in
-- internal_transfers. `kind` says which of those a line belongs to, so a
-- reconciliation never reports camp funding or card settlements as missing.
--
-- Additive and idempotent: safe to run more than once.

create table if not exists public.hq_bank_movements (
  id                   uuid primary key default gen_random_uuid(),
  paying_company       text not null default 'water-movements',
  bank                 text not null default 'santander',
  movement_date        date not null,
  value_date           date,
  description          text not null,
  amount               numeric(14,2) not null,          -- negative = debit
  currency             text not null default 'EUR',
  balance              numeric(14,2),
  kind                 text not null default 'expense'
                       check (kind in ('expense','internal_transfer','bank_fee',
                                       'card_settlement','income','other')),
  hq_invoice_id        uuid references public.hq_invoices(id) on delete set null,
  internal_transfer_id uuid references public.internal_transfers(id) on delete set null,
  seq                  integer not null default 1,      -- nth identical line of the day
  notes                text,
  created_at           timestamptz not null default now(),
  created_by           uuid
);

-- Two identical lines on the same day are real (seven meal-card lots of
-- 214,20); `seq` keeps them apart while still making a re-import a no-op.
create unique index if not exists hq_bank_movements_uniq
  on public.hq_bank_movements (paying_company, bank, movement_date, amount, description, seq);
create index if not exists hq_bank_movements_date on public.hq_bank_movements (movement_date);

alter table public.hq_bank_movements enable row level security;

drop policy if exists "hq_bank_movements read"  on public.hq_bank_movements;
drop policy if exists "hq_bank_movements write" on public.hq_bank_movements;
create policy "hq_bank_movements read"  on public.hq_bank_movements
  for select to authenticated using (is_hq_member());
create policy "hq_bank_movements write" on public.hq_bank_movements
  for all to authenticated using (is_hq_member()) with check (is_hq_member());
