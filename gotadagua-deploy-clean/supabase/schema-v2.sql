-- ═══════════════════════════════════════════════════════════
--  SCHEMA V2  —  Run once in Supabase SQL Editor
--  Sets up: platform_profiles, workspaces, workspace_memberships,
--           workspace_invitations, invitation_workspace_access
--  Then deploy Edge Functions: create-platform-invite + remove-platform-user
-- ═══════════════════════════════════════════════════════════

-- ── 1. platform_profiles ──────────────────────────────────
create table if not exists public.platform_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  platform_role text not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_profiles enable row level security;
drop policy if exists "platform_profiles_self" on public.platform_profiles;
create policy "platform_profiles_self"
  on public.platform_profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "platform_profiles_read_members" on public.platform_profiles;
create policy "platform_profiles_read_members"
  on public.platform_profiles for select to authenticated
  using (true);

-- ── 2. workspaces ─────────────────────────────────────────
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
drop policy if exists "workspaces_read" on public.workspaces;
create policy "workspaces_read"
  on public.workspaces for select to authenticated
  using (true);

-- Seed workspace rows (idempotent)
-- workspace_type values: 'camp' for camp hubs, 'ops' for management tools
insert into public.workspaces (slug, name, workspace_type) values
  ('sri-lanka',   'Sri Lanka',   'camp'),
  ('portugal',    'Portugal',    'camp'),
  ('junior',      'Junior Camp', 'camp'),
  ('morocco',     'Morocco',     'camp'),
  ('partners',    'Partners',    'ops'),
  ('instructors', 'Instructors', 'ops'),
  ('settings',    'Settings',    'ops')
on conflict (slug) do nothing;

-- ── 3. workspace_memberships ──────────────────────────────
create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.platform_profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_role text not null default 'viewer',
  can_view boolean not null default true,
  can_edit boolean not null default false,
  can_manage_team boolean not null default false,
  can_manage_finance boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id)
);
alter table public.workspace_memberships enable row level security;
drop policy if exists "memberships_read" on public.workspace_memberships;
create policy "memberships_read"
  on public.workspace_memberships for select to authenticated
  using (true);
drop policy if exists "memberships_self_write" on public.workspace_memberships;
create policy "memberships_self_write"
  on public.workspace_memberships for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 4. workspace_invitations ──────────────────────────────
create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  platform_role text not null default 'viewer',
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspace_invitations enable row level security;
drop policy if exists "invitations_auth_read" on public.workspace_invitations;
create policy "invitations_auth_read"
  on public.workspace_invitations for select to authenticated
  using (true);
drop policy if exists "invitations_auth_write" on public.workspace_invitations;
create policy "invitations_auth_write"
  on public.workspace_invitations for update to authenticated
  using (true) with check (true);

-- ── 5. invitation_workspace_access ────────────────────────
create table if not exists public.invitation_workspace_access (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.workspace_invitations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_role text not null default 'viewer',
  can_view boolean not null default true,
  can_edit boolean not null default false,
  can_manage_team boolean not null default false,
  can_manage_finance boolean not null default false,
  unique (invitation_id, workspace_id)
);
alter table public.invitation_workspace_access enable row level security;
drop policy if exists "invite_access_read" on public.invitation_workspace_access;
create policy "invite_access_read"
  on public.invitation_workspace_access for select to authenticated
  using (true);

-- ── 6. Auto-create platform_profile on first sign-in ──────
--  This trigger runs server-side so the admin's first login
--  automatically creates their profile row.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.platform_profiles (id, email, full_name, platform_role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    'owner',   -- first user gets owner role; Edge Function sets correct role for invitees
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- ── 7. Auto-grant full access to owner on first sign-in ───
create or replace function public.handle_new_platform_profile()
returns trigger language plpgsql security definer as $$
begin
  -- Only grant all-access if platform_role is 'owner'
  if new.platform_role = 'owner' then
    insert into public.workspace_memberships
      (user_id, workspace_id, member_role, can_view, can_edit, can_manage_team, can_manage_finance, active)
    select
      new.id,
      w.id,
      'owner',
      true, true, true, true,
      true
    from public.workspaces w
    where w.active = true
    on conflict (user_id, workspace_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_platform_profile_created on public.platform_profiles;
create trigger on_platform_profile_created
  after insert on public.platform_profiles
  for each row execute procedure public.handle_new_platform_profile();
