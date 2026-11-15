-- ════════════════════════════════════════════════════════════════════════════
--  Dipløria — stock per camp, adjustable from /diploria/ (Miguel, 15 Nov 2026)
--  «quanto stock metemos por localização (isto dos stocks devia ser ajustável desta parte)».
--
--  The stock is a list of MOVES, never a number that gets overwritten:
--    diploria_stock_moves  one row per change: location, SKU (the catalog name, «Core Black 32» or
--                          Portugal's «Size 30»), qty (+/−), kind, note, who, when. Append-only: a wrong
--                          move is fixed with a correction, not by editing it.
--    kinds                 initial (the opening count) · sent (received from Dipløria) · returned (sent back
--                          to Dipløria) · transfer_out / transfer_in (between camps, one transfer_id) ·
--                          correction (+/−, a recount) · sold_outside (sold without the Camp Tab)
--
--  Stock on hand = Σ moves. Left = Σ moves − the Camp Tab lines with that name (same count as the tab).
--
--  The Camp Tab is NOT changed. It keeps reading stock_qty (pricing_catalog via the hub, location_menus as
--  its own copy) and subtracting its sales, exactly as today. What changes is that, for a Diploria row
--  that has moves, stock_qty is DERIVED: a guard trigger on both tables forces stock_qty = Σ moves on every
--  insert/update, so the Camp Tab's «N left» and the /diploria/ figure are the same number by
--  construction. That also covers the two ways the column could drift:
--    · the Camp Tab's menu sync (delete + re-upsert of location_menus from a browser that loaded the menu
--      before a move) → the re-inserted row gets Σ moves, not the stale figure;
--    · an edit of a Diploria stock figure in /prices or the Camp Tab menu editor → overridden by Σ moves
--      (stock is changed from /diploria/ only; nothing is turned into a phantom move).
--
--  Opening stock: one «initial» move per Diploria catalog row = its stock_qty today (Sri Lanka 61 units,
--  Retro 32 = 0 as on the sheet; Portugal 42). Guarded by a unique index, so a second run adds nothing.
--
--  Writes: only through diploria_stock_move() (security definer, checks is_diploria_editor(), refuses
--  anything that would take a camp's «left» below 0). No insert/update/delete grant on the table.
--  Read: the owner and the 'diploria' workspace members (is_diploria_member()).
--
--  Needs supabase/diploria-area.sql first. Idempotent. NOT run by the agent. Run order: 2 of 3.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.diploria_stock_moves (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  sku         text not null,
  qty         integer not null,
  kind        text not null,
  note        text,
  transfer_id uuid,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint diploria_moves_sku check (length(btrim(sku)) > 0),
  constraint diploria_moves_kind check (kind in ('initial','sent','returned','transfer_out','transfer_in','correction','sold_outside')),
  constraint diploria_moves_sign check (
       (kind = 'initial' and qty >= 0)
    or (kind in ('sent','transfer_in') and qty > 0)
    or (kind in ('returned','transfer_out','sold_outside') and qty < 0)
    or (kind = 'correction' and qty <> 0))
);
create index if not exists diploria_moves_sku_idx on public.diploria_stock_moves (location_id, lower(btrim(sku)));
create unique index if not exists diploria_moves_one_initial on public.diploria_stock_moves (location_id, lower(btrim(sku))) where kind = 'initial';

alter table public.diploria_stock_moves enable row level security;
revoke all on public.diploria_stock_moves from anon, authenticated;
grant select on public.diploria_stock_moves to authenticated;
drop policy if exists diploria_moves_select on public.diploria_stock_moves;
create policy diploria_moves_select on public.diploria_stock_moves for select to authenticated using (public.is_diploria_member());

-- Σ moves for one SKU at one camp (null = the SKU has no move yet → its stock_qty is left alone).
create or replace function public.diploria_on_hand(p_location uuid, p_sku text)
returns integer language sql stable security definer set search_path = public as $$
  select sum(qty)::int from public.diploria_stock_moves where location_id = p_location and lower(btrim(sku)) = lower(btrim(p_sku));
$$;
revoke all on function public.diploria_on_hand(uuid, text) from public, anon;
grant execute on function public.diploria_on_hand(uuid, text) to authenticated;

-- Left at a camp = stock (Σ moves, or the catalog figure before the first move) − the Camp Tab lines.
create or replace function public._diploria_left(p_location uuid, p_sku text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(public.diploria_on_hand(p_location, p_sku),
                  (select max(c.stock_qty) from public.pricing_catalog c where c.location_id = p_location and c.category = 'Diploria' and lower(btrim(c.name)) = lower(btrim(p_sku))), 0)
       - (select count(*)::int from public.camp_tab_items i where i.location_id = p_location and i.category = 'Diploria' and lower(btrim(i.item_name)) = lower(btrim(p_sku)));
$$;
revoke all on function public._diploria_left(uuid, text) from public, anon, authenticated;

-- The guard: a Diploria row with moves always carries stock_qty = Σ moves, whoever writes it.
create or replace function public.diploria_stock_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if new.category is distinct from 'Diploria' then return new; end if;
  v := public.diploria_on_hand(new.location_id, coalesce(to_jsonb(new)->>'name', to_jsonb(new)->>'item_name'));
  if v is not null then new.stock_qty := greatest(0, v); end if;
  return new;
end $$;
drop trigger if exists diploria_stock_guard on public.pricing_catalog;
create trigger diploria_stock_guard before insert or update on public.pricing_catalog for each row execute function public.diploria_stock_guard();
drop trigger if exists diploria_stock_guard on public.location_menus;
create trigger diploria_stock_guard before insert or update on public.location_menus for each row execute function public.diploria_stock_guard();

-- After a move: write Σ moves into both catalog copies (the hub and the Camp Tab pick it up as usual).
create or replace function public.diploria_stock_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v int := greatest(0, coalesce(public.diploria_on_hand(new.location_id, new.sku), 0));
begin
  update public.pricing_catalog set stock_qty = v
   where location_id = new.location_id and category = 'Diploria' and lower(btrim(name)) = lower(btrim(new.sku)) and stock_qty is distinct from v;
  update public.location_menus set stock_qty = v
   where location_id = new.location_id and category = 'Diploria' and lower(btrim(item_name)) = lower(btrim(new.sku)) and stock_qty is distinct from v;
  return null;
end $$;
drop trigger if exists diploria_stock_sync on public.diploria_stock_moves;
create trigger diploria_stock_sync after insert on public.diploria_stock_moves for each row execute function public.diploria_stock_sync();

-- Make sure a SKU exists at a camp before a move touches it. An existing catalog row gets its opening move
-- (= its stock_qty) if it has none. A missing one («+ Received» on an empty cell, or a transfer into a camp
-- that never had that model × size) is created only when p_create, copying price, currency and flags from a
-- Diploria row of the same model at that camp (else any Diploria row there): in pricing_catalog and in the
-- Camp Tab's location_menus, with an opening move of 0.
create or replace function public._diploria_ensure_sku(p_location uuid, p_sku text, p_create boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c record; sib record; m text[]; sz text[] := array['28','30','31','32','33','34']; v_sort int;
begin
  select * into c from public.pricing_catalog where location_id = p_location and category = 'Diploria' and lower(btrim(name)) = lower(btrim(p_sku)) order by active desc, sort_order limit 1;
  if found then
    insert into public.diploria_stock_moves (location_id, sku, qty, kind, note, created_by)
    select p_location, btrim(c.name), coalesce(c.stock_qty, 0), 'initial', 'Opening stock = the catalog figure at the first move', null
     where not exists (select 1 from public.diploria_stock_moves x where x.location_id = p_location and lower(btrim(x.sku)) = lower(btrim(p_sku)))
    on conflict do nothing;
    return;
  end if;
  if not p_create then raise exception 'No «%» at that camp.', btrim(p_sku); end if;
  m := regexp_match(btrim(p_sku), '^(.*\S)\s+(\d{2})$');
  if m is null or not (m[2] = any(sz)) then raise exception '«%» is not a model + waist size (28, 30, 31, 32, 33 or 34).', btrim(p_sku); end if;
  select * into sib from public.pricing_catalog where location_id = p_location and category = 'Diploria' and lower(name) like lower(m[1]) || ' %' order by active desc, sort_order limit 1;
  if not found then
    select * into sib from public.pricing_catalog where location_id = p_location and category = 'Diploria' order by active desc, sort_order limit 1;
  end if;
  if not found then raise exception 'That camp has no Dipløria rows yet: add them in /prices first.'; end if;
  v_sort := (sib.sort_order / 10) * 10 + array_position(sz, m[2]) - 1;
  insert into public.pricing_catalog (location_id, name, category, audience, sell_price, cost_per_guest, currency, show_in_camp_tab, show_in_transport_picker, active, sort_order, picker_tab, sell_currency, stock_qty, alt_price, alt_label)
  values (p_location, btrim(p_sku), 'Diploria', sib.audience, sib.sell_price, sib.cost_per_guest, sib.currency, sib.show_in_camp_tab, false, true, v_sort, sib.picker_tab, sib.sell_currency, 0, sib.alt_price, sib.alt_label);
  insert into public.location_menus (location_id, category, item_name, price_local, stock_qty, active, description, staff_price_local, sort_order)
  select p_location, 'Diploria', btrim(p_sku), coalesce(lm.price_local, sib.sell_price), 0, true, lm.description, lm.staff_price_local, v_sort
    from (select 1) one left join lateral (select * from public.location_menus where location_id = p_location and category = 'Diploria' and lower(btrim(item_name)) = lower(btrim(sib.name)) limit 1) lm on true
  on conflict do nothing;
  insert into public.diploria_stock_moves (location_id, sku, qty, kind, note, created_by)
  values (p_location, btrim(p_sku), 0, 'initial', 'New SKU at this camp (created by a move)', null)
  on conflict do nothing;
end $$;
revoke all on function public._diploria_ensure_sku(uuid, text, boolean) from public, anon, authenticated;

-- The one write path. p_kind: 'sent' (+, received from Dipløria), 'correction' (signed recount),
-- 'returned' / 'sold_outside' (−), 'transfer' (p_qty units from p_location_id to p_to_location_id,
-- landing on p_to_sku, same waist size; two legs with one transfer_id).
create or replace function public.diploria_stock_move(p_location_id uuid, p_sku text, p_qty integer, p_kind text, p_note text default null, p_to_location_id uuid default null, p_to_sku text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sku text := btrim(coalesce(p_sku, ''));
  v_to text := btrim(coalesce(nullif(btrim(coalesce(p_to_sku, '')), ''), p_sku, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_delta int; v_left int; v_tid uuid; v_ids uuid[] := '{}'; v_id uuid;
begin
  if not public.is_diploria_editor() then
    raise exception 'Not allowed: Dipløria stock is changed by the owner and the Dipløria team only.' using errcode = '42501';
  end if;
  if p_location_id is null or v_sku = '' then raise exception 'Pick a camp and a short.'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'The quantity cannot be 0.'; end if;
  if abs(p_qty) > 500 then raise exception 'More than 500 at once: split it into smaller moves.'; end if;
  if p_kind not in ('sent', 'returned', 'correction', 'sold_outside', 'transfer') then raise exception 'Unknown move «%».', p_kind; end if;
  v_delta := case p_kind when 'sent' then abs(p_qty) when 'correction' then p_qty else -abs(p_qty) end;

  perform pg_advisory_xact_lock(hashtext('diploria:' || p_location_id::text || ':' || lower(v_sku)));
  perform public._diploria_ensure_sku(p_location_id, v_sku, v_delta > 0);
  if v_delta < 0 then
    v_left := public._diploria_left(p_location_id, v_sku);
    if v_left + v_delta < 0 then
      raise exception '«%» has % left at that camp: cannot take % out.', v_sku, v_left, -v_delta;
    end if;
  end if;

  if p_kind = 'transfer' then
    if p_to_location_id is null or p_to_location_id = p_location_id then raise exception 'Pick the other camp.'; end if;
    if substring(v_sku from '(\d{2})$') is distinct from substring(v_to from '(\d{2})$') then
      raise exception 'A move keeps the waist size: «%» cannot become «%».', v_sku, v_to;
    end if;
    perform public._diploria_ensure_sku(p_to_location_id, v_to, true);
    v_tid := gen_random_uuid();
    insert into public.diploria_stock_moves (location_id, sku, qty, kind, note, transfer_id)
    values (p_location_id, v_sku, -abs(p_qty), 'transfer_out', v_note, v_tid) returning id into v_id;
    v_ids := v_ids || v_id;
    insert into public.diploria_stock_moves (location_id, sku, qty, kind, note, transfer_id)
    values (p_to_location_id, v_to, abs(p_qty), 'transfer_in', v_note, v_tid) returning id into v_id;
    v_ids := v_ids || v_id;
  else
    insert into public.diploria_stock_moves (location_id, sku, qty, kind, note)
    values (p_location_id, v_sku, v_delta, p_kind, v_note) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids), 'left', public._diploria_left(p_location_id, v_sku),
    'to_left', case when p_kind = 'transfer' then public._diploria_left(p_to_location_id, v_to) end, 'transfer_id', v_tid);
end $$;
revoke all on function public.diploria_stock_move(uuid, text, integer, text, text, uuid, text) from public, anon;
grant execute on function public.diploria_stock_move(uuid, text, integer, text, text, uuid, text) to authenticated;

-- Opening stock: one «initial» move per Diploria catalog row (= its stock_qty today). Second run: nothing.
insert into public.diploria_stock_moves (location_id, sku, qty, kind, note, created_by)
select distinct on (c.location_id, lower(btrim(c.name))) c.location_id, btrim(c.name), coalesce(c.stock_qty, 0), 'initial',
       'Opening stock = the catalog on 15 Nov 2026 (the stock sheets)', null
  from public.pricing_catalog c
 where c.category = 'Diploria'
   and not exists (select 1 from public.diploria_stock_moves x where x.location_id = c.location_id and lower(btrim(x.sku)) = lower(btrim(c.name)))
 order by c.location_id, lower(btrim(c.name)), c.active desc, c.sort_order
on conflict do nothing;

commit;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- Opening stock per camp: sri-lanka 38 rows / 61 units, portugal 6 rows / 42 units
-- select l.slug, count(*) as skus, sum(m.qty) as units from public.diploria_stock_moves m join public.locations l on l.id = m.location_id where m.kind = 'initial' group by 1;
-- Every Diploria row: stock_qty = Σ moves, in both tables (expect no rows)
-- select l.slug, c.name, c.stock_qty, public.diploria_on_hand(c.location_id, c.name) from public.pricing_catalog c join public.locations l on l.id = c.location_id where c.category = 'Diploria' and c.stock_qty is distinct from public.diploria_on_hand(c.location_id, c.name);
-- select l.slug, m.item_name, m.stock_qty from public.location_menus m join public.locations l on l.id = m.location_id where m.category = 'Diploria' and m.stock_qty is distinct from public.diploria_on_hand(m.location_id, m.item_name);
