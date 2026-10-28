-- Fingerprint of the PDF/photo behind an expense (SHA-256 of the file bytes,
-- computed in the browser). The same file uploaded twice is then always
-- recognised, even when the invoice reader extracts the supplier or number
-- slightly differently (Miguel, 28 Oct 2026).
alter table public.hq_invoices add column if not exists file_sha256 text;
create index if not exists hq_invoices_file_sha256_idx on public.hq_invoices (file_sha256) where file_sha256 is not null and deleted_at is null;
