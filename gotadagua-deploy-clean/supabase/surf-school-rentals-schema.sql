-- ════════════════════════════════════════════════════════════════════════════
--  SURF SCHOOL RENTALS — schema for the Surf School module
-- ════════════════════════════════════════════════════════════════════════════
--
--  What this stores: a rental / lesson / activity registered by staff at
--  the Surf School. Students pay UP FRONT (cash / card) — that hits the
--  ledger as revenue immediately. The row here tracks who's still holding
--  a board and when it comes back.
--
--  Money model:
--    - The revenue lands in ledger_entries (type=revenue,
--      attributed_location=surf-school). Created by the client at the
--      same time and linked via ledger_entry_id below.
--    - "Return / Close" DOES NOT touch money. It only flips is_returned
--      and stamps closed_at / closed_by.
--
--  Audit:
--    - opened_by / closed_by = auth.uid() at each write, so we can
--      answer "who took this in / who closed it" the same way we do for
--      camp_tab_items.
--
--  RLS:
--    - Same location gating as ledger_entries — has_location_access(location_id).
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.surf_school_rentals (
  id                uuid          primary key default gen_random_uuid(),
  location_id       uuid          not null references public.locations(id) on delete cascade,
  ledger_entry_id   uuid          references public.ledger_entries(id) on delete set null,
  -- rental / lesson / activity — controls which tab the row shows in and
  -- whether the return workflow applies (only rentals need a Close step).
  kind              text          not null default 'rental',
  -- Student identity. Name required; email and id_card_number optional.
  -- id_card is the informal "collateral" — knowing which passport / ID the
  -- board went out with makes chasing a no-return easier.
  student_name      text          not null,
  student_email     text,
  id_card_number    text,
  -- Item chosen from the pricing_catalog. Store both the id (to survive
  -- rename in the catalog) and the name (so old rows still read once the
  -- catalog row is deleted).
  item_id           uuid          references public.pricing_catalog(id) on delete set null,
  item_name         text          not null,
  qty               numeric(6,2)  not null default 1,
  price_local       numeric(12,2) not null default 0,
  currency          text          not null default 'EUR',
  payment_method    text          not null default 'Cash',
    -- Cash / Card
  terms_accepted    boolean       not null default false,
  terms_accepted_at timestamptz,
  -- Rental lifecycle: opened_at set at insert, closed_at + is_returned
  -- flipped when staff clicks Return. Lessons / activities skip the
  -- close step — they're born already "closed" (returned=true immediately).
  opened_at         timestamptz   not null default now(),
  opened_by         uuid,
  closed_at         timestamptz,
  closed_by         uuid,
  is_returned       boolean       not null default false,
  notes             text,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists idx_surf_rentals_location on public.surf_school_rentals(location_id);
create index if not exists idx_surf_rentals_open     on public.surf_school_rentals(location_id) where is_returned = false;
create index if not exists idx_surf_rentals_opened   on public.surf_school_rentals(location_id, opened_at desc);

-- Auto-bump updated_at on update.
create or replace function public.surf_rentals_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tr_surf_rentals_touch on public.surf_school_rentals;
create trigger tr_surf_rentals_touch
  before update on public.surf_school_rentals
  for each row execute function public.surf_rentals_touch();

-- Audit trigger: on insert, stamp opened_by from auth.uid() if the client
-- didn't set it. On update, stamp closed_by whenever is_returned flips
-- from false to true.
create or replace function public.fn_stamp_audit_surf_rentals() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.opened_by is null then
      new.opened_by = auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_returned = true and old.is_returned = false then
      if new.closed_by is null then
        new.closed_by = auth.uid();
      end if;
      if new.closed_at is null then
        new.closed_at = now();
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tr_stamp_audit_surf_rentals on public.surf_school_rentals;
create trigger tr_stamp_audit_surf_rentals
  before insert or update on public.surf_school_rentals
  for each row execute function public.fn_stamp_audit_surf_rentals();

-- ═══════════════════ RLS ═══════════════════════════════════════════════════
alter table public.surf_school_rentals enable row level security;

drop policy if exists "surf_rentals_select_location" on public.surf_school_rentals;
create policy "surf_rentals_select_location" on public.surf_school_rentals
  for select to authenticated
  using (public.has_location_access(location_id));

drop policy if exists "surf_rentals_insert_location" on public.surf_school_rentals;
create policy "surf_rentals_insert_location" on public.surf_school_rentals
  for insert to authenticated
  with check (public.has_location_access(location_id));

drop policy if exists "surf_rentals_update_location" on public.surf_school_rentals;
create policy "surf_rentals_update_location" on public.surf_school_rentals
  for update to authenticated
  using  (public.has_location_access(location_id))
  with check (public.has_location_access(location_id));

drop policy if exists "surf_rentals_delete_location" on public.surf_school_rentals;
create policy "surf_rentals_delete_location" on public.surf_school_rentals
  for delete to authenticated
  using (public.has_location_access(location_id));

-- ═══════════════════ VERIFICATION (paste into a fresh query) ═════════════
-- 1. See the policies you just created:
--    select policyname, cmd, qual from pg_policies
--    where tablename = 'surf_school_rentals';
--
-- 2. Make sure the location row exists (SQL Editor runs as owner so this
--    should always return one row; managers use RLS):
--    select id, slug, name from public.locations where slug = 'surf-school';
