-- ════════════════════════════════════════════════════════════════════════════
--  SURF SCHOOL — workspaces for Settings → Team Access
-- ════════════════════════════════════════════════════════════════════════════
--
--  Ensures the workspace rows exist so ticking the new Settings chips
--    · Surf School
--    · Surf School · Rentals
--    · Surf School prices
--  actually creates working workspace_memberships (and RLS gates via
--  has_location_access / is_hq_member start returning true for them).
--
--  Miguel already created the 'surf-school' workspace manually during
--  the "lost open booking" debug — this SQL is idempotent, so re-running
--  it just no-ops.
--
--  Access model (unchanged, just extended to surf-school):
--    · workspace 'surf-school'          + can_edit=true  → full camp-hub
--      access (Overview / Rentals / Ledger / Weekly P&L) for surf-school.
--    · workspace 'surf-school'          + can_edit=false → Rentals-only
--      mode. The Settings UI builds `?view=camp-tab-only&location=…`
--      links for these users; camp-hub honours the flag and hides
--      everything except the middle tab, which for surf-school loads
--      /surf-school/?embedded=1.
--    · workspace 'prices-surf-school'   + can_view=true  → the Prices
--      catalog scoped to the school (Surf tab only, per the UI override).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.workspaces (slug, name, workspace_type)
values
  ('surf-school',        'Surf School',        'location'),
  ('prices-surf-school', 'Surf School prices', 'ops')
on conflict (slug) do update
  set name = excluded.name,
      workspace_type = excluded.workspace_type;

-- Owner (Miguel) should have full access to both. Skips silently if the
-- rows already exist from the earlier manual insert.
insert into public.workspace_memberships (user_id, workspace_id, can_view, can_edit, active)
select
  (select id from auth.users where email = 'miguel@gotadaguasurf.com'),
  w.id,
  true, true, true
from public.workspaces w
where w.slug in ('surf-school','prices-surf-school')
  and not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = w.id
      and m.user_id = (select id from auth.users where email = 'miguel@gotadaguasurf.com')
  );

-- Sanity check — should return two rows with can_view=true, active=true.
--   select w.slug, m.can_view, m.can_edit, m.active
--   from public.workspaces w
--   left join public.workspace_memberships m
--     on m.workspace_id = w.id
--    and m.user_id = (select id from auth.users where email='miguel@gotadaguasurf.com')
--   where w.slug in ('surf-school','prices-surf-school');
