-- ════════════════════════════════════════════════════════════════════════════
--  CAMPAIGN STATS VIEW — reply rate per campaign, computed in the DB
--
--  A campaign "reply" = the company received a campaign email (queue row
--  status='sent') and ANY inbound message from that company landed AFTER
--  that send. Counted per distinct company so a chatty contact replying
--  four times doesn't inflate the rate.
--
--  Consumed by the CRM's Campaigns section (Sequences tab) to paint
--  "X replies · Y%" per campaign and the per-template rollup — that's how
--  you learn template A converts at 8% while template B does 2%.
--
--  security_invoker: the view runs with the CALLER's permissions, so the
--  same permissive authenticated policies that govern email_queue /
--  email_messages apply here — no accidental privilege escalation.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.email_campaign_stats
with (security_invoker = on) as
select
  c.id as campaign_id,
  count(q.id) filter (where q.status = 'sent') as sent_count,
  count(distinct q.company_id) filter (
    where q.status = 'sent'
      and exists (
        select 1
          from public.email_messages m
         where m.company_id = q.company_id
           and m.direction = 'inbound'
           and m.created_at > q.sent_at
      )
  ) as replied_count
from public.email_campaigns c
left join public.email_queue q on q.campaign_id = c.id
group by c.id;
