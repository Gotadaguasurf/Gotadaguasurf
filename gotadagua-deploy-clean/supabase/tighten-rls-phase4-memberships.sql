-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 4 : workspace_memberships self-escalation guard
-- ════════════════════════════════════════════════════════════════════════════
--
--  The original schema-v2 created a policy:
--
--    create policy "memberships_self_write"
--      on public.workspace_memberships
--      for ALL
--      using (user_id = auth.uid());
--
--  cmd=ALL means the user can SELECT / INSERT / UPDATE / DELETE rows where
--  user_id = auth.uid(). The intent was to let the user create their own
--  membership row when accepting an invitation. The side effect is that any
--  authenticated user can open DevTools and:
--
--    update workspace_memberships
--      set can_edit=true, can_manage_finance=true, can_manage_team=true
--      where user_id = auth.uid();
--
--  …granting themselves admin powers on the workspaces they're a member of.
--
--  This file splits the policy:
--    INSERT for self      — needed for invite acceptance (acceptPendingInvite
--                           ForCurrentUser upserts the user's row on first
--                           sign-in)
--    UPDATE/DELETE        — owner/admin only (they manage team in Settings)
--    SELECT               — anyone authenticated (unchanged from schema-v2)
--
--  Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

-- Drop the wide-open ALL policy
drop policy if exists "memberships_self_write" on public.workspace_memberships;

-- Drop any partially-defined replacements from previous attempts
drop policy if exists "memberships_self_insert" on public.workspace_memberships;
drop policy if exists "memberships_admin_update" on public.workspace_memberships;
drop policy if exists "memberships_admin_delete" on public.workspace_memberships;

-- INSERT: a user can insert their own membership row (invite acceptance flow).
-- Note: the WITH CHECK enforces user_id = auth.uid(), so they can't create a
-- row for someone else.
create policy "memberships_self_insert"
  on public.workspace_memberships
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- UPDATE: only platform owner/admin can update memberships. This blocks
-- self-escalation. Owners use the Settings UI which uses the Edge Function
-- (service-role key, bypasses RLS) to manage team — so the Settings flow is
-- unaffected.
create policy "memberships_admin_update"
  on public.workspace_memberships
  for update
  to authenticated
  using (
    exists (select 1 from public.platform_profiles
            where id = auth.uid()
              and platform_role in ('owner','admin')
              and active = true)
  )
  with check (
    exists (select 1 from public.platform_profiles
            where id = auth.uid()
              and platform_role in ('owner','admin')
              and active = true)
  );

-- DELETE: only platform owner/admin can remove memberships.
create policy "memberships_admin_delete"
  on public.workspace_memberships
  for delete
  to authenticated
  using (
    exists (select 1 from public.platform_profiles
            where id = auth.uid()
              and platform_role in ('owner','admin')
              and active = true)
  );

-- ════════════════════════════════════════════════════════════════════════════
--  Verification:
--    select policyname, cmd, qual, with_check
--    from pg_policies
--    where schemaname='public' and tablename='workspace_memberships'
--    order by cmd, policyname;
--
--  Expected (4 rows):
--    memberships_read           SELECT   true
--    memberships_self_insert    INSERT   user_id = auth.uid()    user_id=auth.uid()
--    memberships_admin_update   UPDATE   <admin check>           <admin check>
--    memberships_admin_delete   DELETE   <admin check>
--
--  No more cmd=ALL on this table.
-- ════════════════════════════════════════════════════════════════════════════
