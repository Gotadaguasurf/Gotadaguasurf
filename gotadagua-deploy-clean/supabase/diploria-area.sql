-- ════════════════════════════════════════════════════════════════════════════
--  Dipløria — its own business area, phase 1 (Miguel, 15 Nov 2026)
--  «a ideia é ter Dipløria em todos os camps a vender (cada um com o seu stock), mas depois ter uma área
--   como temos o HQ mas para a Dipløria, que vai ser um negócio nosso à parte».
--
--  The page /diploria/ reads, across every camp, the Diploria catalog rows (stock), the Diploria lines of
--  the Camp Tabs (sales) and the guest names of those lines. The Camp Tab data stays read-only here; the
--  stock moves and the expenses come with their own files (run order: this file, diploria-stock.sql,
--  diploria-expenses.sql).
--
--  Access: the owner (super_admin → is_global_admin) plus anyone with an active membership on the new
--  'diploria' workspace (Settings → Team access → «Dipløria», under Businesses). Nobody is granted here.
--  HQ members are NOT included on purpose (is_hq_member is not used): Miguel adds his partners one by one.
--
--  Camps keep their own access untouched: the 'diploria' workspace has no location with the same slug,
--  so has_location_access() never grants a camp through it. The new policies are permissive SELECT
--  policies limited to category 'Diploria' (and to the guests who have such a line).
--  is_diploria_member() = may look (can_view); is_diploria_editor() = may adjust stock and add expenses
--  (can_edit). The owner is both.
--  Idempotent. NOT run by the agent. Run order: 1 of 3 (after 0178cf0's SQL, already run).
-- ════════════════════════════════════════════════════════════════════════════
begin;

insert into public.workspaces (slug, name, workspace_type, active)
values ('diploria', 'Dipløria', 'business', true)
on conflict (slug) do nothing;

create or replace function public.is_diploria_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_admin() or exists (
    select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id
     where m.user_id = auth.uid() and m.active = true and coalesce(m.can_view, true) and w.slug = 'diploria');
$$;
revoke all on function public.is_diploria_member() from public, anon;
grant execute on function public.is_diploria_member() to authenticated;

create or replace function public.is_diploria_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_global_admin() or exists (
    select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id
     where m.user_id = auth.uid() and m.active = true and m.can_edit = true and w.slug = 'diploria');
$$;
revoke all on function public.is_diploria_editor() from public, anon;
grant execute on function public.is_diploria_editor() to authenticated;

-- Sales: every Diploria line of every Camp Tab.
drop policy if exists camp_tab_items_select_diploria on public.camp_tab_items;
create policy camp_tab_items_select_diploria on public.camp_tab_items for select to authenticated
  using (category = 'Diploria' and public.is_diploria_member());

-- The guest's name on those lines (only guests who have a Diploria line).
drop policy if exists camp_guests_select_diploria on public.camp_guests;
create policy camp_guests_select_diploria on public.camp_guests for select to authenticated
  using (public.is_diploria_member() and exists (
    select 1 from public.camp_tab_items i where i.guest_id = camp_guests.id and i.category = 'Diploria'));

-- Stock: the Camp Tab's copy of the Diploria rows (pricing_catalog is already readable by everyone signed in).
drop policy if exists location_menus_select_diploria on public.location_menus;
create policy location_menus_select_diploria on public.location_menus for select to authenticated
  using (category = 'Diploria' and public.is_diploria_member());

commit;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select slug, name, workspace_type from public.workspaces where slug = 'diploria';                         -- 1 row
-- select tablename, policyname from pg_policies where policyname like '%_diploria' order by 1;              -- 3 rows
-- select count(*) from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id where w.slug = 'diploria';   -- 0 (nobody granted yet)
