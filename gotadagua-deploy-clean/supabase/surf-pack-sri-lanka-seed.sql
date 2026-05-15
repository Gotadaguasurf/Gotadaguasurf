-- ════════════════════════════════════════════════════════════════════════════
--  Seed — Sri Lanka surf course (selling price)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Adds the "Surf Course" entry to Sri Lanka's pricing_catalog so it shows
--  up under the Surf tab on /prices?location=sri-lanka. Mirrors the
--  Morocco surf-pack seed pattern (see accommodation-morocco-seed.sql).
--
--  Pack details (from the user's price card):
--    • Surf Course — 150 €
--    • 5 lessons (2h each) · 3 guiding sessions · theory · video analysis
--    • Transport to surf spots included
--
--  Idempotent — the where-not-exists guard skips re-insertion if a row
--  with the same name already exists for Sri Lanka.
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.pricing_catalog
  (location_id, name, category, audience, sell_price, cost_per_guest, currency,
   notes, show_in_camp_tab, show_in_transport_picker, picker_tab, active, sort_order)
select l.id,
       sp.name,
       'Surf Pack',
       'general',
       sp.sell_price,
       0,
       'EUR',
       sp.notes,
       false,
       false,
       'airport',
       true,
       sp.sort_order
  from public.locations l
  cross join (values
    ('Surf Course',
     150::numeric,
     '5 lessons (2h each) · 3 guiding sessions · theory · video analysis · transport to surf spots included',
     10)
  ) as sp(name, sell_price, notes, sort_order)
 where l.slug = 'sri-lanka'
   and not exists (
     select 1
       from public.pricing_catalog pc
      where pc.location_id = l.id
        and pc.category    = 'Surf Pack'
        and lower(pc.name) = lower(sp.name)
   );

-- ── Verify ──────────────────────────────────────────────────────────────────
select l.slug                as location,
       pc.name,
       pc.category,
       pc.sell_price,
       pc.currency,
       pc.notes,
       pc.active
  from public.pricing_catalog pc
  join public.locations l on l.id = pc.location_id
 where l.slug = 'sri-lanka'
   and pc.category = 'Surf Pack'
 order by pc.sort_order, pc.name;
