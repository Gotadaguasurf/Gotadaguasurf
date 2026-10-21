-- ════════════════════════════════════════════════════════════════════════════
--  Businesses (Miguel, 21 Out 2026: «Bora fazer os businesses»)
--  The hub gets a "Businesses" section with Wild Wednesday and The Suk, each
--  with its own page (/wild/, /suk/). Access works like the camps: a
--  workspaces row whose slug equals the location slug, so the Settings pill
--  → workspace_memberships → has_location_access / has_full_location_access
--  chain applies unchanged (view = can_view, edit = can_edit).
-- ════════════════════════════════════════════════════════════════════════════
insert into public.workspaces (slug, name, workspace_type) values
  ('wild-wednesday', 'Wild Wednesday', 'location'),
  ('the-suk',        'The Suk',        'location')
on conflict (slug) do nothing;

-- The Suk — Manjar's restaurant (Costa da Caparica). Nothing lanced yet; the
-- location exists so the card, the page and the HQ Businesses tab have
-- somewhere to point. Daily closes and «Suk · …» categories come later.
insert into public.locations (slug, name, currency, default_fx_to_eur, camp_tab_mode, active)
values ('the-suk', 'The Suk', 'EUR', 1, 'weekly', true)
on conflict (slug) do nothing;

-- Manjar Lda pays The Suk's bills (not Water Movements).
insert into public.hq_companies (slug, name, covers_locations)
values ('manjar', 'Manjar Lda', array['the-suk'])
on conflict (slug) do nothing;

-- Ticket counts on the Wild revenue rows lanced on 20 Oct 2026 (qty was not
-- filled then; the number sits in the description "… 23×10 €").
update public.ledger_entries set qty = (regexp_match(description, '(\d+)×10'))[1]::numeric
 where location_id = (select id from public.locations where slug = 'wild-wednesday')
   and type = 'revenue' and source_kind = 'manual' and qty is null
   and category in ('Wild · Gota', 'Wild · Pure', 'Wild · Surfin')
   and description ~ '\d+×10';

select json_build_object(
  'ws', (select json_agg(slug order by slug) from public.workspaces where slug in ('wild-wednesday', 'the-suk')),
  'loc', (select json_agg(json_build_object('slug', slug, 'id', id)) from public.locations where slug in ('wild-wednesday', 'the-suk')),
  'co', (select json_agg(slug) from public.hq_companies where slug = 'manjar'),
  'qty', (select json_agg(x) from (select category, count(*) n, sum(qty) tickets from public.ledger_entries where location_id = (select id from public.locations where slug = 'wild-wednesday') and type = 'revenue' and source_kind = 'manual' and qty is not null group by category) x)
) j;

-- The Gota top-up rows: qty is the top-up over the camp tab ("acerto de N bilhetes"), not the night's total.
update public.ledger_entries set qty = (regexp_match(description, 'acerto de (\d+) bilhetes'))[1]::numeric
 where location_id = (select id from public.locations where slug = 'wild-wednesday')
   and type = 'revenue' and source_kind = 'manual' and category = 'Wild · Gota'
   and description ~ 'acerto de \d+ bilhetes';
select json_build_object('gota_topup_tickets', (select sum(qty) from public.ledger_entries where location_id = (select id from public.locations where slug = 'wild-wednesday') and type = 'revenue' and source_kind = 'manual' and category = 'Wild · Gota')) j;
