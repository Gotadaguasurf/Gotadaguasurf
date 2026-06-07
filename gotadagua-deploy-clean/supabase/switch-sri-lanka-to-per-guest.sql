-- ════════════════════════════════════════════════════════════════════════════
--  Switch Sri Lanka Camp Tab to per_guest mode
-- ════════════════════════════════════════════════════════════════════════════
--
--  Same model Morocco has been on since add-camp-tab-mode.sql:
--    • No "Close week" — paying an item lands the revenue in the ledger
--      immediately, dated to that day.
--    • Each guest is its own unit; close-guest replaces close-week.
--    • Click-to-unpay flows in both directions (Camp Tab ↔ Operations
--      Ledger) keep the books and the POS in lockstep.
--
--  Data safety
--  ───────────
--  Nothing is deleted. Existing camp_weeks, camp_guests, camp_tab_items,
--  and ledger_entries (campclose_*) rows stay exactly where they are.
--  The currently-open week becomes the "container week" that per_guest
--  needs as a parent row — no migration required. Closed historical
--  weeks remain in the DB; they just aren't surfaced in the POS UI
--  (Operations Ledger is the audit trail).
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

update public.locations
   set camp_tab_mode = 'per_guest'
 where slug = 'sri-lanka';

-- ── Verify ─────────────────────────────────────────────────────────────────
select slug, name, currency, camp_tab_mode
  from public.locations
 order by slug;
