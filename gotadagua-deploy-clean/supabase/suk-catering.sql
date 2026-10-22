-- ════════════════════════════════════════════════════════════════════════════
--  The Suk, phase 4 (Miguel, 22 Oct 2026): restaurant / catering split of the
--  costs. Manjar's two businesses are two locations of the same company:
--    the-suk       = the restaurant (sales = TPA + cash deposits on the BCP;
--                    the restaurant has its own POS, to be connected later)
--    suk-catering  = the food Manjar sells to Water (sales = Water's transfers)
--  An expense line's location_slug says which business it belongs to; the
--  Suk page has a «Business» selector per line (default: restaurant).
-- ════════════════════════════════════════════════════════════════════════════
insert into public.locations (slug, name, currency, default_fx_to_eur, camp_tab_mode, active)
values ('suk-catering', 'The Suk · Catering', 'EUR', 1, 'weekly', true)
on conflict (slug) do nothing;

update public.hq_companies set covers_locations = array['the-suk', 'suk-catering'] where slug = 'manjar';

-- access like the restaurant: the same workspaces row covers both (the page gates on the-suk)
select json_build_object(
  'loc', (select json_agg(json_build_object('slug', slug, 'id', id)) from public.locations where slug in ('the-suk', 'suk-catering')),
  'co', (select covers_locations from public.hq_companies where slug = 'manjar')
) j;
