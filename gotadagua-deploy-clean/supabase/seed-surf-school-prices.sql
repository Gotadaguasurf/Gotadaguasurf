-- ════════════════════════════════════════════════════════════════════════════
--  SURF SCHOOL — pricing_catalog seed (Lessons + Rentals)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Populates the Prices app (`/prices?location=surf-school`) with the
--  official Surf School price list — Standard, Erasmus/Student, and
--  Resident tiers, plus the rental matrix (Board / Wetsuit / combo ×
--  duration).
--
--  Categories chosen so the existing Prices UI groups them correctly:
--    Lesson    → Group / Private / Erasmus / Resident lessons
--    Surf Pack → Rentals (Board / Wetsuit / combo)
--
--  Idempotent: nukes ONLY the Lesson + Surf Pack rows for surf-school
--  before re-inserting. Any drinks, tours, transfers, merch etc. for
--  surf-school (unlikely today, but safe) stay untouched. Manual edits
--  to Lesson/Surf Pack rows will be OVERWRITTEN — that's the point of
--  seeding a canonical price list. Re-run whenever the paper card
--  changes and edit the rows below.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  loc_id uuid;
begin
  select id into loc_id from public.locations where slug = 'surf-school';
  if loc_id is null then
    raise exception 'Surf School location not found (slug=surf-school). Seed locations first.';
  end if;

  -- Wipe existing Lesson + Surf Pack rows for this location.
  delete from public.pricing_catalog
   where location_id = loc_id
     and category in ('Lesson','Surf Pack');

  -- ── LESSONS ──────────────────────────────────────────────────────────
  -- audience='group' = fixed amount per booking (whole package)
  -- audience='general' = per-guest (used for the "Extra person" surcharge)
  insert into public.pricing_catalog
    (location_id, name, category, audience, sell_price, currency, sort_order, notes) values
    -- Standard · Group (max 5 per instructor, 1h30 per lesson)
    (loc_id, 'Group Lesson — 1 lesson (Standard)',    'Lesson', 'group',    35,  'EUR', 10, 'Max 5 per instructor · 1h30'),
    (loc_id, 'Group Lesson — 3 lessons (Standard)',   'Lesson', 'group',    95,  'EUR', 11, 'Max 5 per instructor · 1h30'),
    (loc_id, 'Group Lesson — 5 lessons (Standard)',   'Lesson', 'group',    140, 'EUR', 12, 'Max 5 per instructor · 1h30'),
    (loc_id, 'Group Lesson — 10 lessons (Standard)',  'Lesson', 'group',    230, 'EUR', 13, 'Max 5 per instructor · 1h30'),
    -- Standard · Private
    (loc_id, 'Private Lesson — 1 lesson (Standard)',  'Lesson', 'group',    75,  'EUR', 20, '1h30 · +30€ per extra person, max 5'),
    (loc_id, 'Private Lesson — 3 lessons (Standard)', 'Lesson', 'group',    210, 'EUR', 21, '1h30 · +30€ per extra person, max 5'),
    (loc_id, 'Private Lesson — 5 lessons (Standard)', 'Lesson', 'group',    325, 'EUR', 22, '1h30 · +30€ per extra person, max 5'),
    (loc_id, 'Private Lesson — 10 lessons (Standard)','Lesson', 'group',    550, 'EUR', 23, '1h30 · +30€ per extra person, max 5'),
    -- Private lessons — extra person surcharge
    (loc_id, 'Private Lesson — extra person',         'Lesson', 'general',  30,  'EUR', 24, 'Per additional student · max 5 total'),
    -- Erasmus / Student (needs ESN document)
    (loc_id, 'Surf Lesson — 1 lesson (Erasmus/Student)',   'Lesson', 'group', 20,  'EUR', 30, '1h30 · ESN Erasmus document required'),
    (loc_id, 'Surf Lesson — 5 lessons (Erasmus/Student)',  'Lesson', 'group', 90,  'EUR', 31, '1h30 · ESN Erasmus document required'),
    (loc_id, 'Surf Lesson — 10 lessons (Erasmus/Student)', 'Lesson', 'group', 160, 'EUR', 32, '1h30 · ESN Erasmus document required'),
    -- Residents (needs Portuguese residency doc)
    (loc_id, 'Group Lesson — 5 lessons (Resident)',   'Lesson', 'group',    125, 'EUR', 40, '1h30 · Portuguese residency document required'),
    (loc_id, 'Group Lesson — 10 lessons (Resident)',  'Lesson', 'group',    190, 'EUR', 41, '1h30 · Portuguese residency document required'),
    (loc_id, 'Group Lesson — 20 lessons (Resident)',  'Lesson', 'group',    320, 'EUR', 42, '1h30 · Portuguese residency document required');

  -- ── RENTALS ──────────────────────────────────────────────────────────
  -- Category 'Surf Pack' keeps them in the same tab as lessons.
  -- audience='group' = fixed price per rental (not per-guest).
  insert into public.pricing_catalog
    (location_id, name, category, audience, sell_price, currency, sort_order, notes) values
    -- Board & Wetsuit combo — Standard
    (loc_id, 'Board & Wetsuit — 1h (Standard)',        'Surf Pack', 'group', 20, 'EUR', 100, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board & Wetsuit — 2h (Standard)',        'Surf Pack', 'group', 30, 'EUR', 101, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board & Wetsuit — 3h (Standard)',        'Surf Pack', 'group', 40, 'EUR', 102, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board & Wetsuit — All day (Standard)',   'Surf Pack', 'group', 45, 'EUR', 103, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board & Wetsuit — Extra day (Standard)', 'Surf Pack', 'group', 15, 'EUR', 104, 'Per extra day beyond the first'),
    -- Board only — Standard
    (loc_id, 'Board — 1h (Standard)',        'Surf Pack', 'group', 15, 'EUR', 110, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board — 2h (Standard)',        'Surf Pack', 'group', 20, 'EUR', 111, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board — 3h (Standard)',        'Surf Pack', 'group', 30, 'EUR', 112, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board — All day (Standard)',   'Surf Pack', 'group', 40, 'EUR', 113, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Board — Extra day (Standard)', 'Surf Pack', 'group', 10, 'EUR', 114, 'Per extra day beyond the first'),
    -- Wetsuit only — Standard
    (loc_id, 'Wetsuit — 1h (Standard)',        'Surf Pack', 'group', 10, 'EUR', 120, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Wetsuit — 2h (Standard)',        'Surf Pack', 'group', 12, 'EUR', 121, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Wetsuit — 3h (Standard)',        'Surf Pack', 'group', 15, 'EUR', 122, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Wetsuit — All day (Standard)',   'Surf Pack', 'group', 20, 'EUR', 123, '€250 deposit if the customer takes the gear home'),
    (loc_id, 'Wetsuit — Extra day (Standard)', 'Surf Pack', 'group', 15, 'EUR', 124, 'Per extra day beyond the first'),
    -- Erasmus / Student rentals
    (loc_id, 'Rental — 2h (Erasmus/Student)',       'Surf Pack', 'group', 20, 'EUR', 130, 'ESN Erasmus document required'),
    (loc_id, 'Rental — Full day (Erasmus/Student)', 'Surf Pack', 'group', 25, 'EUR', 131, 'ESN Erasmus document required'),
    -- Resident rentals
    (loc_id, 'Rental — 2h (Resident)',       'Surf Pack', 'group', 15, 'EUR', 140, 'Portuguese residency document required'),
    (loc_id, 'Rental — Full day (Resident)', 'Surf Pack', 'group', 25, 'EUR', 141, 'Portuguese residency document required');
end $$;

-- Sanity check
select
  count(*) filter (where category='Lesson')    as lessons,
  count(*) filter (where category='Surf Pack') as rentals,
  count(*)                                     as total
from public.pricing_catalog
where location_id = (select id from public.locations where slug='surf-school');
-- Expected: lessons = 15, rentals = 19, total = 34
