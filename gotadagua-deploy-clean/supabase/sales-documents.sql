-- ════════════════════════════════════════════════════════════════════════════
--  sales_documents — read-only register of every sales document (invoices and
--  credit notes) issued in InvoiceXpress. 18 Nov 2026 (audit C3 / P3: the app
--  knew ~3% of the sales side — only partner_invoices).
--
--  The app NEVER creates or edits a fiscal document. Rows come only from the
--  billing SAF-T (PT) file that InvoiceXpress exports (Contabilidade → SAF-T),
--  read in the browser (lib/saft.js) and sent here in batches of 500 from the
--  HQ «Month close» tab.
--
--    sales_documents                       one row per document, unique (company, doc_no)
--    sales_documents_import(rows, file)    the ONLY way in: upsert by (company, doc_no),
--                                          returns {new, changed, unchanged}. HQ members.
--    sales_documents_month(month)          the facts the Month close card needs (the month,
--                                          the month before and 15 days after, which
--                                          credit-note references exist, the Partners
--                                          invoices, the customers known to be partners).
--                                          The rules themselves live in lib/saft.js
--                                          (Saft.monthSummary) so they are tested.
--
--  Water Movements only for now. `company` is there so Manjar can be added later
--  on /suk/ (its own policy + its own NIF in lib/saft.js) — not built.
--  Idempotent: safe to run again. Run it BEFORE or AFTER publishing the page —
--  until it runs the card says «not switched on yet» and nothing else changes.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.sales_documents (
  id               uuid primary key default gen_random_uuid(),
  company          text not null default 'water-movements',
  doc_no           text not null,                 -- «FT IN2/17655» exactly as InvoiceXpress writes it
  doc_type         text not null,                 -- FT · FR · FS · NC · ND …
  series           text not null,                 -- IN2
  number           integer not null,              -- 17655 (FT IN2 and NC IN2 count apart)
  doc_date         date not null,
  customer_id      text,                          -- InvoiceXpress customer record (SAF-T CustomerID)
  customer_name    text,
  customer_tax_id  text,                          -- 999999990 = final consumer
  customer_country text,
  net              numeric(14,2) not null default 0,
  tax              numeric(14,2) not null default 0,
  gross            numeric(14,2) not null default 0,   -- always positive, credit notes too
  status           text not null default 'N',     -- N normal · A cancelled · F billed
  credits_doc_no   text,                          -- credit notes: the invoice it references (first one; all in raw.references)
  source_file      text,
  imported_at      timestamptz not null default now(),
  raw              jsonb not null default '{}'::jsonb,  -- atcud, period, entry_date, status_date, currency, lines (count), references, reason
  constraint sales_documents_company_doc_no unique (company, doc_no)
);
create index if not exists sales_documents_company_date on public.sales_documents (company, doc_date);
create index if not exists sales_documents_company_series on public.sales_documents (company, doc_type, series, number);

-- HQ members read; nobody writes directly (no insert / update / delete policy):
-- the only way in is sales_documents_import().
alter table public.sales_documents enable row level security;
drop policy if exists sales_documents_hq_read on public.sales_documents;
create policy sales_documents_hq_read on public.sales_documents
  for select to authenticated
  using (company = 'water-movements' and public.is_hq_member());
revoke all on public.sales_documents from public, anon;
revoke insert, update, delete, truncate on public.sales_documents from authenticated;
grant select on public.sales_documents to authenticated;
grant all on public.sales_documents to service_role;

-- ── the only way in ─────────────────────────────────────────────────────────
-- rows: [{doc_no, doc_type, series, number, doc_date, customer_id, customer_name,
--         customer_tax_id, customer_country, net, tax, gross, status, credits_doc_no, raw}]
-- «changed» compares the business fields only (never the file name or the import time);
-- an unchanged document is not rewritten, so it keeps the file it first came in.
create or replace function public.sales_documents_import(p_rows jsonb, p_file_name text default null, p_company text default 'water-movements')
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_new int := 0; v_changed int := 0; v_unchanged int := 0;
begin
  -- JWT callers must be HQ members; the SQL console / service role (no auth.uid) may run it.
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  if p_company is distinct from 'water-movements' then raise exception 'Only Water Movements is imported here' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1000 documents per call' using errcode = '22023'; end if;

  with incoming as (
    select distinct on (x.doc_no)
           x.doc_no, upper(x.doc_type) as doc_type, x.series, x.number, x.doc_date,
           nullif(x.customer_id, '') as customer_id, nullif(x.customer_name, '') as customer_name,
           nullif(x.customer_tax_id, '') as customer_tax_id, nullif(x.customer_country, '') as customer_country,
           round(coalesce(x.net, 0), 2) as net, round(coalesce(x.tax, 0), 2) as tax, round(coalesce(x.gross, 0), 2) as gross,
           coalesce(nullif(upper(x.status), ''), 'N') as status, nullif(x.credits_doc_no, '') as credits_doc_no,
           coalesce(x.raw, '{}'::jsonb) as raw
      from jsonb_to_recordset(p_rows) as x(doc_no text, doc_type text, series text, number integer, doc_date date,
           customer_id text, customer_name text, customer_tax_id text, customer_country text,
           net numeric, tax numeric, gross numeric, status text, credits_doc_no text, raw jsonb)
     where nullif(trim(x.doc_no), '') is not null
     order by x.doc_no
  ), classified as (
    select i.*, (d.id is not null) as known,
           (d.id is not null
            and (d.doc_type, d.series, d.number, d.doc_date, d.customer_id, d.customer_name, d.customer_tax_id, d.customer_country, d.net, d.tax, d.gross, d.status, d.credits_doc_no)
                is not distinct from
                (i.doc_type, i.series, i.number, i.doc_date, i.customer_id, i.customer_name, i.customer_tax_id, i.customer_country, i.net, i.tax, i.gross, i.status, i.credits_doc_no)) as same
      from incoming i
      left join sales_documents d on d.company = p_company and d.doc_no = i.doc_no
  ), written as (
    insert into sales_documents (company, doc_no, doc_type, series, number, doc_date, customer_id, customer_name, customer_tax_id, customer_country,
                                 net, tax, gross, status, credits_doc_no, source_file, imported_at, raw)
    select p_company, c.doc_no, c.doc_type, c.series, c.number, c.doc_date, c.customer_id, c.customer_name, c.customer_tax_id, c.customer_country,
           c.net, c.tax, c.gross, c.status, c.credits_doc_no, p_file_name, now(), c.raw
      from classified c
     where not c.same
    on conflict (company, doc_no) do update set
      doc_type = excluded.doc_type, series = excluded.series, number = excluded.number, doc_date = excluded.doc_date,
      customer_id = excluded.customer_id, customer_name = excluded.customer_name, customer_tax_id = excluded.customer_tax_id, customer_country = excluded.customer_country,
      net = excluded.net, tax = excluded.tax, gross = excluded.gross, status = excluded.status, credits_doc_no = excluded.credits_doc_no,
      source_file = excluded.source_file, imported_at = excluded.imported_at, raw = excluded.raw
    returning 1
  )
  select count(*) filter (where not c.known), count(*) filter (where c.known and not c.same), count(*) filter (where c.same)
    into v_new, v_changed, v_unchanged
    from classified c;

  return json_build_object('new', v_new, 'changed', v_changed, 'unchanged', v_unchanged);
