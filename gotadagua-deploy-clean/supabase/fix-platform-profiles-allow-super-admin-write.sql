-- ════════════════════════════════════════════════════════════════════════════
--  Fix — super_admin can UPDATE / INSERT other users' platform_profiles
-- ════════════════════════════════════════════════════════════════════════════
--
--  Symptom: saving access for another user from the Settings page failed
--  with "new row violates row-level security policy for table
--  platform_profiles" — even when signed in as super_admin (Miguel).
--
--  Root cause: schema-v2 only created one write policy on this table:
--
--    platform_profiles_self  for ALL  using/with check (id = auth.uid())
--
--  That allows a user to manage their OWN row, but blocks ANY caller —
--  including super_admin — from upserting someone else's row. The
--  Phase 5 doc described managing team via an Edge Function with the
--  service-role key, but the Settings UI's edit-existing-user flow
--  still calls the client SDK directly, so it gets denied.
--
--  Fix: add explicit INSERT and UPDATE policies gated by is_global_admin()
--  (= super_admin). The existing self-write policy stays in place; this
--  is purely additive. RLS policies are OR'd, so any caller who is EITHER
--  the row owner OR a super_admin can write.
--
--  Privilege: super_admin already has free run of the system by design
--  (see is_global_admin() comment in Phase 5). No new attack surface —
--  just unblocks an admin path that was implicitly assumed to work.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "platform_profiles_admin_insert" on public.platform_profiles;
create policy "platform_profiles_admin_insert"
  on public.platform_profiles
  for insert
  to authenticated
  with check (public.is_global_admin());

drop policy if exists "platform_profiles_admin_update" on public.platform_profiles;
create policy "platform_profiles_admin_update"
  on public.platform_profiles
  for update
  to authenticated
  using       (public.is_global_admin())
  with check  (public.is_global_admin());

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expected (5 rows):
--   platform_profiles_self           ALL      id = auth.uid()
--   platform_profiles_read_members   SELECT   true
--   platform_profiles_admin_insert   INSERT                                  is_global_admin()
--   platform_profiles_admin_update   UPDATE   is_global_admin()              is_global_admin()
--   (any later policies you've added)
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'platform_profiles'
 order by cmd, policyname;
