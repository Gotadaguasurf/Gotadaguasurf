-- ════════════════════════════════════════════════════════════════════════════
--  Bookinglayer reports by email → the app, automatically (mail-ingest, 17 Nov 2026).
--
--  mail-ingest reads accounting@ every 15 minutes. The hourly camp reports («AUTO Marrocos / Sri Lanka -
--  hourly para a app») are imported into camp_trips + camp_week_guests with the rules of the Week / Transport
--  import; the daily «App - Revenue & Partners» report updates public.bookings with the rules of the HQ
--  «Import bookings»; the staff copies («App - Semana …») are only archived. Invoices are never archived.
--
--  SAFE FIRST DEPLOY: bl_report_settings starts in DRY RUN for both kinds and with archiving OFF. In dry run the
--  function parses and logs what it WOULD change (bl_report_runs.changes) and writes nothing else. Miguel reads
--  the runs, then flips the flags (end of this file).
--
--  1 · bl_report_settings  (one row: dry_run_camp, dry_run_revenue, archive, cancel_vanished)
--  2 · bl_report_runs      (one row per report email — idempotent on the Gmail message id — and per manual import)
--  3 · bookings_snapshots  (every bookings row as it was before the Revenue import changed it)
--  4 · mail_ingest_account.scopes (what Google granted: archiving needs gmail.modify)
--  5 · camp_trips_can_manage: also true for the service role (the Edge Function), so camp_trips_import runs
--  6 · bl_report_camp_apply / bl_report_bookings_apply: one transaction each (lock per camp, «older than the last
--      import» refused, merges + import + vanished-booking cancels / snapshot + upsert) — service role only
--  7 · bl_report_log_manual (the camp hub logs a manual import) · bl_report_last (Week's «Last import» line)
--      · view bl_report_last_import (last import per camp)
--
--  Requires camp-trips.sql, camp-trips-v2.sql, camp-trips-bl-check.sql (live). Idempotent: safe to run again.
--  NOT run against production by the agent — Miguel runs it.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Settings ───────────────────────────────────────────────────────────────
create table if not exists public.bl_report_settings (
  id int primary key default 1 check (id = 1),
  dry_run_camp boolean not null default true,      -- true = log what the camp import would change, write nothing
  dry_run_revenue boolean not null default true,   -- the same for the Revenue & Partners → bookings import
  archive boolean not null default false,          -- remove INBOX from report emails (needs gmail.modify on accounting@)
  cancel_vanished boolean not null default true,   -- cancel future trips of bookings that left the report (check-out inside −3..+32)
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.bl_report_settings (id) values (1) on conflict (id) do nothing;
alter table public.bl_report_settings enable row level security;
drop policy if exists bl_report_settings_hq_read on public.bl_report_settings;
create policy bl_report_settings_hq_read on public.bl_report_settings for select using (public.is_hq_member());

-- ── 2 · Runs ───────────────────────────────────────────────────────────────────
create table if not exists public.bl_report_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'mail' check (source in ('mail', 'manual')),
  account_email text,
  message_id text unique,                 -- Gmail id: the same email is never processed twice (null for manual)
  received_at timestamptz,                -- when the email arrived (manual: when it was saved)
  subject text,
  filename text,
  report text check (report in ('camp', 'staff_copy', 'revenue', 'none')),
  location_id uuid references public.locations(id),
  location_slug text,
  rows int,
  window_from date,                       -- the report's check-out window (camp reports: received −3 .. +32)
  window_to date,
  -- processing · dry_run · imported · superseded (an older report) · copy (staff copy) · refused (bad file) · error · ignored (not a report)
  status text not null default 'processing',
  changes jsonb,                          -- what the import changes / would change (lib/bl-ingest.js summarize)
  result jsonb,                           -- what camp_trips_import / the bookings upsert returned
  error text,
  import_id uuid,                         -- camp_week_guests.import_id of this import (Week's window guard)
  archived_at timestamptz,
  archive_error text,
  by_user uuid,
  by_name text,
  finished_at timestamptz
);
create index if not exists bl_report_runs_loc_idx on public.bl_report_runs (location_id, report, status, received_at desc);
create index if not exists bl_report_runs_created_idx on public.bl_report_runs (created_at desc);
alter table public.bl_report_runs enable row level security;
drop policy if exists bl_report_runs_read on public.bl_report_runs;
create policy bl_report_runs_read on public.bl_report_runs for select
  using (public.is_hq_member() or (location_id is not null and public.has_location_access(location_id)));
-- no insert / update / delete policy: written by the Edge Function (service role) and the definer functions below

-- ── 3 · Bookings snapshots ─────────────────────────────────────────────────────
create table if not exists public.bookings_snapshots (
  id bigint generated always as identity primary key,
  run_id uuid references public.bl_report_runs(id) on delete set null,
  booking_ref text not null,
  row jsonb not null,                     -- the whole bookings row before the change
  taken_at timestamptz not null default now()
);
create index if not exists bookings_snapshots_ref_idx on public.bookings_snapshots (booking_ref, taken_at desc);
alter table public.bookings_snapshots enable row level security;
drop policy if exists bookings_snapshots_hq_read on public.bookings_snapshots;
create policy bookings_snapshots_hq_read on public.bookings_snapshots for select using (public.is_hq_member());

-- ── 4 · Granted scopes of each mailbox ─────────────────────────────────────────
alter table public.mail_ingest_account add column if not exists scopes text;

-- ── 5 · The Edge Function may run the camp import ──────────────────────────────
--   camp_trips_import checks camp_trips_can_manage(), which reads auth.uid(): the service role has none.
--   Same body as live (17 Nov 2026) + the service-role line. The service key already bypasses RLS.
create or replace function public.camp_trips_can_manage(p_location uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.has_full_location_access(p_location) and not public.is_local_manager(p_location))
      or public.is_hq_member()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

-- ── 6a · Camp report: one transaction ──────────────────────────────────────────
--   p_merges = [{survivor: uuid, patch: {...}, others: [{id, needs_resend}]}] (lib/bl-report.js planTrips → merge)
--   p_vanish = trips of bookings that left the report with their check-out inside the window (future, unpaid)
create or replace function public.bl_report_camp_apply(
  p_run uuid, p_location uuid, p_received_at timestamptz, p_merges jsonb, p_vanish uuid[],
  p_export_date date, p_refs_present text[], p_trips jsonb, p_guests jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_last timestamptz; m jsonb; o jsonb; p jsonb; v_res jsonb; v_today date; v_merged int := 0; v_vanished int := 0;
  v_flag constant text := 'booking no longer in the Bookinglayer report (cancelled there?) — cancelled by the automatic import';
begin
  -- one import per camp at a time; a second run waits here, then sees the newer import below
  perform pg_advisory_xact_lock(hashtext('bl_report_camp:' || p_location::text));
  select max(received_at) into v_last from public.bl_report_runs
   where location_id = p_location and report = 'camp' and source = 'mail' and status = 'imported' and id <> p_run;
  if v_last is not null and p_received_at < v_last then
    update public.bl_report_runs set status = 'superseded', error = 'older than the report already imported (' || v_last || ')', finished_at = now() where id = p_run;
    return jsonb_build_object('superseded', true, 'last_imported', v_last);
  end if;
  v_today := (now() at time zone public.camp_trips__tz(p_location))::date;

  -- One transfer kept as per-guest trips → one survivor with everyone, the others «merged» (as saveImport in transport.js)
  for m in select * from jsonb_array_elements(coalesce(p_merges, '[]'::jsonb)) loop
    p := coalesce(m->'patch', '{}'::jsonb);
    update public.camp_trips set
      guest_names    = coalesce(p->>'guest_names', guest_names),
      pax            = coalesce((p->>'pax')::int, pax),
      vehicle        = coalesce(p->>'vehicle', vehicle),
      trip_time      = coalesce(p->>'trip_time', trip_time),
      flight         = coalesce(p->>'flight', flight),
      expected_price = coalesce((p->>'expected_price')::numeric, expected_price),
      guest_phone    = coalesce(p->>'guest_phone', guest_phone),
      import_flags   = case when p ? 'import_flags' then array(select jsonb_array_elements_text(p->'import_flags')) else import_flags end,
      import_key     = coalesce(p->>'import_key', import_key),
      status         = coalesce(p->>'status', status),
      cancel_reason  = case when p ? 'cancel_reason' then p->>'cancel_reason' else cancel_reason end,
      needs_resend   = case when p ? 'needs_resend' then (p->>'needs_resend')::boolean else needs_resend end
     where id = (m->>'survivor')::uuid and location_id = p_location and payment_entry_id is null;
    if not found then raise exception 'merge: trip % is gone or paid — nothing imported', m->>'survivor'; end if;
    for o in select * from jsonb_array_elements(coalesce(m->'others', '[]'::jsonb)) loop
      update public.camp_trips set status = 'merged', merged_into = (m->>'survivor')::uuid, cancel_reason = 'merged — same transfer',
             needs_resend = coalesce((o->>'needs_resend')::boolean, false)
       where id = (o->>'id')::uuid and location_id = p_location and payment_entry_id is null and status <> 'merged';
      if not found then raise exception 'merge: trip % is gone, paid or already merged — nothing imported', o->>'id'; end if;
    end loop;
    v_merged := v_merged + 1;
  end loop;

  v_res := public.camp_trips_import(p_location, p_export_date, false, p_refs_present, '{}'::text[], p_trips, p_guests);

  -- Bookings that left the report while their check-out is inside the window: the future, unpaid trips are cancelled
  -- with the reason an import uses ('bookinglayer'), so the trip comes back by itself if the booking returns.
  update public.camp_trips c set status = 'cancelled', cancel_reason = 'bookinglayer', needs_resend = c.status in ('sent', 'confirmed'),
         import_flags = case when v_flag = any(coalesce(c.import_flags, '{}')) then c.import_flags else array_append(coalesce(c.import_flags, '{}'), v_flag) end
   where c.id = any(coalesce(p_vanish, '{}'::uuid[])) and c.location_id = p_location and c.source = 'bookinglayer'
     and c.status in ('planned', 'sent', 'confirmed') and c.payment_entry_id is null and c.trip_date >= v_today
     and not (c.booking_ref = any(coalesce(p_refs_present, '{}'::text[])));
  get diagnostics v_vanished = row_count;

  v_res := coalesce(v_res, '{}'::jsonb) || jsonb_build_object('merged', v_merged, 'vanished_cancelled', v_vanished);
  update public.bl_report_runs set status = 'imported', result = v_res, import_id = nullif(v_res->>'import_id', '')::uuid, finished_at = now() where id = p_run;
  return v_res;
end $$;

-- ── 6b · Revenue & Partners: snapshot + upsert in one transaction ──────────────
--   p_rows = the full bookings rows that change (lib/bl-revenue.js plan → upserts); p_new_partners = partners to register
create or replace function public.bl_report_bookings_apply(p_run uuid, p_received_at timestamptz, p_rows jsonb, p_new_partners text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_snap int := 0; v_up int := 0; v_part int := 0; v_res jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('bl_report_revenue'));
  select max(received_at) into v_last from public.bl_report_runs where report = 'revenue' and status = 'imported' and id <> p_run;
  if v_last is not null and p_received_at < v_last then
    update public.bl_report_runs set status = 'superseded', error = 'older than the report already imported (' || v_last || ')', finished_at = now() where id = p_run;
    return jsonb_build_object('superseded', true, 'last_imported', v_last);
  end if;
  -- every row as it was, before it changes
  insert into public.bookings_snapshots (run_id, booking_ref, row)
  select p_run, b.booking_ref, to_jsonb(b) from public.bookings b
   where b.booking_ref in (select x->>'booking_ref' from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x);
  get diagnostics v_snap = row_count;
  -- partners the HQ import would register (existing ones keep their rate, email, type)
  if coalesce(array_length(p_new_partners, 1), 0) > 0 then
    insert into public.partners (name, commission_pct, collects_from_guest, partner_type, is_active)
    select n, 20, true, 'surfcamp', true from unnest(p_new_partners) n where coalesce(trim(n), '') <> ''
    on conflict (name) do nothing;
    get diagnostics v_part = row_count;
  end if;
  insert into public.bookings as b (booking_ref, booker, check_in_on, month_key, total, pax, location, package, partner_name, booking_type,
    partner_commission_pct, commission_amount, net_amount, raw_payload)
  select r.booking_ref, r.booker, r.check_in_on, r.month_key, r.total, r.pax, r.location, r.package, r.partner_name, r.booking_type,
    r.partner_commission_pct, r.commission_amount, r.net_amount, r.raw_payload
    from jsonb_populate_recordset(null::public.bookings, coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r.booking_ref, '') <> ''
  on conflict (booking_ref) do update set booker = excluded.booker, check_in_on = excluded.check_in_on, month_key = excluded.month_key,
    total = excluded.total, pax = excluded.pax, location = excluded.location, package = excluded.package, partner_name = excluded.partner_name,
    booking_type = excluded.booking_type, partner_commission_pct = excluded.partner_commission_pct, commission_amount = excluded.commission_amount,
    net_amount = excluded.net_amount, raw_payload = excluded.raw_payload, updated_at = now();
  get diagnostics v_up = row_count;
  v_res := jsonb_build_object('snapshots', v_snap, 'upserted', v_up, 'partners_created', v_part);
  update public.bl_report_runs set status = 'imported', result = v_res, finished_at = now() where id = p_run;
  return v_res;
end $$;

revoke all on function public.bl_report_camp_apply(uuid, uuid, timestamptz, jsonb, uuid[], date, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.bl_report_camp_apply(uuid, uuid, timestamptz, jsonb, uuid[], date, text[], jsonb, jsonb) to service_role;
revoke all on function public.bl_report_bookings_apply(uuid, timestamptz, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.bl_report_bookings_apply(uuid, timestamptz, jsonb, text[]) to service_role;

-- ── 7a · A manual import (Week → Import Guests file / report) is logged too ────
create or replace function public.bl_report_log_manual(p_location uuid, p_file text, p_rows int, p_result jsonb,
  p_window_from date default null, p_window_to date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if not public.camp_trips_can_manage(p_location) then raise exception 'Only the camp manager or HQ can import' using errcode = '42501'; end if;
  select coalesce(nullif(trim(pp.full_name), ''), pp.email) into v_name from public.platform_profiles pp where pp.id = auth.uid();
  if v_name is null and v_email is not null then select nullif(trim(full_name), '') into v_name from public.team_users where lower(email) = lower(v_email) limit 1; end if;
  insert into public.bl_report_runs (source, report, location_id, location_slug, filename, rows, window_from, window_to, status, result, import_id,
    by_user, by_name, received_at, finished_at)
  values ('manual', 'camp', p_location, (select slug from public.locations where id = p_location), left(p_file, 200), p_rows, p_window_from, p_window_to,
    'imported', p_result, nullif(p_result ->> 'import_id', '')::uuid, auth.uid(), coalesce(v_name, v_email), now(), now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.bl_report_log_manual(uuid, text, int, jsonb, date, date) from public, anon;
grant execute on function public.bl_report_log_manual(uuid, text, int, jsonb, date, date) to authenticated;

-- ── 7b · The last import of a camp (automatic or by hand) ──────────────────────
--   at = when the report was sent (automatic) or saved (by hand).
create or replace function public.bl_report_last(p_location uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_hq_member() or public.has_location_access(p_location) then (
    select jsonb_build_object('at', case when r.source = 'mail' then r.received_at else coalesce(r.finished_at, r.received_at) end,
                              'source', r.source, 'by_name', r.by_name, 'import_id', r.import_id,
                              'window_from', r.window_from, 'window_to', r.window_to, 'filename', r.filename)
      from public.bl_report_runs r
     where r.location_id = p_location and r.report = 'camp' and r.status = 'imported'
     order by case when r.source = 'mail' then r.received_at else coalesce(r.finished_at, r.received_at) end desc
     limit 1) end;
$$;
revoke all on function public.bl_report_last(uuid) from public, anon;
grant execute on function public.bl_report_last(uuid) to authenticated;

-- ── 7c · Last import per camp (and of the Revenue report) ──────────────────────
create or replace view public.bl_report_last_import with (security_invoker = true) as
select distinct on (coalesce(r.location_slug, r.report)) coalesce(r.location_slug, r.report) as camp, r.report, r.source,
       case when r.source = 'mail' then r.received_at else coalesce(r.finished_at, r.received_at) end as imported_report_at,
       r.finished_at, r.by_name, r.rows, r.result
  from public.bl_report_runs r
 where r.status = 'imported'
 order by coalesce(r.location_slug, r.report), case when r.source = 'mail' then r.received_at else coalesce(r.finished_at, r.received_at) end desc;
grant select on public.bl_report_last_import to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  After reviewing the dry runs (select received_at, report, location_slug, status, changes, error
--  from bl_report_runs order by created_at desc limit 20):
--    update public.bl_report_settings set dry_run_camp = false, updated_at = now(), updated_by = 'Miguel';     -- camp reports live
--    update public.bl_report_settings set dry_run_revenue = false, updated_at = now(), updated_by = 'Miguel';  -- Revenue live
--    update public.bl_report_settings set archive = true, updated_at = now(), updated_by = 'Miguel';           -- after reconnecting accounting@ with gmail.modify
--  Back to dry run: set the flag to true again. Undo a Revenue import: bookings_snapshots has every row as it was (run_id).
-- ════════════════════════════════════════════════════════════════════════════
