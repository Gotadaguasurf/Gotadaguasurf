-- ════════════════════════════════════════════════════════════════════════════
--  Camp Tab — per-item paid timestamp (Morocco per_guest mode)
--  Adds camp_tab_items.paid_at so each item carries its own payment date.
-- ════════════════════════════════════════════════════════════════════════════
--
--  Spec: docs/morocco-camp-tab-per-guest-spec.md (Phase 3 — per-item granularity)
--
--  In per_guest mode (Morocco), each tour / drink / etc. on a guest's tab is
--  paid individually on the day it happens — NOT bundled with the whole
--  guest. This column stores the moment each item was settled, so:
--
--    • Each paid item produces ONE ledger_entries row dated to its own day.
--    • Re-hydrate on another device shows the same item as paid (the row
--      survives client reloads and cross-device sync).
--    • Closed-guest history can still inspect WHICH items were paid WHEN.
--
--  In weekly mode (Sri Lanka), this column is simply unused. The existing
--  whole-guest "paid" flag + Close Week flow continues to work; nothing
--  reads paid_at in that mode.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.camp_tab_items
  add column if not exists paid_at timestamptz;

-- ── Quick visibility into what's been paid where ───────────────────────────
-- Useful sanity check after the first per-item Pay clicks in Morocco —
-- you should see paid_at populated only on Morocco rows. Sri Lanka stays
-- entirely null in this column (its revenue still flows through Close Week).
select
  l.slug,
  count(ci.*)                                       as total_items,
  count(*) filter (where ci.paid_at is null)        as unpaid,
  count(*) filter (where ci.paid_at is not null)    as paid_per_item
from public.camp_tab_items ci
join public.locations       l on l.id = ci.location_id
group by l.slug
order by l.slug;
