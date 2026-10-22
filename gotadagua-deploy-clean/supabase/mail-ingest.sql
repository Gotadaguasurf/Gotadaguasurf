-- ════════════════════════════════════════════════════════════════════════════
--  mail-ingest — invoices arrive by themselves (22 Oct 2026, wave 3 of
--  docs/PLANO-interface-e-automacao.md). The Edge Function
--  supabase/functions/mail-ingest reads the invoice mailboxes (read-only),
--  parses each PDF, routes it by the buyer's NIF, files it in the Drive folder
--  of the month, creates or completes the hq_invoices line and links the bank
--  debit. This file holds its tables, the bank matcher and the cron.
--
--    mail_ingest_account   one refresh token per mailbox (accounting@, cafe@…),
--                          written only by the function (Google consent).
--    mail_ingest_items     one row per message / attachment seen, with the
--                          outcome: inserted · linked · skipped · review · error.
--    hq_invoice_to_bank()  the invoice-side matcher: links the single unlinked
--                          debit of the same amount (−5/+25 days). Never for
--                          cash lines, never when two debits could match.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.mail_ingest_account (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  refresh_token     text not null,
  access_token      text,
  access_expires_at timestamptz,
  active            boolean not null default true,
  last_run_at       timestamptz,
  last_result       jsonb,
  updated_at        timestamptz not null default now()
);
alter table public.mail_ingest_account enable row level security;
drop policy if exists mail_ingest_account_none on public.mail_ingest_account;
create policy mail_ingest_account_none on public.mail_ingest_account for all to authenticated using (false) with check (false);

create table if not exists public.mail_ingest_items (
  id             uuid primary key default gen_random_uuid(),
  account_email  text not null,
  message_id     text not null,
  attachment_id  text not null default '-',
  filename       text,
  sha256         text,
  received_at    timestamptz,
  from_addr      text,
  subject        text,
  status         text not null check (status in ('seen','inserted','linked','skipped','review','error')),
  reason         text,
  company        text,
  hq_invoice_id  uuid references public.hq_invoices(id) on delete set null,
  bank_movement_id uuid,
  drive_file_id  text,
  drive_link     text,
  parsed         jsonb,
  gmail_link     text,
  decided_at     timestamptz,
  decided_by     text,
  created_at     timestamptz not null default now(),
  unique (message_id, attachment_id)
);
create index if not exists mail_ingest_items_status_idx on public.mail_ingest_items (status, created_at desc);
create index if not exists mail_ingest_items_sha_idx on public.mail_ingest_items (sha256);
alter table public.mail_ingest_items enable row level security;
drop policy if exists mail_ingest_items_hq_read on public.mail_ingest_items;
create policy mail_ingest_items_hq_read on public.mail_ingest_items for select to authenticated using (public.is_hq_member());

-- Manjar's Drive root (parent of the month folders), so the function can create
-- a month folder that does not exist yet. Water's root is already the '*' row.
insert into public.accountant_drive_folders (company, month_key, folder_id)
values ('manjar', '*', '16Uqrg_7gRZWBLWW4AriG2xvk-pSiMeiM')
on conflict do nothing;

-- the invoice-side bank matcher
create or replace function public.hq_invoice_to_bank(p_invoice uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare i record; v_id uuid; v_n int;
begin
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  select * into i from hq_invoices where id = p_invoice and deleted_at is null;
  if i is null or i.payment_type = 'Cash' or coalesce(i.amount_eur, 0) <= 0 then return null; end if;
  if exists (select 1 from hq_bank_movements where hq_invoice_id = p_invoice) then return null; end if;
  select count(*), min(id) into v_n, v_id from hq_bank_movements b
   where b.paying_company = coalesce(i.paying_company, 'water-movements') and b.kind = 'expense' and b.amount < 0
     and b.hq_invoice_id is null and b.internal_transfer_id is null
     and abs(-b.amount - i.amount_eur) < 0.011
     and b.movement_date between i.invoice_date - 5 and i.invoice_date + 25
     and b.description not ilike 'LOTE TRF CRED SEPA%'
     and coalesce(b.notes, '') not ilike '[sem fatura%' and coalesce(b.notes, '') not like '[ativo%'
     and coalesce(b.notes, '') not like '[financiamento%' and coalesce(b.notes, '') not like '[devolução%';
  if v_n <> 1 then return null; end if;
  update hq_bank_movements set hq_invoice_id = p_invoice where id = v_id;
  return v_id;
end $$;
revoke all on function public.hq_invoice_to_bank(uuid) from public, anon;
grant execute on function public.hq_invoice_to_bank(uuid) to authenticated;

-- cron: every 30 minutes, 07–22 h UTC. The secret is substituted by the deploy
-- script (never commit the real value here).
select cron.unschedule(jobid) from cron.job where jobname = 'mail-ingest-30min';
select cron.schedule('mail-ingest-30min', '*/30 7-22 * * *', $$
  select net.http_post(
    url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/mail-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mail-ingest-secret', '__MAIL_INGEST_SECRET__'),
    body    := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);

select json_build_object(
  'tables', (select json_agg(table_name) from information_schema.tables where table_schema = 'public' and table_name like 'mail_ingest%'),
  'cron', (select json_agg(json_build_object('name', jobname, 'schedule', schedule)) from cron.job where jobname = 'mail-ingest-30min'),
  'manjar_root', (select folder_id from accountant_drive_folders where company = 'manjar' and month_key = '*')
) j;
