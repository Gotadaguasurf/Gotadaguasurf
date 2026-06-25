-- ════════════════════════════════════════════════════════════════════════════
--  CRM v2 — link tasks to sequence runs
--
--  Adds sequence_run_id + sequence_step to tasks so a "Send: Step N" task
--  knows which run it belongs to. The auto-stop-on-reply path uses the
--  run id; the mark-done path uses the step number to advance the
--  run's current_step counter.
--
--  Both new columns are nullable (most tasks aren't part of a sequence).
--  on delete set null on the FK so deleting a sequence keeps its tasks
--  alive (the user might still want to send them) without orphaned IDs.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.tasks
  add column if not exists sequence_run_id uuid references public.outreach_sequence_runs(id) on delete set null,
  add column if not exists sequence_step int;

create index if not exists idx_tasks_sequence_run
  on public.tasks(sequence_run_id) where sequence_run_id is not null;

select count(*) as tasks_total,
       count(sequence_run_id) as tasks_in_sequence
  from public.tasks;
