-- ════════════════════════════════════════════════════════════════════════════
--  Workspaces — seed prices-<slug> rows so per-camp price access can be
--  granted via workspace_memberships
-- ════════════════════════════════════════════════════════════════════════════
--
--  The Settings UI exposes four "Prices" toggles (Sri Lanka prices,
--  Morocco prices, Portugal prices, Junior Camp prices) but they had
--  no corresponding rows in the workspaces table. buildWorkspaceAccessRows
--  silently dropped any area_key starting with 'prices-' because
--  __workspaceRows.find(row => row.slug === workspaceSlug) returned
--  undefined, so toggling those pills did nothing on save.
--
--  This script adds the four missing workspace rows. Once they exist the
--  frontend can persist memberships against them and the pills behave
--  identically to the other access toggles.
--
--  Slugs match the area_key values in ACCESS_AREAS exactly:
--    prices-sri-lanka, prices-morocco, prices-portugal, prices-junior
--
--  workspace_type is 'ops' — these are management surfaces, not camp hubs.
--
--  Idempotent: on conflict (slug) do nothing.
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.workspaces (slug, name, workspace_type) values
  ('prices-sri-lanka', 'Sri Lanka prices',   'ops'),
  ('prices-morocco',   'Morocco prices',     'ops'),
  ('prices-portugal',  'Portugal prices',    'ops'),
  ('prices-junior',    'Junior Camp prices', 'ops')
on conflict (slug) do nothing;

-- ── Verify ──────────────────────────────────────────────────────────────────
select slug, name, workspace_type, active
  from public.workspaces
 where slug like 'prices-%'
 order by slug;
