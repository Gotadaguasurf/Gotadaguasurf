-- ════════════════════════════════════════════════════════════════════════════
--  One number, one formula (22 Oct 2026, wave B of docs/PROPOSTA-estrutura-da-app.md).
--  The same figure was computed in five places with different rules. From now
--  on the rules live here and every page, the Excel, the accountant page, the
--  digest and «Hoje» read them.
--
--  1. hq_doc_status(invoice)  'ok' (has PDF) · 'isento' (no document exists:
--                             doc_exempt_reason, «[sem fatura» note, or a
--                             supplier that never issues one) · 'n/a'
--                             (Manjar salaries, benefits, taxes — no payslip in the app) ·
--                             'falta' (missing). Used by the accountant view,
--                             hq_todo, the Suk and the Month close.
--  2. hq_overview_rollup()    one call for the HQ: bookings (realized only:
--                             Paid / Confirmed / Deposit paid, like /partners),
--                             invoices (not deleted, not duplicates, not
--                             Manjar, personal flagged), ledger by RESOLVED
--                             location slug (attributed_location → paid_from →
--                             the row's location) excluding Manjar, plus the
--                             P&L grid (slug × month) computed here.
--  3. The accountant view and hq_todo use hq_doc_status.
--  4. Suppliers that never issue an invoice get doc_exempt_reason written on
--     their existing lines, so the rule is data, not a list in one page.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 ───────────────────────────────────────────────────────────────────────
create or replace function public.hq_doc_status(i public.hq_invoices)
returns text language sql immutable as $$
  select case
    when i.drive_link is not null and i.drive_link <> '' then 'ok'
    when i.doc_exempt_reason is not null then 'isento'
    when coalesce(i.notes, '') ilike '%[sem fatura%' then 'isento'
    -- suppliers that never issue a document (same list as ACC_NO_INVOICE in hq/index.html)
    when lower(coalesce(i.company, '')) ~ '^(google ads|meta ads|facebook ads|lg leasing|santander|paypal|getnet|domestic|cartao refeicao|cartão refeição)' then 'isento'
    -- Manjar's salaries/taxes come from the bank with no payslip in the app; Water's payroll, instructor receipts and tax forms DO have documents
    when coalesce(i.paying_company, 'water-movements') = 'manjar' and coalesce(i.category_name, '') in ('Salary', 'Benefits', 'Taxes') then 'n/a'
    else 'falta' end
$$;

-- 4 (first, so the view below sees it): suppliers that never issue a document
update public.hq_invoices i
   set doc_exempt_reason = 'o fornecedor não emite fatura'
 where i.deleted_at is null and i.drive_link is null and i.doc_exempt_reason is null
   and (lower(i.company) like 'google ads%' or lower(i.company) like 'meta ads%' or lower(i.company) like 'facebook ads%'
        or lower(i.company) like 'lg leasing%' or lower(i.company) like 'santander%' or lower(i.company) like 'paypal%'
        or lower(i.company) like 'getnet%' or lower(i.company) like 'domestic%' or lower(i.company) like 'cartao refeicao%'
        or lower(i.company) like 'cartão refeição%');

-- 3a. accountant page: same rule
create or replace view public._accountant_rows as
  select i.*, to_char(i.invoice_date, 'YYYY-MM') as month_key,
         case public.hq_doc_status(i) when 'ok' then 'ok' when 'falta' then 'falta' else 'isento' end as doc_status
    from public.hq_invoices i
   where i.deleted_at is null
     and coalesce(i.is_duplicate, false) = false
     and coalesce(i.paying_company, 'water-movements') = 'water-movements'
     and i.invoice_date >= date '2026-01-01';
revoke all on public._accountant_rows from public, anon, authenticated;

-- 2 ───────────────────────────────────────────────────────────────────────
-- Bookinglayer location names → location slugs (the same aliases locNameToSlug() keeps in hq/index.html)
create or replace function public.hq_booking_location_slug(p_name text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(p_name, '')))
    when 'surf camp portugal' then 'portugal' when 'portugal' then 'portugal' when 'coliving portugal caparica' then 'portugal'
    when 'tamraght camp' then 'morocco' when 'morocco' then 'morocco'
    when 'surf camp ahangama' then 'sri-lanka' when 'sri lanka' then 'sri-lanka'
    when 'junior camp caparica' then 'junior-camp' when 'junior camp' then 'junior-camp'
    when 'surf school caparica' then 'surf-school' when 'surf school' then 'surf-school'
    when 'kids camp caparica' then 'kids-camp' when 'kids camp' then 'kids-camp'
    when 'wild wednesday' then 'wild-wednesday' when 'wild' then 'wild-wednesday'
    else null end
$$;

create or replace function public.hq_overview_rollup()
returns jsonb
language sql stable security invoker set search_path = public as $$
  with loc as (
    select id, slug from public.locations
  ), manjar_locs as (
    select unnest(coalesce(covers_locations, array['the-suk'])) as slug from public.hq_companies where slug = 'manjar'
  ), bk as (
    select month_key, location,
           (partner_name is null or partner_name = '' or booking_type = 'direct') as direct,
           sum(coalesce(total, 0)) as total,
           sum(coalesce(net_amount, total, 0)) as net_amount,
           sum(coalesce(commission_amount, 0)) as commission_amount,
           sum(coalesce(pax, 0)) as pax,
           count(*) as n
      from public.bookings
     where coalesce(raw_payload->>'status', 'Paid') in ('Paid', 'Confirmed', 'Deposit paid', 'paid', 'confirmed', 'deposit_paid')
     group by 1, 2, 3
  ), inv as (
    select to_char(i.invoice_date, 'YYYY-MM') as month, coalesce(i.location_slug, 'general') as location_slug, i.category_id,
           coalesce(c.is_personal, false) as personal,
           sum(coalesce(i.amount_eur, 0)) as amount_eur, count(*) as n
      from public.hq_invoices i left join public.hq_invoice_categories c on c.id = i.category_id
     where i.deleted_at is null and coalesce(i.is_duplicate, false) = false
       and coalesce(i.paying_company, 'water-movements') <> 'manjar'
       and coalesce(i.location_slug, 'general') not in (select slug from manjar_locs)
     group by 1, 2, 3, 4
  ), lg as (
    select to_char(l.entry_date, 'YYYY-MM') as month, l.type,
           coalesce(nullif(l.attributed_location, ''), nullif(l.paid_from, ''), loc.slug) as slug,
           l.source_kind, sum(coalesce(l.amount_eur, 0)) as amount_eur
      from public.ledger_entries l left join loc on loc.id = l.location_id
     where coalesce(nullif(l.attributed_location, ''), nullif(l.paid_from, ''), loc.slug) not in (select slug from manjar_locs)
     group by 1, 2, 3, 4
  ), pnl as (
    select slug, month,
           sum(rev_book) as rev_book, sum(rev_ops) as rev_ops, sum(exp_local) as exp_local, sum(exp_hq) as exp_hq
      from (
        select public.hq_booking_location_slug(location) as slug, month_key as month, net_amount as rev_book, 0 as rev_ops, 0 as exp_local, 0 as exp_hq from bk
        union all
        select slug, month, 0, case when type in ('revenue', 'income') then amount_eur else 0 end, case when type = 'expense' then amount_eur else 0 end, 0
          from lg where source_kind is distinct from 'hq_invoice' and slug is not null
        union all
        select location_slug, month, 0, 0, 0, amount_eur from inv where not personal
      ) u
     group by 1, 2
  )
  select jsonb_build_object(
    'rules', jsonb_build_object('bookings', 'realized only (Paid, Confirmed, Deposit paid)', 'invoices', 'not deleted, not duplicate, not Manjar; personal flagged',
                                'ledger', 'slug = attributed_location → paid_from → location; Manjar excluded; hq_invoice rows flagged'),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('month_key', month_key, 'location', location, 'slug', public.hq_booking_location_slug(location), 'direct', direct, 'total', total,
                   'net_amount', net_amount, 'commission_amount', commission_amount, 'pax', pax, 'n', n)), '[]'::jsonb) from bk),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'location_slug', location_slug, 'category_id', category_id,
                   'personal', personal, 'amount_eur', amount_eur, 'n', n)), '[]'::jsonb) from inv),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'type', type, 'slug', slug, 'attributed_location', slug,
                   'source_kind', source_kind, 'amount_eur', amount_eur)), '[]'::jsonb) from lg),
    'pnl', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'month', month, 'rev_book', rev_book, 'rev_ops', rev_ops,
                   'exp_local', exp_local, 'exp_hq', exp_hq) order by month, slug), '[]'::jsonb) from pnl)
  );
$$;
grant execute on function public.hq_overview_rollup() to authenticated;

select json_build_object(
  'doc_status', (select json_agg(json_build_object('s', s, 'n', n)) from (select public.hq_doc_status(i) s, count(*) n from public.hq_invoices i where deleted_at is null and invoice_date >= '2026-09-01' group by 1) x),
  'rollup_keys', (select json_agg(k) from jsonb_object_keys(public.hq_overview_rollup()) k),
  'pnl_rows', (select jsonb_array_length(public.hq_overview_rollup()->'pnl'))
) j;
