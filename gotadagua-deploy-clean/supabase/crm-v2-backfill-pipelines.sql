-- ════════════════════════════════════════════════════════════════════════════
--  CRM v2 — backfill contact_pipeline from outreach_contacts.status
--
--  The new Pipelines section in the detail panel + the Pipeline tab's
--  Sales/Account Mgmt switcher are wired up but every company starts
--  unassigned. Without a backfill, the user would have to manually add
--  600+ contacts to the Sales pipeline one by one.
--
--  This script reads each company's existing flat `status` and inserts
--  the matching contact_pipeline row(s). active_partner gets TWO
--  assignments — one to Sales (Won) and one to Account Management
--  (Active) — because that's the real-world transition the column
--  is trying to capture.
--
--  Idempotent: contact_pipeline has UNIQUE(company_id, pipeline_id),
--  so the on-conflict-do-nothing keeps re-runs harmless. Re-running
--  will NOT update an existing row — by design, so the user's
--  manual pipeline edits aren't reverted by a backfill rerun.
--
--  Mapping (status → Sales stage):
--    not_started     → (skipped — not yet engaged, no Sales row)
--    first_email     → Lead
--    follow_up       → Qualified
--    in_conversation → Qualified
--    meeting         → Proposal
--    proposal_sent   → Proposal
--    active_partner  → Won  (+ also goes into Account Mgmt: Active)
--    no_reply        → Lost
--    lost            → Lost
--
--  How to run: paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. SALES PIPELINE BACKFILL ────────────────────────────────────────────
-- For every active outreach_contact, insert one contact_pipeline row
-- pointing at the Sales pipeline and the mapped stage.
insert into public.contact_pipeline (company_id, pipeline_id, stage_id, entered_stage_at)
select
  c.id                                   as company_id,
  p.id                                   as pipeline_id,
  s.id                                   as stage_id,
  coalesce(c.updated_at, c.created_at, now()) as entered_stage_at
from public.outreach_contacts c
cross join (select id from public.pipelines where key = 'sales') p
join public.pipeline_stages s
  on s.pipeline_id = p.id
 and s.key = case c.status
              when 'first_email'     then 'lead'
              when 'follow_up'       then 'qualified'
              when 'in_conversation' then 'qualified'
              when 'meeting'         then 'proposal'
              when 'proposal_sent'   then 'proposal'
              when 'active_partner'  then 'won'
              when 'no_reply'        then 'lost'
              when 'lost'            then 'lost'
            end
where c.status is not null
  and c.status <> 'not_started'
on conflict (company_id, pipeline_id) do nothing;

-- ── 2. ACCOUNT MANAGEMENT BACKFILL ────────────────────────────────────────
-- Active partners ALSO go into the Account Management pipeline at the
-- "Active" stage — that's the post-sale state the lifecycle column is
-- meant to capture.
insert into public.contact_pipeline (company_id, pipeline_id, stage_id, entered_stage_at)
select
  c.id                                   as company_id,
  p.id                                   as pipeline_id,
  s.id                                   as stage_id,
  coalesce(c.updated_at, c.created_at, now()) as entered_stage_at
from public.outreach_contacts c
cross join (select id from public.pipelines where key = 'account_mgmt') p
join public.pipeline_stages s
  on s.pipeline_id = p.id
 and s.key = 'active'
where c.status = 'active_partner'
on conflict (company_id, pipeline_id) do nothing;

-- ── 3. ALSO SET outreach_contacts.lifecycle for active partners ───────────
-- Aligns the lifecycle column (added by the schema expansion) with
-- the existing status flag, so future reports can rely on either.
update public.outreach_contacts
   set lifecycle = 'active_partner'
 where status = 'active_partner'
   and (lifecycle is null or lifecycle = 'lead');

-- ── 4. Verify ─────────────────────────────────────────────────────────────
-- Counts per pipeline + per stage so you can sanity-check the
-- distribution matches your expectation (most rows land in Sales:Lead
-- and Sales:Qualified for a typical outreach DB).
select
  p.name           as pipeline,
  s.name           as stage,
  count(cp.id)     as companies
from public.contact_pipeline cp
join public.pipelines       p on p.id = cp.pipeline_id
join public.pipeline_stages s on s.id = cp.stage_id
group by p.name, s.sort_order, s.name
order by p.name, s.sort_order;
