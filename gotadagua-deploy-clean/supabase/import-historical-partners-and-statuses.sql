-- ════════════════════════════════════════════════════════════════════════════
--  IMPORT historical partners + monthly statuses from old CSV exports
-- ════════════════════════════════════════════════════════════════════════════
--
--  Loaded from:
--    Downloads/partners_rows.csv               (24 partners)
--    Downloads/partner_month_status_rows.csv   (34 monthly statuses)
--
--  Strategy:
--   1. Upsert partners ON CONFLICT (name) — preserves existing partner UUIDs
--      if a row with the same name already exists, otherwise inserts fresh.
--   2. Upsert statuses by (partner_name, month_key) — looks up partner_id by
--      name at insert time, so it works regardless of whether the partner
--      UUIDs in the CSV match the current DB.
--   3. updated_by from the CSV referenced an old user that no longer exists,
--      so it's set to NULL (column is nullable).
--
--  Idempotent — re-running just refreshes commission %, status values, etc.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Partners ───────────────────────────────────────────────────────────
insert into public.partners
  (name, email, commission_pct, collects_from_guest, partner_type, is_active)
values
  ('AWAVE Travel',                'david@awavetravel.com',                  20.00, true,  'surfcamp',   true),
  ('Ocean Adventure',             'manager@oceanadventure.surf',            20.00, false, 'surfcamp',   true),
  ('AASHA',                       'amit@aashalanka.com',                    20.00, true,  'surfcamp',   true),
  ('Surfwise Travel',             'info@surfwise.ch',                       18.00, false, 'surfcamp',   true),
  ('SURFWISE',                    'info@surfwise.ch',                       18.00, true,  'surfcamp',   true),
  ('Surf Stories Poland',         null,                                     20.00, true,  'surfcamp',   true),
  ('IMPOSSIBLE LISBON HOSTEL',    'booking@innpossible.pt',                 20.00, false, 'surfschool', true),
  ('KILROY',                      'adventureinvoices@kilroy.net',           20.00, true,  'surfcamp',   true),
  ('GOOD MORNING HOSTEL',         'manager@goodmorninghostel.com',          20.00, false, 'surfschool', true),
  ('Dbpadventures',               'christoffer@debredeplanker.dk',          18.00, true,  'surfcamp',   true),
  ('JUVIGO',                      'parceiros@juvigo.pt',                    15.00, false, 'surfcamp',   true),
  ('FEEL FREE TRAVEL UK',         'bookings@feelfreetravel.com',            15.00, true,  'surfcamp',   true),
  ('Surfer Girls Power',          null,                                     20.00, true,  'surfcamp',   true),
  ('Surfawhile',                  'info@surfawhile.com',                    20.00, false, 'surfcamp',   true),
  ('LISBOA CENTRAL HOSTEL',       'msantos@lisboacentralhostel.com',        20.00, true,  'surfschool', true),
  ('SOLID SURF HOUSE CAPARICA',   'Stefania@solidsurfhouse.com',            20.00, true,  'surfcamp',   true),
  ('Stoked Surf Adventures',      'hello@stokedsurfadventures.com',         15.00, false, 'surfcamp',   true),
  ('SURFCAMP IT',                 'lucianocardone@surfcamp.it',             20.00, true,  'surfcamp',   true),
  ('Sant Jordi Hostels Lisbon',   'isabel.carvalho@santjordihostels.com',   20.00, true,  'surfschool', true),
  ('WOT HOSTELS',                 'experiences@wotels.com',                 20.00, true,  'surfschool', true),
  ('Wave Culture',                'info@waveculture.de',                    20.00, true,  'surfcamp',   true),
  ('Adekua',                      'tony@groupe-adekua.fr',                  18.00, true,  'surfcamp',   true),
  ('Enjoy Surf Project',          null,                                     20.00, true,  'surfcamp',   true),
  ('The Surf Tribe',              'ric@thesurftribe.com',                   20.00, true,  'surfcamp',   true),
  ('LISBON BEACH APARTMENTS',     'lisbonbeachapartments@outlook.com',      20.00, false, 'surfschool', true)
