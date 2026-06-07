-- ════════════════════════════════════════════════════════════════════════════
--  Portugal — Costa da Caparica · Surf Camp · 2026 prices & inventory
-- ════════════════════════════════════════════════════════════════════════════
--
--  Populates four surfaces from the user's pricing brief:
--    1. accommodation_packs       (Weekly + Flexible)
--    2. accommodation_seasons     (LOW / MID / HIGH with 2026 date ranges)
--    3. accommodation_room_types  (6 types)
--    4. accommodation_prices      (55 rows — every season × room × occupancy
--                                  with a price)
--    5. accommodation_rooms       (25 physical rooms, 78 pax total capacity)
--    6. pricing_catalog           (Surf courses, lessons, yoga, insurance,
--                                  airport transfer)
--
--  Idempotent — every insert uses a unique key + ON CONFLICT DO NOTHING
--  so the SQL is safe to re-run. Existing rows are NEVER overwritten;
--  user edits in /prices survive a re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. PACKS ─────────────────────────────────────────────────────────────────
insert into public.accommodation_packs
  (location_id, pack_key, label, description, price_basis, sort_order)
select l.id, p.pack_key, p.label, p.description, p.price_basis, p.sort_order
from public.locations l
cross join (values
  ('weekly',   'Weekly Pack — 7 nights',
   '7 Nights · 7 Breakfasts · 5 Dinners + 1 BBQ · Camp activities · Bicycle · Wine tasting & tapas · Free surf equipment. Thursday optional outside dinner (not included). Price per person per week.',
   'per_person_per_week',  10),
  ('flexible', 'Flexible Pack — per night',
   '1 Breakfast · 1 Dinner · Free surf equipment · Camp activities. 1-6 nights, low + mid seasons only. Price per person per night.',
   'per_person_per_night', 20)
) as p(pack_key, label, description, price_basis, sort_order)
where l.slug = 'portugal'
on conflict (location_id, pack_key) do nothing;

-- ── 2. SEASONS (2026 date ranges) ────────────────────────────────────────────
insert into public.accommodation_seasons
  (location_id, season_key, label, color, date_ranges, sort_order)
select l.id, s.season_key, s.label, s.color, s.date_ranges::jsonb, s.sort_order
from public.locations l
cross join (values
  ('low',  'LOW SEASON',  'green',
   '[{"start":"2026-02-28","end":"2026-03-27"},
     {"start":"2026-11-07","end":"2026-12-18"}]',
   10),
  ('mid',  'MID SEASON',  'amber',
   '[{"start":"2026-03-28","end":"2026-06-26"},
     {"start":"2026-10-03","end":"2026-11-06"}]',
   20),
  ('high', 'HIGH SEASON', 'red',
   '[{"start":"2026-06-27","end":"2026-10-02"},
     {"start":"2026-12-19","end":"2027-01-02"}]',
   30)
) as s(season_key, label, color, date_ranges, sort_order)
where l.slug = 'portugal'
on conflict (location_id, season_key) do nothing;

-- ── 3. ROOM TYPES ────────────────────────────────────────────────────────────
insert into public.accommodation_room_types
  (location_id, room_key, label, description, sort_order)
select l.id, r.room_key, r.label, r.description, r.sort_order
from public.locations l
cross join (values
  ('shared_dorm',      'Shared Dorm',
   'Dormitório, casa de banho partilhada. Mesmo preço para 4-bed mixed, 8p Female Dorm, e 10-bed Female Dorm.', 10),
  ('cosy_twin',        'Cosy Twin Room',
   'Quarto privado, casa de banho partilhada. 2 camas.', 20),
  ('twin',             'Twin Room',
   'Quarto privado, casa de banho partilhada. 2 camas.', 30),
  ('standard_ensuite', 'Standard Ensuite Room',
   'Quarto privado com casa de banho privada.', 40),
  ('triple_ensuite',   'Triple Room Ensuite',
   'Quarto privado com casa de banho privada, 2 a 3 pessoas.', 50),
  ('family',           'Family Room',
   'Quarto privado, casa de banho partilhada, 3 a 4 pessoas.', 60)
) as r(room_key, label, description, sort_order)
where l.slug = 'portugal'
on conflict (location_id, room_key) do nothing;

