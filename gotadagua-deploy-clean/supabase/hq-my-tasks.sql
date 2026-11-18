-- ════════════════════════════════════════════════════════════════════════════
--  «My tasks» — the HQ tab (owners only) with one row per source Miguel has to
--  keep up to date: the bank statements, the camps' banks, the documents the
--  automatic routine fetches and the automatic imports. 18 Nov 2026.
--
--  hq_my_tasks()  one JSON with the raw facts per source (last date covered,
--                 when it was loaded, last run, error). The status (OK / Due /
--                 Overdue / Automatic) is decided in the page (hq/my-tasks.js,
--                 MyTasks.status) so the HQ chip and the tab use one rule.
--
--  Sources (key → where the date comes from):
--    santander · cgd · santander_card · paypal   hq_bank_movements of Water Movements
--    bcp                                          hq_bank_movements of Manjar
--    sampath · sg_morocco                         ledger_entries of sri-lanka / morocco
--                                                 paid by Card / ATM Withdrawal / Bank Transfer
--    uber · via_verde · mailchimp · google_ads · meta_ads
--                                                 hq_invoices of the supplier with a Drive link
--    mail:<email>                                 mail_ingest_account (active accounts)
--    bl_reports                                   bl_report_runs received by email
--  Dates after today never count (a Sri Lanka rent row is dated 2028).
--
--  Owner only: same guard as the platform's global bypass (is_global_admin =
--  platform_role super_admin). Read-only. Idempotent: create or replace.
-- ════════════════════════════════════════════════════════════════════════════

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
             b.last_date, b.loaded_at, null::timestamptz as last_run_at, null::text as error, null::int as prev_month_docs
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
             c.last_date, c.loaded_at, null, null, null
        from (values (6, 'sampath', 'sri-lanka'), (7, 'sg_morocco', 'morocco')) s(ord, key, slug)
        left join lateral (
          select max(l.entry_date) as last_date, max(l.created_at) as loaded_at
            from ledger_entries l join locations o on o.id = l.location_id
           where o.slug = s.slug and l.payment_method in ('Card', 'ATM Withdrawal', 'Bank Transfer')
             and l.entry_date <= v_today) c on true

      union all
      -- documents the automatic routine fetches (last invoice with its PDF in the Drive)
      select s.ord, s.key, 'water-movements', 'doc',
             d.last_date, d.loaded_at, null, null, d.prev_month_docs
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
             null
        from mail_ingest_account a
       where a.active

      union all
      -- Bookinglayer reports by email (hourly): last run + the error of the latest one
      select 30, 'bl_reports', 'water-movements', 'run',
             null, null, r.created_at,
             case when r.status in ('error', 'refused') then coalesce(nullif(r.error, ''), r.status) end,
             null
        from (select 1) one
        left join lateral (
          select created_at, status, error from bl_report_runs
           where source = 'mail' order by created_at desc limit 1) r on true

    ) x), '[]'::json)
  ) into v;
  return v;
end $$;

revoke all on function public.hq_my_tasks() from public, anon;
grant execute on function public.hq_my_tasks() to authenticated;
