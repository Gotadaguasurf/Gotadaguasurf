-- ════════════════════════════════════════════════════════════════════
--  Partner commissions counted once (25 Oct 2026)
--
--  Bookings come into the app net of the partner commission
--  (bookings.net_amount). When the guest paid Gota, the partner later
--  sends a commission invoice, which was ALSO entered as an expense
--  (category Partners) — the same commission counted twice, about
--  28 k€ in 2026. From now on the commission lives only in the booking,
--  so it always lands in the right camp even when one invoice mixes
--  camps or years.
--
--  hq_invoices.commission_in_booking: null = default rule (Partners
--  lines dated 2026 or later are already in the booking), false = count
--  it as an expense (bookings from earlier years), true = force out.
--  The lines stay in the app, linked to the bank and in the
--  accountant pack; only the P&L (hq_overview_rollup) and the camp
--  ledger mirror leave them out.
-- ════════════════════════════════════════════════════════════════════

alter table public.hq_invoices add column if not exists commission_in_booking boolean;

create or replace function public.hq_commission_in_booking(i public.hq_invoices)
returns boolean language sql stable set search_path = public as $$
  select coalesce(i.commission_in_booking,
                  coalesce(i.category_name, '') = 'Partners' and i.invoice_date >= date '2026-01-01');
$$;
grant execute on function public.hq_commission_in_booking(public.hq_invoices) to authenticated;

CREATE OR REPLACE FUNCTION public.fn_mirror_hq_invoice_to_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_loc uuid; v_slug text; v_excluded boolean;
begin
  if tg_op = 'DELETE' then
    perform set_config('app.hq_mirror','1',true);
    delete from public.ledger_entries where hq_invoice_id = old.id;
    return old;
  end if;
  v_slug := case new.location_slug when 'kids-camp' then 'junior-camp' else new.location_slug end;
  select id into v_loc from public.locations where slug = v_slug;
  v_excluded := new.deleted_at is not null
             or coalesce(new.is_duplicate,false)
             or v_loc is null
             or new.location_slug in ('general')
             or coalesce(new.category_name,'') ilike '%personal%'
             or lower(coalesce(new.company,'')) like '%barata%'
             or public.hq_commission_in_booking(new);
  perform set_config('app.hq_mirror','1',true);
  if v_excluded then
    delete from public.ledger_entries where hq_invoice_id = new.id;
    return new;
  end if;
  insert into public.ledger_entries (
    location_id, type, category, business_area, description, payment_method, qty,
    amount_local, currency, fx_rate, amount_eur, entry_date, source_kind, is_comp,
    paid_from, attributed_location, hq_invoice_id)
  values (
    v_loc, 'expense', coalesce(nullif(new.category_name,''),'Other'),
    public.hq_mirror_business_area(new.category_name),
    left(coalesce(nullif(new.company,''),'?') || coalesce(' — ' || nullif(new.description,''), '') || ' · pago pelo HQ', 200),
    'HQ Paid', 1,
    coalesce(new.amount, 0), coalesce(nullif(new.currency,''),'EUR'),
    coalesce(new.fx_rate, 1), coalesce(new.amount_eur, new.amount, 0),
    new.invoice_date, 'hq_invoice', false, 'hq', v_slug, new.id)
  on conflict (hq_invoice_id) where hq_invoice_id is not null do update set
    location_id = excluded.location_id, category = excluded.category, business_area = excluded.business_area,
    description = excluded.description, amount_local = excluded.amount_local, currency = excluded.currency,
    fx_rate = excluded.fx_rate, amount_eur = excluded.amount_eur, entry_date = excluded.entry_date,
    attributed_location = excluded.attributed_location;
  return new;
end $function$;

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
       and not public.hq_commission_in_booking(i)
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
