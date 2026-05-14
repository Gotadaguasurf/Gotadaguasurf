-- ════════════════════════════════════════════════════════════════════════════
--  AUTO-LINK Tours ↔ Transports for Sri Lanka and Morocco
-- ════════════════════════════════════════════════════════════════════════════
--
--  Every Camp Tab tour in both camps uses an associated transport, but the
--  initial /prices import landed each tour with linked_transport_preset_id
--  NULL. This script wires the obvious pairs so the Tours by product card
--  in the Hub Overview, plus the catalog table's combined-cost column,
--  reflect the true cost per guest.
--
--  Mappings used:
--
--    Sri Lanka (Tour ⟶ Transport)
--      Tea Plantation Visit  → Tea Plantation
--      Ice Bath              → Ice Bath
--      River Safari          → River Cruise   (closest water-based match)
--      Cooking Class         → (no transport — in-camp activity)
--      Safari Yala           → (no transport — bespoke per booking)
--
--    Morocco (Tour ⟶ Transport, default to the "Car" vehicle)
--      Souk Tour             → Souk — Car
--      Paradise Valley       → Paradise Valley — Car
--      Dunes — Sandboarding  → Dunes — Car
--      Dunes — Camel Ride    → Dunes — Car
--
--  How to run: paste into the Supabase SQL Editor → Run. Idempotent: each
--  update is guarded by "linked_transport_preset_id IS NULL OR <>", so
--  re-running won't disturb anything you've since changed by hand in the
--  /prices modal. The matching is case-insensitive on both names.
--
--  After running, the catalog table at /prices will show the "↔" chip
--  under each tour name and the combined cost (e.g. "LKR 700 = LKR 500
--  this tour + LKR 200 Tea Plantation") in the Cost column.
-- ════════════════════════════════════════════════════════════════════════════

with pairs as (
  -- One row per (tour_name, transport_name, location_slug) intended link.
  select * from (values
    -- Sri Lanka
    ('sri-lanka', 'Tea Plantation Visit', 'Tea Plantation'),
    ('sri-lanka', 'Ice Bath',             'Ice Bath'),
    ('sri-lanka', 'River Safari',         'River Cruise'),
    -- Morocco — pick the Car vehicle as the default; the cheaper option
    -- is the most common booking, and the user can switch any tour to
    -- Minivan / Big Van later in the modal.
    ('morocco',   'Souk Tour',            'Souk — Car'),
    ('morocco',   'Paradise Valley',      'Paradise Valley — Car'),
    ('morocco',   'Dunes — Sandboarding', 'Dunes — Car'),
    ('morocco',   'Dunes — Camel Ride',   'Dunes — Car')
  ) as t(loc, tour_name, transport_name)
),
resolved as (
  -- Find the catalog UUIDs for each pair on each side. Uses case-insensitive
  -- equality so capitalisation drift doesn't break the match. Picks just
  -- one transport row even if the user has accidentally created duplicates
  -- (min(id) — deterministic so re-runs land on the same row).
  select
    p.loc                                                as slug,
    p.tour_name                                          as tour_name,
    p.transport_name                                     as transport_name,
    l.id                                                 as location_id,
    (select pc.id from public.pricing_catalog pc
       where pc.location_id = l.id
         and pc.category    = 'Tour'
         and lower(pc.name) = lower(p.tour_name)
         and pc.active      = true
       order by pc.sort_order, pc.created_at
       limit 1)                                          as tour_id,
    (select pc.id from public.pricing_catalog pc
       where pc.location_id = l.id
         and pc.category    = 'Transport'
         and lower(pc.name) = lower(p.transport_name)
         and pc.active      = true
       order by pc.sort_order, pc.created_at
       limit 1)                                          as transport_id
  from pairs p
  join public.locations l on l.slug = p.loc
)
update public.pricing_catalog pc
   set linked_transport_preset_id = r.transport_id::text
  from resolved r
 where pc.id = r.tour_id
   and r.transport_id is not null
   and (pc.linked_transport_preset_id is null
        or pc.linked_transport_preset_id <> r.transport_id::text);

-- ── Verify — list what's now linked in both locations ──────────────────────

select
  l.slug                                              as location,
  t.name                                              as tour,
  t.sell_price                                        as tour_sell,
  t.cost_per_guest                                    as tour_cost,
  tr.name                                             as linked_transport,
  tr.cost_per_guest                                   as transport_cost,
  coalesce(t.cost_per_guest,0) + coalesce(tr.cost_per_guest,0) as combined_cost
from public.pricing_catalog t
join public.locations l on l.id = t.location_id
left join public.pricing_catalog tr
  on tr.id::text = t.linked_transport_preset_id
 and tr.category = 'Transport'
where t.category = 'Tour'
  and t.active = true
  and l.slug in ('sri-lanka', 'morocco')
order by l.slug, t.sort_order, t.name;
