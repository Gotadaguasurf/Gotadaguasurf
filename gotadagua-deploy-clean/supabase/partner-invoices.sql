-- ════════════════════════════════════════════════════════════════════════════
--  partner_invoices — sales invoices (InvoiceXpress FT IN2/…) issued to partners
-- ════════════════════════════════════════════════════════════════════════════
--  Miguel, 5 Oct 2026: "ter um link nos partners com as faturas da drive".
--  One row per invoice; the Drive file lives in "Partner INVOICES/<partner>".
--  The partners page will show invoice number + link on the partner month;
--  the daily Downloads task fills it in. Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.partner_invoices (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid references public.partners(id),
  partner_name   text not null,
  month_key      text not null,              -- bookings month, e.g. 2026-08
  invoice_number text not null unique,       -- FT IN2/16809
  invoice_date   date,
  amount         numeric(12,2),              -- total incl. IVA
  drive_link     text,
  file_name      text,
  location       text,                       -- optional: country/camp when the partner is invoiced per country (Kilroy)
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     text
);
create index if not exists partner_invoices_partner_month on public.partner_invoices(partner_id, month_key);
alter table public.partner_invoices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='partner_invoices' and policyname='partner_invoices_auth_read') then
    create policy partner_invoices_auth_read on public.partner_invoices for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='partner_invoices' and policyname='partner_invoices_auth_write') then
    create policy partner_invoices_auth_write on public.partner_invoices for all to authenticated using (true) with check (true);
  end if;
end $$;
