-- 9 Set 2026 — Miguel: quem só tem "Surf School · Rentals" (can_edit=false)
-- cria rentals e devolve pranchas, mas NÃO apaga nem altera valores. Só quem
-- tem edição na Surf School apaga. E cada venda fica presa a quem a fez
-- (opened_by = auth.uid()) por causa das comissões de venda.
--
-- Antes: a policy de DELETE usava has_location_access (ver chegava) e o
-- UPDATE deixava mudar qualquer coluna, incluindo o preço.

drop policy if exists surf_rentals_delete_location on public.surf_school_rentals;
create policy surf_rentals_delete_full on public.surf_school_rentals
  for delete to authenticated
  using (public.has_full_location_access(location_id));

create or replace function public.fn_surf_rental_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    -- a venda é sempre de quem está autenticado; só edição plena pode atribuir a outro
    if not public.has_full_location_access(new.location_id) then
      new.opened_by := auth.uid();
    end if;
    return new;
  end if;

  -- UPDATE
  if public.has_full_location_access(new.location_id) then
    return new;
  end if;
  -- rentals-only: só pode devolver / reabrir a prancha
  if new.location_id      is distinct from old.location_id
  or new.kind             is distinct from old.kind
  or new.student_name     is distinct from old.student_name
  or new.student_email    is distinct from old.student_email
  or new.id_card_number   is distinct from old.id_card_number
  or new.item_id          is distinct from old.item_id
  or new.item_name        is distinct from old.item_name
  or new.qty              is distinct from old.qty
  or new.price_local      is distinct from old.price_local
  or new.currency         is distinct from old.currency
  or new.payment_method   is distinct from old.payment_method
  or new.customer_type    is distinct from old.customer_type
  or new.rental_type      is distinct from old.rental_type
  or new.duration         is distinct from old.duration
  or new.items            is distinct from old.items
  or new.opened_at        is distinct from old.opened_at
  or new.opened_by        is distinct from old.opened_by
  or new.start_time       is distinct from old.start_time
  or new.ledger_entry_id  is distinct from old.ledger_entry_id
  or new.terms_accepted   is distinct from old.terms_accepted
  or new.nif              is distinct from old.nif
  then
    raise exception 'Só quem tem edição na Surf School pode alterar uma entrada; com acesso só a Rentals podes devolver ou reabrir a prancha.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists tr_surf_rental_guard on public.surf_school_rentals;
create trigger tr_surf_rental_guard
  before insert or update on public.surf_school_rentals
  for each row execute function public.fn_surf_rental_guard();