on conflict (name) do update set
  email               = excluded.email,
  commission_pct      = excluded.commission_pct,
  collects_from_guest = excluded.collects_from_guest,
  partner_type        = excluded.partner_type,
  is_active           = excluded.is_active,
  updated_at          = now();

-- ── 2. Monthly statuses ──────────────────────────────────────────────────
-- Use a CTE keyed by partner NAME (not the old UUIDs from the CSV) so this
-- works regardless of whether the partners just got fresh UUIDs or already
-- existed with different ones.
with status_input(partner_name, month_key, status_value) as (
  values
    ('Surf Stories Poland',       '2026-01', 'Paid'),
    ('Sant Jordi Hostels Lisbon', '2026-03', 'Invoice Sent'),
    ('JUVIGO',                    '2026-03', 'Paid'),
    ('Adekua',                    '2026-01', 'Paid'),
    ('Sant Jordi Hostels Lisbon', '2026-01', 'Invoice Sent'),
    ('LISBOA CENTRAL HOSTEL',     '2026-03', 'Paid'),
    ('LISBOA CENTRAL HOSTEL',     '2026-01', 'Paid'),
    ('SOLID SURF HOUSE CAPARICA', '2026-03', 'Paid'),
    ('FEEL FREE TRAVEL UK',       '2026-01', 'PDF Sent'),
    ('Surfer Girls Power',        '2026-02', 'Paid'),
    ('The Surf Tribe',            '2026-01', 'PDF Sent'),
    ('Surfer Girls Power',        '2026-01', 'Paid'),
    ('AASHA',                     '2026-01', 'Paid'),
    ('AASHA',                     '2026-02', 'Paid'),
    ('Surfawhile',                '2026-02', 'Paid'),
    ('IMPOSSIBLE LISBON HOSTEL',  '2026-03', 'PDF Sent'),
    ('Stoked Surf Adventures',    '2026-03', 'PDF Sent'),
    ('SURFCAMP IT',               '2026-03', 'PDF Sent'),
    ('Surfwise Travel',           '2026-03', 'PDF Sent'),
    ('SURFWISE',                  '2026-01', 'Paid'),
    ('Enjoy Surf Project',        '2026-02', 'Paid'),
    ('Surfawhile',                '2026-01', 'Paid'),
    ('KILROY',                    '2026-03', 'Invoice Sent'),
    ('Ocean Adventure',           '2026-02', 'Paid'),
    ('WOT HOSTELS',               '2026-02', 'Invoice Sent'),
    ('AWAVE Travel',              '2026-02', 'Invoice Sent'),
    ('AASHA',                     '2026-03', 'Paid'),
    ('Surf Stories Poland',       '2026-02', 'Paid'),
    ('The Surf Tribe',            '2026-02', 'PDF Sent'),
    ('Dbpadventures',             '2026-02', 'Paid'),
    ('Wave Culture',              '2026-03', 'Invoice Sent'),
    ('Surfwise Travel',           '2026-02', 'Paid'),
    ('WOT HOSTELS',               '2026-03', 'Invoice Sent'),
    ('The Surf Tribe',            '2026-03', 'Invoice Sent')
)
insert into public.partner_month_status (partner_id, month_key, status, notes)
select p.id, s.month_key, s.status_value, null
from status_input s
join public.partners p
  on lower(trim(p.name)) = lower(trim(s.partner_name))
on conflict (partner_id, month_key) do update set
  status     = excluded.status,
  updated_at = now();

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
--  -- All 25 partners present:
--    select count(*) from public.partners;
--
--  -- All 34 statuses present (or close — duplicates by partner+month merge):
--    select count(*) from public.partner_month_status;
--
--  -- Spot-check AASHA:
--    select p.name, s.month_key, s.status
--    from public.partner_month_status s
--    join public.partners p on p.id = s.partner_id
--    where p.name = 'AASHA'
--    order by s.month_key;
--    -- Expected: 2026-01 Paid, 2026-02 Paid, 2026-03 Paid.
-- ════════════════════════════════════════════════════════════════════════════
