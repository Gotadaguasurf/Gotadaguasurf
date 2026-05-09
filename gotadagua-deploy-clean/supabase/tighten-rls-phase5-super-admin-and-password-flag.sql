-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 5 : super_admin role + mandatory-password flag
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why this file exists (the two real bugs it fixes):
--
--   (A) The original schema-v2 trigger handle_new_auth_user defaults every
--       brand-new auth user to platform_role='owner', and a second trigger
--       handle_new_platform_profile auto-grants memberships on EVERY workspace
--       to anyone whose role = 'owner'. Result: every invitee was being
--       silently promoted to owner with full access — the area pills had no
--       effect at all on first sign-in.
--
--   (B) The mandatory password screen relied on workspace_invitations.status
--       being 'sent'/'pending'. That state is fragile: stale rows from prior
--       tests, race conditions between two parallel hydrateFromSession() calls,
--       or Supabase's auto-acceptance of magic links can all flip the row to
--       'accepted' before we get a chance to render the password screen — so
--       the user lands inside the app without ever choosing a password.
--
--  This file ships a more robust model:
--
--    1. New role 'super_admin' — only humans set explicitly via SQL get this.
--       It REPLACES 'owner'/'admin' as the global bypass for is_global_admin().
--       'owner' and 'admin' become pure labels on the invite dropdown; access
--       is enforced ENTIRELY by workspace_memberships pills.
--
--    2. New column platform_profiles.password_set_at. Set when the user
--       finishes the password screen. The frontend forces the password screen
--       whenever this is null, regardless of invitation_status. No more races.
--
--    3. handle_new_auth_user default role drops to 'viewer'. The Edge Function
--       (create-platform-invite) injects the real role via user_metadata.
--       Even then we never auto-promote to super_admin/owner/admin from the
--       trigger — those have to come from acceptPendingInviteForCurrentUser
--       (which runs in the user's session and sets memberships only for the
--        invited workspaces).
--
--    4. handle_new_platform_profile no longer auto-grants memberships. Every
--       membership is created either by the invite-acceptance flow or by an
--       admin in the Settings UI. No accidental "owner gets everything".
--
--    5. workspace_invitations RLS is tightened to "self or super_admin" reads,
--       so an invited user can read THEIR OWN pending invite (needed by the
--       password screen) but not other people's invites.
--
--    6. Miguel is promoted to super_admin and his password_set_at is stamped
--       so he doesn't get prompted for a password on his next sign-in.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. password_set_at flag ───────────────────────────────────────────────
alter table public.platform_profiles
  add column if not exists password_set_at timestamptz;

-- ── 1b. Block self-escalation on platform_profiles ────────────────────────
-- The schema-v2 "platform_profiles_self" policy is cmd=ALL gated by
-- id = auth.uid(). That allowed:
--     update platform_profiles set platform_role='super_admin' where id=auth.uid();
-- …from any authenticated browser. A trigger resets the protected fields if
-- the caller is the owner of the row AND not a super_admin.
create or replace function public.fn_platform_profiles_no_self_escalate()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  -- Only sanitize when the caller is editing their OWN row in a real user
  -- session (auth.uid() is null for service-role calls — the Edge Function
  -- still bypasses this).
  if auth.uid() is not null
     and OLD.id = auth.uid()
     and not public.is_global_admin() then
    NEW.platform_role := OLD.platform_role;
    NEW.active        := OLD.active;
    NEW.email         := OLD.email;
    NEW.id            := OLD.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_platform_profiles_no_self_escalate on public.platform_profiles;
create trigger trg_platform_profiles_no_self_escalate
  before update on public.platform_profiles
  for each row execute procedure public.fn_platform_profiles_no_self_escalate();

-- ── 2. handle_new_auth_user: default to viewer, never bootstrap super_admin ─
-- After Phase 5, only platform_role='super_admin' grants any privilege. The
-- 'owner'/'admin'/etc. roles are pure labels — access is enforced entirely
-- by workspace_memberships. So we let those through (so the Settings page
-- displays the invited role correctly), and only sanitize 'super_admin'.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
declare
  meta_role text;
