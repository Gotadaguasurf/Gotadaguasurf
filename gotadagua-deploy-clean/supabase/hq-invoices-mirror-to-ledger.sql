-- 9 Set 2026 — Miguel: "tudo o que o HQ pagou para uma location devia aparecer no
-- ledger dessa location, a dizer que foi pago pelo HQ". Espelho de sentido único
-- hq_invoices → ledger_entries: a factura é a verdade, a linha do ledger é reflexo,
-- só de leitura no camp-hub. Fora: location 'general' (HQ), facturas apagadas ou
-- duplicadas, categorias pessoais, e o Pedro Barata (Marrocos) por decisão do Miguel.
-- kids-camp não tem location própria → junior-camp.

alter table public.ledger_entries add column if not exists hq_invoice_id uuid;
create unique index if not exists ledger_entries_hq_invoice_id_uq on public.ledger_entries(hq_invoice_id) where hq_invoice_id is not null;

create or replace function public.hq_mirror_business_area(p_cat text)
returns text language sql immutable as $$
  select case
    when p_cat = 'Salary' then 'Salaries'
    when p_cat = 'Food' then 'Food'
    when p_cat = 'Transport' then 'Transport'
    when p_cat in ('Activities','Tours') then 'Tours'
    when p_cat = 'Merch' then 'Merch'
    when p_cat in ('Rent','Utilities','Setup','Cleaning Supplies','Services','Insurances','Taxes','Accounting') then 'Utilities'
    else 'General' end;
$$;

create or replace function public.fn_mirror_hq_invoice_to_ledger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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
             or lower(coalesce(new.company,'')) like '%barata%';
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
end $$;

drop trigger if exists tr_hq_invoice_mirror on public.hq_invoices;
create trigger tr_hq_invoice_mirror
  after insert or update or delete on public.hq_invoices
  for each row execute function public.fn_mirror_hq_invoice_to_ledger();

-- As linhas espelhadas não se editam nem apagam no ledger — só a factura no HQ.
create or replace function public.fn_ledger_mirror_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.hq_mirror', true),'') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.hq_invoice_id is not null then
      raise exception 'Esta linha é uma factura paga pelo HQ. Altera-a ou arquiva-a no HQ, não aqui.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.hq_invoice_id is not null or new.hq_invoice_id is not null then
    raise exception 'Esta linha é uma factura paga pelo HQ. Altera-a ou arquiva-a no HQ, não aqui.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tr_ledger_mirror_guard on public.ledger_entries;
create trigger tr_ledger_mirror_guard
  before update or delete on public.ledger_entries
  for each row execute function public.fn_ledger_mirror_guard();

-- Backfill: dispara o espelho para tudo o que já existe (2026).
update public.hq_invoices set updated_at = coalesce(updated_at, now()) where invoice_date >= '2026-01-01';
