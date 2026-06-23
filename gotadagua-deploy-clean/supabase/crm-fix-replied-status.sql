-- ════════════════════════════════════════════════════════════════════════════
--  Fix orphaned status='replied' rows
--
--  The Mark replied button used to write status='replied' (a string not in
--  the schema's 9-stage STATUS_ORDER), so any contact that had the button
--  clicked on it ended up with a broken status pill that didn't render
--  correctly and was invisible to the pipeline funnel counts.
--
--  This script moves all those rows to in_conversation — the correct stage
--  given that the user manually flagged them as having replied — and logs
--  one status_changed activity per moved row so the timeline reflects the
--  cleanup.
--
--  Idempotent: re-running after the fix lands does nothing because no row
--  matches status='replied' anymore.
--
--  How to run: paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Insert a status_changed activity row for each broken contact, so the
--    timeline tells the truth ("replied → in_conversation") instead of
--    silently mutating state under the user's feet.
insert into public.outreach_activity (contact_id, action, old_value, new_value, meta, created_by)
select id, 'status_changed', 'replied', 'in_conversation',
       jsonb_build_object('via', 'sql-cleanup'),
       'system'
  from public.outreach_contacts
 where status = 'replied';

-- 2. Move the broken rows to in_conversation.
update public.outreach_contacts
   set status = 'in_conversation'
 where status = 'replied';

-- 3. Verify — should return 0.
select count(*) as still_replied
  from public.outreach_contacts
 where status = 'replied';
