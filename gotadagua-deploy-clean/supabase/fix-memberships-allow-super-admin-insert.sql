-- ════════════════════════════════════════════════════════════════════════════
--  Fix — super_admin can INSERT workspace_memberships for OTHER users
-- ════════════════════════════════════════════════════════════════════════════
--
--  Phase 4 created memberships_self_insert with:
--     with check (user_id = auth.uid())
--
--  That intentionally restricts a regular user to inserting only their own
--  membership row (the invite-acceptance path). The Phase 5 doc said admin
--  team-management would route through an Edge Function with the service-
--  role key, but the Settings UI currently writes from the client SDK —
--  so any UPSERT whose INSERT branch fires for someone else's user_id
--  fails with "new row violates row-level security policy for table
--  workspace_memberships".
--
--  This file adds an additive INSERT policy gated by is_global_admin().
--  The self-insert policy stays in place; policies are OR'd, so a caller
--  can insert if they're EITHER the row owner OR a super_admin. No new
--  privilege — super_admin already has UPDATE/DELETE on the table (see
--  fix-memberships-admin-policies-use-super-admin.sql) and free run of
--  the platform by Phase 5 design.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "memberships_admin_insert" on public.workspace_memberships;
create policy "memberships_admin_insert"
  on public.workspace_memberships
  for insert
  to authenticated
  with check (public.is_global_admin());

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expected: 5 policies — read / self_insert / admin_insert / admin_update /
-- admin_delete. All three admin_* should reference is_global_admin().
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'workspace_memberships'
 order by cmd, policyname;
