-- ════════════════════════════════════════════════════════════════════════════
--  Manjar Lda (The Suk) — one expense line per BCP debit, linked, like the HQ
--  does for Water (Miguel, 22 Oct 2026: «as invoices do banco deviam estar
--  todas ligadas como temos no HQ, até as invoices que adicionas entram nas
--  expenses»). Lines carry the bank description; the missing invoice is just
--  the PDF (drive_link null). Category from the description; unknown →
--  category null + needs_review (the HQ convention).
--  Idempotent: only debits without hq_invoice_id are turned into lines.
-- ════════════════════════════════════════════════════════════════════════════
create temp table _m on commit drop as
select b.id as bank_id, b.movement_date, b.description, -b.amount as amount, upper(b.description) as u
  from hq_bank_movements b
 where b.paying_company = 'manjar' and b.kind = 'expense' and b.amount < 0 and b.hq_invoice_id is null;

create temp table _lines on commit drop as
select bank_id, movement_date, description, amount,
  -- supplier: strip the bank prefixes and trailing references
  lower(trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(description,
      '^MDB \d+ ', ''), '^DD ', ''), '^TRF P/ ', ''), '^PAG SERV \d+/\d+ ', 'PAG SERV '), '\s+\d[\d\s/.-]*$', ''))) as company,
  case when u ~ '^MDB' then 'Card' else 'Bank Transfer' end as payment_type,
  case
    when u ~ 'MAKRO|SUPERBOCK|SUPER BOCK|NEWCOFFEE|SILAU|PANICONGELADOS|CONTINENTE|LIDL|NOVO RUMO|MERCADONA|AUCHAN|PINGO DOCE|CONSOANTES|PASTE?LARIA|PADARIA|APH POS|BARAO E COSTA|GRUPO ATLANTA|TALHO|PEIXARIA|FRUTA|GELO' then 'Food'
    when u ~ 'PAGAMENTO\s+VENCIMENTOS|VENCIMENTO' then 'Salary'
    when u ~ 'TAXA SOCIAL|PAG\.DUC|INSTITUTO REGISTOS|AUTORIDADE TRIBUT' then 'Taxes'
    when u ~ 'LARANJEIRO|RENDA' then 'Rent'
    when u ~ 'EDP|SMAS|NOS COMUNICA|PETROGAL|GALP|EUPAGO|MEO |VODAFONE|AGUAS' then 'Utilities'
    when u ~ 'ESCALA DE PALAVRAS' then 'Accounting'
    when u ~ 'ARABLAU|HIGIENE' then 'Cleaning Supplies'
    when u ~ 'GENERALI|FIDELIDADE|TRANQUILIDADE|ALLIANZ' then 'Insurances'
    when u ~ 'LEROY MERLIN|BRICOTEJO|BRICOMARCHE|IKEA|WORTEN|FNAC' then 'Setup'
    else null end as category_name
  from _m;

insert into hq_invoices (location_slug, paying_company, invoice_date, company, description, amount, currency, fx_rate, amount_eur, payment_type,
                         category_id, category_name, needs_review, notes)
select 'the-suk', 'manjar', l.movement_date, coalesce(nullif(l.company, ''), 'desconhecido'), l.description, l.amount, 'EUR', 1, l.amount, l.payment_type,
       c.id, c.name, (c.id is null),
       '[do extrato BCP Manjar ' || to_char(l.movement_date, 'DD Mon YYYY') || '; sem fatura]' || case when c.id is null then ' [categoria por decidir]' else '' end
  from _lines l left join hq_invoice_categories c on c.name = l.category_name and c.active;

-- link each debit to the line just created for it (same date, amount, description; newest line without a link)
update hq_bank_movements b set hq_invoice_id = i.id
  from hq_invoices i
 where b.paying_company = 'manjar' and b.kind = 'expense' and b.hq_invoice_id is null
   and i.paying_company = 'manjar' and i.deleted_at is null and i.drive_link is null
   and i.invoice_date = b.movement_date and i.amount_eur = -b.amount and i.description = b.description
   and i.id = (select i2.id from hq_invoices i2 where i2.paying_company = 'manjar' and i2.deleted_at is null and i2.invoice_date = b.movement_date and i2.amount_eur = -b.amount and i2.description = b.description
                 and not exists (select 1 from hq_bank_movements b2 where b2.hq_invoice_id = i2.id) order by i2.created_at desc limit 1);

select json_build_object(
  'lines', (select json_build_object('n', count(*), 'eur', sum(amount_eur), 'review', count(*) filter (where needs_review)) from hq_invoices where paying_company = 'manjar' and deleted_at is null),
  'by_cat', (select json_agg(x order by x.eur desc) from (select coalesce(category_name, '— por decidir') cat, count(*) n, round(sum(amount_eur)) eur from hq_invoices where paying_company = 'manjar' and deleted_at is null group by 1) x),
  'unlinked_debits', (select count(*) from hq_bank_movements where paying_company = 'manjar' and kind = 'expense' and hq_invoice_id is null),
  'ledger', (select json_build_object('n', count(*), 'eur', sum(amount_eur)) from ledger_entries where location_id = (select id from locations where slug = 'the-suk') and type = 'expense')
) j;
