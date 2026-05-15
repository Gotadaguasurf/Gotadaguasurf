-- ════════════════════════════════════════════════════════════════════════════
--  Fix — workspace_memberships UPDATE/DELETE policies must recognise
--        super_admin (Phase 4 hard-coded 'owner','admin', stale post-Phase 5)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Phase 4 (tighten-rls-phase4-memberships.sql) created:
--
--    memberships_admin_update / memberships_admin_delete
--      using ( platform_role in ('owner','admin') )
--
--  Phase 5 then changed the semantics of platform_role: only 'super_admin'
--  carries cross-workspace privilege; 'owner' and 'admin' became display
--  labels. Miguel was promoted to platform_role='super_admin'.
--
--  Net result: Miguel could no longer update workspace_memberships from
--  the client. Saving his own pills via the Settings → Edit form failed
--  with "new row violates row-level security policy (USING expression)
--  for table workspace_memberships" because his upsert's UPDATE branch
--  failed the stale check.
--
--  This file rewrites both policies to use the canonical is_global_admin()
--  function — the single source of truth for "platform-wide admin" after
--  Phase 5. No new privilege grants: only the user(s) who already passed
--  is_global_admin() (= super_admin only) can update/delete memberships,
--  matching the documented Phase 5 semantics.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "memberships_admin_update" on public.workspace_memberships;
create policy "memberships_admin_update"
  on public.workspace_memberships
  for update
  to authenticated
  using       (public.is_global_admin())
  with check  (public.is_global_admin());

drop policy if exists "memberships_admin_delete" on public.workspace_memberships;
create policy "memberships_admin_delete"
  on public.workspace_memberships
  for delete
  to authenticated
  using (public.is_global_admin());

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expected: both rows reference is_global_admin() in qual / with_check.
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'workspace_memberships'
 order by cmd, policyname;
