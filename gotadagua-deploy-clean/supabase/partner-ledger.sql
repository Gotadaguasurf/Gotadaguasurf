-- ════════════════════════════════════════════════════════════════════════════
--  partner_ledger — advances, payments and agreed corrections per partner
-- ════════════════════════════════════════════════════════════════════════════
--  Miguel, 13 Oct 2026: partners paid by advances (JUVIGO, Ocean Adventure)
--  need "o valor que temos por mês mas dependendo do que pagamos saber esse
--  valor que ainda temos em crédito". The partners page adds up the
--  commission the bookings generate month by month and sets it against the
--  rows here, so the running balance says how much credit is left or how
--  much is still owed.
--
--  amount is always seen from Gota's side:
--    kind 'payment'    → money that left our bank for the partner (> 0)
--    kind 'received'   → money the partner sent us (> 0)
--    kind 'adjustment' → agreed correction; > 0 is in our favour (less to
--                        pay / more credit), < 0 adds to what we owe
--  Only bank-confirmed money goes in as payment/received ("quando metes pago
--  tem mesmo de estar pago no banco"): bank + bank_ref say which movement.
--  applies_to (YYYY-MM) is the bookings month a row belongs to when it is not
--  the month of entry_date (e.g. a 2025 settlement paid in Feb 2026).
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.partner_ledger (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid references public.partners(id),
  partner_name     text not null,
  entry_date       date not null,
  kind             text not null check (kind in ('payment','received','adjustment')),
  amount           numeric(12,2) not null,
  applies_to       text,                       -- bookings month, e.g. 2025-12
  ref              text,                       -- partner invoice number, e.g. INV-010495
  bank             text,                       -- santander | cgd
  bank_movement_id uuid references public.hq_bank_movements(id),
  bank_ref         text,                       -- statement line as printed
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       text
);
create index if not exists partner_ledger_partner_date on public.partner_ledger(partner_name, entry_date);
alter table public.partner_ledger enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='partner_ledger' and policyname='partner_ledger_auth_read') then
    create policy partner_ledger_auth_read on public.partner_ledger for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='partner_ledger' and policyname='partner_ledger_auth_write') then
    create policy partner_ledger_auth_write on public.partner_ledger for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Rows are never hard-deleted from the page: "remove" sets deleted_at.
alter table public.partner_ledger add column if not exists deleted_at timestamptz;
