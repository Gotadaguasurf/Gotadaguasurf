-- ════════════════════════════════════════════════════════════════════════════
--  SURF SCHOOL RENTALS — Phase 3 columns (start time + expected return)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Miguel: "Devia ter a hora de começo e consoante a hora de começo e
--  quantas horas alugas depois sabes na activity a hora que tem de
--  entregar (dizem se ficaram mais tempo que o que alugaram ou não).
--  Manter se for vários dias manter lá o guest aberto..."
--
--  Two nullable columns:
--    start_time            — when the rental actually starts (student
--                            walks off with the board). Anchored to
--                            "Date of activity" + a HH:MM picker.
--    expected_return_at    — computed client-side from start_time +
--                            duration (1H/2H/3H/Full day → +1/+2/+3/+8h;
--                            Multi-day → + N × 24h). Stored so the
--                            Open rentals list can flag overdue without
--                            re-parsing duration strings.
--
--  Multi-day rentals stay is_returned=false until staff clicks Return —
--  no schema change needed for that, but expected_return_at lets us
--  distinguish "still within the rented period" from "overdue".
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.surf_school_rentals
  add column if not exists start_time         timestamptz,
  add column if not exists expected_return_at timestamptz;

comment on column public.surf_school_rentals.start_time is
  'When the rental actually started (student walked off with the gear). Combined with duration to compute expected_return_at.';
comment on column public.surf_school_rentals.expected_return_at is
  'When the gear is expected back = start_time + duration. Client-computed on save. Used by the Open rentals view to flag overdue rentals.';

create index if not exists idx_surf_rentals_expected_return
  on public.surf_school_rentals(expected_return_at)
  where is_returned = false;
