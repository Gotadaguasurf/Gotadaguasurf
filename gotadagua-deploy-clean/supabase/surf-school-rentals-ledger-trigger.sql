-- ════════════════════════════════════════════════════════════════════════════
--  SURF SCHOOL RENTALS ↔ LEDGER — bulletproof link via triggers
-- ════════════════════════════════════════════════════════════════════════════
--
--  Miguel's deep review: the 4 test rentals in surf_school_rentals had
--  ledger_entry_id = NULL, so their revenue never showed up in HQ →
--  Profit per location → On-site rev. The client-side insertion path
--  worked once RLS was clean, but "client did the two-step insert" is
--  fragile: if the ledger insert silently returns null (RLS on SELECT
--  after INSERT quirks, race conditions, custom client code paths, SQL
--  editor bulk inserts, imports), the rental lands without a linked
--  revenue row.
--
--  Solution: a BEFORE INSERT trigger. Every surf_school_rentals row
--  auto-creates its own ledger_entries revenue row + links back via
--  ledger_entry_id. The client no longer needs to insert into ledger
--  itself — the trigger is the single source of truth.
--
--  Companion BEFORE DELETE trigger removes the linked ledger row when
--  a rental is deleted so we don't leave orphan revenue floating.
--
--  Idempotent — safe to re-run. The trigger only fires on rows where
--  ledger_entry_id is NULL, so old rows already linked (or manually
--  linked backfills below) are untouched.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Auto-create the ledger revenue row on INSERT ────────────────────
create or replace function public.fn_surf_rental_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ledger_id uuid;
  loc_slug text;
  ledger_category text;
begin
  -- Client already linked one — nothing to do.
  if new.ledger_entry_id is not null then
    return new;
  end if;

  select slug into loc_slug from public.locations where id = new.location_id;
  if loc_slug is null then loc_slug := 'surf-school'; end if;

  ledger_category := case new.kind
    when 'lesson'   then 'Lessons'
    when 'activity' then 'Activities'
    else 'Rentals'
  end;

  insert into public.ledger_entries (
    location_id, type, category,
    description, payment_method,
    qty, amount_local, currency,
    entry_date, business_area,
    fx_rate, amount_eur,
    source_kind, paid_from, attributed_location
  ) values (
    new.location_id,
    'revenue',
    ledger_category,
    coalesce(new.item_name, 'Rental') || ' — ' || coalesce(new.student_name, 'guest')
      || case when new.customer_type is not null then ' (' || new.customer_type || ')' else '' end
      || case when new.duration      is not null then ' · ' || new.duration else '' end,
    coalesce(new.payment_method, 'Cash'),
    coalesce(new.qty, 1),
    new.price_local,
    coalesce(new.currency, 'EUR'),
    coalesce(new.opened_at::date, current_date),
    'Surf School',
    1,
    case when coalesce(new.currency, 'EUR') = 'EUR' then new.price_local else 0 end,
    'surf_school',
    loc_slug,
    loc_slug
  )
  returning id into new_ledger_id;

  new.ledger_entry_id := new_ledger_id;
  return new;
end;
$$;

drop trigger if exists tr_surf_rental_ledger on public.surf_school_rentals;
create trigger tr_surf_rental_ledger
  before insert on public.surf_school_rentals
  for each row execute function public.fn_surf_rental_ledger();

-- ── 2. Auto-delete the linked ledger row when a rental is deleted ──────
create or replace function public.fn_surf_rental_delete_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ledger_entry_id is not null then
    delete from public.ledger_entries where id = old.ledger_entry_id;
  end if;
  return old;
end;
$$;

drop trigger if exists tr_surf_rental_delete_ledger on public.surf_school_rentals;
create trigger tr_surf_rental_delete_ledger
  before delete on public.surf_school_rentals
  for each row execute function public.fn_surf_rental_delete_ledger();

-- ── 3. Backfill the 4 test rentals (or any real ones missing a ledger) ─
--     If Miguel deletes the test data below instead of running this
--     backfill, that's fine too — new rentals get linked automatically
--     via the trigger from now on. This block only touches rows still
--     missing a ledger_entry_id, so it's safe either way.
do $$
declare
  r record;
  new_ledger_id uuid;
  ledger_category text;
  loc_slug text;
begin
  for r in
    select * from public.surf_school_rentals where ledger_entry_id is null
  loop
    select slug into loc_slug from public.locations where id = r.location_id;
    if loc_slug is null then loc_slug := 'surf-school'; end if;

    ledger_category := case r.kind
      when 'lesson'   then 'Lessons'
      when 'activity' then 'Activities'
      else 'Rentals'
    end;

    insert into public.ledger_entries (
      location_id, type, category,
      description, payment_method,
      qty, amount_local, currency,
      entry_date, business_area,
      fx_rate, amount_eur,
      source_kind, paid_from, attributed_location
    ) values (
      r.location_id, 'revenue', ledger_category,
      coalesce(r.item_name, 'Rental') || ' — ' || coalesce(r.student_name, 'guest')
        || case when r.customer_type is not null then ' (' || r.customer_type || ')' else '' end
        || case when r.duration      is not null then ' · ' || r.duration else '' end,
      coalesce(r.payment_method, 'Cash'),
      coalesce(r.qty, 1),
      r.price_local,
      coalesce(r.currency, 'EUR'),
      coalesce(r.opened_at::date, current_date),
      'Surf School',
      1,
      case when coalesce(r.currency, 'EUR') = 'EUR' then r.price_local else 0 end,
      'surf_school',
      loc_slug,
      loc_slug
    )
    returning id into new_ledger_id;

    update public.surf_school_rentals set ledger_entry_id = new_ledger_id where id = r.id;
  end loop;
end $$;

-- ── 4. Normalise customer_type — "Regular" → "Standard" ────────────────
--     Old test rows saved before the rename; keep the schema clean before
--     adding the CHECK constraint below.
update public.surf_school_rentals
   set customer_type = 'Standard'
 where customer_type = 'Regular';

-- ── 5. Constrain customer_type to the three real tiers ─────────────────
alter table public.surf_school_rentals
  drop constraint if exists surf_rentals_customer_type_check;
alter table public.surf_school_rentals
  add  constraint surf_rentals_customer_type_check
       check (customer_type is null or customer_type in ('Standard','Erasmus / Student','Resident'));

-- ── 6. Sanity — every rental should now have a ledger link ─────────────
--     select count(*) filter (where ledger_entry_id is null) as still_missing,
--            count(*) as total
--     from public.surf_school_rentals;
--     Expected: still_missing = 0.
