-- ════════════════════════════════════════════════════════════════════════════
--  CRM DRIP CAMPAIGNS — server-side email queue that can't get the account
--  blocked and doesn't die when the browser tab closes.
--
--  Why: the old batch send looped in the BROWSER at 1 email/second. 200
--  emails in ~3.5 minutes from one mailbox is exactly the burst pattern
--  Google's abuse heuristics flag. And closing the tab killed the batch
--  halfway with no record of where it stopped.
--
--  New model (like Pipedrive/Instantly):
--    • The client renders the emails and inserts them as email_queue rows.
--    • A cron-invoked Edge Function (email-dispatch, every 5 min) sends a
--      FEW per run with spacing, only inside the send window, respecting
--      per-campaign and global daily caps.
--    • If the contact replies mid-campaign, their remaining queued emails
--      are skipped automatically (stop_on_reply).
--
--  Safe daily volumes for outreach from one Google Workspace mailbox:
--    hard Google limit 2,000/day, but cold-outreach safe zone is 50–150/day.
--    Defaults here: campaign cap 80/day, global cap 150/day across
--    everything (campaigns + manual sends).
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Campaigns ────────────────────────────────────────────────────────
create table if not exists public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  sender_user_id  uuid,                          -- team_users.id whose name goes on From:
  status          text not null default 'running'
                  check (status in ('running','paused','done','cancelled')),
  daily_cap       int  not null default 80,      -- max sends per day for THIS campaign
  window_start    time not null default '08:30', -- local send window
  window_end      time not null default '19:30',
  timezone        text not null default 'Europe/Lisbon',
  stop_on_reply   boolean not null default true,
  template_name   text,
  created_by      text,                          -- email of the user who launched it
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── 2. Queue rows (one per recipient, content rendered at queue time) ──
create table if not exists public.email_queue (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.email_campaigns(id) on delete cascade,
  company_id      uuid,                          -- outreach_contacts.id
  contact_id      uuid,                          -- outreach_people.id (nullable)
  to_email        text not null,
  subject         text not null,
  body            text not null,
  status          text not null default 'pending'
                  check (status in ('pending','sent','failed','skipped','cancelled')),
  error           text,
  provider_msg_id text,
  thread_id       text,
  attempts        int not null default 0,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_email_queue_dispatch
  on public.email_queue (status, campaign_id, created_at);
create index if not exists idx_email_queue_campaign
  on public.email_queue (campaign_id);

-- ── 3. RLS — CRM team can read + manage campaigns; queue writes happen
--      from the client at launch (rendered rows) and from the dispatcher
--      (service role bypasses RLS). Mirrors outreach_contacts's model:
--      any authenticated platform user with CRM access works with these.
alter table public.email_campaigns enable row level security;
alter table public.email_queue     enable row level security;

drop policy if exists "campaigns_all_authenticated" on public.email_campaigns;
create policy "campaigns_all_authenticated" on public.email_campaigns
  for all to authenticated using (true) with check (true);

drop policy if exists "queue_all_authenticated" on public.email_queue;
create policy "queue_all_authenticated" on public.email_queue
  for all to authenticated using (true) with check (true);

-- ── 4. updated_at touch trigger on campaigns ───────────────────────────
create or replace function public.fn_touch_email_campaign()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tr_touch_email_campaign on public.email_campaigns;
create trigger tr_touch_email_campaign
  before update on public.email_campaigns
  for each row execute function public.fn_touch_email_campaign();

-- ── 5. Cron: run the dispatcher every 5 minutes ─────────────────────────
--      Same pattern as gmail-sync-5min. The function is deployed with
--      --no-verify-jwt; it self-authorizes via service-role internals and
--      does nothing unless there are running campaigns with pending rows.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'email-dispatch-5min') then
    perform cron.unschedule('email-dispatch-5min');
  end if;
end $$;

select cron.schedule(
  'email-dispatch-5min',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://wnksmcjqnbxaagyhfxlt.supabase.co/functions/v1/email-dispatch',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

-- Verify
select jobid, jobname, schedule from cron.job where jobname = 'email-dispatch-5min';
