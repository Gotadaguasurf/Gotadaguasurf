-- ════════════════════════════════════════════════════════════════════════════
--  hq_bank_to_expenses(p_company, p_since) — after a statement import, every
--  debit becomes a line (Miguel, 22 Oct 2026, phase 3 of «mesmo feel»):
--
--    1. LINK: a debit with an existing unlinked line of the same amount,
--       same company, invoice date within −20/+5 days → link (never create,
--       «não quero duplicados»). If the debit equals the sum of several lines
--       of one supplier on one date (split receipts), nothing is created.
--    2. CREATE: anything still unlinked becomes a line with the bank
--       description, supplier guessed from it, category = the supplier's
--       usual category in this company's books (else none + needs_review),
--       notes «[do extrato <banco> <data>; sem fatura]», and is linked.
--
--  Not touched: bank fees, internal transfers, credits, salary lots («LOTE TRF
--  CRED SEPA», lanced per person from the payslips) and any debit whose
--  supplier already has an unlinked line nearby with another amount (split
--  instructor payments, partial receipts) — those stay for the daily routine.
--  Idempotent.
--  Callable by HQ members (the Suk page passes 'manjar').
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.hq_bank_to_expenses(p_company text, p_since date default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_linked int := 0; v_created int := 0; v_skipped int := 0; v_skipped_sup int := 0;
  r record; v_line uuid; v_supplier text; v_cat record; v_loc text; v_pay text; v_bank_label text;
begin
  -- JWT callers must be HQ members; the SQL console / service role (no auth.uid) may run it.
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  v_loc := case p_company when 'manjar' then 'the-suk' when 'mgrp-sarl' then 'morocco' when 'wave-movements' then 'sri-lanka' else 'general' end;

  for r in
    select b.* from hq_bank_movements b
     where b.paying_company = p_company and b.kind = 'expense' and b.amount < 0 and b.hq_invoice_id is null
       and (p_since is null or b.movement_date >= p_since)
       and coalesce(b.notes,'') not ilike '[sem fatura%' and coalesce(b.notes,'') not like '[ativo%' and coalesce(b.notes,'') not like '[financiamento%' and coalesce(b.notes,'') not like '[devolução%'
       and b.description not ilike 'LOTE TRF CRED SEPA%'
     order by b.movement_date, b.seq
  loop
    v_supplier := lower(trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(r.description,
        '^(COMPRA(\s+ESTRANG)?\s*\*?\d*\s*|TRF\.?\s*IMED\.?\s*P/\s*|TRF CRED INTRABANC P/\s*|TRF\.? P/\s*|D[ÉE]BITO DIRETO-?\s*|DD\s+|PAG\.?\s*SERVICOS\s*\*?\d*\s*|MDB \d+ |PAG SERV \d+/\d+ )', '', 'i'),
        '[-\s]?E\d{4,9}.*$', ''), '\s+\d[\d\s/.-]*$', ''), '\s+PT\d+.*$', ''), '([a-z])\d{5,}$', '\1', 'i'), '\s{2,}', ' '), '^\s+|\s+$', '')));
    if v_supplier = '' then v_supplier := 'desconhecido'; end if;

    -- 1. an existing unlinked line of this amount, same books, nearby date
    select i.id into v_line
      from hq_invoices i
     where i.paying_company = p_company and i.deleted_at is null and coalesce(i.is_duplicate,false) = false
       and abs(i.amount_eur - (-r.amount)) < 0.011
       and i.invoice_date between r.movement_date - 20 and r.movement_date + 5
       and not exists (select 1 from hq_bank_movements b2 where b2.hq_invoice_id = i.id)
     order by abs(i.invoice_date - r.movement_date), (lower(i.company) like '%' || left(v_supplier, 8) || '%') desc
     limit 1;
    if v_line is not null then
      update hq_bank_movements set hq_invoice_id = v_line where id = r.id;
      v_linked := v_linked + 1; continue;
    end if;

    -- 1b. the debit is the sum of a supplier's lines on one date (split receipts): leave for the routine
    if exists (
      select 1 from hq_invoices i
       where i.paying_company = p_company and i.deleted_at is null and i.invoice_date between r.movement_date - 20 and r.movement_date + 5
         and not exists (select 1 from hq_bank_movements b2 where b2.hq_invoice_id = i.id)
       group by i.invoice_date, i.company having abs(sum(i.amount_eur) - (-r.amount)) < 0.011 and count(*) > 1
    ) then v_skipped := v_skipped + 1; continue; end if;

    -- 1c. the supplier already has an unlinked line nearby with another amount (split payment, partial receipt): routine's job
    if v_supplier <> 'desconhecido' and exists (
      select 1 from hq_invoices i
       where i.paying_company = p_company and i.deleted_at is null and i.invoice_date between r.movement_date - 20 and r.movement_date + 5
         and (lower(i.company) = v_supplier or lower(i.company) like left(v_supplier, 10) || '%')
         and not exists (select 1 from hq_bank_movements b2 where b2.hq_invoice_id = i.id)
    ) then v_skipped_sup := v_skipped_sup + 1; continue; end if;

    -- 2. create the line: category = this supplier's usual category in these books
    select c.id, c.name into v_cat
      from hq_invoices i join hq_invoice_categories c on c.id = i.category_id
     where i.paying_company = p_company and i.deleted_at is null and c.active and not c.is_personal
       and (lower(i.company) = v_supplier or lower(i.company) like left(v_supplier, 10) || '%')
     group by c.id, c.name order by count(*) desc limit 1;
    v_pay := case when r.description ~* '^(COMPRA|MDB|PAG\.?\s*SERV)' then 'Card' when r.description ~* '^(DD |D[ÉE]BITO DIRETO|PAG\.DUC|PTU)' then 'Other' else 'Bank Transfer' end;
    v_bank_label := case r.bank when 'santander' then 'Santander' when 'cgd' then 'CGD' when 'bcp' then 'BCP' else r.bank end;
    insert into hq_invoices (location_slug, paying_company, invoice_date, company, description, amount, currency, fx_rate, amount_eur, payment_type,
                             category_id, category_name, needs_review, notes)
    values (v_loc, p_company, r.movement_date, v_supplier, r.description, -r.amount, 'EUR', 1, -r.amount, v_pay,
            v_cat.id, v_cat.name, (v_cat.id is null),
            '[do extrato ' || v_bank_label || ' ' || to_char(r.movement_date, 'DD Mon YYYY') || '; sem fatura]' || case when v_cat.id is null then ' [categoria por decidir]' else '' end)
    returning id into v_line;
    update hq_bank_movements set hq_invoice_id = v_line where id = r.id;
    v_created := v_created + 1;
  end loop;
  return json_build_object('linked', v_linked, 'created', v_created, 'skipped_split', v_skipped + v_skipped_sup);
end $$;
revoke all on function public.hq_bank_to_expenses(text, date) from public, anon;
grant execute on function public.hq_bank_to_expenses(text, date) to authenticated;

-- Run once for both companies (idempotent).
select json_build_object(
  'water', (select public.hq_bank_to_expenses('water-movements', null)),
  'manjar', (select public.hq_bank_to_expenses('manjar', null)),
  'water_left', (select count(*) from hq_bank_movements where paying_company = 'water-movements' and kind = 'expense' and hq_invoice_id is null and description not ilike 'LOTE TRF CRED SEPA%' and coalesce(notes,'') not ilike '[sem fatura%' and coalesce(notes,'') not like '[ativo%' and coalesce(notes,'') not like '[financiamento%' and coalesce(notes,'') not like '[devolução%')
) j;