-- ── 4. PRICES — Weekly Pack + Flexible Pack ──────────────────────────────────
with loc as (select id from public.locations where slug='portugal' limit 1),
     pkw as (select id from public.accommodation_packs    where pack_key='weekly'           and location_id=(select id from loc)),
     pkf as (select id from public.accommodation_packs    where pack_key='flexible'         and location_id=(select id from loc)),
     low_ as (select id from public.accommodation_seasons where season_key='low'             and location_id=(select id from loc)),
     mid_ as (select id from public.accommodation_seasons where season_key='mid'             and location_id=(select id from loc)),
     hi_  as (select id from public.accommodation_seasons where season_key='high'            and location_id=(select id from loc)),
     rsd  as (select id from public.accommodation_room_types where room_key='shared_dorm'      and location_id=(select id from loc)),
     rct  as (select id from public.accommodation_room_types where room_key='cosy_twin'        and location_id=(select id from loc)),
     rtw  as (select id from public.accommodation_room_types where room_key='twin'             and location_id=(select id from loc)),
     rse  as (select id from public.accommodation_room_types where room_key='standard_ensuite' and location_id=(select id from loc)),
     rtr  as (select id from public.accommodation_room_types where room_key='triple_ensuite'   and location_id=(select id from loc)),
     rfm  as (select id from public.accommodation_room_types where room_key='family'           and location_id=(select id from loc))
insert into public.accommodation_prices
  (location_id, pack_id, season_id, room_type_id, occupancy, sell_price, currency)
values
  -- ── WEEKLY PACK · LOW ──
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rsd),1, 429, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rct),1, 649, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rct),2, 479, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rtw),1, 679, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rtw),2, 509, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rse),1, 729, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rse),2, 529, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rtr),2, 529, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rtr),3, 509, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rfm),3, 489, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from low_),(select id from rfm),4, 479, 'EUR'),
  -- ── WEEKLY PACK · MID ──
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rsd),1, 449, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rct),1, 669, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rct),2, 499, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rtw),1, 699, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rtw),2, 529, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rse),1, 749, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rse),2, 549, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rtr),2, 549, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rtr),3, 529, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rfm),3, 509, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from mid_),(select id from rfm),4, 499, 'EUR'),
  -- ── WEEKLY PACK · HIGH ──
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rsd),1, 499, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rct),1, 719, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rct),2, 549, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rtw),1, 749, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rtw),2, 579, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rse),1, 799, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rse),2, 599, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rtr),2, 599, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rtr),3, 579, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rfm),3, 559, 'EUR'),
  ((select id from loc),(select id from pkw),(select id from hi_), (select id from rfm),4, 549, 'EUR'),
  -- ── FLEXIBLE PACK · LOW (per-night, per-person) ──
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rsd),1, 61.28, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rct),1, 92.71, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rct),2, 68.42, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rtw),1, 97.00, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rtw),2, 72.71, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rse),1,104.14, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rse),2, 75.57, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rtr),2, 75.57, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rtr),3, 72.71, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rfm),3, 69.85, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from low_),(select id from rfm),4, 68.42, 'EUR'),
  -- ── FLEXIBLE PACK · MID ──
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rsd),1, 64.14, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rct),1, 95.57, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rct),2, 71.28, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rtw),1, 99.85, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rtw),2, 75.57, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rse),1,107.00, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rse),2, 78.42, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rtr),2, 78.42, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rtr),3, 75.57, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rfm),3, 72.71, 'EUR'),
  ((select id from loc),(select id from pkf),(select id from mid_),(select id from rfm),4, 71.28, 'EUR')
  -- High season is intentionally absent from Flexible Pack — owner brief
  -- says "só fora de época alta".
on conflict (location_id, pack_id, season_id, room_type_id, occupancy) do nothing;

-- ── 5. ROOMS INVENTORY (25 physical rooms, 78 pax) ───────────────────────────
insert into public.accommodation_rooms
  (location_id, name, config_text, max_capacity, variant, tags, sort_order)
