-- ════════════════════════════════════════════════════════════════════════════
--  «Cash today and the next 30 days» — top of the HQ «Cash flow» tab, owners
--  only. 18 Nov 2026.
--
--  hq_cash_position()  one JSON with the raw facts; the page (hq/cash-position.js,
--                      CashPosition.plan) turns them into the 30-day list and the
--                      lowest point per account, so the rule is tested without a
--                      database.
--
--  1. accounts — every Water Movements bank whose statement carries a running
--     balance in hq_bank_movements (today: santander, cgd). PayPal and the
--     Santander card have no balance on any row, so they never appear. Manjar's
--     account (bcp) is another company and lives on /suk/. The camps' banks
--     (Sampath, Société Générale) have no statement table, so no closing balance
--     is stored anywhere.
--     The balance is the CLOSING balance of the last day loaded. A day's rows
--     come in no reliable order (seq only numbers twin rows), so the closing row
--     is found by the chain: it is the one row of the day whose balance is not
--     the «balance before» (balance − amount) of another row of that day. If a
--     day has no single such row (a +X and a −X on the same day), the last day
--     that has one is used plus the amounts that came after.
--
--  2. payments — a SMALL fixed set of recurring debits, read from the bank
--     description (rules written against the real 2026 statements, first match
--     wins, so nothing is counted twice):
--       salaries         «LOTE TRF CRED SEPA+ -Salarios <month>» / «-<month> Salario»
--       social_security  «TRANSFERENCIA - PAG. T.S.U.»
--       state_iva        «TRF. COBR DUC <ref>» or «PAG ESTADO *nnnn 10095-<ref>», ref starting 162
--       state_irs        same two shapes, ref starting 156 (monthly withholding declarations)
--       state_irc        same two shapes, ref starting 164 — not monthly: seen in July and
--                        September, so it is given the fixed calendar Jul · Sep · Dec
--       leasing          «LG-LEASING IMOBIL…», «LEAS <contract>», «DÉBITO DIRETO-RCI PORTUGAL…»
--                        (one row per account; these lines are categorised Rent, which is
--                        why this rule comes before rent)
--       catering         debit of 1,000 or more whose linked expense line has a supplier
--                        starting «manjar» (the description changes every month)
--       rent             debit whose linked expense line has category Rent, one row per
--                        supplier (no names in this file: the link decides). A rent
--                        debit not yet linked to its line does not count.
--     Other State references (fines, IUC…), the meal-card batch, transfers to the
--     camps and salaries paid one by one are NOT in the set.
--
--     Per rule × account, by calendar month (several debits of one month are one
--     payment: leasing and IRS leave in pieces). «This month» is the month the
--     account's statement has reached (its last movement), not today's: on 1 Dec
--     with a statement that stops in November, November's salaries are still to
--     leave, not forgotten.
--       month   that statement month (first day)
--       amount  median of the last 3 months it was paid, before that month
--               (looks back 6 months)
--       day     median day of the month of the biggest debit of those months
--       recent  the monthly totals behind that median, newest first
--       this_month_amount / this_month_date   what already left in that month
--     A rule is returned only if something left in that month, or the month before's was at
--     least half the usual amount (catering stopped on 30 Sep, so it is silent from
--     November; a seasonal rent that shrank to a few euros goes silent too), and
--     only from 500 a month. At most 3 rent rows.
--
--  Owner only: same guard as hq_my_tasks (is_global_admin = platform_role
--  super_admin). Read-only. Idempotent: create or replace.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.hq_cash_position()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v json;
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
begin
  if auth.uid() is not null and not public.is_global_admin() then
    raise exception 'Owner required' using errcode = '42501';
  end if;

  -- BODY (the same text is run read-only as a plain SELECT to prove it)
  with mv as (
    select m.id, m.bank, m.movement_date as d, m.amount, m.balance, m.currency, m.created_at
      from hq_bank_movements m
     where m.paying_company = 'water-movements'
       and m.balance is not null
       and m.movement_date <= v_today
  ),
  last_day as (
    select bank, max(d) as d, max(created_at) as loaded_at, max(currency) as currency from mv group by bank
  ),
  day_end as (
    select a.bank, a.d, min(a.balance) as balance, count(*) as n
      from mv a
      join last_day l on l.bank = a.bank and a.d >= l.d - 30
     where not exists (
             select 1 from mv b
              where b.bank = a.bank and b.d = a.d and b.id <> a.id
                and round(b.balance - b.amount, 2) = round(a.balance, 2))
     group by a.bank, a.d
  ),
  anchor as (
    select distinct on (bank) bank, d, balance from day_end where n = 1 order by bank, d desc
  ),
  accounts as (
    select a.bank as key, coalesce(l.currency, 'EUR') as currency,
           round(a.balance + coalesce((select sum(x.amount) from mv x where x.bank = a.bank and x.d > a.d), 0), 2) as balance,
           l.d as as_of, l.loaded_at
      from anchor a join last_day l on l.bank = a.bank
  ),
  deb as (
    select m.bank, m.movement_date as d, -m.amount as amt, r.key, date_trunc('month', l.d)::date as ref,
           case when r.key = 'rent' then lower(trim(i.company)) else '' end as party,
           case when r.key = 'rent' then initcap(trim(i.company)) end as name
      from hq_bank_movements m
      join last_day l on l.bank = m.bank
      left join hq_invoices i on i.id = m.hq_invoice_id and i.deleted_at is null
      cross join lateral (
        select case
          when m.description ~* '^LOTE TRF' and m.description ~* 'sal[aá]rio' then 'salaries'
          when m.description ~* 'PAG\. ?T\.S\.U' then 'social_security'
          when m.description ~* '(COBR DUC|PAG ESTADO)' then
            case substring(m.description from '(?:DUC |10095-)(\d{3})\d{12}')
              when '162' then 'state_iva' when '156' then 'state_irs' when '164' then 'state_irc' end
          when m.description ~* '^(LG-LEASING|LEAS )' or m.description ~* 'RCI PORTUGAL' then 'leasing'
          when lower(coalesce(i.company, '')) like 'manjar%' then case when -m.amount >= 1000 then 'catering' end
          when i.category_name = 'Rent' and nullif(trim(i.company), '') is not null then 'rent'
        end as key) r
     where m.paying_company = 'water-movements'
       and m.balance is not null
       and m.amount < 0
       and m.movement_date >= date_trunc('month', l.d) - interval '6 months' and m.movement_date <= v_today
       and r.key is not null
  ),
  per_month as (
    select key, party, bank, ref, date_trunc('month', d)::date as mon, max(name) as name,
           sum(amt) as total, (array_agg(d order by amt desc, d))[1] as main_date
      from deb group by key, party, bank, ref, date_trunc('month', d)
  ),
  hist as (
    select * from (
      select pm.*, row_number() over (partition by key, party, bank order by mon desc) as rn
        from per_month pm where mon < ref) t
     where rn <= 3
  ),
  stat as (
    select key, party, bank, ref, max(name) as name, count(*)::int as n, max(mon) as last_month,
           round((percentile_cont(0.5) within group (order by total))::numeric, 2) as amount,
           round((percentile_cont(0.5) within group (order by extract(day from main_date)))::numeric)::int as day,
           (array_agg(main_date order by mon desc))[1] as last_date,
           (array_agg(total order by mon desc))[1] as last_amount,
           array_agg(total order by mon desc) as recent
      from hist group by key, party, bank, ref
  ),
  pay as (
    select s.key, s.name, s.bank as account, s.ref as month, s.amount, s.day, s.n, s.last_date, s.last_amount, s.recent,
           t.main_date as this_month_date, t.total as this_month_amount,
           case when s.key = 'state_irc' then '[7,9,12]'::json end as months,
           row_number() over (partition by s.key order by s.amount desc) as rk
      from stat s
      left join per_month t on t.key = s.key and t.party = s.party and t.bank = s.bank and t.mon = s.ref
     where s.amount >= 500
       and (s.key = 'state_irc' or t.total is not null or (s.last_month = (s.ref - interval '1 month')::date and s.last_amount >= 0.5 * s.amount))
  )
  select json_build_object(
    'generated_at', now(),
    'today', v_today,
    'accounts', coalesce((select json_agg(json_build_object(
        'key', a.key, 'currency', a.currency, 'balance', a.balance, 'as_of', a.as_of, 'loaded_at', a.loaded_at)
        order by (a.key = 'santander') desc, a.key) from accounts a), '[]'::json),
    'payments', coalesce((select json_agg(json_build_object(
        'key', p.key, 'name', p.name, 'account', p.account, 'month', p.month, 'amount', p.amount, 'day', p.day, 'n', p.n,
        'last_date', p.last_date, 'last_amount', p.last_amount, 'recent', to_json(p.recent),
        'this_month_date', p.this_month_date, 'this_month_amount', p.this_month_amount, 'months', p.months)
        order by p.day, p.key, p.account) from pay p where p.key <> 'rent' or p.rk <= 3), '[]'::json)
  ) into v;
  -- /BODY
  return v;
end $$;

revoke all on function public.hq_cash_position() from public, anon;
grant execute on function public.hq_cash_position() to authenticated, service_role;
