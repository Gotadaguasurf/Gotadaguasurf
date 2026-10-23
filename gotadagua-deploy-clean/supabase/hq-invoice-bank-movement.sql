-- One bank movement can pay several expense lines (salary / meal-card lots, two invoices in one
-- transfer, instructor receipts split by location). hq_bank_movements.hq_invoice_id keeps the
-- one-to-one link; hq_invoices.bank_movement_id points the OTHER lines of the same payment to it.
-- The HQ Expenses «Bank» column reads both. (23 Oct 2026)
alter table public.hq_invoices add column if not exists bank_movement_id uuid references public.hq_bank_movements(id) on delete set null;
create index if not exists hq_invoices_bank_movement_id_idx on public.hq_invoices (bank_movement_id);
