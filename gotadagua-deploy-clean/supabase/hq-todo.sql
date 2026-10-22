-- ════════════════════════════════════════════════════════════════════════════
--  «Hoje» — what needs Miguel today, computed by the database (22 Oct 2026,
--  wave 2 of docs/PLANO-interface-e-automacao.md: «quero tudo o mais
--  automatizado possível… melhorar o workflow das minhas tarefas diárias»).
--
--  1. hq_todo()            one JSON with every pending item the daily routine
--                          used to compute by hand: lines to categorise,
--                          duplicates, bank debits without a line, lines
--                          without PDF since Sept, Wild «[pending HQ invoice]»
--                          rows, recurring lines due, how old each bank
--                          statement is, partner invoices still to issue,
--                          month-close checks. Read by the hub («Hoje») and
--                          the HQ overview.
--  2. hq_recurring_run()   creates the monthly fixed lines from
--                          hq_recurring_expenses when due (idempotent: never
--                          twice in a month, never when a same line already
--                          exists). pg_cron runs it every day at 06:10 UTC.
--  3. Seeds the four monthly cash lines Miguel listed on 21 Oct 2026 (office
--                          rent 1.300, surf-school rent 400, João Girbal +200,
--                          Maxime +50) as templates, and fills the two missing
--                          surf-school rent months (Sep, Oct 2026).
--  4. fn_wild_pending_cleanup: when a «Wild · …» invoice enters the HQ, the
--                          matching «[pending HQ invoice]» row of the Wild
--                          ledger (same amount, ±14 days) is removed so the
--                          cost is not counted twice (SKILL, 21 Oct 2026).
-- ════════════════════════════════════════════════════════════════════════════

-- 1 ───────────────────────────────────────────────────────────────────────
create or replace function public.hq_todo()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v json; v_since date := '2026-09-01'; v_today date := current_date;
  v_month text := to_char(current_date, 'YYYY-MM');
  v_prev  text := to_char(current_date - interval '1 month', 'YYYY-MM');
begin
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
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
    -- partner + month with bookings (net > 0, commission > 0, month ended) and no partner invoice yet
    'partner_to_issue', (select json_agg(json_build_object('partner', partner_name, 'month', month_key, 'net', net, 'commission', comm) order by month_key desc, net desc) from (
        select b.partner_name, b.month_key, round(sum(b.net_amount)::numeric, 2) net, round(sum(coalesce(b.commission_amount, 0))::numeric, 2) comm
          from bookings b
         where b.partner_name is not null and b.net_amount > 0
           and b.month_key < v_month and b.month_key >= to_char(v_today - interval '4 months', 'YYYY-MM')
           and lower(b.partner_name) not in ('bpi', 'caixa geral de depositos', 'caixa gestão de activos e pensões', 'surfer girls power',
                                             'enjoy surf project', 'surf stories poland', 'solo campamentos', 'ocean adventure', 'juvigo')   -- Juvigo: advances + 15 % settlement, not monthly invoices
         group by 1, 2
        having sum(coalesce(b.commission_amount, 0)) > 0
           and not exists (select 1 from partner_invoices pi join partners p on p.id = pi.partner_id
                            where pi.month_key = b.month_key and lower(p.name) = lower(b.partner_name))) e),
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
grant execute on function public.hq_todo() to authenticated;

-- 2 ───────────────────────────────────────────────────────────────────────
create or replace function public.hq_recurring_run()
returns json
language plpgsql security definer set search_path = public as $$
declare r record; v_date date; v_created int := 0; v_rows json := '[]'::json; v_month text := to_char(current_date, 'YYYY-MM'); v_num text;
begin
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  for r in
    select * from hq_recurring_expenses
     where active and extract(day from current_date) >= coalesce(day_of_month, 1)
       and (last_created_on is null or to_char(last_created_on, 'YYYY-MM') < v_month)
     order by company
  loop
    v_date := (date_trunc('month', current_date)::date + (least(coalesce(r.day_of_month, 1), 28) - 1));
    -- never twice: a line of this supplier and amount already in the month (typed by hand or by an earlier run)
    if exists (select 1 from hq_invoices i where i.deleted_at is null and i.paying_company = r.paying_company
                 and lower(i.company) = lower(r.company) and to_char(i.invoice_date, 'YYYY-MM') = v_month
                 and abs(coalesce(i.amount_eur, i.amount) - coalesce(r.amount_eur, r.amount)) < 0.011) then
      update hq_recurring_expenses set last_created_on = v_date where id = r.id;
      continue;
    end if;
    v_num := nullif(trim(replace(replace(replace(coalesce(r.invoice_number_pattern, ''), '{YYYY-MM}', v_month), '{YYYY}', to_char(current_date, 'YYYY')), '{MM}', to_char(current_date, 'MM'))), '');
    insert into hq_invoices (location_slug, paying_company, invoice_date, company, supplier_nif, description, amount, currency, fx_rate, amount_eur,
                             payment_type, invoice_number, category_id, category_name, needs_review, notes)
    values (r.location_slug, r.paying_company, v_date, r.company, r.supplier_nif, r.description, r.amount, coalesce(r.currency, 'EUR'), coalesce(r.fx_rate, 1),
            coalesce(r.amount_eur, r.amount), coalesce(r.payment_type, 'Bank Transfer'), v_num, r.category_id, r.category_name,
            (r.category_id is null),
            '[recorrente mensal · criado automaticamente ' || to_char(current_date, 'DD Mon YYYY') || ']'
            || case when r.payment_type = 'Cash' then ' [em dinheiro — nunca ligar ao banco]' else '' end
            || case when r.payment_type <> 'Cash' then ' [confirmar valor com a fatura do mês]' else '' end);
    update hq_recurring_expenses set last_created_on = v_date where id = r.id;
    v_created := v_created + 1;
    v_rows := (select json_agg(x) from (select * from json_array_elements(v_rows) union all select json_build_object('company', r.company, 'date', v_date, 'amount', coalesce(r.amount_eur, r.amount))) q(x));
  end loop;
  return json_build_object('created', v_created, 'rows', coalesce(v_rows, '[]'::json));
