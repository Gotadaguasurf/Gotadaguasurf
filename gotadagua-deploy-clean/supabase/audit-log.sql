-- ════════════════════════════════════════════════════════════════════════════
--  AUDIT LOG — track every DELETE on critical tables
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why: even with RLS phase-1 limiting DELETE to owner/admin, you still want
--  to know WHO deleted WHAT and WHEN. This creates an `audit_log` table and
--  attaches BEFORE-DELETE triggers on the critical data tables. Each delete
--  produces one audit row with the actor's auth.uid(), the table, the row id,
--  and the full deleted row as jsonb so it can be reconstructed if needed.
--
--  How to apply: paste into Supabase SQL Editor and run. Idempotent.
--
--  How to view recent deletes:
--    select at, actor_email, table_name, action, deleted_row->>'name' as name,
--           deleted_row->>'booking_ref' as booking_ref
--    from audit_log
--    order by at desc
--    limit 50;
--
--  How to view deletes by a specific user:
--    select * from audit_log
--    where actor_id = (select id from auth.users where email = 'user@x.com')
--    order by at desc;
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. audit_log table ─────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor_id    uuid,                              -- auth.uid() at the time
  actor_email text,                              -- captured from auth.users for readability
  table_name  text not null,
  action      text not null,                     -- 'DELETE' for now; future: 'UPDATE', 'INSERT'
  row_id      text,                              -- string-cast id of the affected row
  deleted_row jsonb                              -- full snapshot of the row before deletion
);

create index if not exists idx_audit_log_at         on public.audit_log (at desc);
create index if not exists idx_audit_log_actor      on public.audit_log (actor_id);
create index if not exists idx_audit_log_table_name on public.audit_log (table_name);

-- RLS: only owner/admin can read audit log; nobody can write directly (triggers do)
alter table public.audit_log enable row level security;
drop policy if exists "audit_log_read_owner_admin" on public.audit_log;
create policy "audit_log_read_owner_admin" on public.audit_log for select to authenticated using (
  exists (select 1 from public.platform_profiles
          where id = auth.uid()
            and platform_role in ('owner','admin')
            and active = true)
);
-- No insert/update/delete policy → only the trigger (which runs as the table owner / definer) can write
drop policy if exists "audit_log_no_writes" on public.audit_log;

-- ── 2. trigger function ────────────────────────────────────────────────────
create or replace function public.fn_audit_delete()
returns trigger
language plpgsql
security definer  -- runs with table-owner privileges so it can write audit_log
set search_path = public
as $$
declare
  v_email text;
  v_id    text;
begin
  -- Get the actor's email (for human-readable audit)
  select email into v_email from auth.users where id = auth.uid();
  -- Stringify the row's primary key (assumes column 'id' exists; falls back to NULL)
  begin
    v_id := (to_jsonb(OLD)->>'id');
  exception when others then
    v_id := null;
  end;
  insert into public.audit_log (actor_id, actor_email, table_name, action, row_id, deleted_row)
  values (auth.uid(), v_email, TG_TABLE_NAME, 'DELETE', v_id, to_jsonb(OLD));
  return OLD;
end;
$$;

-- ── 3. attach BEFORE DELETE trigger to each critical table ─────────────────
do $$
declare
  t text;
  tables text[] := array[
    'ledger_entries','bookings','partners','partner_month_status',
    'camp_weeks','camp_guests','camp_tab_items',
    'monthly_cost_profiles',
    'instructor_directory','instructor_lessons',
    'location_state_store','location_menus','camp_staff_directory'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_audit_delete on public.%I', t);
    execute format('create trigger trg_audit_delete before delete on public.%I for each row execute function public.fn_audit_delete()', t);
  end loop;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Verification:
--    select trigger_name, event_object_table from information_schema.triggers
--    where trigger_name = 'trg_audit_delete' order by event_object_table;
--  Expected: 13 rows (one per table above).
-- ════════════════════════════════════════════════════════════════════════════
