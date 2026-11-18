-- ════════════════════════════════════════════════════════════════════════════
--  Audit 18 Nov 2026 · wave 4 · security and automation (SEC-*, AUT-*, SEAM-19)
--
--  PART 1 runs as is: idempotent (safe to run twice), changes no business row,
--  nothing granted to anon or public. Every page and Edge Function already works
--  BEFORE this file runs (the functions skip a missing table silently).
--  PART 2 is COMMENTED OUT: each block waits for Miguel's yes, with the count a
--  read-only SELECT gave on 18 Nov 2026. Run its SELECT first; if the number
--  differs, stop and ask.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
--  PART 1 — runs as is
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1.1 automation_runs (AUT-09) ───────────────────────────────────────────
-- One line per run of a scheduled job. Today: daily-backup writes one at the end
-- of every night (ok = every table whole in every tier). The cron's own status
-- only means «the HTTP call was queued», and the function's answer is deleted
-- after 6 hours (pg_net.ttl), so a failed 03:00 backup was never seen.
-- Service role writes; nobody reads it directly (hq_automation_health below).
create table if not exists public.automation_runs (
  id       bigint generated always as identity primary key,
  job      text        not null,
  at       timestamptz not null default now(),
  ok       boolean     not null,
  summary  text,
  details  jsonb
);
create index if not exists automation_runs_job_at_idx on public.automation_runs (job, at desc);
alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from anon, authenticated;
comment on table public.automation_runs is
  'One line per run of a scheduled job (daily-backup since 18 Nov 2026, audit AUT-09). Service role only; read through hq_automation_health().';


