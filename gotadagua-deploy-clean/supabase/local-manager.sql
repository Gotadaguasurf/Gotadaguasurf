-- ════════════════════════════════════════════════════════════════════════════
--  Local Manager (6 Nov 2026, Miguel): a camp's local manager (Sri Lanka: Nadith)
--  works the Camp Tab and the Operations Ledger — local expenses and revenue,
--  with editing — but must never see what the HQ pays for that camp
--  (international salaries, flights, SRP, HQ transfers…).
--
--  Only users whose membership on that camp has member_role = 'local_manager'
--  are restricted. Everyone else with access to the camp (international manager,
--  owners, HQ members) keeps seeing every line, as before.
--
--  An «HQ line» = paid_from 'hq', or mirrored from the HQ (source_kind hq_invoice /
--  hq_transfer), or payment method «HQ Paid».
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.is_local_manager(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_global_admin() and not public.is_hq_member() and exists (
    select 1 from public.workspace_memberships m
      join public.workspaces w on w.id = m.workspace_id
      join public.locations l on (l.slug = w.slug) or (w.slug = 'junior' and l.slug = 'junior-camp')
     where m.user_id = auth.uid() and m.active = true and m.member_role = 'local_manager' and l.id = p_location_id);
$$;

create or replace function public.ledger_hq_line(p_paid_from text, p_source_kind text, p_payment_method text)
returns boolean language sql immutable as $$
  select coalesce(p_paid_from, '') = 'hq'
      or coalesce(p_source_kind, '') in ('hq_invoice', 'hq_transfer')
      or coalesce(p_payment_method, '') = 'HQ Paid';
$$;

drop policy if exists ledger_entries_select_location on public.ledger_entries;
create policy ledger_entries_select_location on public.ledger_entries for select using (
  (public.has_location_access(location_id) or public.is_hq_member())
  and not (public.is_local_manager(location_id) and public.ledger_hq_line(paid_from, source_kind, payment_method))
);

drop policy if exists ledger_entries_insert_full on public.ledger_entries;
create policy ledger_entries_insert_full on public.ledger_entries for insert with check (
  public.has_full_location_access(location_id)
  and not (public.is_local_manager(location_id) and public.ledger_hq_line(paid_from, source_kind, payment_method))
);

drop policy if exists ledger_entries_update_full on public.ledger_entries;
create policy ledger_entries_update_full on public.ledger_entries for update using (
  public.has_full_location_access(location_id)
  and not (public.is_local_manager(location_id) and public.ledger_hq_line(paid_from, source_kind, payment_method))
) with check (
  public.has_full_location_access(location_id)
  and not (public.is_local_manager(location_id) and public.ledger_hq_line(paid_from, source_kind, payment_method))
);

drop policy if exists ledger_entries_delete_full on public.ledger_entries;
create policy ledger_entries_delete_full on public.ledger_entries for delete using (
  public.has_full_location_access(location_id)
  and not (public.is_local_manager(location_id) and public.ledger_hq_line(paid_from, source_kind, payment_method))
);
