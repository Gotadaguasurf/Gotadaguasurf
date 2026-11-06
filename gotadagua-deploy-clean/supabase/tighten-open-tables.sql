-- ════════════════════════════════════════════════════════════════════════════
--  6 Nov 2026 (Miguel): tables that any signed-in account could read and write
--  (policy «true» for authenticated) now follow the areas in Settings → Team Access.
--  Edge functions use the service role and are not affected.
--    Partners   → HQ or the «partners» area
--    CRM        → HQ or the «crm» area
--    Month close / accountant folders → HQ (and «the-suk», whose page uses them)
--    Prices     → everyone reads (camp hub, surf school); only HQ or a «prices-*» area writes
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.is_prices_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hq_member() or exists (
    select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id
     where m.user_id = auth.uid() and m.active = true and w.slug like 'prices-%');
$$;

do $$
declare t text; p record;
  partners text[] := array['partner_invoices','partner_ledger'];
  crm text[] := array['contacts','contact_pipeline','email_campaigns','email_messages','email_queue','email_suppression','meetings',
    'outreach_activity','outreach_contacts','outreach_groups','outreach_saved_views','outreach_sequence_runs','outreach_sequences','outreach_templates',
    'pipeline_stages','pipelines','tasks','team_users'];
  hq_suk text[] := array['hq_month_checks','accountant_drive_folders'];
  hq_only text[] := array['accountant_month_marks','review_drive_files'];
  prices text[] := array['pricing_catalog','pricing_areas','tour_zones','accommodation_packs','accommodation_prices','accommodation_room_types','accommodation_rooms','accommodation_seasons','pricing_access'];
begin
  foreach t in array partners || crm || hq_suk || hq_only || prices loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array partners loop
    execute format('create policy area_partners on public.%I for all to authenticated using (public.is_hq_member() or public.is_workspace_member(''partners'')) with check (public.is_hq_member() or public.is_workspace_member(''partners''))', t);
  end loop;
  foreach t in array crm loop
    execute format('create policy area_crm on public.%I for all to authenticated using (public.is_hq_member() or public.is_workspace_member(''crm'')) with check (public.is_hq_member() or public.is_workspace_member(''crm''))', t);
  end loop;
  foreach t in array hq_suk loop
    execute format('create policy area_hq_suk on public.%I for all to authenticated using (public.is_hq_member() or public.is_workspace_member(''the-suk'')) with check (public.is_hq_member() or public.is_workspace_member(''the-suk''))', t);
  end loop;
  foreach t in array hq_only loop
    execute format('create policy area_hq on public.%I for all to authenticated using (public.is_hq_member()) with check (public.is_hq_member())', t);
  end loop;
  foreach t in array prices loop
    execute format('create policy area_prices_read on public.%I for select to authenticated using (true)', t);
    execute format('create policy area_prices_insert on public.%I for insert to authenticated with check (public.is_prices_member())', t);
    execute format('create policy area_prices_update on public.%I for update to authenticated using (public.is_prices_member()) with check (public.is_prices_member())', t);
    execute format('create policy area_prices_delete on public.%I for delete to authenticated using (public.is_prices_member())', t);
  end loop;
end $$;
