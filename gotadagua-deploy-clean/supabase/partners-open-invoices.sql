-- ════════════════════════════════════════════════════════════════════════════
--  Who owes us, by invoice (18 Nov 2026 audit, finding H2: the HQ chip
--  «partner invoices to issue» said 42 and about 7 were real).
--
--  The Partners page computes its three lists in the browser with its own
--  commission maths (monthSplit / bookingPayRoute in partners/index.html).
--  This file gives the HQ chip the SAME rule on the server:
--
--  1. partners.no_monthly_invoice   optional flag, default false: the partner
--                                   is never listed under «To invoice» (billed
--                                   outside the monthly partner invoices, or
--                                   it invoices us). Seeded ONCE with the nine
--                                   names hq_todo() skipped by a hard-coded
--                                   list until today — nothing else changes.
--  2. partner_alias(name)           several partner records, one company
--                                   (mirror of lib/partner-alias.js — keep the
--                                   two lists equal; tests/partners-owes.spec.js
--                                   compares them). No row is merged or renamed.
--  3. partner_open_items()          to_invoice + waiting, same rule as the page.
--  4. hq_todo()                     whole function re-created (body identical
--                                   to supabase/hq-todo.sql): partner_to_issue
--                                   now comes from (3) and partner_waiting_60
--                                   is new (issued invoices unpaid > 60 days).
--
--  Never changes a status, never creates a document: read-only functions and
--  one new column. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 ───────────────────────────────────────────────────────────────────────
alter table public.partners add column if not exists no_monthly_invoice boolean;
-- first run only (the column is still empty): the names hq_todo() already skipped
update public.partners
   set no_monthly_invoice = lower(btrim(name)) in ('bpi', 'caixa geral de depositos', 'caixa gestão de activos e pensões', 'surfer girls power',
                                                    'enjoy surf project', 'surf stories poland', 'solo campamentos', 'ocean adventure', 'juvigo')
 where no_monthly_invoice is null;
alter table public.partners alter column no_monthly_invoice set default false;
alter table public.partners alter column no_monthly_invoice set not null;
comment on column public.partners.no_monthly_invoice is
  'true = never listed under «To invoice» on the Partners page / HQ chip (billed outside the monthly partner invoices, or the partner invoices us). Issued invoices still show under «Waiting for payment».';

-- 2 ───────────────────────────────────────────────────────────────────────
create or replace function public.partner_alias(p_name text)
returns text
language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_name, '')))
           when 'surfcamp it'     then 'Surf Camp IT'
           when 'surfcamp italy'  then 'Surf Camp IT'
           when 'surfhouse.it'    then 'Surf Camp IT'
           when 'surfwise'        then 'Surfwise'
           when 'surfwise travel' then 'Surfwise'
           else btrim(coalesce(p_name, ''))
         end
$$;
revoke all on function public.partner_alias(text) from public, anon;
grant execute on function public.partner_alias(text) to authenticated, service_role;