-- ── 1.2 client_errors (error-monitor.js) ───────────────────────────────────
-- A page error that a logged-in person hit (uncaught error or failed promise),
-- sent by /error-monitor.js: at most 3 per page load, no query strings, never
-- the page's data. Insert-only for the person themselves; only Miguel reads.
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid        not null default auth.uid(),
  page        text        not null check (length(page) <= 200),
  kind        text        not null check (kind in ('window.error', 'unhandledrejection')),
  message     text        not null check (length(message) <= 500),
  source      text        check (length(source) <= 300),
  user_agent  text        check (length(user_agent) <= 200)
);
create index if not exists client_errors_at_idx on public.client_errors (at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant insert (page, kind, message, source, user_agent) on public.client_errors to authenticated;
drop policy if exists client_errors_insert_own on public.client_errors;
create policy client_errors_insert_own on public.client_errors
  for insert to authenticated with check (user_id = auth.uid());
comment on table public.client_errors is
  'Page errors sent by /error-monitor.js (audit 18 Nov 2026). Insert-only for the person themselves; read through hq_automation_health() (owner only).';


-- ── 1.3 hq_automation_health() (AUT-09) ────────────────────────────────────
-- Owner only (same guard as hq_my_tasks). For a «Backup» and an «App errors»
-- row in My tasks — the HQ page wiring is not in this wave; the function is
-- ready for it:
--   backup.last_at / ok / summary / hours_since_ok  → overdue when the last ok
--     run is older than 26 h or the last run failed
--   app_errors.last_7_days and the 5 most frequent messages
create or replace function public.hq_automation_health()
returns json
language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if auth.uid() is not null and not public.is_global_admin() then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  select json_build_object(
    'generated_at', now(),
    'backup', (select json_build_object(
                 'last_at', r.at, 'ok', r.ok, 'summary', r.summary,
                 'last_ok_at', (select max(at) from automation_runs where job = 'daily-backup' and ok),
                 'hours_since_ok', round(extract(epoch from now() - (select max(at) from automation_runs where job = 'daily-backup' and ok)) / 3600.0, 1))
               from automation_runs r where r.job = 'daily-backup' order by r.at desc limit 1),
    'app_errors', json_build_object(
      'last_7_days', (select count(*) from client_errors where at > now() - interval '7 days'),
      'top', coalesce((select json_agg(x) from (
                select message, page, count(*) as n, max(at) as last_at, count(distinct user_id) as people
                  from client_errors where at > now() - interval '7 days'
                 group by message, page order by count(*) desc, max(at) desc limit 5) x), '[]'::json))
  ) into v;
  return v;
end $$;
revoke all on function public.hq_automation_health() from public, anon;
grant execute on function public.hq_automation_health() to authenticated;


-- ── 1.4 The two dead crons off (AUT-08, SEAM-19) ───────────────────────────
-- drive-sync-4x and run-sri-lanka-month-end still fire with a placeholder secret
-- and get 401 (drive-sync 4× a day, «succeeded» in the cron log). A working
-- secret would do harm: drive-sync would re-read every PDF mail-ingest filed and
-- add it again; run-month-end would bring back automatic salaries (manual since
-- 28 Oct 2026). Switched OFF, not deleted: `select cron.alter_job(<jobid>,
-- active := true)` undoes it. The functions themselves now also refuse unless
-- DRIVE_SYNC_ENABLED / MONTH_END_ENABLED = 'true'.
do $$
declare j record;
begin
  for j in select jobid, jobname from cron.job where jobname in ('drive-sync-4x', 'run-sri-lanka-month-end') and active loop
    perform cron.alter_job(j.jobid, active := false);
    raise notice 'cron job % (%) switched off', j.jobname, j.jobid;
  end loop;
end $$;


-- ── 1.5 The backup cron waits for its answer (AUT-09) ──────────────────────
-- The run takes about 20 s; with no timeout_milliseconds pg_net stops waiting
-- after its default 5,000 ms, so the backup's answer is never kept in
-- net._http_response. Adds the timeout to the existing command, keeping its key.
-- (The answer still lasts only 6 h there: automation_runs is the record.)
do $$
declare j record;
begin
  for j in select jobid, command from cron.job where jobname = 'gotadagua_daily_backup' and command !~* 'timeout_milliseconds' loop
    perform cron.alter_job(j.jobid, command := regexp_replace(j.command, '(body\s*:=\s*''\{\}''::jsonb)', '\1, timeout_milliseconds := 120000'));
    raise notice 'backup cron: timeout_milliseconds := 120000 added';
  end loop;
end $$;


-- ── 1.6 Functions anyone could call without logging in (SEC-02, SEC-13) ────
-- touch_outreach_interaction: SECURITY DEFINER and executable by anon (sets
-- last_interaction_at on any company). The CRM's insert triggers call it as the
-- logged-in user, so authenticated keeps it.
revoke execute on function public.touch_outreach_interaction(uuid) from public, anon;
grant  execute on function public.touch_outreach_interaction(uuid) to authenticated, service_role;
-- The two auth.users trigger functions: a trigger does not need EXECUTE, so no
-- client needs it either. handle_new_auth_user is the only SECURITY DEFINER
-- function in public without a search_path (legacy, masked by
-- handle_platform_user; dropping it is in PART 2).
alter function public.handle_new_auth_user() set search_path = public;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.handle_platform_user() from public, anon, authenticated;


-- ── 1.7 An invitee may only mark their own invite accepted (SEC-20) ────────
-- Policy invitations_self_accept lets the invited person UPDATE their own
-- invitation row, every column (role, token, expiry). The hub only ever sets
-- status = 'accepted', accepted_at and updated_at (index.html
-- acceptPendingInviteForCurrentUser). For anyone but Miguel and the service
-- role every other column silently keeps its value. Never raises.
create or replace function public.fn_invitation_self_accept_only()
returns trigger
language plpgsql set search_path = public as $$
declare
  v_status text := new.status;
  v_accepted_at timestamptz := new.accepted_at;
  v_updated_at timestamptz := new.updated_at;
begin
  if auth.uid() is null or public.is_global_admin() then
    return new;
  end if;
  new := old;
  if v_status = 'accepted' then
    new.status := 'accepted';
    new.accepted_at := v_accepted_at;
  end if;
  new.updated_at := v_updated_at;
  return new;
end $$;
revoke execute on function public.fn_invitation_self_accept_only() from public, anon;
drop trigger if exists trg_invitation_self_accept_only on public.workspace_invitations;
create trigger trg_invitation_self_accept_only
  before update on public.workspace_invitations
  for each row execute function public.fn_invitation_self_accept_only();


-- ── 1.8 Exchange rates: only team members add one (SEC-09, first half) ─────
-- Policy daily_fx_rates_insert_auth was «with check (true)»: any login — even
-- one with no area at all — could store the day's rate first, and the first
-- writer wins for every camp. Now: an active person with at least one active
-- area (every camp hub and Camp Tab account has one). Reading is unchanged.
-- The second half (a sane range per currency, DATA-05) waits for the rate fix.
create or replace function public.has_active_membership()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_global_admin()
      or exists (select 1 from workspace_memberships m
                   join platform_profiles p on p.id = m.user_id and p.active
                  where m.user_id = auth.uid() and m.active);
$$;
revoke all on function public.has_active_membership() from public, anon;
grant execute on function public.has_active_membership() to authenticated;
drop policy if exists daily_fx_rates_insert_auth on public.daily_fx_rates;
drop policy if exists daily_fx_rates_insert_member on public.daily_fx_rates;
create policy daily_fx_rates_insert_member on public.daily_fx_rates
  for insert to authenticated with check (public.has_active_membership());


-- ── 1.9 CRM attachments: only the CRM team writes (SEC-15, first half) ─────
-- Any login could upload, replace or delete any file in the crm-assets bucket.
-- Only the CRM page uploads there (crm/index.html, CRM_FILES_BUCKET). Reading
-- stays public (the files travel in emails as links). Cleaning the 796 MB is in
-- the «for Miguel» list, not here.
drop policy if exists "team can upload crm assets"  on storage.objects;
drop policy if exists "team can replace crm assets" on storage.objects;
drop policy if exists "team can delete crm assets"  on storage.objects;
drop policy if exists crm_assets_write_crm_team  on storage.objects;
drop policy if exists crm_assets_update_crm_team on storage.objects;
drop policy if exists crm_assets_delete_crm_team on storage.objects;
create policy crm_assets_write_crm_team on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-assets' and (public.is_global_admin() or public.is_hq_member() or public.is_workspace_member('crm')));
create policy crm_assets_update_crm_team on storage.objects for update to authenticated
  using      (bucket_id = 'crm-assets' and (public.is_global_admin() or public.is_hq_member() or public.is_workspace_member('crm')))
  with check (bucket_id = 'crm-assets' and (public.is_global_admin() or public.is_hq_member() or public.is_workspace_member('crm')));
create policy crm_assets_delete_crm_team on storage.objects for delete to authenticated
  using      (bucket_id = 'crm-assets' and (public.is_global_admin() or public.is_hq_member() or public.is_workspace_member('crm')));


-- ════════════════════════════════════════════════════════════════════════════
--  PART 2 — FOR MIGUEL TO APPROVE. Nothing below runs until uncommented.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 2.1 Cron history purge, weekly (AUT-14) ───────────────────────────────
-- cron.job_run_details is never purged: 88,128 rows on 18 Nov 2026, 79,052 of
-- them older than 14 days (about 37 MB). Deletes LOG lines only, every Sunday.
--   select count(*) from cron.job_run_details where end_time < now() - interval '14 days';   -- 79052 on 18 Nov
-- select cron.schedule('purge-cron-history', '30 4 * * 0',
--   $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);

-- ── 2.2 Legacy sign-up trigger (SEC-13) ───────────────────────────────────
-- on_auth_user_created → handle_new_auth_user copies platform_role from the
-- sign-up metadata; masked today because on_auth_platform_user_created runs
-- first. Drop it, then send ONE test invite and open it.
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_auth_user();
-- And in the dashboard (Authentication → Sign In / Providers): turn OFF «Allow
-- new users to sign up» (invites and password resets use the admin API).

-- ── 2.3 The May 2026 invitation with no account behind it (SEC-20) ────────
-- One 'accepted' invitation whose person has no profile; its access rows give
-- Partners, Portugal and Sri Lanka as OWNER. accept-invite no longer opens it
-- (_shared/invite.ts) once deployed; this closes the row itself.
--   select count(*) from workspace_invitations i
--    where i.status = 'accepted' and not exists (select 1 from platform_profiles p where lower(p.email) = lower(i.email));   -- 1 on 18 Nov
-- update workspace_invitations i set status = 'canceled', updated_at = now()
--  where i.status = 'accepted' and not exists (select 1 from platform_profiles p where lower(p.email) = lower(i.email));
-- -- expect: UPDATE 1

-- ── 2.4 Keys out of the cron table (AUT-13) ───────────────────────────────
-- Job 4 (backup) carries the service-role key and job 14 (mail-ingest) its
-- secret in plain text. Move both into Vault and read them in the command:
--   select vault.create_secret('<service role key>', 'cron_service_key');
--   select vault.create_secret('<backup secret>',    'backup_cron_secret');   -- also set BACKUP_CRON_SECRET on daily-backup
-- then re-create the backup job with
--   headers := jsonb_build_object(
--     'Authorization',   'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_key'),
--     'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_cron_secret'),
--     'Content-Type',    'application/json')
-- (the same for mail-ingest-15min with its x-mail-ingest-secret).

-- ── 2.5 The root cause of SEC-02 (anon can run every new function) ────────
-- In this project every function created in public is executable by anon unless
-- revoked. Turning that off means a future function the accountant portal or
-- the invite page calls without a login needs an explicit
-- «grant execute … to anon». Run only if you want that default:
-- alter default privileges in schema public revoke execute on functions from public, anon;
