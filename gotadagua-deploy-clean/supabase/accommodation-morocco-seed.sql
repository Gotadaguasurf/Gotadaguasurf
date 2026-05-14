-- ════════════════════════════════════════════════════════════════════════════
--  MOROCCO — accommodation + surf pack seed
-- ════════════════════════════════════════════════════════════════════════════
--
--  Companion to supabase/accommodation-schema.sql. Run this AFTER the
--  schema migration has already created the four accommodation_* tables.
--
--  Morocco differs from Sri Lanka in three ways:
--    • 6 room types (vs Sri Lanka's 3), including dorm-style "Shared
--      Ensuite", multi-bed "Double/Triple" rooms, and a 3-4 pax
--      "Safi Family" room.
--    • Occupancy goes up to 4 (vs 2 in Sri Lanka).
--    • Mid-season replaced by "SPECIAL SEASON" (Christmas/New Year peak).
--
--  Plus Morocco runs a Surf Pack programme in Taghazout / Tamraght that
--  doesn't fit the pack × season × room matrix — those four products go
--  into the existing pricing_catalog as Surf Pack entries.
--
--  Idempotent: ON CONFLICT DO NOTHING on each insert, so re-running won't
--  duplicate. To clean a row before re-seeding, delete it manually.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Packs ────────────────────────────────────────────────────────────────

insert into public.accommodation_packs
  (location_id, pack_key, label, description, price_basis, sort_order)
select l.id, p.pack_key, p.label, p.description, p.price_basis, p.sort_order
from public.locations l
cross join (values
  ('weekly',   'Weekly Pack — 7 nights',
     '7 Nights · 7 Breakfasts · 6 Dinners · Free Surf Equipment · Camp Activities · Moroccan Sunset Rooftop Tea · Prices per person per week',
     'per_person_per_week',  10),
  ('flexible', 'Flexible Pack — 1 night',
     'Per night · 1 Breakfast · 1 Dinner · Free Surf Equipment · Camp Activities · Choose number of nights below',
     'per_person_per_night', 20)
) as p(pack_key, label, description, price_basis, sort_order)
where l.slug = 'morocco'
on conflict (location_id, pack_key) do nothing;

-- ── 2. Seasons — LOW / HIGH / SPECIAL (NB: no MID for Morocco) ─────────────

insert into public.accommodation_seasons
  (location_id, season_key, label, color, date_ranges, sort_order)
select l.id, s.season_key, s.label, s.color, s.date_ranges::jsonb, s.sort_order
from public.locations l
cross join (values
  ('low',     'LOW SEASON',     'green',
     '[{"start":"2026-04-11","end":"2026-09-11"}]',
     10),
  ('high',    'HIGH SEASON',    'amber',
     '[{"start":"2026-01-24","end":"2026-04-10"},
       {"start":"2026-09-12","end":"2026-12-18"},
       {"start":"2027-01-09","end":"2027-04-02"}]',
     20),
  ('special', 'SPECIAL SEASON', 'red',
     '[{"start":"2026-12-19","end":"2027-01-08"}]',
     30)
) as s(season_key, label, color, date_ranges, sort_order)
where l.slug = 'morocco'
on conflict (location_id, season_key) do nothing;

-- ── 3. Room types ──────────────────────────────────────────────────────────

insert into public.accommodation_room_types
  (location_id, room_key, label, description, sort_order)
select l.id, r.room_key, r.label, r.description, r.sort_order
from public.locations l
cross join (values
  ('shared_ensuite',          'Shared Ensuite Room',                              'Shared dorm-style room with private bathroom — sold per bed.', 10),
  ('la_source_riad',          'La Source Private Room (Riad View)',               'Private room with view over the Riad central area.',          20),
  ('imsouane_private',        'Imsouane Private Room',                            'Private room named after the wave town.',                      30),
  ('double_triple_riad',      'Double/Triple Standard Room Ensuite (Riad View)',  'Standard double/triple room with Riad view + ensuite.',        40),
  ('double_triple_standard',  'Double/Triple Standard Room Ensuite',              'Standard double/triple room with ensuite bathroom.',           50),
  ('safi_family',             'Safi Family Private Room Ensuite',                 'Family-size private room with ensuite — sleeps 3-4.',          60)
) as r(room_key, label, description, sort_order)
where l.slug = 'morocco'
on conflict (location_id, room_key) do nothing;

-- ── 4. Prices ──────────────────────────────────────────────────────────────

with loc   as (select id from public.locations           where slug='morocco' limit 1),
     pk_w  as (select id from public.accommodation_packs where pack_key='weekly'   and location_id=(select id from loc)),
     pk_f  as (select id from public.accommodation_packs where pack_key='flexible' and location_id=(select id from loc)),
     s_low as (select id from public.accommodation_seasons where season_key='low'     and location_id=(select id from loc)),
     s_hi  as (select id from public.accommodation_seasons where season_key='high'    and location_id=(select id from loc)),
     s_sp  as (select id from public.accommodation_seasons where season_key='special' and location_id=(select id from loc)),
     r1    as (select id from public.accommodation_room_types where room_key='shared_ensuite'         and location_id=(select id from loc)),
     r2    as (select id from public.accommodation_room_types where room_key='la_source_riad'         and location_id=(select id from loc)),
     r3    as (select id from public.accommodation_room_types where room_key='imsouane_private'       and location_id=(select id from loc)),
     r4    as (select id from public.accommodation_room_types where room_key='double_triple_riad'     and location_id=(select id from loc)),
     r5    as (select id from public.accommodation_room_types where room_key='double_triple_standard' and location_id=(select id from loc)),
     r6    as (select id from public.accommodation_room_types where room_key='safi_family'            and location_id=(select id from loc))
