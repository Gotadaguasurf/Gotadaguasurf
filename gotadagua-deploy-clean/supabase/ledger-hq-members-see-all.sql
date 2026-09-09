-- 9 Set 2026 — Miguel: "quem tem acesso ao HQ vê tudo; se não der acesso não vê o HQ".
-- O ledger dos camps (despesas locais, receita no local) era filtrado por
-- localização mesmo para membros do HQ, e o Overview mostrava €0 de despesas
-- locais e um lucro inflacionado a quem não tinha todas as localizações.
drop policy if exists ledger_entries_select_location on public.ledger_entries;
create policy ledger_entries_select_location on public.ledger_entries
  for select to authenticated
  using (public.has_location_access(location_id) or public.is_hq_member());
