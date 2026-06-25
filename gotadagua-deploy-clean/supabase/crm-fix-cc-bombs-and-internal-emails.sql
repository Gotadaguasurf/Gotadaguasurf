-- ════════════════════════════════════════════════════════════════════════════
--  Cleanup: internal emails wrongly attached to contacts + team_users
--           that shouldn't be in the auto-CC pool
--
--  Two issues fixed by the matching commit + this script:
--
--  1. The Gmail sync was attaching INTERNAL emails (Supabase invites,
--     miguel→miguel notes, marketing@ replies, etc.) to whichever
--     contact happened to share the @gotadaguasurf.com domain — the
--     domain fallback didn't know "@gotadaguasurf.com" was OURS.
--     This script deletes those wrongly-attached rows so the activity
--     log on each company shows only real external replies.
--
--  2. The team_users seed pulled every auth.users row into the auto-CC
--     pool. Most of those addresses (marketing@, srilanka@, partner
--     mailboxes) aren't actual sales people. The app now defaults
--     auto-CC OFF and only adds team_users with role='sales' AND
--     active=true, but the existing rows still all carry role='sales'.
--     The block below shows how to demote them — RUN IT MANUALLY,
--     edit the email list to match your real sales pair.
--
--  How to run:
--    Section 1 — safe to run as-is, deletes the wrong rows.
--    Section 2 — uncomment + edit the email list to your two real
--                sales addresses, then run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Delete email_messages wrongly attached to contacts ──────────────────
-- Strip the address from the From header ("Name <email>") and match the
-- domain part. Anything from gotadaguasurf.com is INTERNAL — those rows
-- were attached to whichever company happened to share the domain.
delete from public.email_messages
 where direction = 'inbound'
   and lower(
     substring(
       coalesce(from_addr, '')
       from position('<' in coalesce(from_addr, '')||'<') + 1
       for case when from_addr like '%<%' then position('>' in from_addr) - position('<' in from_addr) - 1
                else length(coalesce(from_addr, '')) end
     )
   ) like '%@gotadaguasurf.com';

-- Verify — count remaining inbound emails (should be only EXTERNAL replies).
select count(*) as remaining_inbound from public.email_messages where direction = 'inbound';

-- Optional cleanup: also delete the "replied_marked" activity rows from
-- gmail-sync that no longer have any matching email_messages — they're
-- stubs pointing at the now-deleted internal noise.
delete from public.outreach_activity
 where action = 'replied_marked'
   and meta ->> 'via' = 'gmail-sync'
   and contact_id not in (
     select distinct company_id from public.email_messages where direction = 'inbound'
   );


-- ── 2. (MANUAL) Demote non-sales team_users so they stop getting CC'd ──────
-- Edit the email list below to YOUR two real sales addresses, then
-- uncomment + run. Everyone else gets active=false (still in DB, but
-- excluded from the auto-CC pool).
--
--   update public.team_users
--      set active = false
--    where email not in (
--      'miguel@gotadaguasurf.com',
--      'ricardo@gotadaguasurf.com'
--    );
--
-- Verify after running:
--   select email, full_name, role, active from public.team_users
--    order by active desc, email;
