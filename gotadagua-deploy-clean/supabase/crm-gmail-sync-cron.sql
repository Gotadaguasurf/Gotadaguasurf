-- ════════════════════════════════════════════════════════════════════════════
--  gmail-sync cron — schedule the inbox poll every 5 minutes
--
--  Uses pg_cron (managed Postgres) + pg_net (HTTP from inside Postgres) to
--  call the gmail-sync Edge Function on a 5-minute interval, regardless of
--  whether anyone has the CRM open in a browser. With this, a reply that
--  lands at 14:03 shows up in the CRM by 14:08 even if every team member's
--  laptop is closed.
--
--  Idempotent: drops the job first if it exists so re-running the SQL just
--  updates the schedule / URL.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any prior schedule so we don't end up with multiple jobs hitting the
-- same endpoint at slightly offset times.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gmail-sync-5min') then
    perform cron.unschedule('gmail-sync-5min');
  end if;
end $$;

-- Schedule: every 5 minutes. The function is deployed with --no-verify-jwt
-- so we don't need to inject a JWT here; the function's own
-- authorize-by-shared-mailbox-config gates who can write.
select cron.schedule(
  'gmail-sync-5min',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/gmail-sync',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Verify
select jobid, jobname, schedule, command
  from cron.job
 where jobname = 'gmail-sync-5min';
