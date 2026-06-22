-- ════════════════════════════════════════════════════════════════════════════
--  CRM v2 — schema expansion (team, contacts, pipelines, tasks, meetings,
--                            emails, partner lifecycle on outreach_contacts)
--
--  Builds on the existing outreach_contacts (companies). Adds the seven
--  new tables your spec proposed, plus the seven extension columns on
--  outreach_contacts.
--
--  Idempotent: every statement uses IF NOT EXISTS / on conflict / a DO
--  block. Safe to re-run.
--
--  Heads-up: this SQL ONLY creates the schema. The CRM UI today still
--  reads outreach_contacts as a flat row with embedded segment / status /
--  deal_value etc. None of these new tables wire to anything visible
--  until each surface gets its own UI rewrite (tasks panel, pipelines
--  switcher, multi-contact roster, etc.). So applying this is free —
--  it doesn't change behaviour — but on its own it doesn't add features.
--
--  Spec deviations + why:
--    • `team_users.id default auth.uid()` won't work — column defaults
--      run before any auth context exists. Changed to
--      `references auth.users(id) on delete cascade` and inserted as
--      `(id, ...) values (auth.uid(), ...)` by the app.
--    • Added unique index on contacts(company_id) where is_primary = true
--      so a company can only have one primary contact at the DB level.
--    • Added auth full-access RLS policies on every new table, mirroring
--      the existing CRM tables. Tighten later if/when multi-tenant.
--    • CHECK constraint on outreach_contacts.lifecycle accepts only the
--      three documented values.
--    • Seeded the three default pipelines + their stages so the UI
--      doesn't have to handle "no pipelines exist" empty state on first
--      load.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1. TEAM_USERS ──────────────────────────────────────────────────────────
create table if not exists public.team_users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email     text,
  role      text,                                  -- Owner / Admin / Sales / AccountManager / ...
  active    boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_users_active on public.team_users(active);

-- ── 2. CONTACTS (people inside companies) ──────────────────────────────────
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.outreach_contacts(id) on delete cascade,
  name text, role text, email text, phone text, linkedin text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_contacts_company on public.contacts(company_id);
create index if not exists idx_contacts_email   on public.contacts(lower(email)) where email is not null;
-- Only one primary contact per company (DB-enforced).
create unique index if not exists uq_contacts_primary_per_company
  on public.contacts(company_id) where is_primary = true;

-- ── 3. PIPELINES + STAGES ──────────────────────────────────────────────────
create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                        -- 'sales' / 'account_mgmt' / 'partnerships'
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  key  text not null,
  name text not null,
  sort_order int not null default 0,
  is_won  boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  unique (pipeline_id, key)
);

create index if not exists idx_pipeline_stages_pipeline on public.pipeline_stages(pipeline_id, sort_order);

-- ── 4. CONTACT ↔ PIPELINE ──────────────────────────────────────────────────
-- A company can sit in several pipelines, but only ONE row per
-- (company, pipeline) — enforced by the unique constraint.
create table if not exists public.contact_pipeline (
  id uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.outreach_contacts(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id    uuid references public.pipeline_stages(id),
  owner_id    uuid references public.team_users(id),
  entered_stage_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (company_id, pipeline_id)
);

create index if not exists idx_contact_pipeline_stage on public.contact_pipeline(stage_id);
create index if not exists idx_contact_pipeline_owner on public.contact_pipeline(owner_id);
create index if not exists idx_contact_pipeline_company on public.contact_pipeline(company_id);

-- ── 5. TASKS ───────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.outreach_contacts(id) on delete cascade,
  owner_id   uuid references public.team_users(id),
  title text not null,
  type  text,                                       -- call / email / meeting / follow_up / admin
  due_at  timestamptz,
  done_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- Open tasks for the current owner, sorted by due date — the "Today" view.
create index if not exists idx_tasks_owner_due_open
  on public.tasks(owner_id, due_at) where done_at is null;
create index if not exists idx_tasks_company on public.tasks(company_id);

-- ── 6. MEETINGS ────────────────────────────────────────────────────────────
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.outreach_contacts(id) on delete cascade,
  owner_id   uuid references public.team_users(id),
  met_at  timestamptz,
  attendees text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_meetings_company on public.meetings(company_id, met_at desc);

-- ── 7. EMAIL_MESSAGES ──────────────────────────────────────────────────────
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.outreach_contacts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  direction text check (direction in ('outbound','inbound')),
  from_addr text, to_addr text, subject text, body text,
  thread_id text,                                  -- ties replies together (Gmail/IMAP thread id)
  provider_msg_id text,                            -- raw message id from the provider
  status text,                                     -- queued / sent / delivered / bounced / replied
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_messages_company on public.email_messages(company_id, sent_at desc);
create index if not exists idx_email_messages_thread  on public.email_messages(thread_id) where thread_id is not null;
create index if not exists idx_email_messages_msg_id  on public.email_messages(provider_msg_id) where provider_msg_id is not null;

-- ── 8. EXTEND outreach_contacts ────────────────────────────────────────────
alter table public.outreach_contacts
  add column if not exists lifecycle text default 'lead',
  add column if not exists account_manager_id uuid references public.team_users(id),
  add column if not exists contract_start date,
  add column if not exists contract_end   date,
  add column if not exists contract_terms text,
  add column if not exists commission_pct numeric,
  add column if not exists last_interaction_at timestamptz;

-- Constrain lifecycle to the three documented values.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'outreach_contacts_lifecycle_chk') then
    alter table public.outreach_contacts
      add constraint outreach_contacts_lifecycle_chk
      check (lifecycle in ('lead','active_partner','churned'));
  end if;
