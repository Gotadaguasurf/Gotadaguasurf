-- ════════════════════════════════════════════════════════════════════════════
--  Credit notes as a real line type (18 Nov 2026 — audit C1 / M1 / P1).
--  Until today a supplier credit note was only a negative number in hq_invoices:
--  nothing said what it was, nothing tied it to the invoice it cancels, the mail
--  harvester skipped it, and its refund on the BCP counted as sales in /suk/.
--
--    hq_invoices.doc_type            invoice | credit_note | receipt   (default invoice)
--    hq_invoices.credits_invoice_id  the invoice a credit note cancels (null = not linked)
--    tr_hq_invoices_credit_note_sign a credit note is ALWAYS stored negative, whatever
--                                    sign the form, an import or the harvester sends
--    hq_invoice_to_bank()            a credit note links to the single bank CREDIT of the
--                                    same absolute amount (same company, ±20 days)
--    hq_credit_notes_to_bank()       the same for every credit note still without its
--                                    refund — the pages call it after a statement import
--    _accountant_bank_unmatched(),   a credit note of X no longer hides an unrelated
--    hq_bank_unmatched_co()          DEBIT of X (they compared abs(); now the sign counts)
--
--  Idempotent: run it as many times as needed. The backfill runs ONCE, when the
--  doc_type column is created (a line someone turns back into «invoice» later is
--  not touched by a second run). Page: lib/credit-notes.js; the HQ and The Suk
--  work without this file (no switch, no badge) and switch on by themselves after it.
--
--  This file supersedes the definitions of hq_invoice_to_bank (mail-ingest.sql),
--  _accountant_bank_unmatched (accountant-portal.sql, hq-bank-unmatched.sql) and hq_bank_unmatched_co
--  (bank-unmatched-company.sql): after re-running any of those, run this one again.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. columns + one-time backfill ───────────────────────────────────────────
do $$
declare v_new boolean; v_cn int := 0; v_links int := 0;
begin
  select not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'hq_invoices' and column_name = 'doc_type') into v_new;

  alter table public.hq_invoices add column if not exists doc_type text not null default 'invoice';
  alter table public.hq_invoices add column if not exists credits_invoice_id uuid references public.hq_invoices(id) on delete set null;
  if not exists (select 1 from pg_constraint where conname = 'hq_invoices_doc_type_check' and conrelid = 'public.hq_invoices'::regclass) then
    alter table public.hq_invoices add constraint hq_invoices_doc_type_check check (doc_type in ('invoice', 'credit_note', 'receipt'));
  end if;

  if v_new then
    -- negative lines that ARE credit notes: the number or the file starts with NC / NCC / NCRTP / ADC, or the
    -- note / file name says «nota de crédito». Card refunds with no document stay 'invoice'.
    -- 18 Nov 2026, read-only count on production: 13 of the 19 negative lines.
    update public.hq_invoices i
       set doc_type = 'credit_note'
     where i.doc_type = 'invoice' and i.amount < 0
       and (coalesce(i.invoice_number, '') ~* '^\s*(NCRTP|NCC|NC|ADC)([^a-z]|$)'
         or coalesce(i.file_name, '')      ~* '^\s*(NCRTP|NCC|NC|ADC)([^a-z]|$)'
         or coalesce(i.file_name, '')      ~* 'nota de cr[ée]dito'
         or coalesce(i.notes, '')          ~* 'nota de cr[ée]dito');
    get diagnostics v_cn = row_count;

    -- the invoice each one cancels, only where the note already names the line («abate a despesa <id>»,
    -- «(linha <8 hex>)») and that line is a positive one of the same company, dated on or before the
    -- credit note and not smaller than it. 18 Nov 2026, read-only count: 5 links.
    update public.hq_invoices c
       set credits_invoice_id = t.id
      from public.hq_invoices t
     where c.doc_type = 'credit_note' and c.credits_invoice_id is null
       and t.id <> c.id and t.amount > 0
       and coalesce(t.paying_company, '') = coalesce(c.paying_company, '')
       and t.invoice_date <= c.invoice_date
       and coalesce(t.amount_eur, t.amount) >= abs(coalesce(c.amount_eur, c.amount)) - 0.011
       and ( t.id::text = (regexp_match(c.notes, 'abate a despesa ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]
          or ( (regexp_match(c.notes, 'abate a despesa ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1] is null
               and left(t.id::text, 8) = (regexp_match(c.notes, '\(linha ([0-9a-f]{8})\)'))[1]
               and (select count(*) from public.hq_invoices x
                     where left(x.id::text, 8) = (regexp_match(c.notes, '\(linha ([0-9a-f]{8})\)'))[1]) = 1 ) );
    get diagnostics v_links = row_count;
    raise notice 'credit notes: % lines marked, % linked to the invoice they cancel', v_cn, v_links;
  end if;
end $$;

create index if not exists hq_invoices_credits_invoice_idx on public.hq_invoices (credits_invoice_id) where credits_invoice_id is not null;
create index if not exists hq_invoices_credit_notes_idx on public.hq_invoices (invoice_date) where doc_type = 'credit_note';

-- ── 1b. emailed credit notes the harvester skipped before today: back to «to decide» ──
--  Until 18 Nov 2026 mail-ingest skipped every credit note («documento anulado» / «não é
--  fatura (credit_note)»). The ones nobody decided and that have no line in the app yet go
--  back to the «Invoices from email» queue of the HQ Month close, where a person adds them
--  («Add credit note») or ignores them. Nothing is booked here. Run AFTER mail-ingest is
--  deployed: the old function books a confirmed credit note as a positive expense.
update public.mail_ingest_items m
   set status = 'review',
       company = coalesce(m.company, case m.parsed->>'buyer_nif' when '502379723' then 'manjar' when '515059927' then 'water-movements' end),
       reason = 'nota de crédito ' || coalesce(m.parsed->>'invoice_number', '') || ' — por confirmar (estava ignorada: ' || coalesce(m.reason, '') || ')'
 where m.status = 'skipped' and m.decided_at is null and m.hq_invoice_id is null
   -- only the two old reasons: a credit note skipped today for another reason (a personal NIF…) stays skipped
   and (m.reason like 'documento anulado%' or m.reason like 'não é fatura (credit_note)%')
   and (m.parsed->>'doc_type' = 'credit_note' or coalesce(m.parsed->>'invoice_number', '') ~* '^\s*(NCRTP|NCC|NC|ADC)([^a-z]|$)')
   and m.parsed->>'amount' is not null
   and not exists (select 1 from public.hq_invoices i where i.deleted_at is null
                    and lower(trim(i.invoice_number)) = lower(trim(m.parsed->>'invoice_number')));

-- ── 2. a credit note is always negative ──────────────────────────────────────
create or replace function public.hq_invoices_credit_note_sign()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.doc_type = 'credit_note' then
    new.amount := -abs(new.amount);
    new.amount_eur := -abs(new.amount_eur);
    if new.credits_invoice_id = new.id then new.credits_invoice_id := null; end if;
  else
    new.credits_invoice_id := null;   -- only a credit note cancels an invoice
  end if;
  return new;
end $$;
revoke all on function public.hq_invoices_credit_note_sign() from public, anon, authenticated;

drop trigger if exists tr_hq_invoices_credit_note_sign on public.hq_invoices;
create trigger tr_hq_invoices_credit_note_sign
  before insert or update on public.hq_invoices
  for each row execute function public.hq_invoices_credit_note_sign();

-- ── 3. the invoice-side bank matcher ─────────────────────────────────────────
--  An invoice links to the single unlinked DEBIT of its amount (−5/+25 days), as before.
--  A credit note links to the single unlinked CREDIT of its absolute amount (±20 days):
--  money in that no partner payment, sales invoice, transfer or other line already explains,
--  and never a card-terminal batch, a cash deposit or partner funding (the Suk's sales rubrics).
--  Never for cash lines, never when two movements could match.
--  Also fixed here: the old body used min(uuid), which Postgres does not have, so every
--  call failed (42883) and mail-ingest never linked a debit. The candidates are now
--  counted and the single one taken with array_agg.
create or replace function public.hq_invoice_to_bank(p_invoice uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare i record; v_ids uuid[]; v_id uuid;
begin
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  select * into i from hq_invoices where id = p_invoice and deleted_at is null;
  if i is null or i.payment_type = 'Cash' or coalesce(i.amount_eur, 0) = 0 then return null; end if;
  if i.bank_movement_id is not null or exists (select 1 from hq_bank_movements where hq_invoice_id = p_invoice) then return null; end if;

  if i.amount_eur < 0 then
    if i.doc_type <> 'credit_note' then return null; end if;
    select array_agg(b.id) into v_ids from hq_bank_movements b
     where b.paying_company = coalesce(i.paying_company, 'water-movements') and b.kind = 'income' and b.amount > 0
       and b.hq_invoice_id is null and b.internal_transfer_id is null and b.sales_invoice_ref is null
       and abs(b.amount + i.amount_eur) < 0.011
       and b.movement_date between i.invoice_date - 20 and i.invoice_date + 20
       -- never money the Suk counts as sales or funding (rubricOf in suk/index.html): a card-terminal batch or a
       -- cash deposit of the same amount must not turn into a «supplier refund» and drop out of Sales
       and upper(coalesce(b.description, '')) !~ '(TPA|UNICRE|DEP +NUM|DEPOSITO|WATER MOVEMENTS|RICARDO NUNO)'
       and not exists (select 1 from partner_ledger pl where pl.bank_movement_id = b.id and pl.deleted_at is null)
       and not exists (select 1 from hq_invoices x where x.bank_movement_id = b.id and x.deleted_at is null);
  else
    select array_agg(b.id) into v_ids from hq_bank_movements b
     where b.paying_company = coalesce(i.paying_company, 'water-movements') and b.kind = 'expense' and b.amount < 0
       and b.hq_invoice_id is null and b.internal_transfer_id is null
       and abs(-b.amount - i.amount_eur) < 0.011
       and b.movement_date between i.invoice_date - 5 and i.invoice_date + 25
       and b.description not ilike 'LOTE TRF CRED SEPA%'
       and coalesce(b.notes, '') not ilike '[sem fatura%' and coalesce(b.notes, '') not like '[ativo%'
       and coalesce(b.notes, '') not like '[financiamento%' and coalesce(b.notes, '') not like '[devolução%';
  end if;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then return null; end if;
  v_id := v_ids[1];
  update hq_bank_movements set hq_invoice_id = p_invoice where id = v_id;
  return v_id;
end $$;
revoke all on function public.hq_invoice_to_bank(uuid) from public, anon;
grant execute on function public.hq_invoice_to_bank(uuid) to authenticated, service_role;

-- every credit note of the last 120 days still without its refund (called after a statement import)
create or replace function public.hq_credit_notes_to_bank(p_company text)
returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_hq_member() then raise exception 'HQ member required' using errcode = '42501'; end if;
  for r in
    select i.id from hq_invoices i
     where i.doc_type = 'credit_note' and i.deleted_at is null
       and coalesce(i.paying_company, 'water-movements') = coalesce(p_company, 'water-movements')
       and i.payment_type <> 'Cash' and i.bank_movement_id is null
       and i.invoice_date >= current_date - 120
       and not exists (select 1 from hq_bank_movements b where b.hq_invoice_id = i.id)
     order by i.invoice_date
  loop
    if public.hq_invoice_to_bank(r.id) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.hq_credit_notes_to_bank(text) from public, anon;
grant execute on function public.hq_credit_notes_to_bank(text) to authenticated, service_role;

-- ── 4. «bank debit without a line»: the sign counts ──────────────────────────
--  Same rules as before, one change: the lines are compared with their sign. A credit
--  note of −X no longer «explains» a debit of X, and a supplier's invoice + credit note
--  of the same day explain the debit of their NET amount (invoice 250 − credit note 200 = debit 50).
create or replace function public._accountant_bank_unmatched(p_from date, p_to date)
returns table (id uuid, movement_date date, description text, amount numeric)
language sql stable security definer set search_path = public as $$
  with inv as (
    select invoice_date, company, coalesce(amount_eur, amount) as v
      from hq_invoices
     where deleted_at is null and coalesce(paying_company, 'water-movements') = 'water-movements'
       and invoice_date between p_from - 20 and p_to + 10
  ), grp as (
    select invoice_date, company, sum(v) as v from inv group by 1, 2
  )
  select b.id, b.movement_date, b.description, b.amount
    from hq_bank_movements b
   where b.paying_company = 'water-movements' and b.amount < 0
     and b.kind in ('expense', 'other')
     and b.movement_date between p_from and p_to
     and b.hq_invoice_id is null and b.internal_transfer_id is null
     and b.description not ilike 'LOTE TRF CRED SEPA%'
     -- 20 Out 2026: CGD movements marked as an asset or financing (shop
     -- purchase, IMT, van, extraordinary amortisation) are not expenses.
     and coalesce(b.notes, '') not like '[ativo%'
     and coalesce(b.notes, '') not like '[financiamento%'
     and coalesce(b.notes, '') not like '[devolução%'
     and not exists (select 1 from inv i where abs(i.v - abs(b.amount)) < 0.011
                       and i.invoice_date between b.movement_date - 15 and b.movement_date + 5)
     and not exists (select 1 from grp g where abs(g.v - abs(b.amount)) < 0.011
                       and g.invoice_date between b.movement_date - 15 and b.movement_date + 5)
$$;
revoke all on function public._accountant_bank_unmatched(date, date) from public, anon, authenticated;

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
grant execute on function public.hq_bank_unmatched_co(text, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- what the run left behind
select json_build_object(
  'credit_notes', (select count(*) from public.hq_invoices where doc_type = 'credit_note' and deleted_at is null),
  'linked_to_invoice', (select count(*) from public.hq_invoices where doc_type = 'credit_note' and credits_invoice_id is not null and deleted_at is null),
  'negative_lines_left_as_invoice', (select count(*) from public.hq_invoices where doc_type <> 'credit_note' and amount < 0 and deleted_at is null),
  'positive_credit_notes', (select count(*) from public.hq_invoices where doc_type = 'credit_note' and (amount > 0 or amount_eur > 0))
) as credit_notes;
