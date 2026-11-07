-- ════════════════════════════════════════════════════════════════════════════
--  7 Nov 2026: «Forgot password?» now sends through the send-password-reset
--  Edge Function (Gmail, groups@) — Supabase's own mailer only delivers to the
--  project's team members. This table is its rate limit and its log
--  (3 per address per hour, 30 per hour in total). Only the service role
--  writes or reads it; HQ members can read it to see what happened.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  outcome text not null,          -- sent | no_account | gmail_failed
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_requests_email_time on public.password_reset_requests (email, created_at desc);
alter table public.password_reset_requests enable row level security;
drop policy if exists password_reset_requests_hq_read on public.password_reset_requests;
create policy password_reset_requests_hq_read on public.password_reset_requests for select to authenticated using (public.is_hq_member());