end $$;

create index if not exists idx_outreach_contacts_lifecycle on public.outreach_contacts(lifecycle);
create index if not exists idx_outreach_contacts_acct_mgr  on public.outreach_contacts(account_manager_id) where account_manager_id is not null;
create index if not exists idx_outreach_contacts_contract  on public.outreach_contacts(contract_end) where contract_end is not null;

-- ── 9. RLS (authenticated full access; tighten later if multi-tenant) ──────
alter table public.team_users        enable row level security;
alter table public.contacts          enable row level security;
alter table public.pipelines         enable row level security;
alter table public.pipeline_stages   enable row level security;
alter table public.contact_pipeline  enable row level security;
alter table public.tasks             enable row level security;
alter table public.meetings          enable row level security;
alter table public.email_messages    enable row level security;

do $$
  declare t text;
begin
  foreach t in array array[
    'team_users','contacts','pipelines','pipeline_stages',
    'contact_pipeline','tasks','meetings','email_messages'
  ] loop
    execute format('drop policy if exists "auth full access on %I" on public.%I', t, t);
    execute format(
      'create policy "auth full access on %I" on public.%I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ── 10. SEED — three default pipelines + their stages ──────────────────────
insert into public.pipelines (key, name, sort_order) values
  ('sales',        'Sales',              10),
  ('account_mgmt', 'Account Management', 20),
  ('partnerships', 'Partnerships',       30)
on conflict (key) do nothing;

-- Sales stages
insert into public.pipeline_stages (pipeline_id, key, name, sort_order, is_won, is_lost)
select p.id, s.key, s.name, s.sort_order, s.is_won, s.is_lost
  from public.pipelines p
  join (values
    ('lead',        'Lead',        10, false, false),
    ('qualified',   'Qualified',   20, false, false),
    ('proposal',    'Proposal',    30, false, false),
    ('negotiation', 'Negotiation', 40, false, false),
    ('won',         'Won',         50, true,  false),
    ('lost',        'Lost',        60, false, true)
  ) as s(key, name, sort_order, is_won, is_lost) on p.key = 'sales'
on conflict (pipeline_id, key) do nothing;

-- Account-management stages
insert into public.pipeline_stages (pipeline_id, key, name, sort_order, is_won, is_lost)
select p.id, s.key, s.name, s.sort_order, s.is_won, s.is_lost
  from public.pipelines p
  join (values
    ('onboarding', 'Onboarding', 10, false, false),
    ('active',     'Active',     20, true,  false),
    ('at_risk',    'At risk',    30, false, false),
    ('churned',    'Churned',    40, false, true)
  ) as s(key, name, sort_order, is_won, is_lost) on p.key = 'account_mgmt'
on conflict (pipeline_id, key) do nothing;

-- Partnerships stages
insert into public.pipeline_stages (pipeline_id, key, name, sort_order, is_won, is_lost)
select p.id, s.key, s.name, s.sort_order, s.is_won, s.is_lost
  from public.pipelines p
  join (values
    ('exploring', 'Exploring', 10, false, false),
    ('agreed',    'Agreed',    20, false, false),
    ('live',      'Live',      30, true,  false),
    ('ended',     'Ended',     40, false, true)
  ) as s(key, name, sort_order, is_won, is_lost) on p.key = 'partnerships'
on conflict (pipeline_id, key) do nothing;

-- ── 11. Verify ─────────────────────────────────────────────────────────────
select 'team_users' as table_name, count(*) from public.team_users
union all
select 'contacts',          count(*) from public.contacts
union all
select 'pipelines',         count(*) from public.pipelines
union all
select 'pipeline_stages',   count(*) from public.pipeline_stages
union all
select 'contact_pipeline',  count(*) from public.contact_pipeline
union all
select 'tasks',             count(*) from public.tasks
union all
select 'meetings',          count(*) from public.meetings
union all
select 'email_messages',    count(*) from public.email_messages;
-- Expected: 0 rows in all except pipelines (3) and pipeline_stages (14).
