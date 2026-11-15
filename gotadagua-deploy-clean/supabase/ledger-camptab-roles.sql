-- ════════════════════════════════════════════════════════════════════════════
--  The Camp-Tab-only accounts (member_role 'bar_man' / 'head_social_host' /
--  'camp_tab_staff', can_edit = false — e.g. Portugal's cafe@, the social hosts'
--  tablet) may write ONLY their camp's Camp Tab checkout lines in ledger_entries
--  (15 Nov 2026).
--
--  Why: the Camp Tab writes a ledger row when a line is paid. A bar_man has no
--  edit rights, so every write was refused: ~17,000 € paid in Portugal since July
--  never reached the ledger (the line stayed «Paid», no row). Since 15 Nov the
--  Camp Tab takes «Paid» back when the row is refused, so the bar could not pay.
--
--  Scope: rows of a location where the user has one of those roles (active), source_kind
--  camp_tab_per_guest / camp_tab_per_item, type revenue (sales) or money_sent
--  (cash held for Dipløria), never paid by HQ. Nothing else changes: managers keep
--  their rights, the restrictive policies (local manager bank lines, cash count)
--  still apply, other tables untouched. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists ledger_entries_insert_camptab_bar on public.ledger_entries;
drop policy if exists ledger_entries_update_camptab_bar on public.ledger_entries;
drop policy if exists ledger_entries_delete_camptab_bar on public.ledger_entries;
drop function if exists public.is_location_bar_man(uuid);

create or replace function public.is_location_camptab_role(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_memberships m
      join public.workspaces w on w.id = m.workspace_id
      join public.locations  l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
     where m.user_id = auth.uid() and m.active and m.member_role in ('bar_man', 'head_social_host', 'camp_tab_staff') and l.id = p_location_id);
$$;
revoke all on function public.is_location_camptab_role(uuid) from public, anon;
grant execute on function public.is_location_camptab_role(uuid) to authenticated;

create or replace function public.ledger_camptab_row(p_source_kind text, p_type text, p_paid_from text, p_payment_method text)
returns boolean language sql immutable as $$
  select coalesce(p_source_kind, '') in ('camp_tab_per_guest', 'camp_tab_per_item')
     and coalesce(p_type, '') in ('revenue', 'money_sent')
     and not public.ledger_hq_line(p_paid_from, p_source_kind, p_payment_method);
$$;

drop policy if exists ledger_entries_insert_camptab_role on public.ledger_entries;
create policy ledger_entries_insert_camptab_role on public.ledger_entries for insert to authenticated
  with check (public.is_location_camptab_role(location_id) and public.ledger_camptab_row(source_kind, type, paid_from, payment_method));
drop policy if exists ledger_entries_update_camptab_role on public.ledger_entries;
create policy ledger_entries_update_camptab_role on public.ledger_entries for update to authenticated
  using (public.is_location_camptab_role(location_id) and public.ledger_camptab_row(source_kind, type, paid_from, payment_method))
  with check (public.is_location_camptab_role(location_id) and public.ledger_camptab_row(source_kind, type, paid_from, payment_method));
drop policy if exists ledger_entries_delete_camptab_role on public.ledger_entries;
create policy ledger_entries_delete_camptab_role on public.ledger_entries for delete to authenticated
  using (public.is_location_camptab_role(location_id) and public.ledger_camptab_row(source_kind, type, paid_from, payment_method));

-- Checks (SELECT only)
-- select policyname, permissive, cmd from pg_policies where tablename = 'ledger_entries' and policyname like '%camptab_role%';
