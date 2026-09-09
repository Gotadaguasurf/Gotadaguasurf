-- 9 Set 2026 — Miguel: "quando meto o money sent no cash flow do HQ devia ir
-- sozinho para a location, com lock". Espelho internal_transfers → ledger_entries
-- (type money_sent, payment_method 'HQ Transfer'), o que o camp-hub lê como
-- "HQ Transferred (in)". Só de leitura no camp-hub; a transferência no HQ manda.
-- Empresa destino → location: wave-movements → sri-lanka (LKR), mgrp-sarl → morocco (MAD).

alter table public.ledger_entries add column if not exists internal_transfer_id uuid;
create unique index if not exists ledger_entries_internal_transfer_id_uq on public.ledger_entries(internal_transfer_id) where internal_transfer_id is not null;

create or replace function public.fx_eur_to(p_currency text, p_date date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select rate from public.daily_fx_rates
  where base_currency = 'EUR' and quote_currency = p_currency and rate_date <= p_date
  order by rate_date desc limit 1;
$$;

create or replace function public.fn_mirror_internal_transfer_to_ledger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_slug text; v_loc uuid; v_cur text; v_fx numeric; v_eur numeric; v_local numeric; v_desc text;
begin
  perform set_config('app.hq_mirror','1',true);
  if tg_op = 'DELETE' then
    delete from public.ledger_entries where internal_transfer_id = old.id;
    return old;
  end if;
  v_slug := case new.to_company when 'wave-movements' then 'sri-lanka' when 'mgrp-sarl' then 'morocco' else null end;
  if v_slug is null then
    delete from public.ledger_entries where internal_transfer_id = new.id;
    return new;
  end if;
  select id into v_loc from public.locations where slug = v_slug;
  v_cur := case v_slug when 'sri-lanka' then 'LKR' when 'morocco' then 'MAD' else 'EUR' end;
  v_eur := coalesce(new.amount_eur, new.amount, 0);
  v_fx  := coalesce(nullif(new.fx_rate, 1), public.fx_eur_to(v_cur, new.transfer_date));
  if v_fx is null then v_cur := 'EUR'; v_fx := 1; end if;
  v_local := round(v_eur * v_fx, 2);
  v_desc := left('Transferência do HQ (' || coalesce(new.reference, to_char(new.transfer_date,'DD Mon')) || ')'
            || coalesce(' · ' || nullif(new.purpose,''), '') || ' · pago pelo HQ', 200);
  insert into public.ledger_entries (
    location_id, type, category, business_area, description, payment_method, qty,
    amount_local, currency, fx_rate, amount_eur, entry_date, source_kind, is_comp,
    paid_from, attributed_location, internal_transfer_id)
  values (v_loc, 'money_sent', 'Cash Float', 'General', v_desc, 'HQ Transfer', 1,
    v_local, v_cur, v_fx, v_eur, new.transfer_date, 'hq_transfer', false, 'hq', v_slug, new.id)
  on conflict (internal_transfer_id) where internal_transfer_id is not null do update set
    location_id = excluded.location_id, description = excluded.description, amount_local = excluded.amount_local,
    currency = excluded.currency, fx_rate = excluded.fx_rate, amount_eur = excluded.amount_eur,
    entry_date = excluded.entry_date, attributed_location = excluded.attributed_location;
  return new;
end $$;

drop trigger if exists tr_internal_transfer_mirror on public.internal_transfers;
create trigger tr_internal_transfer_mirror
  after insert or update or delete on public.internal_transfers
  for each row execute function public.fn_mirror_internal_transfer_to_ledger();

-- Guard: linhas espelhadas (factura ou transferência) só mudam via HQ.
create or replace function public.fn_ledger_mirror_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.hq_mirror', true),'') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.hq_invoice_id is not null or old.internal_transfer_id is not null then
      raise exception 'Esta linha vem do HQ (factura ou transferência). Altera-a ou arquiva-a no HQ, não aqui.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.hq_invoice_id is not null or new.hq_invoice_id is not null or old.internal_transfer_id is not null or new.internal_transfer_id is not null then
    raise exception 'Esta linha vem do HQ (factura ou transferência). Altera-a ou arquiva-a no HQ, não aqui.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Backfill: liga as linhas manuais que já são estas transferências (Sri Lanka, 8 remessas),
-- em vez de as duplicar; o resto é inserido pelo trigger.
do $$
declare t record; v_slug text; v_loc uuid; v_id uuid;
begin
  perform set_config('app.hq_mirror','1',true);
  for t in select * from public.internal_transfers where transfer_date >= '2026-01-01' loop
    v_slug := case t.to_company when 'wave-movements' then 'sri-lanka' when 'mgrp-sarl' then 'morocco' else null end;
    if v_slug is null then continue; end if;
    select id into v_loc from public.locations where slug = v_slug;
    select id into v_id from public.ledger_entries
     where location_id = v_loc and type = 'money_sent' and payment_method = 'HQ Transfer'
       and internal_transfer_id is null and hq_invoice_id is null
       and abs(entry_date - t.transfer_date) <= 3
       and abs(amount_eur - coalesce(t.amount_eur, t.amount)) <= 0.02 * coalesce(t.amount_eur, t.amount)
     order by abs(entry_date - t.transfer_date) limit 1;
    if v_id is not null then
      update public.ledger_entries set internal_transfer_id = t.id, source_kind = 'hq_transfer', paid_from = 'hq' where id = v_id;
    end if;
  end loop;
  update public.internal_transfers set updated_at = now() where transfer_date >= '2026-01-01';
end $$;

-- Sem taxa em ou antes da data (as taxas MAD começam a 24 Abr 2026), usa a
-- taxa mais próxima depois — melhor do que deixar a linha em euros.
create or replace function public.fx_eur_to(p_currency text, p_date date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select rate from public.daily_fx_rates
  where base_currency = 'EUR' and quote_currency = p_currency
  order by (rate_date > p_date), abs(rate_date - p_date) limit 1;
$$;
update public.internal_transfers set updated_at = now() where transfer_date = '2026-04-10' and to_company = 'mgrp-sarl';
