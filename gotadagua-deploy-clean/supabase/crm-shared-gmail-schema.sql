-- ════════════════════════════════════════════════════════════════════════════
--  Shared-Gmail backend — server-side OAuth + send + sync
--
--  Single shared mailbox (groups@gotadaguasurf.com). Authenticated ONCE by
--  the admin; refresh token lives server-side, never in the browser. Edge
--  Functions read it via the service-role key and use it to send / sync.
--
--  Idempotent. RLS locks the tokens table to service-role only so a stolen
--  user JWT can't read refresh tokens.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1. gmail_account — one row per shared mailbox ─────────────────────────
-- For now we expect exactly ONE row (groups@gotadaguasurf.com). The unique
-- constraint on email keeps it that way.
create table if not exists public.gmail_account (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  refresh_token text not null,           -- long-lived; service-role only
  access_token text,                     -- short-lived cache (~1h)
  access_expires_at timestamptz,
  history_id bigint,                     -- last seen Gmail history id for incremental sync
  display_name text,                     -- e.g. "Gota d'Água Surf" (default sender display)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. RLS — service role only ────────────────────────────────────────────
-- No authenticated user (browser session) should ever read refresh tokens.
-- Edge Functions use the service-role key which bypasses RLS by design.
alter table public.gmail_account enable row level security;
drop policy if exists "no client access on gmail_account" on public.gmail_account;
create policy "no client access on gmail_account" on public.gmail_account
  for all to authenticated using (false) with check (false);

-- ── 3. Track who CLICKED Send on each outbound row ────────────────────────
-- The shared mailbox sends them all, but the audit trail needs to know which
-- team_user actually hit the button. NULL for messages predating this
-- migration or seeded by the sync function (those are 'inbound' anyway).
alter table public.email_messages
  add column if not exists sender_user_id uuid references public.team_users(id);

create index if not exists idx_email_messages_sender
  on public.email_messages(sender_user_id) where sender_user_id is not null;

-- ── 4. Verify ─────────────────────────────────────────────────────────────
select 'gmail_account rows' as label, count(*) from public.gmail_account
union all
select 'email_messages.sender_user_id present',
       count(*) filter (where sender_user_id is not null) from public.email_messages;
-- Expected: gmail_account = 0 (gets seeded by the OAuth callback first run),
-- email_messages.sender_user_id = 0 (gets stamped on every server send going
-- forward).
