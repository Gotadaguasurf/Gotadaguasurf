-- ════════════════════════════════════════════════════════════════════════════
--  Audit wave 4 — HQ (18 Nov 2026). Idempotent. Nothing here grants to anon or public.
--
--  RUN ORDER: after supabase/hq-todo.sql, supabase/partners-open-invoices.sql and
--  supabase/hq-my-tasks.sql (this file re-creates hq_todo() and hq_my_tasks() with
--  their text plus the changes below). Any later file that re-creates one of those
--  functions must start from this text, or it undoes these fixes.
--  The pages work before and after this file runs.
--
--  PART A — functions (safe to run; read-only functions, same guards as before)
--    A1 hq_todo()            SEAM-12: «without PDF» leaves duplicates out, like the accountant
--                            page (live 18 Nov: 92 → 88, the contabilista shows 88).
--    A2 hq_my_tasks()        PRT-06 / SEAM-06 / AUT-06: the daily revenue report gets its own row
--                            (Overdue after a day without a run; Due with the things to decide:
--                            unknown location, held rows, new partner, foreign-currency amounts);
--                            the hourly camp runs no longer hide it; one row for emailed invoices
--                            that failed to import (30 days, the café's export_cart PDFs left out).
--                            Live 18 Nov: «Location not recognised: Surf Camp Ahamgama · 5 commission
--                            differences» before this change; the commission differences repeat every day, so they
--                            stay in the run's notes and are not a warning. Emailed invoices: 0 today — the one
--                            failed PDF of 22 Oct (Anthropic EPP24GVE-0009) is in the app through the receipt PDF of
--                            the same email, so an error with a sibling that made a line is not listed.
--                            A failed email is listed for 30 days (there is no «handled» button yet).
--    A3 hq_bank_unmatched(), hq_bank_unmatched_co()
--                            HQ-17: the member guards that live in the database but never reached the
--                            repo. Identical to the live definitions read on 18 Nov (a no-op live);
--                            supabase/hq-bank-unmatched.sql and supabase/bank-unmatched-company.sql
--                            still carry the unguarded text — never run those two again.
--
--  PART B — data corrections, ALL COMMENTED. Each has the count a read-only SELECT
--  gave on 18 Nov 2026; run the check first, and only with Miguel's yes.
-- ════════════════════════════════════════════════════════════════════════════

-- A1 ─────────────────────────────────────────────────────────────────────────
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
         where i.deleted_at is null and coalesce(i.is_duplicate, false) = false
           and i.invoice_date >= v_since and public.hq_doc_status(i) = 'falta'
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
        'no_pdf', (select count(*) from hq_invoices i where i.deleted_at is null and coalesce(i.is_duplicate, false) = false
                     and public.hq_doc_status(i) = 'falta'
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

-- A2 ─────────────────────────────────────────────────────────────────────────
create or replace function public.hq_my_tasks()
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v json;
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_prev_from date := (date_trunc('month', (now() at time zone 'Europe/Lisbon')::date) - interval '1 month')::date;
  v_prev_to   date := (date_trunc('month', (now() at time zone 'Europe/Lisbon')::date) - interval '1 day')::date;
begin
  if auth.uid() is not null and not public.is_global_admin() then
    raise exception 'Owner required' using errcode = '42501';
  end if;

  select json_build_object(
    'generated_at', now(),
    'today', v_today,
    'sources', coalesce((select json_agg(x order by x.ord, x.key) from (

      -- bank statements (Water Movements + Manjar)
      select s.ord, s.key, s.company as block, s.kind,
             b.last_date, b.loaded_at, null::timestamptz as last_run_at, null::text as error, null::int as prev_month_docs,
             null::text as warning
        from (values (1, 'santander',      'water-movements', 'bank2'),
                     (2, 'cgd',            'water-movements', 'bank2'),
                     (3, 'santander_card', 'water-movements', 'monthly'),
                     (4, 'paypal',         'water-movements', 'week'),
                     (5, 'bcp',            'manjar',          'bank2')) s(ord, key, company, kind)
        left join lateral (
          select max(m.movement_date) as last_date, max(m.created_at) as loaded_at
            from hq_bank_movements m
           where m.bank = s.key and m.paying_company = s.company and m.movement_date <= v_today) b on true

      union all
      -- the camps' banks, read from their ledger (what the manager or Claude entered from the statement)
      select s.ord, s.key, 'water-movements', 'bank2',
             c.last_date, c.loaded_at, null, null, null, null
        from (values (6, 'sampath', 'sri-lanka'), (7, 'sg_morocco', 'morocco')) s(ord, key, slug)
        left join lateral (
          select max(l.entry_date) as last_date, max(l.created_at) as loaded_at
            from ledger_entries l join locations o on o.id = l.location_id
           where o.slug = s.slug and l.payment_method in ('Card', 'ATM Withdrawal', 'Bank Transfer')
             and l.entry_date <= v_today) c on true

      union all
      -- documents the automatic routine fetches (last invoice with its PDF in the Drive)
      select s.ord, s.key, 'water-movements', 'doc',
             d.last_date, d.loaded_at, null, null, d.prev_month_docs, null
        from (values (8,  'uber',       array['uber']),
                     (9,  'via_verde',  array['via verde']),
                     (10, 'mailchimp',  array['mailchimp']),
                     (11, 'google_ads', array['google ads']),
                     (12, 'meta_ads',   array['meta ads', 'facebook ads'])) s(ord, key, names)
        left join lateral (
          select max(i.invoice_date) as last_date, max(i.created_at) as loaded_at,
                 count(*) filter (where i.invoice_date between v_prev_from and v_prev_to)::int as prev_month_docs
            from hq_invoices i
           where i.deleted_at is null and lower(trim(i.company)) = any (s.names)
             and nullif(trim(i.drive_link), '') is not null and i.invoice_date <= v_today) d on true

      union all
      -- mail ingest: one row per active Gmail account; an account-level failure is a line «conta: …»
      select 20, 'mail:' || a.email, 'water-movements', 'run',
             null, null, a.last_run_at,
             (select ln from json_array_elements_text(coalesce(a.last_result::json -> 'lines', '[]'::json)) ln
               where ln like 'conta:%' limit 1),
             null, null
        from mail_ingest_account a
       where a.active

      union all
      -- emailed invoices that failed to import (audit AUT-06 / SEAM-06): the run went on, the document did not.
      -- The café's own order PDFs (export_cart*.pdf) are never invoices and are left out.
      select 21, 'mail_items', 'water-movements', 'check',
             null, null, null,
             (select count(*) || ' emailed invoice' || case when count(*) = 1 then '' else 's' end || ' failed to import: '
                     || string_agg(coalesce(filename, '?') || ' (' || to_char(created_at, 'DD Mon') || ')', ', ' order by created_at desc)
                from mail_ingest_items
               where status = 'error' and decided_at is null and created_at > now() - interval '30 days'
                 and coalesce(filename, '') not ilike 'export_cart%'
                 -- another attachment of the same email already made or met the line (e.g. the receipt PDF beside a
                 -- failed invoice PDF): nothing is missing, so it is not asked again (review of wave 4, 18 Nov 2026)
                 and not exists (select 1 from mail_ingest_items s
                                  where s.message_id = mail_ingest_items.message_id and s.id <> mail_ingest_items.id
                                    and s.hq_invoice_id is not null)
              having count(*) > 0),
             null, null

      union all
      -- Bookinglayer camp reports by email (hourly): last run + the error of the latest one.
      -- The daily revenue report has its own row below, so the hourly camp runs never hide it (SEAM-06).
      select 30, 'bl_reports', 'water-movements', 'run',
             null, null, r.created_at,
             case when r.status in ('error', 'refused') then coalesce(nullif(r.error, ''), r.status) end,
             null, null
        from (select 1) one
        left join lateral (
          select created_at, status, error from bl_report_runs
           where source = 'mail' and coalesce(report, '') not in ('revenue', 'staff_copy')
           order by created_at desc limit 1) r on true

      union all
      -- Bookinglayer daily revenue report (PRT-06 / SEAM-06): last run, its error, and what it asks to decide
      -- (a location it did not recognise, held rows, a new partner, foreign currency). The commission differences
      -- (20 % computed vs Bookinglayer's own total) repeat every day and would keep the card amber for ever:
      -- they stay in the run's notes and are not a warning here.
      select 31, 'bl_revenue', 'water-movements', 'daily',
             null, null, r.created_at,
             case when r.status in ('error', 'refused') then coalesce(nullif(r.error, ''), r.status) end,
             null,
             nullif(concat_ws(' · ',
               case when jsonb_array_length(coalesce(r.changes->'file'->'unknownLocations', '[]'::jsonb)) > 0
                    then 'Location not recognised: ' || (select string_agg(coalesce(x->>'name', x#>>'{}'), ', ') from jsonb_array_elements(r.changes->'file'->'unknownLocations') x) end,
               case when jsonb_array_length(coalesce(r.changes->'held', '[]'::jsonb)) > 0
                    then jsonb_array_length(r.changes->'held') || ' held' end,
               case when jsonb_array_length(coalesce(r.changes->'newPartners', '[]'::jsonb)) > 0
                    then 'New partner: ' || (select string_agg(coalesce(x->>'name', x#>>'{}'), ', ') from jsonb_array_elements(r.changes->'newPartners') x) end,
               (select nullif(count(*), 0) || ' foreign-currency amounts to check' from jsonb_array_elements_text(coalesce(r.changes->'notes', '[]'::jsonb)) n where n ilike '%euro value%')
             ), '')
        from (select 1) one
        left join lateral (
          select created_at, status, error, changes from bl_report_runs
           where source = 'mail' and report = 'revenue' order by created_at desc limit 1) r on true

    ) x), '[]'::json)
  ) into v;
  return v;
end $$;

revoke all on function public.hq_my_tasks() from public, anon;
grant execute on function public.hq_my_tasks() to authenticated;

-- A3 ─────────────────────────────────────────────────────────────────────────
-- Same text as live (pg_get_functiondef, 18 Nov 2026).
create or replace function public.hq_bank_unmatched(p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  select * from public._accountant_bank_unmatched(p_from, p_to)
   where auth.uid() is null or public.is_hq_member()
$$;
revoke all on function public.hq_bank_unmatched(date, date) from public, anon;
grant execute on function public.hq_bank_unmatched(date, date) to authenticated;

create or replace function public.hq_bank_unmatched_co(p_company text, p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  with inv as (
    select invoice_date, company, coalesce(amount_eur, amount) as v
      from hq_invoices
     where deleted_at is null and coalesce(paying_company, 'water-movements') = p_company
       and invoice_date between p_from - 20 and p_to + 10
  ), grp as (
    select invoice_date, company, sum(v) as v from inv group by 1, 2
  )
  select b.id, b.movement_date, b.description, b.amount
    from hq_bank_movements b
   where b.paying_company = p_company and b.amount < 0
     and b.kind in ('expense', 'other')
     and b.movement_date between p_from and p_to
     and b.hq_invoice_id is null and b.internal_transfer_id is null
     and b.description not ilike 'LOTE TRF CRED SEPA%'
     and b.description not ilike 'PAGAMENTO VENCIMENTOS%'
     and coalesce(b.notes, '') not ilike '[sem fatura%'
     and coalesce(b.notes, '') not like '[ativo%'
     and coalesce(b.notes, '') not like '[financiamento%'
     and coalesce(b.notes, '') not like '[devolução%'
     and not exists (select 1 from inv i where abs(i.v - abs(b.amount)) < 0.011
                       and i.invoice_date between b.movement_date - 15 and b.movement_date + 5)
     and not exists (select 1 from grp g where abs(g.v - abs(b.amount)) < 0.011
                       and g.invoice_date between b.movement_date - 15 and b.movement_date + 5)
     and (auth.uid() is null or public.is_hq_member()
          or (p_company = 'manjar' and public.is_workspace_member('the-suk')))
$$;
revoke all on function public.hq_bank_unmatched_co(text, date, date) from public, anon;
grant execute on function public.hq_bank_unmatched_co(text, date, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  PART B — data corrections (commented: run only with Miguel's yes)
-- ════════════════════════════════════════════════════════════════════════════

-- B1 HQ-02 / DATA-01: Sri Lanka bookings saved as location «Unknown» by the revenue import before the
--    «Ahamgama» spelling was recognised. 18 Nov: 16 rows (11,604.87 EUR, November 2026), package
--    «Surf Camp Ahangama…». The one «Unknown» of January (190.00, no package) is left as it is.
--    Run only if the next 08:15 revenue run (after the wave-1 deploy of mail-ingest) still leaves them «Unknown»:
--    the fixed importer may correct them by itself.
-- select count(*) from bookings where location = 'Unknown' and package ilike 'Surf Camp Ahangama%';   -- expect 16
-- update bookings set location = 'Surf Camp Ahangama'
--  where location = 'Unknown' and package ilike 'Surf Camp Ahangama%';

-- B2 DATA-08: two archived lines still point at a bank debit (the page now lets go on archive).
-- select count(*) from hq_invoices where deleted_at is not null and bank_movement_id is not null;   -- expect 2
-- update hq_invoices set bank_movement_id = null
--  where deleted_at is not null and bank_movement_id is not null
--    and id in ('316afc46-a2e5-4a7a-b871-80e1a0df91f0', 'e7b59bf0-aee5-4634-b8b4-297e3246c5a3');

-- B3 DATA-08: the Almada beach licences FTR 0500126/851 and /853 (12 monthly parts of 159.50) were paid by one
--    Santander debit of −1,914.00 on 14 Oct 2026 (movement 2ba4c0eb-28c5-4d9f-a55c-6bb716c65f13, «Licencas surf
--    GOTA DAGUA»); only the two October parts point at it. Link the other 10 and cite the debit in the note.
-- select count(*) from hq_invoices where deleted_at is null and bank_movement_id is null and id in (
--   '774d05ea-504c-42ae-a881-4bd127cf3fe5','9234bb23-6d1f-4acd-9b0e-afc3542156f4','ff42c067-f4be-4d5e-9904-880b61215569',
--   '71541826-1fae-48e7-b84b-28ff50dce76b','eaf51de6-f8ae-4b61-916a-a7ffe5d7700b','bdb1b913-29c3-4775-8801-194ac69de250',
--   'ce395d58-af15-4721-8247-4a9cac59e759','7ed780b8-b4d0-43ba-823c-b9926dcc5ffa','3f12dbb7-5841-4d4c-9b17-f4a2cfb589fe',
--   '6aa38141-98ff-4d05-82c8-e7c4b800dc7d');   -- expect 10
-- update hq_invoices
--    set bank_movement_id = '2ba4c0eb-28c5-4d9f-a55c-6bb716c65f13',
--        notes = coalesce(notes || ' ', '') || '[pago no débito Santander de 14 Out 2026 −1.914,00 (12 partes de 159,50) — 18 Nov 2026]'
--  where deleted_at is null and bank_movement_id is null and id in (
--   '774d05ea-504c-42ae-a881-4bd127cf3fe5','9234bb23-6d1f-4acd-9b0e-afc3542156f4','ff42c067-f4be-4d5e-9904-880b61215569',
--   '71541826-1fae-48e7-b84b-28ff50dce76b','eaf51de6-f8ae-4b61-916a-a7ffe5d7700b','bdb1b913-29c3-4775-8801-194ac69de250',
--   'ce395d58-af15-4721-8247-4a9cac59e759','7ed780b8-b4d0-43ba-823c-b9926dcc5ffa','3f12dbb7-5841-4d4c-9b17-f4a2cfb589fe',
--   '6aa38141-98ff-4d05-82c8-e7c4b800dc7d');
