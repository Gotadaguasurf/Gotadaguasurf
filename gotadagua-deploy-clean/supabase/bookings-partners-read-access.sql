-- 9 Set 2026 — Miguel: quem não tem o botão HQ não pode ver os números.
-- bookings, partners e partner_month_status eram legíveis por QUALQUER login
-- (cafe@, staff de bar, camp tab…): €1,56M de reservas e as comissões dos
-- parceiros à vista de todos. Regra nova: HQ, workspace Partners, workspace
-- CRM (o comercial vê reservas por parceiro), ou gestor com edição na própria
-- camp — e nesse caso só as reservas dessa camp. hq_invoice_audit passa a HQ.

create or replace function public.is_workspace_member(p_slug text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and m.active = true and w.slug = p_slug
  );
$$;

-- bookings.location é texto vindo do Bookinglayer; mapeia-se para locations.id
create or replace function public.booking_location_id(p_location text)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select l.id from public.locations l
  where l.slug = case p_location
    when 'Surf Camp Ahangama'   then 'sri-lanka'
    when 'Tamraght Camp'        then 'morocco'
    when 'Surf Camp Portugal'   then 'portugal'
    when 'Junior Camp Caparica' then 'junior-camp'
    when 'Kids Camp Caparica'   then 'junior-camp'
    when 'Surf School Caparica' then 'surf-school'
    else null end
  limit 1;
$$;

drop policy if exists bookings_select_auth on public.bookings;
create policy bookings_select_scoped on public.bookings for select to authenticated
  using (
    public.is_hq_member()
    or public.is_workspace_member('partners')
    or public.is_workspace_member('crm')
    or public.has_full_location_access(public.booking_location_id(location))
  );

drop policy if exists partners_select_auth on public.partners;
create policy partners_select_scoped on public.partners for select to authenticated
  using (public.is_hq_member() or public.is_workspace_member('partners') or public.is_workspace_member('crm'));

drop policy if exists partner_month_status_select_auth on public.partner_month_status;
create policy partner_month_status_select_scoped on public.partner_month_status for select to authenticated
  using (public.is_hq_member() or public.is_workspace_member('partners') or public.is_workspace_member('crm'));

drop policy if exists hq_invoice_audit_all_authenticated on public.hq_invoice_audit;
create policy hq_invoice_audit_hq_member on public.hq_invoice_audit for all to authenticated
  using (public.is_hq_member()) with check (public.is_hq_member());