select l.id, r.name, r.config_text, r.max_capacity, r.variant, r.tags::text[], r.sort_order
from public.locations l
cross join (values
  -- 5 × Shared Room (mixed, 4 camas)
  ('Shared Room 1',       '4 camas · misto',                 4, 'shared',  '{shared,bath,mixed}',           110),
  ('Shared Room 2',       '4 camas · misto',                 4, 'shared',  '{shared,bath,mixed}',           120),
  ('Shared Room 3',       '4 camas · misto',                 4, 'shared',  '{shared,bath,mixed}',           130),
  ('Shared Room 4',       '4 camas · misto',                 4, 'shared',  '{shared,bath,mixed}',           140),
  ('Shared Room 5',       '4 camas · misto',                 4, 'shared',  '{shared,bath,mixed}',           150),
  -- 1 × Shared 8p Female Dorm
  ('Female Dorm 8',       '8 camas · só feminino',           8, 'shared',  '{shared,bath,female}',          160),
  -- 1 × Female Dorm 10 camas
  ('Female Dorm 10',      '10 camas · só feminino',         10, 'shared',  '{shared,bath,female}',          170),
  -- 6 × Cosy Twin
  ('Cosy Twin 1',         '2 camas · cosy · cb partilhada',  2, 'standard','{private,shared-bath}',         210),
  ('Cosy Twin 2',         '2 camas · cosy · cb partilhada',  2, 'standard','{private,shared-bath}',         220),
  ('Cosy Twin 3',         '2 camas · cosy · cb partilhada',  2, 'standard','{private,shared-bath}',         230),
  ('Cosy Twin 4',         '2 camas · cosy · cb partilhada',  2, 'standard','{private,shared-bath}',         240),
  ('Cosy Twin 5',         '2 camas · cosy · cb partilhada',  2, 'standard','{private,shared-bath}',         250),
  ('Cosy Twin 6',         '2 camas · cosy · cb partilhada',  2, 'standard','{private,shared-bath}',         260),
  -- 7 × Twin
  ('Twin 1',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         310),
  ('Twin 2',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         320),
  ('Twin 3',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         330),
  ('Twin 4',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         340),
  ('Twin 5',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         350),
  ('Twin 6',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         360),
  ('Twin 7',              '2 camas · cb partilhada',         2, 'standard','{private,shared-bath}',         370),
  -- 2 × Standard Ensuite
  ('Standard Ensuite 1',  '2 camas · ensuite',               2, 'superior','{private,ensuite}',             410),
  ('Standard Ensuite 2',  '2 camas · ensuite',               2, 'superior','{private,ensuite}',             420),
  -- 2 × Triple Ensuite
  ('Triple Ensuite 1',    '3 camas · ensuite',               3, 'superior','{private,ensuite,triple}',      510),
  ('Triple Ensuite 2',    '3 camas · ensuite',               3, 'superior','{private,ensuite,triple}',      520),
  -- 1 × Family Room
  ('Family Room',         '4 camas · cb partilhada · família',4,'standard','{private,shared-bath,family}', 610)
) as r(name, config_text, max_capacity, variant, tags, sort_order)
where l.slug = 'portugal'
  and not exists (
    select 1 from public.accommodation_rooms ar
    where ar.location_id = l.id and ar.name = r.name
  );

-- ── 6. EXTRAS — pricing_catalog rows ─────────────────────────────────────────
insert into public.pricing_catalog (
  location_id, name, category, audience,
  sell_price, cost_per_guest,
  currency, sell_currency,
  notes,
  show_in_camp_tab, show_in_transport_picker,
  active, sort_order
)
select
  l.id, p.name, p.category, 'general',
  p.sell_price, 0,
  coalesce(l.currency,'EUR'), coalesce(l.currency,'EUR'),
  p.notes,
  p.show_ct, p.show_tp,
  true, p.sort_order
from public.locations l
cross join (values
  ('Standard Surf Course',    'Surf Pack',     170.00,
   '5 aulas de 1h30 + teoria + vídeo. Só com Weekly Pack.',
   true,  false, 110),
  ('Intensive Surf Course',   'Surf Pack',     219.00,
   '7 aulas. Só com Weekly Pack.',
   true,  false, 120),
  ('Individual Surf Lesson',  'Lesson',         35.00,
   '1h30, prancha + fato incluídos. Marcada na véspera com o head coach. Para clientes em Flexible Pack.',
   true,  false, 130),
  ('5x Yoga Pack',            'Lesson',         50.00,
   'Pack de 5 aulas de yoga.',
   true,  false, 140),
  ('Equipment Insurance',     'Other Service',  30.00,
   'Por semana.',
   false, false, 150),
  ('Airport Transfer Lisbon', 'Transport',      35.00,
   'Por sentido (preço único, sem detalhe por veículo).',
   false, true,  160)
) as p(name, category, sell_price, notes, show_ct, show_tp, sort_order)
where l.slug = 'portugal'
  and not exists (
    select 1 from public.pricing_catalog pc
    where pc.location_id = l.id
      and pc.category    = p.category
      and lower(pc.name)  = lower(p.name)
  );

-- ── 7. VERIFY ────────────────────────────────────────────────────────────────
select
  l.slug                                                                                  as location,
  (select count(*) from public.accommodation_packs       pk where pk.location_id = l.id)  as packs,
  (select count(*) from public.accommodation_seasons     s  where s.location_id  = l.id)  as seasons,
  (select count(*) from public.accommodation_room_types  rt where rt.location_id = l.id)  as room_types,
  (select count(*) from public.accommodation_prices      pr where pr.location_id = l.id)  as price_cells,
  (select count(*) from public.accommodation_rooms       ar where ar.location_id = l.id)  as rooms,
  (select coalesce(sum(max_capacity),0) from public.accommodation_rooms ar where ar.location_id = l.id) as pax_capacity,
  (select count(*) from public.pricing_catalog           pc where pc.location_id = l.id)  as catalog_rows
from public.locations l
where l.slug = 'portugal';

-- Expected:
--   packs        2
--   seasons      3
--   room_types   6
--   price_cells  55  (33 weekly + 22 flexible)
--   rooms        25
--   pax_capacity 78  (20 + 8 + 10 + 12 + 14 + 4 + 6 + 4)
--   catalog_rows 30  (24 t-shirts+hoodies if you ran those seeds + 6 extras)