end $$;
revoke all on function public.hq_recurring_run() from public, anon;
grant execute on function public.hq_recurring_run() to authenticated;

-- 3 ───────────────────────────────────────────────────────────────────────
insert into hq_recurring_expenses (location_slug, paying_company, company, description, category_id, category_name, amount, currency, fx_rate, amount_eur, payment_type, day_of_month, active, last_created_on, notes)
select v.location_slug, 'water-movements', v.company, v.description, c.id, c.name, v.amount, 'EUR', 1, v.amount, 'Cash', v.dom, true,
       (select max(invoice_date) from hq_invoices i where i.deleted_at is null and lower(i.company) = v.company and i.payment_type = 'Cash'),
       'Miguel, 21 Out 2026: sai do dinheiro todos os meses, nunca aparece no banco; nunca ligar a um débito.'
  from (values
    ('general',     'renda escritorio portugal', 'Renda do escritório Portugal (dinheiro)', 'Rent',   1300::numeric, 1),
    ('surf-school', 'renda escola de surf',      'Renda da escola de surf (dinheiro)',      'Rent',    400::numeric, 1),
    ('general',     'joao girbal',               'João Girbal · +200 € ao ordenado (dinheiro)', 'Salary', 200::numeric, 28),
    ('portugal',    'maxime',                    'Maxime · +50 € ao ordenado (dinheiro)',       'Salary',  50::numeric, 28)
  ) as v(location_slug, company, description, cat, amount, dom)
  join hq_invoice_categories c on c.name = v.cat and c.active
 where not exists (select 1 from hq_recurring_expenses e where lower(e.company) = v.company);

-- the surf-school rent was missing for Sep and Oct 2026 (routine rule: the four lines of the month must exist)
insert into hq_invoices (location_slug, paying_company, invoice_date, company, description, amount, currency, fx_rate, amount_eur, payment_type, category_id, category_name, needs_review, notes)
select 'surf-school', 'water-movements', d, 'renda escola de surf', 'Renda da escola de surf (dinheiro)', 400, 'EUR', 1, 400, 'Cash', c.id, c.name, false,
       '[em dinheiro — nunca ligar ao banco] criado 22 Out 2026 pela rotina mensal (mês em falta)'
  from (values ('2026-09-01'::date), ('2026-10-01'::date)) m(d)
  join hq_invoice_categories c on c.name = 'Rent' and c.active
 where not exists (select 1 from hq_invoices i where i.deleted_at is null and lower(i.company) = 'renda escola de surf' and to_char(i.invoice_date, 'YYYY-MM') = to_char(m.d, 'YYYY-MM'));
update hq_recurring_expenses set last_created_on = '2026-10-01' where lower(company) = 'renda escola de surf' and (last_created_on is null or last_created_on < '2026-10-01');

-- daily run (06:10 UTC); SQL directly, no HTTP secret to forget
select cron.unschedule(jobid) from cron.job where jobname = 'hq-recurring-daily';
select cron.schedule('hq-recurring-daily', '10 6 * * *', $$select public.hq_recurring_run();$$);

-- 4 ───────────────────────────────────────────────────────────────────────
create or replace function public.fn_wild_pending_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_loc uuid; v_id uuid;
begin
  if new.deleted_at is not null or coalesce(new.location_slug, '') <> 'wild-wednesday' or coalesce(new.category_name, '') not like 'Wild · %' then return new; end if;
  if tg_op = 'UPDATE' and old.deleted_at is null and old.category_name = new.category_name and old.amount_eur = new.amount_eur and old.invoice_date = new.invoice_date then return new; end if;
  select id into v_loc from locations where slug = 'wild-wednesday';
  select l.id into v_id from ledger_entries l
   where l.location_id = v_loc and l.source_kind = 'manual' and l.type = 'expense' and l.hq_invoice_id is null
     and l.description ilike '%[pending HQ invoice]%'
     and abs(l.amount_eur - coalesce(new.amount_eur, new.amount)) < 0.011
     and l.entry_date between new.invoice_date - 14 and new.invoice_date + 14
   order by (l.category = new.category_name) desc, abs(l.entry_date - new.invoice_date)
   limit 1;
  if v_id is not null then
    delete from ledger_entries where id = v_id;
    new.notes := trim(coalesce(new.notes, '') || ' [substituiu a linha «pending HQ invoice» da Wild]');
  end if;
  return new;
end $$;
drop trigger if exists tr_wild_pending_cleanup on public.hq_invoices;
create trigger tr_wild_pending_cleanup
  before insert or update on public.hq_invoices
  for each row execute function public.fn_wild_pending_cleanup();

-- check
select json_build_object(
  'templates', (select json_agg(json_build_object('c', company, 'dom', day_of_month, 'last', last_created_on)) from hq_recurring_expenses),
  'run', public.hq_recurring_run(),
  'cron', (select json_agg(jobname) from cron.job where jobname = 'hq-recurring-daily'),
  'todo', public.hq_todo()
) j;
