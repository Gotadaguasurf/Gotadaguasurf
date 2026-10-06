-- ════════════════════════════════════════════════════════════════════════════
--  hq_overview_rollup — os totais do Overview do HQ calculados na base de
--  dados, num só pedido. Antes o browser puxava TODAS as reservas, despesas
--  e lançamentos do ledger (≈20 pedidos de 1000 linhas) só para somar.
--  Miguel, 6 Out 2026: «a app demora a abrir».
--  Mesmas regras do renderOverview(): reservas directas = sem parceiro ou
--  booking_type='direct'; net = coalesce(net_amount, total); despesas sem
--  deleted_at; ledger com source_kind (o browser exclui 'hq_invoice').
--  Corre com os direitos de quem chama (RLS igual aos selects directos).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.hq_overview_rollup()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month_key', b.month_key, 'location', b.location, 'direct', b.direct,
        'total', b.total, 'net_amount', b.net_amount, 'commission_amount', b.commission_amount, 'pax', b.pax, 'n', b.n)), '[]'::jsonb)
      from (
        select month_key, location, (partner_name is null or partner_name = '' or booking_type = 'direct') as direct,
               sum(coalesce(total, 0)) as total,
               sum(coalesce(net_amount, total, 0)) as net_amount,
               sum(coalesce(commission_amount, 0)) as commission_amount,
               sum(coalesce(pax, 0)) as pax,
               count(*) as n
          from bookings
         group by 1, 2, 3
      ) b),
    'invoices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', i.month, 'location_slug', i.location_slug, 'category_id', i.category_id, 'amount_eur', i.amount_eur)), '[]'::jsonb)
      from (
        select to_char(invoice_date, 'YYYY-MM') as month, location_slug, category_id, sum(coalesce(amount_eur, 0)) as amount_eur
          from hq_invoices
         where deleted_at is null
         group by 1, 2, 3
      ) i),
    'ledger', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', l.month, 'type', l.type, 'attributed_location', l.attributed_location, 'location_id', l.location_id,
        'source_kind', l.source_kind, 'amount_eur', l.amount_eur)), '[]'::jsonb)
      from (
        select to_char(entry_date, 'YYYY-MM') as month, type, attributed_location, location_id, source_kind, sum(coalesce(amount_eur, 0)) as amount_eur
          from ledger_entries
         group by 1, 2, 3, 4, 5
      ) l)
  );
$$;
grant execute on function public.hq_overview_rollup() to authenticated;
