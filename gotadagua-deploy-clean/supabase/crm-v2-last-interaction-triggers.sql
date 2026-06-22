-- ════════════════════════════════════════════════════════════════════════════
--  CRM v2 — auto-maintain outreach_contacts.last_interaction_at
--
--  The column was added by crm-v2-schema-expansion.sql but never populated.
--  This script:
--    1. Backfills it once from the best available signal.
--    2. Installs triggers on outreach_activity / tasks / meetings / contacts
--       so the column stays current without any JS code touching it.
--
--  Semantics:
--    last_contacted_at  = last time WE sent them an email (unchanged).
--                          Use this for "no reply since" / "follow up overdue".
--    last_interaction_at = ANY movement on the account: outbound, status
--                          change, follow-up set, replied marker, task
--                          completed, meeting added, person added, group
--                          activity. Use this for "abandoned account" /
--                          "cold for X days" / "needs re-engagement".
--
--  Idempotent: every CREATE uses OR REPLACE / IF NOT EXISTS.
--
--  How to run: paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. BACKFILL ────────────────────────────────────────────────────────────
-- Seed with the best date we already have on each row. greatest() skips
-- nulls, so a row with no last_contacted_at still gets updated_at or
-- created_at.
update public.outreach_contacts
   set last_interaction_at = greatest(
       last_contacted_at,
       coalesce(updated_at, created_at)
     )
 where last_interaction_at is null;

-- ── 2. TOUCH FUNCTION ──────────────────────────────────────────────────────
-- Single helper used by all the per-table triggers below. Takes the
-- company id, sets the parent's stamp to now(). Defined SECURITY DEFINER
-- so it can write even when the triggering user only has insert rights
-- on the child table.
create or replace function public.touch_outreach_interaction(p_company_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.outreach_contacts
     set last_interaction_at = now()
   where id = p_company_id;
$$;

-- ── 3. TRIGGER FUNCTIONS ───────────────────────────────────────────────────
-- outreach_activity already captures email_sent, status_changed,
-- follow_up_set, replied_marked, group_added, group_updated, group_stage,
-- etc. One trigger here covers all of them.
create or replace function public._trg_activity_touch()
returns trigger language plpgsql as $$
begin
  perform public.touch_outreach_interaction(new.contact_id);
  return new;
end;
$$;

-- tasks: bump on insert (new task = activity), and on update when done_at
-- transitions from null to a value (task completed).
create or replace function public._trg_tasks_touch()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.touch_outreach_interaction(new.company_id);
  elsif tg_op = 'UPDATE' then
    -- Only when completion state changes, or other fields edited.
    if (old.done_at is null and new.done_at is not null)
       or old.title is distinct from new.title
       or old.due_at is distinct from new.due_at
       or old.notes is distinct from new.notes
       or old.type  is distinct from new.type
    then
      perform public.touch_outreach_interaction(new.company_id);
    end if;
  end if;
  return new;
end;
$$;

-- meetings: any insert is an interaction (no UI yet but supported).
create or replace function public._trg_meetings_touch()
returns trigger language plpgsql as $$
begin
  perform public.touch_outreach_interaction(new.company_id);
  return new;
end;
$$;

-- contacts (people roster): any insert/update on a person is movement.
create or replace function public._trg_people_touch()
returns trigger language plpgsql as $$
begin
  perform public.touch_outreach_interaction(new.company_id);
  return new;
end;
$$;

-- ── 4. INSTALL TRIGGERS ────────────────────────────────────────────────────
-- drop + create so this script can be re-run after editing the functions
-- above without "already exists" errors.
drop trigger if exists trg_activity_touches_interaction on public.outreach_activity;
create trigger trg_activity_touches_interaction
after insert on public.outreach_activity
for each row execute function public._trg_activity_touch();

drop trigger if exists trg_tasks_touch_interaction on public.tasks;
create trigger trg_tasks_touch_interaction
after insert or update on public.tasks
for each row execute function public._trg_tasks_touch();

drop trigger if exists trg_meetings_touch_interaction on public.meetings;
create trigger trg_meetings_touch_interaction
after insert on public.meetings
for each row execute function public._trg_meetings_touch();

drop trigger if exists trg_people_touch_interaction on public.contacts;
create trigger trg_people_touch_interaction
after insert or update on public.contacts
for each row execute function public._trg_people_touch();

-- ── 5. Verify ──────────────────────────────────────────────────────────────
-- Count companies that still have a NULL last_interaction_at (should be
-- exactly the ones with no last_contacted_at AND no updated_at AND no
-- created_at — i.e. zero in practice).
select
  count(*) filter (where last_interaction_at is null) as still_null,
  count(*) filter (where last_interaction_at is not null) as populated,
  count(*) as total
from public.outreach_contacts;
-- Expected: still_null = 0 (or very small), populated ≈ total.
