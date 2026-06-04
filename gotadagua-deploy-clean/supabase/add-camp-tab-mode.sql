-- ════════════════════════════════════════════════════════════════════════════
--  Camp Tab — per-location mode switch
--  Adds locations.camp_tab_mode and sets Morocco to per_guest
-- ════════════════════════════════════════════════════════════════════════════
--
--  Spec: docs/morocco-camp-tab-per-guest-spec.md
--
--  Two modes:
--    'weekly'    — Sri Lanka (default). Saturday→Friday cycle, close-week
--                  generates revenue dated to Friday.
--    'per_guest' — Morocco. No week close. Marking a guest paid writes
--                  revenue to the ledger immediately, dated to today.
--
--  Sri Lanka behaviour is UNCHANGED — column defaults to 'weekly' for
--  every existing row.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Add the column with default 'weekly' ───────────────────────────────
alter table public.locations
  add column if not exists camp_tab_mode text not null default 'weekly';

-- ── 2. Constrain values ───────────────────────────────────────────────────
-- Drop first so re-runs after an enum change don't fail.
alter table public.locations
  drop constraint if exists locations_camp_tab_mode_check;

alter table public.locations
  add constraint locations_camp_tab_mode_check
  check (camp_tab_mode in ('weekly','per_guest'));

-- ── 3. Set Morocco to per_guest. Other locations stay 'weekly'. ───────────
update public.locations
   set camp_tab_mode = 'per_guest'
 where slug = 'morocco';

-- ── 4. Verify ─────────────────────────────────────────────────────────────
select slug, name, currency, camp_tab_mode
  from public.locations
 order by slug;