-- 3 ───────────────────────────────────────────────────────────────────────
-- Same rule as partnerOwes() in partners/index.html:
--   · who collected is decided per booking (Status + Due; «Connect:» rows and
--     partial payments fall back to partners.collects_from_guest) — only what
--     the PARTNER collected (net) is ours to invoice;
--   · a partner-month marked Paid is closed (Paid only comes from the bank);
--   · to invoice  = closed month, not Paid, worth − invoices of the month > 1 €,
--                   one row per company (aliases grouped) and month;
--   · waiting     = one row per issued invoice of a month not Paid, minus what
--                   partner_ledger says was received for that invoice number;
--                   invoices of months where only WE owe (the partner's own
--                   invoice to us) are left out.
create or replace function public.partner_open_items()
returns json
language sql stable set search_path = public as $$
  with bk as (
    select lower(btrim(b.partner_name)) pkey, btrim(b.partner_name) pname,
           to_char(b.check_in_on, 'YYYY-MM') m,
           coalesce(b.total, 0) gross, coalesce(b.net_amount, 0) net, coalesce(b.commission_amount, 0) com,
           lower(regexp_replace(btrim(coalesce(b.raw_payload->>'status', '')), '\s+', '_', 'g')) st,
           case when b.raw_payload->>'due' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then (b.raw_payload->>'due')::numeric end due,
           coalesce(nullif(b.raw_payload->>'bookingSource', ''), b.raw_payload->>'source', '') src,
           (select p.collects_from_guest from partners p where p.name = btrim(b.partner_name) and p.is_active limit 1) cfg
      from bookings b
     where btrim(coalesce(b.partner_name, '')) <> '' and b.check_in_on is not null
  ), routed as (
    select bk.*,
           (st = '' or st in ('paid', 'confirmed', 'deposit_paid')) realized,
           case when due is null or gross <= 0 then null
                when src ~* '^\s*connect\M' then case when st in ('confirmed', 'deposit_paid') and abs(due - gross) <= 0.01 then 'partner' end
                when st = 'paid' and due <= 0.01 then 'gota'
                when st in ('confirmed', 'deposit_paid') and abs(due - gross) <= 0.01 then 'partner'
                when due <= 0.01 then 'gota'
           end route
      from bk
  ), pm as (            -- one partner record × month: what the partner owes us / what we owe the partner
    select pkey, max(pname) pname, m,
           round(coalesce(sum(net) filter (where realized and coalesce(route = 'partner', cfg is not false)), 0), 2) to_us,
           round(coalesce(sum(com) filter (where realized and not coalesce(route = 'partner', cfg is not false)), 0), 2) to_partner
      from routed group by pkey, m
  ), st as (
    select distinct on (lower(btrim(p.name)), s.month_key)
           lower(btrim(p.name)) pkey, s.month_key m, btrim(coalesce(s.status, '')) status, coalesce(s.notes, '') notes
      from partner_month_status s join partners p on p.id = s.partner_id
     order by lower(btrim(p.name)), s.month_key, s.updated_at desc nulls last
  ), flag as (
    select lower(btrim(name)) pkey, bool_or(no_monthly_invoice) skip from partners group by 1
  ), inv as (
    select i.id, lower(btrim(coalesce(nullif(btrim(i.partner_name), ''), p.name, ''))) pkey,
           btrim(coalesce(nullif(btrim(i.partner_name), ''), p.name, '')) pname,
           i.month_key m, i.invoice_number, coalesce(i.invoice_date, i.created_at::date) invoice_date,
           coalesce(i.amount, 0) amount, coalesce(i.notes, '') notes
      from partner_invoices i left join partners p on p.id = i.partner_id
  ), g_all as (         -- company × month, every booking: tells whose invoice a month's invoice is
    select lower(public.partner_alias(pname)) g, m, sum(to_us) to_us, sum(to_partner) to_partner from pm group by 1, 2
  ), g_open as (        -- company × month, records not Paid and not flagged
    select lower(public.partner_alias(pm.pname)) g, pm.m, max(public.partner_alias(pm.pname)) partner, sum(pm.to_us) worth,
           string_agg(distinct nullif(st.status, ''), ', ') status
      from pm left join st on st.pkey = pm.pkey and st.m = pm.m
              left join flag on flag.pkey = pm.pkey
     where coalesce(st.status, '') <> 'Paid' and coalesce(flag.skip, false) = false
     group by 1, 2
  ), g_inv as (         -- invoices filed on a month that is not Paid
    select lower(public.partner_alias(inv.pname)) g, inv.m, sum(inv.amount) invoiced
      from inv left join st on st.pkey = inv.pkey and st.m = inv.m
     where coalesce(st.status, '') <> 'Paid'
     group by 1, 2
  ), to_invoice as (
    select o.partner, o.m, o.worth, coalesce(i.invoiced, 0) invoiced, o.worth - coalesce(i.invoiced, 0) amount, o.status
      from g_open o left join g_inv i on i.g = o.g and i.m = o.m
     where o.m < to_char(current_date, 'YYYY-MM') and o.worth - coalesce(i.invoiced, 0) > 1
  ), recv as (          -- received per company and invoice number («FT » prefix and spaces ignored)
    select lower(public.partner_alias(l.partner_name)) g,
           upper(regexp_replace(regexp_replace(l.ref, '^\s*F[TRS]\s*', '', 'i'), '\s+', '', 'g')) ref, sum(l.amount) got
      from partner_ledger l
     where l.deleted_at is null and l.kind = 'received' and btrim(coalesce(l.ref, '')) <> ''
     group by 1, 2
  ), waiting as (
    select public.partner_alias(inv.pname) partner, inv.m, inv.invoice_number, inv.invoice_date, inv.amount,
           inv.amount - coalesce(r.got, 0) open, current_date - inv.invoice_date days,
           (coalesce(st.notes, '') || ' ' || inv.notes) ~* '(disput|on hold)' hold
      from inv left join st on st.pkey = inv.pkey and st.m = inv.m
               left join g_all a on a.g = lower(public.partner_alias(inv.pname)) and a.m = inv.m
               left join recv r on r.g = lower(public.partner_alias(inv.pname))
                               and r.ref = upper(regexp_replace(regexp_replace(inv.invoice_number, '^\s*F[TRS]\s*', '', 'i'), '\s+', '', 'g'))
     where coalesce(st.status, '') <> 'Paid'
       and inv.amount - coalesce(r.got, 0) > 0.01
       and not (coalesce(a.to_partner, 0) > 0.004 and coalesce(a.to_us, 0) <= 0.004)
  )
  select json_build_object(
    'to_invoice', coalesce((select json_agg(json_build_object('partner', partner, 'month', m, 'worth', worth, 'invoiced', invoiced, 'amount', amount, 'status', status)
                                            order by m desc, amount desc) from to_invoice), '[]'::json),
    'waiting',    coalesce((select json_agg(json_build_object('partner', partner, 'month', m, 'invoice', invoice_number, 'date', invoice_date,
                                                              'amount', amount, 'open', open, 'days', days, 'hold', coalesce(hold, false))
                                            order by days desc, open desc) from waiting), '[]'::json))
