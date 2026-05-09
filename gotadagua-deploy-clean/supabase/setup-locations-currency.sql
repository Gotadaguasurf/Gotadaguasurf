-- ════════════════════════════════════════════════════════════════════════════
--  SETUP — locations.currency + locations.default_fx_to_eur
-- ════════════════════════════════════════════════════════════════════════════
--
--  Add per-location currency awareness so the same Camp Hub UI works for
--  Sri Lanka (LKR), Morocco (MAD), Portugal (EUR), and Junior Camp (EUR).
--
--  The Camp Hub already reads ?location=<slug> from the URL and uses it to
--  scope every read/write to the matching location row. With this migration,
--  it will also read the currency code and the default FX rate from that
--  same row, so every label and conversion in the UI reacts to the active
--  location automatically — no per-location code branches needed.
--
--  default_fx_to_eur values:
--    LKR ≈ 330  (current rate, can be edited later in the FX field per entry)
--    MAD ≈ 10.8
--    EUR = 1    (Portugal / Junior Camp — local IS Euro, no conversion)
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.locations
  add column if not exists currency           text   not null default 'LKR',
  add column if not exists default_fx_to_eur  numeric(12,4) not null default 330;

-- Make sure the rows we expect exist. INSERT ... ON CONFLICT keeps any
-- existing row untouched and only adds missing ones.
insert into public.locations (slug, name) values
  ('sri-lanka',   'Sri Lanka'),
  ('morocco',     'Morocco'),
  ('portugal',    'Portugal'),
  ('junior-camp', 'Junior Camp')
on conflict (slug) do nothing;

update public.locations set currency = 'LKR', default_fx_to_eur = 330
  where slug = 'sri-lanka';

update public.locations set currency = 'MAD', default_fx_to_eur = 10.8
  where slug = 'morocco';

update public.locations set currency = 'EUR', default_fx_to_eur = 1
  where slug in ('portugal', 'junior-camp');

-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION
-- ════════════════════════════════════════════════════════════════════════════
--
--   select slug, name, currency, default_fx_to_eur
--   from public.locations
--   order by slug;
--
-- Expected:
--   junior-camp  Junior Camp  EUR  1.0000
--   morocco      Morocco      MAD  10.8000
--   portugal     Portugal     EUR  1.0000
--   sri-lanka    Sri Lanka    LKR  330.0000
-- ════════════════════════════════════════════════════════════════════════════
