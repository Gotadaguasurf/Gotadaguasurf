-- ════════════════════════════════════════════════════════════════════════════
--  ENABLE REALTIME — partners / bookings / partner_month_status
-- ════════════════════════════════════════════════════════════════════════════
--
--  enable-realtime.sql added the camp-hub tables to the supabase_realtime
--  publication but missed the three tables the Partners app subscribes to.
--  Without them, changes one user makes never get pushed to the other
--  user's tab, so multi-device live sync is broken on the Partners page.
--
--  Tables added here:
--    partners              — partner list edits (name, commission %)
--    bookings              — CSV imports + booking edits
--    partner_month_status  — monthly Paid / Pending toggles
--
--  Idempotent: re-runs are safe (skips tables already in the publication).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  tables text[] := array[
    'partners',
    'bookings',
    'partner_month_status'
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
--   select schemaname, tablename from pg_publication_tables
--   where pubname = 'supabase_realtime'
--   order by tablename;
--
-- After running, the list should include partners, bookings,
-- partner_month_status (alongside the camp-hub tables).
-- ════════════════════════════════════════════════════════════════════════════
