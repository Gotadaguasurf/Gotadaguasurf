-- ════════════════════════════════════════════════════════════════════════════
--  Recovery — reactivate workspace_memberships that the destructive-replace
--             save bug deactivated, leaving users invisible in the team list
-- ════════════════════════════════════════════════════════════════════════════
--
--  Symptom: Ricardo and Gonçalo (and possibly others) disappeared from the
--  Settings → Team Access list after an edit attempt that hit an RLS error
--  half-way through.
--
--  Root cause: the edit handler used to (1) UPDATE all of the user's
--  workspace_memberships rows to active=false, then (2) UPSERT a fresh set.
--  When step 2 failed (RLS denial on platform_profiles or memberships),
--  step 1's deactivation was already committed — so the user ended up
--  with zero active memberships and dropped out of accessUsers, which is
--  the data source for the team list.
--
--  This script flips active back to true for every membership row of the
--  two named users. The bug only deactivated rows that were previously
--  active, so flipping them all back is the correct undo. Other users
--  are untouched.
--
--  Step 1 is a preview — eyeball it before running step 2. If Pedro /
--  surfschool / any other person was also affected (you'll see them in
--  the preview with active=false), add their email to the in (...) list
--  in step 2 before running.
--
--  Idempotent: re-runs are safe (active=true → active=true is a no-op).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Preview every membership row for the affected users ────────────────
select pp.email,
       pp.full_name,
       w.slug   as workspace,
       wm.member_role,
       wm.can_view,
       wm.can_edit,
       wm.active,
       wm.updated_at
  from public.workspace_memberships wm
  join public.platform_profiles pp on pp.id = wm.user_id
  join public.workspaces        w  on w.id  = wm.workspace_id
 where lower(pp.email) in (
   'ricardo@gotadaguasurf.com',
   'info@gotadaguasurf.com'
 )
 order by pp.email, w.slug;

-- ── 2. Restore — flip active back to true for those users ─────────────────
update public.workspace_memberships wm
   set active     = true,
       updated_at = now()
  from public.platform_profiles pp
 where pp.id = wm.user_id
   and wm.active = false
   and lower(pp.email) in (
     'ricardo@gotadaguasurf.com',
     'info@gotadaguasurf.com'
   );

-- ── 3. Verify — should now show active=true everywhere ────────────────────
select pp.email,
       w.slug     as workspace,
       wm.active,
       wm.updated_at
  from public.workspace_memberships wm
  join public.platform_profiles pp on pp.id = wm.user_id
  join public.workspaces        w  on w.id  = wm.workspace_id
 where lower(pp.email) in (
   'ricardo@gotadaguasurf.com',
   'info@gotadaguasurf.com'
 )
 order by pp.email, w.slug;
