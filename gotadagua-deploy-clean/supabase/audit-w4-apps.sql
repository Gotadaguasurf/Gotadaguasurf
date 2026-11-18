-- ════════════════════════════════════════════════════════════════════════════
--  Audit 18 Nov 2026, wave 4 (apps: CRM, hub, Prices, Instructors, Surf School)
--
--  Part 1 runs as is: safe to run more than once, changes no row.
--  Parts 2 to 6 are COMMENTED OUT: each one waits for Miguel's yes. Every
--  count below was read on 18 Nov 2026 with a read-only SELECT; run the
--  SELECT first and stop if the number changed.
--
--  Every page and both CRM Edge Functions already work without this file.
--  No names or addresses are written here (public repository): every
--  statement finds its rows by a rule, never by a person.
-- ════════════════════════════════════════════════════════════════════════════


-- ── Part 1 · campaign reply rate counts each reply once (crm-11) ──────────
-- A company was counted as «replied» by EVERY campaign that had emailed it
-- before any later inbound, so one answer was credited to the first email and
-- to each follow-up: the campaigns summed 195 replies from 143 companies. Now
-- a reply belongs to the most recent campaign email before it. Read-only check
-- on 18 Nov 2026: old rule 195, new rule 143 = the 143 companies that really
-- answered after a campaign. Same columns, same security_invoker.
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
           -- …and no later campaign email went to them before that reply
           and not exists (
             select 1 from public.email_queue q2
              where q2.company_id = q.company_id
                and q2.status = 'sent'
                and q2.sent_at > q.sent_at
                and q2.sent_at < m.created_at
           )
      )
  ) as replied_count
from public.email_campaigns c
left join public.email_queue q on q.campaign_id = c.id
group by c.id;


-- ── Part 2 · two «unsubscribe» replies that were missed (crm-08) ───────────
-- FOR MIGUEL TO APPROVE. Not run.
-- Two replies (15 and 17 Sep) whose first line is just «unsubscribe» were not
-- caught (the quoted original was not cut). Both companies were later set to
-- Lost by hand, nothing was sent to them since, but the addresses are not on
-- the do-not-email list. This adds them; it changes no company and no email.
-- Read-only count on 18 Nov 2026: 2. Stop if the SELECT says otherwise.
--
-- select count(*) from public.email_messages m
--  where m.direction = 'inbound'
--    and m.body ~* '^\s*(unsubscribe|remove me|stop emailing|opt.?out)[\s.!]*(\n|$)'
--    and not exists (select 1 from public.email_suppression s
--                     where s.email = lower(substring(m.from_addr from '[^<\s]+@[^>\s]+')));
--
-- insert into public.email_suppression (email, reason, detail, company_id, created_by)
-- select distinct lower(substring(m.from_addr from '[^<\s]+@[^>\s]+')), 'unsubscribe',
--        'replied «unsubscribe» (missed by the old reply reader; audit 18 Nov 2026)', m.company_id, 'audit-w4'
--   from public.email_messages m
--  where m.direction = 'inbound'
--    and m.body ~* '^\s*(unsubscribe|remove me|stop emailing|opt.?out)[\s.!]*(\n|$)'
-- on conflict (email) do nothing;
-- -- expect: INSERT 0 2


