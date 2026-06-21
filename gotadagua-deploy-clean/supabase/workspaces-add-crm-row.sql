-- ════════════════════════════════════════════════════════════════════════════
--  Workspaces — seed the 'crm' row so the CRM access toggle in Settings
--  actually persists.
-- ════════════════════════════════════════════════════════════════════════════
--
--  Same fix pattern as workspaces-add-prices-rows.sql.
--
--  The Settings UI has a "CRM" pill in Allowed areas, but the workspaces
--  table never had a 'crm' row. buildWorkspaceAccessRows in index.html
--  does `__workspaceRows.find(row => row.slug === workspaceSlug)` and if
--  that returns undefined (which it always did for 'crm') the area key is
--  silently dropped — no row in workspace_memberships, no workspace_access,
--  the CRM card never appears for the granted user.
--
--  Adding the row is enough on the data side; once it's here the existing
--  save path picks it up. Combined with the matching code patch
--  (console.warn instead of silent drop) so the next missing area never
--  goes unnoticed.
--
--  workspace_type is 'ops' — CRM is a management surface, not a camp hub.
--
--  Idempotent: on conflict (slug) do nothing.
--
--  How to run: paste into Supabase SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.workspaces (slug, name, workspace_type) values
  ('crm', 'CRM', 'ops')
on conflict (slug) do nothing;

-- ── Verify ──────────────────────────────────────────────────────────────────
select slug, name, workspace_type, active
  from public.workspaces
 where slug = 'crm';
-- Expected: 1 row, active = true.