$$;
-- internal: only hq_todo() (security definer) and the service role call it
revoke all on function public.partner_open_items() from public, anon, authenticated;
grant execute on function public.partner_open_items() to service_role;

-- 4 ───────────────────────────────────────────────────────────────────────
-- Body identical to supabase/hq-todo.sql (tests/partners-owes.spec.js compares the two).
create or replace function public.hq_todo()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v json; v_since date := '2026-09-01'; v_today date := current_date;
  v_month text := to_char(current_date, 'YYYY-MM');
  v_prev  text := to_char(current_date - interval '1 month', 'YYYY-MM');
  v_po json;
begin
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  -- who owes us (supabase/partners-open-invoices.sql): a problem there must not take the other chips down
  begin
    v_po := public.partner_open_items();
  exception when others then
    v_po := json_build_object('error', sqlerrm);
  end;
  select json_build_object(
    'generated_at', now(),
    'month', v_month, 'prev_month', v_prev, 'since', v_since,
    -- lines without a category (Water and Manjar separately)
    'review', (select json_agg(json_build_object('company', paying_company, 'n', n, 'sum', s)) from (
        select paying_company, count(*) n, round(coalesce(sum(amount_eur), 0)::numeric, 2) s
          from hq_invoices where deleted_at is null and needs_review and coalesce(is_duplicate, false) = false group by 1) a),
    'duplicates', (select count(*) from hq_invoices where deleted_at is null and is_duplicate and paying_company = 'water-movements'),
    -- bank debits still without a line (what the daily routine calls «débitos sem linha»)
    'bank_unlinked', (select json_agg(json_build_object('bank', bank, 'company', paying_company, 'n', n, 'sum', s, 'oldest', o)) from (
        select bank, paying_company, count(*) n, round((-sum(amount))::numeric, 2) s, min(movement_date) o
          from hq_bank_movements
         where kind = 'expense' and amount < 0 and hq_invoice_id is null and internal_transfer_id is null
           and movement_date >= v_since
           and description not ilike 'LOTE TRF CRED SEPA%'
           and coalesce(notes, '') not ilike '[sem fatura%' and coalesce(notes, '') not like '[ativo%'
           and coalesce(notes, '') not like '[financiamento%' and coalesce(notes, '') not like '[devolução%'
         group by 1, 2) b),
    -- lines without a document since September (salaries/taxes/benefits never need one)
    'no_pdf', (select json_agg(json_build_object('company', paying_company, 'n', n, 'sum', s)) from (
        select paying_company, count(*) n, round(coalesce(sum(amount_eur), 0)::numeric, 2) s
          from hq_invoices i
         where i.deleted_at is null and i.invoice_date >= v_since and public.hq_doc_status(i) = 'falta'
         group by 1) c),
    'wild_pending', (select count(*) from ledger_entries l join locations o on o.id = l.location_id
                      where o.slug = 'wild-wednesday' and l.description ilike '%[pending HQ invoice]%'),
    'recurring_due', (select count(*) from hq_recurring_expenses r
                       where r.active and extract(day from v_today) >= coalesce(r.day_of_month, 1)
                         and (r.last_created_on is null or to_char(r.last_created_on, 'YYYY-MM') < v_month)),
    'bank_last', (select json_agg(json_build_object('bank', bank, 'company', paying_company, 'last', mx, 'days', v_today - mx)) from (
        select bank, paying_company, max(movement_date) mx from hq_bank_movements group by 1, 2) d),
    -- company + closed month that is not Paid and is worth more than its invoices (same rule as the Partners page)
    'partner_to_issue', v_po->'to_invoice',
    -- issued partner invoices unpaid for more than 60 days (months «on hold» left out)
    'partner_waiting_60', (select json_agg(w) from json_array_elements(v_po->'waiting') w where (w->>'days')::int > 60 and not (w->>'hold')::boolean),
    'partner_error', v_po->>'error',
    'month_close', json_build_object('month', v_prev,
        'checks', (select json_agg(json_build_object('item', item, 'done', done_at is not null)) from hq_month_checks where month_key = v_prev),
        'no_pdf', (select count(*) from hq_invoices i where i.deleted_at is null and public.hq_doc_status(i) = 'falta'
                     and i.paying_company = 'water-movements' and to_char(i.invoice_date, 'YYYY-MM') = v_prev),
        'bank_unlinked', (select count(*) from hq_bank_movements
                           where paying_company = 'water-movements' and kind = 'expense' and amount < 0 and hq_invoice_id is null and internal_transfer_id is null
                             and to_char(movement_date, 'YYYY-MM') = v_prev and description not ilike 'LOTE TRF CRED SEPA%'
                             and coalesce(notes, '') not ilike '[sem fatura%' and coalesce(notes, '') not like '[ativo%'
                             and coalesce(notes, '') not like '[financiamento%' and coalesce(notes, '') not like '[devolução%'))
  ) into v;
  return v;
end $$;
revoke all on function public.hq_todo() from public, anon;
grant execute on function public.hq_todo() to authenticated, service_role;

-- check (read-only): the chip count and the rows behind it
select json_build_object(
  'flagged',  (select json_agg(name order by name) from partners where no_monthly_invoice),
  'to_issue', public.hq_todo()->'partner_to_issue',
  'waiting_60', public.hq_todo()->'partner_waiting_60',
  'error', public.hq_todo()->'partner_error'
) j;
