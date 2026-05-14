-- ════════════════════════════════════════════════════════════════════════════
--  MOROCCO PRICING CATALOG — one-time cleanup + correct tours seed
-- ════════════════════════════════════════════════════════════════════════════
--
--  Phase 2 (import existing) accidentally pulled five Sri Lanka tour names
--  into Morocco's catalog (Cooking Class, Tea Plantation Visit, River
--  Safari, Ice Bath, Safari Yala) because of a localStorage fallback bug
--  that has since been fixed in fix/prices-import-no-cross-location.
--
--  This script:
--    1. Removes those 5 wrongly-imported rows from Morocco's catalog.
--    2. Inserts the 4 actual Morocco tours (Souk Tour, Paradise Valley,
--       Dunes — Sandboarding, Dunes — Camel Ride) at the prices the user
--       has configured in the Hub's Camp Tab → Menu settings.
--
--  How to run:
--    Paste into Supabase SQL Editor → Run. Idempotent (NOT EXISTS guard
--    on the insert) so re-running is safe.
--
--  Verification:
--    The final SELECT returns the Morocco Tour rows after cleanup.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Delete the five Sri-Lanka-named tour rows from Morocco
delete from public.pricing_catalog
where location_id = (select id from public.locations where slug = 'morocco')
  and category   = 'Tour'
  and name in (
    'Cooking Class',
    'Tea Plantation Visit',
    'River Safari',
    'Ice Bath',
    'Safari Yala'
  );

-- 2. Insert the four real Morocco tours, idempotently
insert into public.pricing_catalog
  (location_id, name, category, audience, sell_price, cost_per_guest,
   currency, notes, show_in_camp_tab, show_in_transport_picker, sort_order, active)
select
  l.id,
  t.name,
  'Tour',
  'general',
  t.sell_price,
  0,
  'MAD',
  t.notes,
  true,    -- show_in_camp_tab — these are Camp Tab tours
  false,   -- show_in_transport_picker
  t.sort_order,
  true
from public.locations l
cross join (values
  ('Souk Tour',             150, 'Imported from Camp Tab Tours', 101),
  ('Paradise Valley',       250, 'Imported from Camp Tab Tours', 102),
  ('Dunes — Sandboarding',  350, 'Imported from Camp Tab Tours', 103),
  ('Dunes — Camel Ride',    450, 'Imported from Camp Tab Tours', 104)
) as t(name, sell_price, notes, sort_order)
where l.slug = 'morocco'
  and not exists (
    select 1 from public.pricing_catalog pc
    where pc.location_id = l.id
      and pc.category    = 'Tour'
      and lower(pc.name) = lower(t.name)
  );

-- 3. Verify — should return 4 rows after a clean run
select name, sell_price, currency, show_in_camp_tab, sort_order
from public.pricing_catalog
where location_id = (select id from public.locations where slug = 'morocco')
  and category = 'Tour'
order by sort_order;
