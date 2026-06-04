-- ════════════════════════════════════════════════════════════════════════════
--  Camp Tab — per-guest closing (Morocco mode)
--  Adds camp_guests.closed_at so closed guests survive across devices
-- ════════════════════════════════════════════════════════════════════════════
--
--  Spec: docs/morocco-camp-tab-per-guest-spec.md
--
--  In per_guest mode (Morocco), the "Close guest" button stamps a timestamp
--  on the guest row. The hub UI filters closed guests out of every active
--  list. The data is NEVER deleted — closed guests can still be found in
--  the database, can be re-opened later (clear closed_at), and their full
--  item history is preserved.
--
--  In weekly mode (Sri Lanka), this column is simply unused. The existing
--  "Close week" flow continues to work; nothing reads closed_at there.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.camp_guests
  add column if not exists closed_at timestamptz;

-- ── Quick visibility into who's been closed where ──────────────────────────
-- Useful if you ever wonder "where did that guest go?" — they're filtered
-- out of the camp tab but still here.
select
  l.slug,
  count(cg.*)                                  as total_guests,
  count(*) filter (where cg.closed_at is null) as still_active,
  count(*) filter (where cg.closed_at is not null) as closed
from public.camp_guests cg
join public.locations    l on l.id = cg.location_id
group by l.slug
order by l.slug;
