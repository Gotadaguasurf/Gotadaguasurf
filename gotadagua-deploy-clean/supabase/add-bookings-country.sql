-- ════════════════════════════════════════════════════════════════════════════
--  ADD `country` to bookings  — needed for per-country grouping on
--  partner statements (KILROY bills per country: Sweden / Norway / …).
-- ════════════════════════════════════════════════════════════════════════════
--
--  What this does:
--    1. Adds a nullable `country` text column to public.bookings so each
--       CSV row's "Country" cell can be persisted alongside the booking.
--    2. Adds a partial index on it (skips NULLs) so future grouped
--       queries don't full-scan the table.
--
--  Safe to re-run — both statements are idempotent (IF NOT EXISTS).
--
--  How to apply:
--    Paste into the Supabase SQL Editor and run.
--
--  How to verify:
--    select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='bookings' and column_name='country';
--    -- one row expected: country | text
--
--  Roll back (only if needed):
--    alter table public.bookings drop column if exists country;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.bookings
  add column if not exists country text;

create index if not exists idx_bookings_country
  on public.bookings(country)
  where country is not null;
