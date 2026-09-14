-- 14 Set 2026 — Miguel: hóspedes do surf camp vão à escola buscar pranchas.
-- Não pagam (está no pacote) e não têm hora de devolução; só interessa saber
-- quem foi, quando começou e quantas pranchas estão na água.
--
-- A app grava essas linhas em surf_school_rentals com kind='camp' e
-- price_local=0. Sem esta migração o trigger fn_surf_rental_ledger criava
-- uma receita "Rentals" a 0 € por cada grupo — lixo no P&L. Esta versão é
-- a de surf-school-revenue-on-return.sql com uma única saída antecipada
-- para kind='camp'. Idempotente; correr no SQL editor do Supabase.

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
  -- Hóspedes do surf camp (kind='camp'): pranchas grátis, incluídas no
  -- pacote. Nunca geram receita — sem linha no ledger, nem a 0 €.
  if new.kind = 'camp' then return new; end if;
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
