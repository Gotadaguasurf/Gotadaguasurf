-- ════════════════════════════════════════════════════════════════════════════
--  CRM v2 — email sequences (drip campaigns)
--
--  Two tables:
--    outreach_sequences        — the template list (e.g. "Surf school 3-step")
--    outreach_sequence_runs    — one row per company × sequence (a "send")
--
--  Each step inside a sequence carries a template_id + a day offset. When
--  the user "Starts" a sequence on a company, the JS layer creates one
--  task per step at the right due date. The sequence_run row keeps the
--  relationship so the auto-stop-on-reply logic can mark it stopped
--  without hunting tasks.
--
--  Idempotent. RLS authenticated full access mirrors the other CRM tables.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. SEQUENCES TABLE ────────────────────────────────────────────────────
create table if not exists public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  -- steps = JSON array of { template_id: uuid, days_after_start: int,
  -- subject_override: text, body_override: text }. JS layer reads + writes.
  steps jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_by uuid references public.team_users(id),
  created_at timestamptz not null default now()
);

-- ── 2. SEQUENCE RUNS ──────────────────────────────────────────────────────
-- One per company × sequence — UNIQUE so you can't accidentally start
-- the same sequence twice on the same company. owner_id stamps WHO ran
-- it, so reports per-team work. stopped_at + stop_reason capture the
-- outcome: 'replied' = auto-stopped after reply detection, 'manual' =
-- user clicked Stop, 'completed' = all steps done.
create table if not exists public.outreach_sequence_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.outreach_contacts(id) on delete cascade,
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  current_step int not null default 0,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  stop_reason text check (stop_reason in ('replied','manual','completed') or stop_reason is null),
  owner_id uuid references public.team_users(id),
  unique (company_id, sequence_id)
);

create index if not exists idx_seq_runs_company on public.outreach_sequence_runs(company_id);
create index if not exists idx_seq_runs_sequence on public.outreach_sequence_runs(sequence_id);
create index if not exists idx_seq_runs_active on public.outreach_sequence_runs(stopped_at) where stopped_at is null;

-- ── 3. RLS ────────────────────────────────────────────────────────────────
alter table public.outreach_sequences      enable row level security;
alter table public.outreach_sequence_runs  enable row level security;

do $$
  declare t text;
begin
  foreach t in array array['outreach_sequences','outreach_sequence_runs']
  loop
    execute format('drop policy if exists "auth full access on %I" on public.%I', t, t);
    execute format(
      'create policy "auth full access on %I" on public.%I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ── 4. Verify ─────────────────────────────────────────────────────────────
select 'outreach_sequences' as table_name, count(*) from public.outreach_sequences
union all
select 'outreach_sequence_runs', count(*) from public.outreach_sequence_runs;
-- Expected: 0 rows in both until the user creates sequences via the UI.
