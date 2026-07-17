-- ════════════════════════════════════════════════════════════════════════════
--  HQ INVOICES — soft-delete + audit trail
--
--  Before this, Delete in Despesas HQ hard-deleted the row AND the
--  attached file from storage — one misclick on financial records was
--  unrecoverable. Now:
--
--    • Delete    → stamps deleted_at + deleted_by; row hidden from every
--                  list/aggregate; file KEPT in storage.
--    • Restore   → clears the stamp; invoice reappears untouched.
--    • Purge     → ("Delete forever", from the Deleted view only) hard
--                  delete + storage cleanup, audit row survives.
--
--  hq_invoice_audit keeps a full JSONB snapshot of the row at delete
--  time — even a purged invoice can be reconstructed by hand from the
--  snapshot. invoice_id has NO foreign key on purpose: the audit must
--  outlive the row it describes.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.hq_invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

-- Partial index: every live query filters "deleted_at is null" now, so
-- index exactly that predicate.
create index if not exists idx_hq_invoices_not_deleted
  on public.hq_invoices (invoice_date desc)
  where deleted_at is null;

create table if not exists public.hq_invoice_audit (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null,          -- no FK: audit outlives purged rows
  action      text not null check (action in ('deleted','restored','purged')),
  actor       text,                   -- email of who clicked
  snapshot    jsonb,                  -- full row at delete time
  created_at  timestamptz not null default now()
);

create index if not exists idx_hq_invoice_audit_invoice
  on public.hq_invoice_audit (invoice_id, created_at desc);

alter table public.hq_invoice_audit enable row level security;

drop policy if exists "hq_invoice_audit_all_authenticated" on public.hq_invoice_audit;
create policy "hq_invoice_audit_all_authenticated" on public.hq_invoice_audit
  for all to authenticated using (true) with check (true);
