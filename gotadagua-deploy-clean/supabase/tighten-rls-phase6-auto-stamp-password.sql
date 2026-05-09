-- ════════════════════════════════════════════════════════════════════════════
--  TIGHTEN RLS — PHASE 6 : auto-stamp password_set_at via auth.users trigger
-- ════════════════════════════════════════════════════════════════════════════
--
--  Phase 5 added platform_profiles.password_set_at as the source of truth for
--  "has this user finished the password screen?" The frontend was responsible
--  for stamping it after a successful client.auth.updateUser({password}).
--
--  In practice that stamping has been silently failing — RLS, the
--  no-self-escalate trigger, network races, or just a cached browser sending
--  the request in the wrong order all cause the UPDATE to land 0 rows. The
--  user fills in the password, the password is in fact saved on auth.users,
--  but platform_profiles.password_set_at stays NULL — so the password gate
--  re-fires on the next hydrate and the user is stranded on the New Password
--  screen forever.
--
--  This file installs an AFTER UPDATE trigger on auth.users that stamps
--  password_set_at whenever the encrypted_password column changes. The
--  trigger runs as SECURITY DEFINER so it doesn't care about RLS, and it's
--  driven by Supabase's own write to auth.users — there's nothing the
--  frontend can do to skip it.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_stamp_password_set_at()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Only fire when the password actually changed and there is a password set.
  -- The first time a user is created via inviteUserByEmail their
  -- encrypted_password is null; once they finish the New Password screen
  -- Supabase writes the hash and this trigger stamps the flag.
  if (NEW.encrypted_password is distinct from OLD.encrypted_password)
     and NEW.encrypted_password is not null then
    update public.platform_profiles
    set password_set_at = coalesce(password_set_at, now()),
        updated_at      = now()
    where id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_stamp_password_set_at on auth.users;
create trigger trg_stamp_password_set_at
  after update on auth.users
  for each row execute procedure public.fn_stamp_password_set_at();

-- ════════════════════════════════════════════════════════════════════════════
--  BACKFILL — anyone who already has an encrypted_password but a NULL
--  password_set_at gets stamped now. Otherwise existing real users (Miguel)
--  would have to re-set their password just to clear the gate, which would
--  be silly.
-- ════════════════════════════════════════════════════════════════════════════
update public.platform_profiles pp
set password_set_at = coalesce(pp.password_set_at, u.created_at, now()),
    updated_at      = now()
from auth.users u
where u.id = pp.id
  and u.encrypted_password is not null
  and pp.password_set_at is null;

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
--  -- Trigger is in place:
--    select tgname from pg_trigger where tgname = 'trg_stamp_password_set_at';
--    -- Expected: 1 row.
--
--  -- All real users now have a stamp:
--    select pp.email,
--           pp.password_set_at is not null as stamped,
--           u.encrypted_password is not null as has_password
--    from public.platform_profiles pp
--    join auth.users u on u.id = pp.id;
-- ════════════════════════════════════════════════════════════════════════════
