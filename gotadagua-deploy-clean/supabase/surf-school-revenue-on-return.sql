-- 10 Set 2026 — Miguel: "só vão para o ledger quando entregam as pranchas".
-- Antes a receita de uma rental entrava no ledger ao criar; agora entra na
-- devolução (is_returned passa a true) e sai se a rental for reaberta.
-- Aulas/actividades (kind <> 'rental') continuam a entrar ao criar.

create or replace function public.fn_surf_rental_ledger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  new_ledger_id uuid; loc_slug text; ledger_category text; v_date date;
begin
  -- Reaberta por engano: a receita sai do ledger até voltar a ser devolvida.
  if tg_op = 'UPDATE' and old.is_returned = true and new.is_returned = false and new.ledger_entry_id is not null then
    perform set_config('app.hq_mirror','1',true);
    delete from public.ledger_entries where id = new.ledger_entry_id;
    new.ledger_entry_id := null;
    return new;
  end if;
  if new.ledger_entry_id is not null then return new; end if;
  -- Rentals: só na devolução. Outros kinds: ao criar (já nascem "devolvidos").
  if new.kind = 'rental' and not (new.is_returned = true and (tg_op = 'INSERT' or old.is_returned = false)) then
    return new;
  end if;
  select slug into loc_slug from public.locations where id = new.location_id;
  if loc_slug is null then loc_slug := 'surf-school'; end if;
  ledger_category := case new.kind when 'lesson' then 'Lessons' when 'activity' then 'Activities' else 'Rentals' end;
  v_date := coalesce(new.closed_at::date, new.opened_at::date, current_date);
  insert into public.ledger_entries (
    location_id, type, category, description, payment_method, qty, amount_local, currency,
    entry_date, business_area, fx_rate, amount_eur, source_kind, paid_from, attributed_location)
  values (
    new.location_id, 'revenue', ledger_category,
    coalesce(new.item_name, 'Rental') || ' — ' || coalesce(new.student_name, 'guest')
      || case when new.customer_type is not null then ' (' || new.customer_type || ')' else '' end
      || case when new.duration is not null then ' · ' || new.duration else '' end,
    coalesce(new.payment_method, 'Cash'), coalesce(new.qty, 1), new.price_local, coalesce(new.currency, 'EUR'),
    v_date, 'Surf School', 1,
    case when coalesce(new.currency, 'EUR') = 'EUR' then new.price_local else 0 end,
    'surf_school', loc_slug, loc_slug)
  returning id into new_ledger_id;
  new.ledger_entry_id := new_ledger_id;
  return new;
end $$;

drop trigger if exists tr_surf_rental_ledger on public.surf_school_rentals;
create trigger tr_surf_rental_ledger
  before insert or update on public.surf_school_rentals
  for each row execute function public.fn_surf_rental_ledger();

-- O guard já não compara ledger_entry_id: essa coluna é gerida pelo servidor.
create or replace function public.fn_surf_rental_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if not public.has_full_location_access(new.location_id) then new.opened_by := auth.uid(); end if;
    return new;
  end if;
  if public.has_full_location_access(new.location_id) then return new; end if;
  if new.location_id is distinct from old.location_id or new.kind is distinct from old.kind
  or new.student_name is distinct from old.student_name or new.student_email is distinct from old.student_email
  or new.id_card_number is distinct from old.id_card_number or new.item_id is distinct from old.item_id
  or new.item_name is distinct from old.item_name or new.qty is distinct from old.qty
  or new.price_local is distinct from old.price_local or new.currency is distinct from old.currency
  or new.payment_method is distinct from old.payment_method or new.customer_type is distinct from old.customer_type
  or new.rental_type is distinct from old.rental_type or new.duration is distinct from old.duration
  or new.items is distinct from old.items or new.opened_at is distinct from old.opened_at
  or new.opened_by is distinct from old.opened_by or new.start_time is distinct from old.start_time
  or new.terms_accepted is distinct from old.terms_accepted or new.nif is distinct from old.nif
  then
    raise exception 'Só quem tem edição na Surf School pode alterar uma entrada; com acesso só a Rentals podes devolver ou reabrir a prancha.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Limpeza: rentals ainda abertas que já tinham receita no ledger (2, €40).
do $$
declare r record;
begin
  perform set_config('app.hq_mirror','1',true);
  for r in select id, ledger_entry_id from public.surf_school_rentals where kind='rental' and is_returned=false and ledger_entry_id is not null loop
    update public.surf_school_rentals set ledger_entry_id = null where id = r.id;
    delete from public.ledger_entries where id = r.ledger_entry_id;
  end loop;
end $$;

-- A reabertura apaga a linha do ledger de dentro do trigger da rental; o
-- cascade ledger→rental não pode disparar nesse caso (apagaria a própria
-- rental e dá "tuple already modified"). O flag app.hq_mirror marca-o.
create or replace function public.fn_ledger_cascade_to_surf_rental()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare rental_ids uuid[];
begin
  if coalesce(current_setting('app.hq_mirror', true),'') = '1' then return old; end if;
  if old.source_kind is distinct from 'surf_school' then return old; end if;
  select array_agg(id) into rental_ids from public.surf_school_rentals where ledger_entry_id = old.id;
  if rental_ids is null or array_length(rental_ids, 1) is null then return old; end if;
  update public.surf_school_rentals set ledger_entry_id = null where id = any(rental_ids);
  delete from public.surf_school_rentals where id = any(rental_ids);
  return old;
end $$;
