-- ════════════════════════════════════════════════════════════════════════════
--  OUTREACH CRM — Tables for the B2B sales pipeline in /crm/
--
--  Built for tracking outreach to surf schools / surf camps / partners that
--  Gota d'Agua wants to do business with. Imported from
--  Gota_Dagua_CRM_Master.xlsx (628 organisations as of 2026-06-18).
--
--  Three tables:
--    1. outreach_contacts  — the prospect list (1 row per organisation)
--    2. outreach_templates — reusable email templates with EN/PT versions
--    3. outreach_activity  — append-only log of every status change /
--                            email sent / note added, for audit + dashboard
--
--  Safe to re-run — every statement uses IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. outreach_contacts ─────────────────────────────────────────────────────
create table if not exists public.outreach_contacts (
  id              uuid primary key default gen_random_uuid(),
  company         text not null,
  segment         text,
  country         text,
  city            text,
  email           text,
  email_source    text,
  email_confidence text,
  phone           text,
  website         text,
  -- Pipeline status. Constrained at the app layer (not a DB enum) so we can
  -- add new stages without a migration. Default 'not_started' matches what
  -- the xlsx had as the most common initial value.
  status          text not null default 'not_started',
  last_contacted_at timestamptz,
  follow_up_at    date,
  replied         boolean not null default false,
  notes           text,
  source_url      text,
  -- en or pt — drives which template language is offered when composing.
  language        text not null default 'en',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Useful indexes for the most common list-view filters/sorts.
create index if not exists idx_outreach_contacts_status
  on public.outreach_contacts(status);
create index if not exists idx_outreach_contacts_country
  on public.outreach_contacts(country)
  where country is not null;
create index if not exists idx_outreach_contacts_segment
  on public.outreach_contacts(segment)
  where segment is not null;
create index if not exists idx_outreach_contacts_follow_up
  on public.outreach_contacts(follow_up_at)
  where follow_up_at is not null;
create index if not exists idx_outreach_contacts_last_contacted
  on public.outreach_contacts(last_contacted_at desc nulls last);

-- ── 2. outreach_templates ────────────────────────────────────────────────────
create table if not exists public.outreach_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,           -- 'Intro', 'Follow-up 1', etc.
  subject     text not null,
  body        text not null,
  -- en or pt. A template's "intro" can have two language variants; the
  -- compose UI picks the one matching the contact's language column.
  language    text not null default 'en',
  -- Optional ordering so the picker can show 'Intro' before 'Follow-up 1'.
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_outreach_templates_language
  on public.outreach_templates(language);

-- ── 3. outreach_activity ─────────────────────────────────────────────────────
-- Append-only log. Every meaningful action on a contact lands here, so the
-- detail view can show a chronological timeline and the dashboard can
-- compute "no reply in 14 days" / "follow-ups due this week" reliably.
create table if not exists public.outreach_activity (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.outreach_contacts(id) on delete cascade,
  -- 'status_changed', 'email_sent', 'note_added', 'follow_up_set',
  -- 'replied_marked', 'imported'
  action      text not null,
  old_value   text,
  new_value   text,
  -- Free-form metadata. For 'email_sent' we store the template id and
  -- subject so the timeline can show "Sent 'Intro' template" without
  -- another join.
  meta        jsonb not null default '{}'::jsonb,
  created_by  text,                    -- auth.email() at insert time
  created_at  timestamptz not null default now()
);

create index if not exists idx_outreach_activity_contact
  on public.outreach_activity(contact_id, created_at desc);
create index if not exists idx_outreach_activity_action
  on public.outreach_activity(action);

-- ── updated_at trigger ───────────────────────────────────────────────────────
-- Auto-bump updated_at on every UPDATE so the list view can sort by
-- "recently touched". We attach the same trigger to both tables.
create or replace function public.outreach_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_outreach_contacts_updated_at on public.outreach_contacts;
create trigger trg_outreach_contacts_updated_at
  before update on public.outreach_contacts
  for each row execute function public.outreach_set_updated_at();

drop trigger if exists trg_outreach_templates_updated_at on public.outreach_templates;
create trigger trg_outreach_templates_updated_at
  before update on public.outreach_templates
  for each row execute function public.outreach_set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Mirror the pattern used by partner tables: authenticated users get full
-- access. We don't expose this to anon. If finer per-role access is needed
-- later (e.g. sales rep sees only their own contacts), add a row_owner
-- column and tighten the policy.
alter table public.outreach_contacts  enable row level security;
alter table public.outreach_templates enable row level security;
alter table public.outreach_activity  enable row level security;

drop policy if exists "authenticated full access on outreach_contacts"
  on public.outreach_contacts;
create policy "authenticated full access on outreach_contacts"
  on public.outreach_contacts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated full access on outreach_templates"
  on public.outreach_templates;
create policy "authenticated full access on outreach_templates"
  on public.outreach_templates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated full access on outreach_activity"
  on public.outreach_activity;
create policy "authenticated full access on outreach_activity"
  on public.outreach_activity
  for all
  to authenticated
  using (true)
  with check (true);

-- ── Seed: starter Intro templates (EN + PT) ──────────────────────────────────
-- Idempotent via name+language unique-ish check. If you re-run, no dupes.
insert into public.outreach_templates (name, subject, body, language, sort_order)
select 'Intro', 'Partnership opportunity — Gota d''Água Surf',
$$Hi {{first_name}},

I'm Miguel from Gota d'Água Surf Camp. We operate camps in Portugal, Morocco and Sri Lanka, and I'm reaching out because {{company}} caught my attention.

I'd love to explore a partnership: referrals, joint packages, or anything that brings value to both sides.

Would you have 15 minutes for a quick call next week?

Best,
Miguel Pereira
Gota d'Água Surf
gotadaguasurf.com$$,
'en', 10
where not exists (
  select 1 from public.outreach_templates where name='Intro' and language='en'
);

insert into public.outreach_templates (name, subject, body, language, sort_order)
select 'Intro', 'Oportunidade de parceria — Gota d''Água Surf',
$$Olá {{first_name}},

Sou o Miguel da Gota d'Água Surf Camp. Operamos camps em Portugal, Marrocos e Sri Lanka, e contacto-vos porque {{company}} chamou-me a atenção.

Gostava de explorar uma parceria: referrals, pacotes conjuntos, ou qualquer outra forma de trazer valor a ambos os lados.

Teriam 15 minutos para uma chamada rápida na próxima semana?

Cumprimentos,
Miguel Pereira
Gota d'Água Surf
gotadaguasurf.com$$,
'pt', 10
where not exists (
  select 1 from public.outreach_templates where name='Intro' and language='pt'
);

-- ────────────────────────────────────────────────────────────────────────────
--  Verification (paste at end of run to confirm):
--    select 'contacts' as t, count(*) from public.outreach_contacts
--    union all
--    select 'templates', count(*) from public.outreach_templates
--    union all
--    select 'activity', count(*) from public.outreach_activity;
-- ────────────────────────────────────────────────────────────────────────────