-- ── Part 3 · four companies «In conversation» only because of an out-of-office (crm-14) ──
-- FOR MIGUEL TO APPROVE. Not run.
-- gmail-sync moved them to In conversation when the only thing they sent was
-- an automatic answer. This puts each one back to the status it had before
-- that move (the old_value of the sync's own status_changed line) and logs it.
-- Read-only count on 18 Nov 2026: 4. Look at the list first.
--
-- with auto_only as (
--   select c.id,
--          (select a.old_value from public.outreach_activity a
--            where a.contact_id = c.id and a.action = 'status_changed'
--              and a.new_value = 'in_conversation' and a.created_by = 'gmail-sync-server'
--            order by a.created_at desc limit 1) as before_status
--     from public.outreach_contacts c
--    where c.status = 'in_conversation'
--      and exists (select 1 from public.email_messages m where m.company_id = c.id and m.direction = 'inbound')
--      and not exists (select 1 from public.email_messages m
--                       where m.company_id = c.id and m.direction = 'inbound'
--                         and coalesce(regexp_replace(m.subject, '^((re|aw|fw|fwd|tr|wg)\s*:\s*)+', '', 'i'), '') !~*
--                             '^(auto(matic)?[ -]?(reply|response)|automatic reply|out of (the )?office|i am (currently )?(out|away)|on (annual )?leave|automatische antwort|abwesenheit|r[eé]ponse automatique|absence|absent|respuesta autom[aá]tica|fuera de (la )?oficina|resposta autom[aá]tica|aus[eê]ncia|ausente|automatisch antwoord|afwezig|niet aanwezig|risposta automatica|fuori sede)')
-- )
-- select * from auto_only;          -- expect 4 rows, each with a before_status
--
-- begin;
-- with auto_only as (
--   select c.id,
--          (select a.old_value from public.outreach_activity a
--            where a.contact_id = c.id and a.action = 'status_changed'
--              and a.new_value = 'in_conversation' and a.created_by = 'gmail-sync-server'
--            order by a.created_at desc limit 1) as before_status
--     from public.outreach_contacts c
--    where c.status = 'in_conversation'
--      and exists (select 1 from public.email_messages m where m.company_id = c.id and m.direction = 'inbound')
--      and not exists (select 1 from public.email_messages m
--                       where m.company_id = c.id and m.direction = 'inbound'
--                         and coalesce(regexp_replace(m.subject, '^((re|aw|fw|fwd|tr|wg)\s*:\s*)+', '', 'i'), '') !~*
--                             '^(auto(matic)?[ -]?(reply|response)|automatic reply|out of (the )?office|i am (currently )?(out|away)|on (annual )?leave|automatische antwort|abwesenheit|r[eé]ponse automatique|absence|absent|respuesta autom[aá]tica|fuera de (la )?oficina|resposta autom[aá]tica|aus[eê]ncia|ausente|automatisch antwoord|afwezig|niet aanwezig|risposta automatica|fuori sede)')
-- ),
-- moved as (
--   update public.outreach_contacts c set status = a.before_status, replied = false
--     from auto_only a where a.id = c.id and a.before_status is not null
--   returning c.id, a.before_status
-- )
-- insert into public.outreach_activity (contact_id, action, old_value, new_value, meta, created_by)
-- select id, 'status_changed', 'in_conversation', before_status, '{"via":"audit-w4","why":"only an automatic reply"}'::jsonb, 'audit-w4' from moved;
-- -- expect: INSERT 0 4
-- commit;


-- ── Part 4 · «Bad email» mark on companies whose address bounced (crm-09) ───
-- FOR MIGUEL TO APPROVE. Not run. Optional: the batch email already unticks
-- them and the sender skips them; this only makes them findable in Contacts
-- through the existing email_confidence field. Read-only count: 86.
--
-- update public.outreach_contacts c set email_confidence = 'bounced'
--  where exists (select 1 from public.email_suppression s where s.reason = 'bounce' and s.email = lower(trim(c.email)))
--    and coalesce(c.email_confidence, '') <> 'bounced';
-- -- expect: UPDATE 86


-- ── Part 5 · People rows that only copy the company email (crm-18) ─────────
-- FOR MIGUEL TO APPROVE, after a backup. Not run.
-- A one-off fill on 6 Jul 2026 made one «person» per company with no name,
-- role, phone or LinkedIn and the company's own email. They add nothing and
-- are 0.47 MB of every CRM open. Read-only count on 18 Nov 2026: 1,866.
-- The 3 rows whose address no longer equals the company's are NOT touched:
-- Miguel picks the right address for those first.
--
-- select count(*) from public.contacts p join public.outreach_contacts c on c.id = p.company_id
--  where lower(trim(p.email)) = lower(trim(c.email))
--    and (coalesce(trim(p.name), '') = '' or lower(trim(p.name)) = lower(trim(c.company)))
--    and coalesce(trim(p.role), '') = '' and coalesce(trim(p.phone), '') = '' and coalesce(trim(p.linkedin), '') = '';
--
-- begin;
-- delete from public.contacts p using public.outreach_contacts c
--  where c.id = p.company_id
--    and lower(trim(p.email)) = lower(trim(c.email))
--    and (coalesce(trim(p.name), '') = '' or lower(trim(p.name)) = lower(trim(c.company)))
--    and coalesce(trim(p.role), '') = '' and coalesce(trim(p.phone), '') = '' and coalesce(trim(p.linkedin), '') = '';
-- -- expect: DELETE 1866
-- commit;


-- ── Part 6 · Instructors pay readable only with the Instructors area (SA-07) ──
-- FOR MIGUEL TO APPROVE. Not run. Today anyone with any Portugal access
-- (a Camp-Tab-only bar account included) can read every lesson, rate and
-- monthly pay. With this, reading and writing need the Instructors area (or
-- HQ) on top of the Portugal access they need today. Before running: give the
-- Portugal location manager the Instructors pill if they should keep it.
--
-- drop policy if exists instructor_lessons_select_location on public.instructor_lessons;
-- create policy instructor_lessons_select_location on public.instructor_lessons for select to authenticated
--   using (public.has_location_access(location_id) and (public.is_hq_member() or public.is_workspace_member('instructors')));
-- drop policy if exists instructor_directory_select_location on public.instructor_directory;
-- create policy instructor_directory_select_location on public.instructor_directory for select to authenticated
--   using (public.has_location_access(location_id) and (public.is_hq_member() or public.is_workspace_member('instructors')));
-- -- and the same extra condition on the six *_insert_full / *_update_full / *_delete_full policies:
-- --   … and (public.is_hq_member() or public.is_workspace_member('instructors'))
