-- ════════════════════════════════════════════════════════════════════════════
--  CRM audit fixes, 18 Nov 2026 (crm-03, crm-04, crm-05 / SEC-04)
--
--  Part 1 runs as is: safe to run more than once, changes no existing data.
--  Parts 2 and 3 are COMMENTED OUT: each one waits for Miguel's yes.
--
--  The page and both Edge Functions already work without this file:
--  gmail-sync falls back to an in-memory list while gmail_sync_seen does not
--  exist (fewer re-downloads only while one instance stays warm).
-- ════════════════════════════════════════════════════════════════════════════


-- ── Part 1 · gmail_sync_seen (crm-03) ──────────────────────────────────────
-- Gmail messages gmail-sync looked at and left out of email_messages
-- (newsletters, mail from people not in the CRM, bounce notices). Without
-- it every such message was downloaded in full again on every 5-minute run
-- for a week, all at once, next to the campaign sender's Gmail quota.
--   addr   the address that matched nobody; when a contact with that address
--          is added later, the message is looked at once more and imported.
-- Only the Edge Function (service role) reads or writes it: RLS on, no policy.
create table if not exists public.gmail_sync_seen (
  provider_msg_id text primary key,
  reason          text,
  addr            text,
  seen_at         timestamptz not null default now()
);
create index if not exists gmail_sync_seen_seen_at_idx on public.gmail_sync_seen (seen_at);
alter table public.gmail_sync_seen enable row level security;
revoke all on public.gmail_sync_seen from anon, authenticated;
comment on table public.gmail_sync_seen is
  'gmail-sync: Gmail ids already looked at and not stored in email_messages, so they are not downloaded again (audit 18 Nov 2026, crm-03). Service role only.';


-- ── Part 2 · one-off clean-up of repeated bounce lines (crm-04) ────────────
-- FOR MIGUEL TO APPROVE. Not run.
-- Until the fix, gmail-sync wrote the same «email_bounced» line on every run
-- while the bounce notice stayed in the inbox. Read-only count on
-- 18 Nov 2026 17:56 UTC: 11,425 such rows for 89 contacts; this keeps the
-- FIRST line per contact and address (89 rows) and deletes 11,336.
-- outreach_activity has only an AFTER INSERT trigger and no foreign keys
-- pointing at it, so deleting touches nothing else.
-- Run the SELECT first; if it no longer says 11336, stop and ask.
--
-- select count(*) from public.outreach_activity a
--  where a.action = 'email_bounced' and a.created_by = 'gmail-sync-server'
--    and exists (select 1 from public.outreach_activity b
--                 where b.contact_id = a.contact_id and b.action = 'email_bounced'
--                   and b.created_by = 'gmail-sync-server'
--                   and lower(coalesce(b.meta->>'email','')) = lower(coalesce(a.meta->>'email',''))
--                   and (b.created_at, b.id) < (a.created_at, a.id));
--
-- begin;
-- delete from public.outreach_activity a
--  where a.action = 'email_bounced' and a.created_by = 'gmail-sync-server'
--    and exists (select 1 from public.outreach_activity b
--                 where b.contact_id = a.contact_id and b.action = 'email_bounced'
--                   and b.created_by = 'gmail-sync-server'
--                   and lower(coalesce(b.meta->>'email','')) = lower(coalesce(a.meta->>'email',''))
--                   and (b.created_at, b.id) < (a.created_at, a.id));
-- -- expect: DELETE 11336
-- commit;


-- ── Part 3 · cron jobs send the shared secret (crm-05 / SEC-04) ────────────
-- Step 2 of the staged rollout (see the report): run ONLY after the secret
-- CRM_CRON_SECRET is set on both functions (step 1). Replace
-- __CRM_CRON_SECRET__ with the same value in the SQL editor; never commit it.
-- While ENFORCE_CRON_SECRET is not 'true' the header is simply ignored, so
-- this changes nothing until step 4.
--
-- select cron.unschedule('gmail-sync-5min');
-- select cron.schedule('gmail-sync-5min', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/gmail-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRM_CRON_SECRET__'),
--     body    := '{}'::jsonb,
--     timeout_milliseconds := 60000
--   );
-- $$);
-- select cron.unschedule('email-dispatch-5min');
-- select cron.schedule('email-dispatch-5min', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/email-dispatch',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRM_CRON_SECRET__'),
--     body    := '{}'::jsonb,
--     timeout_milliseconds := 120000
--   );
-- $$);
