-- ════════════════════════════════════════════════════════════════════════════
--  ENABLE REALTIME — instructors + workspace/membership/invitation tables
-- ════════════════════════════════════════════════════════════════════════════
--
--  Adds the missing tables to the supabase_realtime publication so:
--
--    - When an admin adds/edits/removes an instructor lesson on one device,
--      every other device viewing the Instructor Control sees the change
--      live (no manual refresh).
--    - When an admin invites/removes a team member, or accepts pending
--      invites, every other Live Workspace tab updates the Settings page
--      live without refresh.
--
--  Idempotent: re-runs are safe (each table is added only if it isn't
--  already in the publication).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  tables text[] := array[
    'instructor_directory',
    'instructor_lessons',
    'platform_profiles',
    'workspace_memberships',
    'workspace_invitations',
    'invitation_workspace_access'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname    = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Added % to supabase_realtime', t;
    else
      raise notice '% already in supabase_realtime, skipped', t;
    end if;
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public'
--   order by tablename;
--
-- After running, the list should include the 6 tables above alongside the
-- camp-hub + partners tables already added previously.
-- ════════════════════════════════════════════════════════════════════════════
