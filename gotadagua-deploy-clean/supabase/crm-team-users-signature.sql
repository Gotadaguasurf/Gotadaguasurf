-- ════════════════════════════════════════════════════════════════════════════
--  team_users.signature — server-side, per-user signature
--
--  Before: signatures lived in localStorage keyed by auth.user.id, so each
--  browser only knew ITS user's signature — Miguel's browser had no way to
--  use Ricardo's signature when sending "as Ricardo" via the Send-as picker.
--
--  After: signature stored on the team_users row. The CRM reads it via
--  loadTeamUsers and writes it via the Settings page. Templates that use
--  {{my_signature}} resolve against the picked sender (not the logged-in
--  user) so Send-As works end to end.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.team_users
  add column if not exists signature text;

-- No RLS change needed — existing policies already gate team_users by
-- authenticated users. Signature is non-sensitive (a footer string).

-- Verify
select column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name='team_users' and column_name='signature';
