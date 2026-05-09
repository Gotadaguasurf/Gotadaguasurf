-- ════════════════════════════════════════════════════════════════════════════
--  SCHEDULE DAILY BACKUP via pg_cron + Supabase Storage bucket setup
-- ════════════════════════════════════════════════════════════════════════════
--
--  This file does three things:
--    1. Ensures the `backups` Storage bucket exists and is private.
--    2. Enables pg_cron + pg_net extensions (needed to schedule HTTP calls).
--    3. Schedules the daily-backup Edge Function to run every day at 03:00 UTC.
--
--  Run this AFTER you deploy the daily-backup Edge Function via the Supabase
--  Dashboard. If you deploy this SQL first, the cron will fire but the
--  function URL will return 404 until you deploy.
--
--  Idempotent — safe to re-run if you change the schedule.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Create private Storage bucket for backups ──────────────────────────
-- (Idempotent: ignores conflict if the bucket already exists.)
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- Lock it down: only service role can read/write. RLS on storage.objects
-- already defaults to denying anon/authenticated for non-public buckets,
-- so no extra policy is strictly required, but we make the intent explicit.
-- (The Edge Function uses SERVICE_ROLE_KEY which bypasses these.)
drop policy if exists "backups_no_public_access" on storage.objects;
create policy "backups_no_public_access" on storage.objects
  for all to authenticated, anon
  using (bucket_id <> 'backups')
  with check (bucket_id <> 'backups');

-- ── 2. Enable pg_cron + pg_net extensions ─────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 3. Schedule the cron job ──────────────────────────────────────────────
-- IMPORTANT: edit the two values below before running.
--   project_url       → your project URL: https://wnksmcjqnbxaagyhfxlt.supabase.co
--   service_role_key  → Supabase Dashboard → Project Settings → API → service_role key
--                       (KEEP THIS SECRET — it lives only in this SQL run, not in client code)

-- Remove any previous schedule so re-running this file is idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gotadagua_daily_backup') then
    perform cron.unschedule('gotadagua_daily_backup');
  end if;
end;
$$;

-- Schedule: every day at 03:00 UTC (~04:00 Lisbon DST, ~08:30 Sri Lanka).
-- pg_cron syntax is standard cron — '0 3 * * *' = minute 0, hour 3.
select cron.schedule(
  'gotadagua_daily_backup',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer SERVICE_ROLE_KEY_GOES_HERE',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════

-- Confirm the schedule is set:
--   select jobname, schedule, active from cron.job where jobname = 'gotadagua_daily_backup';
--   Expected: 1 row, schedule = '0 3 * * *', active = true.

-- See last 10 cron firings:
--   select jobid, runid, return_message, status, start_time
--   from cron.job_run_details
--   join cron.job using (jobid)
--   where jobname = 'gotadagua_daily_backup'
--   order by start_time desc limit 10;

-- Manual fire (test that the wiring works without waiting for 03:00):
--   select net.http_post(
--     url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/daily-backup',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY_HERE',
--       'Content-Type',  'application/json'
--     )
--   );
--   Then check Storage → backups bucket → today's folder appears with
--   one .json per table + a _manifest.json.
-- ════════════════════════════════════════════════════════════════════════════
