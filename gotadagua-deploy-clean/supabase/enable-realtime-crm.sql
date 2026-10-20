-- ════════════════════════════════════════════════════════════════════════════
--  ENABLE REALTIME — CRM tables
-- ════════════════════════════════════════════════════════════════════════════
--
--  The CRM page subscribes to these tables (subscribeRealtime in
--  crm/index.html) but none of them were in the supabase_realtime
--  publication, so nothing was ever pushed. A contact created elsewhere
--  (Compose to a new address, the Gmail sync, the other computer) stayed
--  invisible in an open page — Miguel, 14 Oct 2026: searching
--  "partnership@esn-utrecht.nl" found nothing until a reload.
--
--  Idempotent: re-runs are safe (skips tables already in the publication).
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  tables text[] := array[
    'outreach_contacts',
    'outreach_activity',
    'contacts',
    'contact_pipeline',
    'email_messages',
    'meetings',
    'tasks'
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
