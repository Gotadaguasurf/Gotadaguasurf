-- ════════════════════════════════════════════════════════════════════════════
--  Pricing Catalog — alternative price (Offer / Discount) for Merch
-- ════════════════════════════════════════════════════════════════════════════
--
--  Why
--  ───
--  The owner wants to sell each merch line at a regular price AND
--  optionally at an alternative price (a holiday offer, a bulk discount,
--  a staff price, etc.). Both prices point at the SAME physical stock —
--  selling one or the other decrements the same stock_qty counter.
--
--  Adds two columns:
--    • alt_price  numeric(12,2)  — the alternative price (nullable).
--                                  Currency matches the row's sell_currency.
--    • alt_label  text           — human-readable label shown on the POS
--                                  card next to the alt price ('Offer',
--                                  'Discount', 'Holiday', 'Staff', …).
--                                  Defaults to 'Offer' on the UI when null.
--
--  Both are nullable; Tours / Transport / etc. leave them null forever.
--
--  Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.pricing_catalog
  add column if not exists alt_price numeric(12,2);

alter table public.pricing_catalog
  add column if not exists alt_label text;

-- Sanity constraint: alt_price can't be negative if set.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pricing_catalog_alt_price_nonneg'
  ) then
    alter table public.pricing_catalog
      add constraint pricing_catalog_alt_price_nonneg
      check (alt_price is null or alt_price >= 0);
  end if;
end $$;
