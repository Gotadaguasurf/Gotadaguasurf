-- ════════════════════════════════════════════════════════════════════════════
--  Team Access — invites that stay valid until the password is created
--  (6 Nov 2026, Miguel: «não é fixe caducar… se eu envio, até ele fazer devia
--  ser o sign up»)
--
--  Francisco was invited on 2 Nov; by the time he opened the email the Supabase
--  invite link (24 h) had expired and he could never set a password. From now on
--  the invite email links to OUR page (/?accept=<invitation_token>) and the
--  `accept-invite` Edge Function sets the password. The invite is open until the
--  person creates the password or an admin cancels it (expires_at = a generous
--  60 days from the last send, renewed on every «Resend invite»).
--
--  1. handle_platform_user no longer flips the invite to 'accepted' the moment
--     the auth user is created (that is why every invite in the table read
--     'accepted' although Francisco and Nadith never signed in). It still copies
--     the role, name and areas from the open invite. The invite is accepted by
--     accept-invite, when the password is saved.
--  2. workspace_invitations.last_sent_at — when the email last went out (Settings
--     shows «Invite sent 6 Nov»); expires_at default 60 days.
--  3. team_access_people() — the Settings list needs each person's last sign-in,
--     which lives in auth.users. SECURITY DEFINER, returns rows only to a
--     super_admin or someone who can manage the team; everyone else gets nothing.
--     No RLS policy is changed.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Creating the auth user no longer «accepts» the invite ────────────────
create or replace function public.handle_platform_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  matched_invite public.workspace_invitations%rowtype;
begin
  select *
  into matched_invite
  from public.workspace_invitations
  where lower(email) = lower(new.email)
    and status in ('pending','sent')
    and expires_at > now()
  order by created_at desc
  limit 1;

  insert into public.platform_profiles (id, email, full_name, platform_role)
  values (
    new.id,
    new.email,
    coalesce(nullif(matched_invite.full_name, ''), new.raw_user_meta_data->>'full_name', ''),
    coalesce(nullif(matched_invite.platform_role, ''), 'viewer')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when excluded.full_name is not null and excluded.full_name <> '' then excluded.full_name
          else public.platform_profiles.full_name
        end,
        platform_role = excluded.platform_role,
        updated_at = now();

  if matched_invite.id is not null then
    insert into public.workspace_memberships (
      user_id, workspace_id, member_role, can_view, can_edit,
      can_manage_team, can_manage_finance, active
    )
    select new.id, workspace_id, member_role, can_view, can_edit,
           can_manage_team, can_manage_finance, true
      from public.invitation_workspace_access
     where invitation_id = matched_invite.id
    on conflict (user_id, workspace_id) do update
      set member_role = excluded.member_role,
          can_view = excluded.can_view,
          can_edit = excluded.can_edit,
          can_manage_team = excluded.can_manage_team,
          can_manage_finance = excluded.can_manage_finance,
          active = true,
          updated_at = now();
    -- The invite stays open: it is accepted only when the person creates the
    -- password (accept-invite Edge Function).
  end if;

  return new;
end;
$function$;

-- ── 2. When the invite email last went out; generous default validity ──────
alter table public.workspace_invitations
  add column if not exists last_sent_at timestamptz;
alter table public.workspace_invitations
  alter column expires_at set default (now() + interval '60 days');

-- ── 3. Last sign-in per person, for Settings → Team Access ──────────────────
create or replace function public.team_access_people()
returns table (
  user_id uuid,
  email text,
  full_name text,
  platform_role text,
  active boolean,
  password_set_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select p.id, p.email, p.full_name, p.platform_role, p.active, p.password_set_at,
         u.last_sign_in_at, u.email_confirmed_at, p.created_at
    from public.platform_profiles p
    join auth.users u on u.id = p.id
   where public.is_global_admin()
      or exists (
        select 1 from public.workspace_memberships m
         where m.user_id = auth.uid() and m.active = true and m.can_manage_team = true
      );
$function$;

revoke all on function public.team_access_people() from public;
revoke all on function public.team_access_people() from anon;
grant execute on function public.team_access_people() to authenticated;
