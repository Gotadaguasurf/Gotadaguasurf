-- ════════════════════════════════════════════════════════════════════════════
--  HEAL — tour revenue rows from Camp Tab should have category='Tours'
-- ════════════════════════════════════════════════════════════════════════════
--
--  Closed-week revenue entries imported from Camp Tab used to copy the
--  tour name (e.g. 'Ice Bath', 'River Safari') into the `category`
--  column. That made the Operations Ledger show "Ice Bath" as the
--  category, which is wrong — the bucket should be 'Tours' and the
--  specific tour belongs in the `linked_item` column.
--
--  These rows are recognisable by:
--    • description LIKE 'Closed week revenue from Camp Tab%'
--    • linked_item is NOT NULL AND not empty
--    • category equals linked_item (the legacy duplication)
--
--  Fix: set category='Tours'. linked_item already has the tour name —
--  no change needed there. The business_area was correctly inferred
--  via inferArea() at write time so we don't touch it.
--
--  amount_local / fx_rate / amount_eur are NEVER touched.
--
--  Idempotent. Safe to re-run.
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- NOTE about table columns:
--   * type column: the JS layer uses 'income' but the DB stores 'revenue'
--     (see mapLedgerTypeToDb in camp-hub/index.html). The SQL must match
--     the DB value → 'revenue'.
--   * ledger_entries has NO updated_at column (only created_at), so we
--     don't set one here. Realtime still fires on the UPDATE regardless.

-- ── 1. Preview the rows that will be touched ──────────────────────────────
select
  l.slug                                  as location,
  le.id,
  le.entry_date,
  le.category                             as old_category,
  le.linked_item                          as keeps,
  le.amount_local,
  le.currency,
  le.description
from public.ledger_entries le
join public.locations       l on l.id = le.location_id
where le.type = 'revenue'
  and le.description like 'Closed week revenue from Camp Tab%'
  and le.linked_item is not null
  and trim(le.linked_item) <> ''
  and le.category = le.linked_item
order by l.slug, le.entry_date desc, le.id;

-- ── 2. Apply the heal ─────────────────────────────────────────────────────
update public.ledger_entries
   set category = 'Tours'
 where type = 'revenue'
   and description like 'Closed week revenue from Camp Tab%'
   and linked_item is not null
   and trim(linked_item) <> ''
   and category = linked_item;

-- ── 3. Verify — should now show category='Tours' for all tour rows ────────
select
  l.slug,
  le.entry_date,
  le.category,
  le.linked_item,
  le.amount_local,
  le.currency
from public.ledger_entries le
join public.locations       l on l.id = le.location_id
where le.type = 'revenue'
  and le.description like 'Closed week revenue from Camp Tab%'
  and le.linked_item is not null
  and trim(le.linked_item) <> ''
order by l.slug, le.entry_date desc
limit 25;