begin
  meta_role := coalesce(new.raw_user_meta_data->>'platform_role', 'viewer');
  if meta_role = 'super_admin' then
    meta_role := 'viewer';
  end if;
  insert into public.platform_profiles (id, email, full_name, platform_role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    meta_role,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 3. Disable the all-access auto-grant trigger ──────────────────────────
-- Memberships now come ONLY from acceptPendingInviteForCurrentUser (client-
-- side, in the invitee's session) or from the Settings UI (admin action).
drop trigger  if exists on_platform_profile_created on public.platform_profiles;
drop function if exists public.handle_new_platform_profile();

-- ── 4. is_global_admin() gates on super_admin only ────────────────────────
-- This is the single point where 'global access without an explicit pill' is
-- granted. We keep the function name so all the Phase 3 policies still resolve.
create or replace function public.is_global_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.platform_profiles
    where id = auth.uid()
      and platform_role = 'super_admin'
      and active = true
  );
$$;

-- ── 5. workspace_invitations: self-or-super_admin SELECT, super_admin write ─
alter table public.workspace_invitations enable row level security;
drop policy if exists "invitations_auth_read"           on public.workspace_invitations;
drop policy if exists "invitations_auth_write"          on public.workspace_invitations;
drop policy if exists "invitations_self_or_admin_read"  on public.workspace_invitations;
drop policy if exists "invitations_admin_write"         on public.workspace_invitations;

-- A user can read their own pending invitation row (so the password screen
-- can detect "you have a pending invite") AND a super_admin can read all
-- invitations (Settings UI uses this to render the pending-invites list).
create policy "invitations_self_or_admin_read"
  on public.workspace_invitations for select to authenticated
  using (
    public.is_global_admin()
    or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );

-- Only super_admin can flip status / fields directly. The Edge Function uses
-- the service-role key which bypasses RLS, so create-platform-invite is fine.
create policy "invitations_admin_write"
  on public.workspace_invitations for update to authenticated
  using       (public.is_global_admin())
  with check  (public.is_global_admin());

-- A user can mark their own invitation accepted (for acceptPendingInviteForCurrentUser).
drop policy if exists "invitations_self_accept" on public.workspace_invitations;
create policy "invitations_self_accept"
  on public.workspace_invitations for update to authenticated
  using       (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')))
  with check  (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

-- ── 6. Promote Miguel to super_admin and stamp his password_set_at ────────
update public.platform_profiles
set platform_role  = 'super_admin',
    active         = true,
    password_set_at = coalesce(password_set_at, now()),
    updated_at      = now()
where lower(email) = 'miguel@gotadaguasurf.com';

-- Make sure Miguel has memberships on every active workspace (defensive: if
-- the auto-grant trigger ran for him on first sign-in he's already covered;
-- if we're running this on a fresh DB it backfills him).
do $$
declare
  miguel_id uuid;
begin
  select id into miguel_id
  from public.platform_profiles
  where lower(email) = 'miguel@gotadaguasurf.com'
    and active = true
  limit 1;

  if miguel_id is not null then
    insert into public.workspace_memberships
      (user_id, workspace_id, member_role, can_view, can_edit,
       can_manage_team, can_manage_finance, active)
    select
      miguel_id, w.id, 'owner', true, true, true, true, true
    from public.workspaces w
    where w.active = true
    on conflict (user_id, workspace_id) do update set
      active             = true,
      can_view           = true,
      can_edit           = true,
      can_manage_team    = true,
      can_manage_finance = true,
      updated_at         = now();
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
--  -- Miguel is the only super_admin and has a password_set_at:
--    select email, platform_role, password_set_at from public.platform_profiles
--    where platform_role = 'super_admin';
--
--  -- The auto-grant trigger is gone:
--    select tgname from pg_trigger where tgname = 'on_platform_profile_created';
--    -- Expected: 0 rows.
--
--  -- workspace_invitations RLS now has self-or-admin policies:
--    select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='workspace_invitations'
--    order by cmd, policyname;
--    -- Expected:
--    --   invitations_self_or_admin_read  SELECT
--    --   invitations_admin_write         UPDATE
--    --   invitations_self_accept         UPDATE
--
--  -- is_global_admin returns false for non-super-admin owners now:
--    select public.is_global_admin();
--    -- (Run as Miguel: true. Run as any other user: false.)
-- ════════════════════════════════════════════════════════════════════════════
