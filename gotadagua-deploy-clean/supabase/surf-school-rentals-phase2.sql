-- ════════════════════════════════════════════════════════════════════════════
--  SURF SCHOOL RENTALS — Phase 2 columns
-- ════════════════════════════════════════════════════════════════════════════
--
--  Google Form parity. Miguel showed screenshots of the live "Surf School
--  Cash Payment Data Collection Form" and it captures a few fields Phase 1
--  didn't have yet:
--
--    Customer Type      — Regular / Student / Resident / Surf Camp Customer
--    Rental Item(s)     — multi-select (Board + Wetsuit at once for one
--                         customer, e.g. surfer without their own suit)
--    Rental Type        — Same Day / Multi-day
--    Duration           — 1H / 2H / 3H / Full day (Same Day) or N days
--
--  We keep item_id / item_name as the "primary" item for backwards compat
--  with rows already inserted; the new items JSONB column holds the full
--  picked set so a single rental can carry Board + Wetsuit + whatever
--  future combos, each with their own price.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.surf_school_rentals
  add column if not exists customer_type text,
  add column if not exists rental_type   text,
  add column if not exists duration      text,
  add column if not exists items         jsonb;

comment on column public.surf_school_rentals.customer_type is
  'Regular / Student / Resident / Surf Camp Customer — mirrors the Google Form Customer Type field.';
comment on column public.surf_school_rentals.rental_type is
  'Same Day / Multi-day. Combined with duration to describe how long the rental is for.';
comment on column public.surf_school_rentals.duration is
  '1H / 2H / 3H / Full day (Same Day) or "N days" (Multi-day). Free-text — the client parses if needed.';
comment on column public.surf_school_rentals.items is
  'Array of picked items for this rental: [{"item_id":"…","name":"Board","price":15,"qty":1}, …]. item_id + item_name up top stay populated with the first / primary entry for compatibility.';
