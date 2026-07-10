-- ════════════════════════════════════════════════════════════════════════════
--  SCHEDULE HQ WEEKLY DIGEST via pg_cron
-- ════════════════════════════════════════════════════════════════════════════
--
--  Runs the hq-weekly-digest Edge Function every Monday morning so Miguel
--  wakes up to the previous full Mon–Sun business summary in his inbox.
--
--  Prerequisites (deploy in this order):
--    1. Deploy the Edge Function via `supabase functions deploy hq-weekly-digest`
--    2. Set the secret DIGEST_TO_EMAIL if the default (miguel@gotadaguasurf.com)
--       isn't right, plus GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
--       (those two are already set for gmail-send — same values).
--    3. Fill SERVICE_ROLE_KEY below, then run this SQL in the Supabase editor.
--
--  Idempotent — safe to re-run if you change the schedule.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'gotadagua_hq_weekly_digest') then
    perform cron.unschedule('gotadagua_hq_weekly_digest');
  end if;
end;
$$;

-- Schedule: Mondays at 08:00 UTC (~09:00 Lisbon winter, 09:00 Lisbon summer).
-- cron syntax: minute hour day-of-month month day-of-week (0=Sun, 1=Mon).
select cron.schedule(
  'gotadagua_hq_weekly_digest',
  '0 8 * * 1',
  $$
  select net.http_post(
    url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/hq-weekly-digest',
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
--
-- Confirm the schedule is set:
--   select jobname, schedule, active from cron.job where jobname = 'gotadagua_hq_weekly_digest';
--
-- Preview the digest HTML in the browser without sending:
--   curl -H "Authorization: Bearer SERVICE_ROLE_KEY_HERE" \
--        'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/hq-weekly-digest?preview=1' \
--        -o /tmp/digest.html && open /tmp/digest.html
--
-- Send a one-off test to yourself:
--   curl -X POST -H "Authorization: Bearer SERVICE_ROLE_KEY_HERE" \
--        -H "Content-Type: application/json" \
--        -d '{"to":"miguel@gotadaguasurf.com"}' \
--        'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/hq-weekly-digest'
--
-- See last firings:
--   select jobid, runid, return_message, status, start_time
--   from cron.job_run_details
--   join cron.job using (jobid)
--   where jobname = 'gotadagua_hq_weekly_digest'
--   order by start_time desc limit 5;
-- ════════════════════════════════════════════════════════════════════════════
