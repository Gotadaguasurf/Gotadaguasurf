-- ═══════════════════════════════════════════════════════════════════════════
--  drive-sync — controlo de ingestão da pasta de faturas do Google Drive
--
--  hq_drive_ingest: um registo por ficheiro do Drive alguma vez processado.
--  É o que garante que cada ficheiro entra UMA vez (dedup por drive_file_id)
--  e que falhas ficam visíveis (status='error') em vez de desaparecerem.
--
--  Correr no SQL Editor DEPOIS de deployar a função drive-sync.
--  Antes de correr: substituir COLOCA_AQUI_O_SEGREDO pelo mesmo valor que
--  definires em `supabase secrets set DRIVE_SYNC_SECRET=...`
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.hq_drive_ingest (
  drive_file_id text primary key,
  file_name     text not null,
  folder_name   text,
  status        text not null check (status in ('inserted','error','skipped')),
  invoice_id    uuid references public.hq_invoices(id) on delete set null,
  error         text,
  created_at    timestamptz not null default now()
);

alter table public.hq_drive_ingest enable row level security;

-- Escreve só o service role (a Edge Function); HQ pode ler para diagnóstico.
drop policy if exists hq_drive_ingest_select on public.hq_drive_ingest;
create policy hq_drive_ingest_select on public.hq_drive_ingest
  for select to authenticated using (public.is_hq_member());

-- Cron: 4x/dia (07:00, 12:00, 17:00, 21:00 UTC)
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'drive-sync-4x') then
    perform cron.unschedule('drive-sync-4x');
  end if;
end $$;

select cron.schedule(
  'drive-sync-4x',
  '0 7,12,17,21 * * *',
  $$
    select net.http_post(
      url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/drive-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-drive-sync-secret', 'COLOCA_AQUI_O_SEGREDO'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- Sanity
select jobid, jobname, schedule from cron.job where jobname = 'drive-sync-4x';
select count(*) as ficheiros_processados from public.hq_drive_ingest;