insert into public.accommodation_prices
  (location_id, pack_id, season_id, room_type_id, occupancy, sell_price, currency)
values
  -- ── Weekly Pack — LOW SEASON ───────────────────────
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r1),1, 379, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r2),1, 579, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r2),2, 419, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r3),1, 609, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r3),2, 449, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r4),2, 454, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r4),3, 429, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r5),2, 464, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r5),3, 439, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r6),3, 439, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_low),(select id from r6),4, 419, 'EUR'),
  -- ── Weekly Pack — HIGH SEASON ──────────────────────
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r1),1, 429, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r2),1, 629, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r2),2, 469, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r3),1, 659, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r3),2, 499, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r4),2, 504, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r4),3, 479, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r5),2, 514, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r5),3, 489, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r6),3, 489, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_hi), (select id from r6),4, 469, 'EUR'),
  -- ── Weekly Pack — SPECIAL SEASON ───────────────────
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r1),1, 479, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r2),1, 679, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r2),2, 519, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r3),1, 709, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r3),2, 549, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r4),2, 554, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r4),3, 529, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r5),2, 564, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r5),3, 539, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r6),3, 539, 'EUR'),
  ((select id from loc),(select id from pk_w),(select id from s_sp), (select id from r6),4, 564, 'EUR'),
  -- ── Flexible Pack — LOW SEASON ─────────────────────
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r1),1,  54.14, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r2),1,  82.71, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r2),2,  59.85, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r3),1,  87.00, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r3),2,  64.14, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r4),2,  64.86, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r4),3,  61.29, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r5),2,  66.29, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r5),3,  62.71, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r6),3,  62.71, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_low),(select id from r6),4,  59.86, 'EUR'),
  -- ── Flexible Pack — HIGH SEASON ────────────────────
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r1),1,  61.29, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r2),1,  89.86, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r2),2,  67.00, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r3),1,  94.14, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r3),2,  71.29, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r4),2,  72.00, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r4),3,  68.43, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r5),2,  73.43, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r5),3,  69.86, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r6),3,  69.86, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_hi), (select id from r6),4,  67.00, 'EUR'),
  -- ── Flexible Pack — SPECIAL SEASON ─────────────────
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r1),1,  68.43, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r2),1,  97.00, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r2),2,  74.14, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r3),1, 101.29, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r3),2,  78.43, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r4),2,  79.14, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r4),3,  75.57, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r5),2,  80.57, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r5),3,  77.00, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r6),3,  77.00, 'EUR'),
  ((select id from loc),(select id from pk_f),(select id from s_sp), (select id from r6),4,  74.14, 'EUR')
on conflict (location_id, pack_id, season_id, room_type_id, occupancy) do nothing;

-- ── 5. Surf packs (go into pricing_catalog, NOT accommodation_*) ───────────
--
--  Surf packs have their own structure (Pack / Duration / Includes / Price)
--  but it's flat — one row per pack with notes capturing the includes.
--  The Surf tab in /prices will surface them via category='Surf Pack'.

insert into public.pricing_catalog
  (location_id, name, category, audience, sell_price, cost_per_guest, currency,
   notes, show_in_camp_tab, show_in_transport_picker, picker_tab, active, sort_order)
select l.id, sp.name, 'Surf Pack', 'general', sp.sell_price, 0, 'EUR',
       sp.notes, false, false, 'airport', true, sp.sort_order
from public.locations l
cross join (values
  ('Standard Surf Pack',  230::numeric, '5 days · 5 lessons + 5 lunches + 5 free afternoon sessions + theory + video',  10),
  ('Intensive Surf Pack', 299::numeric, '5 days · 10 lessons + 5 lunches + theory + video',                              20),
  ('Standard Flex Surf',   50::numeric, '1 day · 1 lesson + lunch + 1 free session',                                     30),
  ('Intensive Flex Surf',  70::numeric, '1 day · 2 lessons + lunch',                                                     40)
) as sp(name, sell_price, notes, sort_order)
where l.slug = 'morocco'
  and not exists (
    select 1 from public.pricing_catalog pc
    where pc.location_id = l.id
      and pc.category    = 'Surf Pack'
      and lower(pc.name) = lower(sp.name)
  );

-- ── 6. Verify ──────────────────────────────────────────────────────────────

select
  l.slug                                              as location,
  (select count(*) from public.accommodation_packs      pk where pk.location_id = l.id) as packs,
  (select count(*) from public.accommodation_seasons    s  where s.location_id  = l.id) as seasons,
  (select count(*) from public.accommodation_room_types r  where r.location_id  = l.id) as rooms,
  (select count(*) from public.accommodation_prices     p  where p.location_id  = l.id) as accom_prices,
  (select count(*) from public.pricing_catalog          c  where c.location_id  = l.id and c.category='Surf Pack') as surf_packs
from public.locations l
where l.slug in ('sri-lanka','morocco')
order by l.slug;