end $$;
revoke all on function public.sales_documents_import(jsonb, text, text) from public, anon;
grant execute on function public.sales_documents_import(jsonb, text, text) to authenticated, service_role;

-- ── the facts of one month (read-only; RLS decides who sees rows) ───────────
create or replace function public.sales_documents_month(p_month text, p_company text default 'water-movements')
returns json
language sql stable set search_path = public as $$
  with w as (
    select (to_date(p_month || '-01', 'YYYY-MM-DD') - interval '1 month')::date                    as w_from,
           to_date(p_month || '-01', 'YYYY-MM-DD')                                                 as m_from,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date as m_to,
           (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' + interval '14 days')::date as w_to
  ), docs as (
    select d.* from sales_documents d, w
     where d.company = p_company and d.doc_date between w.w_from and w.w_to
  ), refs as (
    select distinct r.ref
      from docs d, w,
           lateral jsonb_array_elements_text(case when jsonb_typeof(d.raw -> 'references') = 'array' then d.raw -> 'references'
                                                  else to_jsonb(array_remove(array[d.credits_doc_no], null)) end) as r(ref)
     where d.doc_type = 'NC' and d.doc_date between w.m_from and w.m_to
  ), pk as (
    -- Partners invoice numbers with spaces dropped: «FT IN2/16809» → «FTIN2/16809»
    select distinct upper(regexp_replace(pi.invoice_number, '\s', '', 'g')) as k
      from partner_invoices pi
     where p_company = 'water-movements'
  )
  select json_build_object(
    'month', p_month,
    'company', p_company,
    'total', (select count(*) from sales_documents s where s.company = p_company),
    'covered_until', (select max(s.doc_date) from sales_documents s where s.company = p_company),
    'last_import', (select json_build_object('file', s.source_file, 'at', s.imported_at)
                      from sales_documents s where s.company = p_company order by s.imported_at desc limit 1),
    'docs', coalesce((select json_agg(json_build_object(
                'doc_no', d.doc_no, 'doc_type', d.doc_type, 'series', d.series, 'number', d.number, 'doc_date', d.doc_date, 'status', d.status,
                'customer_id', d.customer_id, 'customer_name', d.customer_name, 'customer_tax_id', d.customer_tax_id,
                'gross', d.gross, 'credits_doc_no', d.credits_doc_no, 'refs', d.raw -> 'references')
                order by d.doc_date, d.doc_type, d.series, d.number) from docs d), '[]'::json),
    'known_refs', coalesce((select json_agg(s.doc_no) from sales_documents s
                             where s.company = p_company and s.doc_no in (select ref from refs)), '[]'::json),
    'partner_invoices', coalesce((select json_agg(json_build_object('invoice_number', pi.invoice_number, 'partner_name', pi.partner_name,
                                    'invoice_date', pi.invoice_date, 'amount', pi.amount) order by pi.invoice_date, pi.invoice_number)
                                    from partner_invoices pi where p_company = 'water-movements'), '[]'::json),
    -- customers that already have an invoice on Partners (matched on the number, with or without «FT»)
    'partner_customers', coalesce((select json_agg(c.customer_id) from (
                              select s.customer_id from sales_documents s join pk on pk.k = upper(replace(s.doc_no, ' ', ''))
                               where s.company = p_company and s.customer_id is not null
                              union
                              select s.customer_id from sales_documents s join pk on pk.k = upper(s.series || '/' || s.number)
                               where s.company = p_company and s.customer_id is not null and s.doc_type = 'FT') c), '[]'::json)
  )
$$;
revoke all on function public.sales_documents_month(text, text) from public, anon;
grant execute on function public.sales_documents_month(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
