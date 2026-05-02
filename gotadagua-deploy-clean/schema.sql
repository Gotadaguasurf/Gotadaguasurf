create extension if not exists "pgcrypto";

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  workspace_key text not null,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, location_id, workspace_key)
);

create table if not exists camp_weeks (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists camp_guests (
  id uuid primary key default gen_random_uuid(),
  week_id uuid references camp_weeks(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  name text not null,
  booking_ref text,
  is_staff boolean not null default false,
  paid boolean not null default false,
  paid_at timestamptz,
  checkin date,
  checkout date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists camp_tab_items (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references camp_guests(id) on delete cascade,
  week_id uuid references camp_weeks(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  category text not null,
  item_name text not null,
  qty numeric(10,2) not null default 1,
  price_local numeric(10,2) not null default 0,
  currency text not null default 'LKR',
  added_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  week_id uuid references camp_weeks(id) on delete set null,
  type text not null check (type in ('expense','revenue','money_sent')),
  category text not null,
  linked_item text,
  description text,
  payment_method text,
  qty numeric(10,2),
  amount_local numeric(10,2) not null default 0,
  currency text not null default 'LKR',
  entry_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists location_menus (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  category text not null,
  item_name text not null,
  price_local numeric(10,2) not null default 0,
  stock_qty integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists instructor_directory (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete cascade,
  name text not null,
  email text,
  rate numeric(10,2) default 0,
  payment_type text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists instructor_lessons (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  instructor_id uuid references instructor_directory(id) on delete set null,
  instructor_name text not null,
  lesson_date date not null,
  lesson_category text not null,
  num_lessons integer not null default 1,
  price_unit numeric(10,2) not null default 0,
  total numeric(10,2) generated always as (num_lessons * price_unit) stored,
  payment_type text,
  paid boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text,
  commission_pct numeric(5,2) not null default 0,
  collects_from_guest boolean not null default false,
  partner_type text not null default 'surfcamp',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  booking_ref text not null unique,
  booker text,
  check_in_on date,
  month_key text,
  total numeric(10,2) not null default 0,
  pax integer not null default 1,
  location text,
  package text,
  partner_name text,
  partner_id uuid references partners(id) on delete set null,
  booking_type text not null default 'direct',
  partner_commission_pct numeric(5,2) not null default 0,
  commission_amount numeric(10,2) not null default 0,
  net_amount numeric(10,2) not null default 0,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists partner_month_status (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  month_key text not null,
  status text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, month_key)
);

create index if not exists idx_bookings_check_in_on on bookings(check_in_on);
create index if not exists idx_bookings_month_key on bookings(month_key);
create index if not exists idx_bookings_partner_id on bookings(partner_id);
create index if not exists idx_partner_month_status_month_key on partner_month_status(month_key);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'viewer'
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.upsert_partner_month_status(
  p_partner_name text,
  p_month_key text,
  p_status text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
begin
  select id into v_partner_id
  from public.partners
  where lower(trim(name)) = lower(trim(p_partner_name))
  limit 1;

  if v_partner_id is null then
    raise exception 'Partner not found: %', p_partner_name;
  end if;

  insert into public.partner_month_status (partner_id, month_key, status, notes)
  values (v_partner_id, p_month_key, coalesce(p_status, ''), p_notes)
  on conflict (partner_id, month_key) do update
    set status = excluded.status,
        notes = excluded.notes,
        updated_at = now();
end;
$$;

insert into locations (slug, name) values
  ('sri-lanka', 'Sri Lanka'),
  ('morocco', 'Morocco'),
  ('portugal', 'Portugal'),
  ('junior-camp', 'Junior Camp')
on conflict (slug) do nothing;

insert into user_profiles (id, email, role)
select id, email, 'owner'
from auth.users
where email = 'miguel@gotadaguasurf.com'
on conflict (id) do update set role = 'owner', updated_at = now();

insert into workspace_access (user_id, location_id, workspace_key, can_view, can_edit)
select
  up.id,
  l.id,
  wk.workspace_key,
  true,
  true
from user_profiles up
cross join locations l
cross join (
  values
    ('hub'),
    ('camp-hub'),
    ('partners'),
    ('instructors'),
    ('settings')
) as wk(workspace_key)
where up.email = 'miguel@gotadaguasurf.com'
on conflict (user_id, location_id, workspace_key) do nothing;

alter table locations enable row level security;
alter table user_profiles enable row level security;
alter table workspace_access enable row level security;
alter table camp_weeks enable row level security;
alter table camp_guests enable row level security;
alter table camp_tab_items enable row level security;
alter table ledger_entries enable row level security;
alter table location_menus enable row level security;
alter table instructor_directory enable row level security;
alter table instructor_lessons enable row level security;
alter table partners enable row level security;
alter table bookings enable row level security;
alter table partner_month_status enable row level security;

drop policy if exists "locations_read_auth" on locations;
create policy "locations_read_auth" on locations for select to authenticated using (true);

drop policy if exists "profiles_read_auth" on user_profiles;
create policy "profiles_read_auth" on user_profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on user_profiles;
create policy "profiles_update_own" on user_profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "workspace_access_read_auth" on workspace_access;
create policy "workspace_access_read_auth" on workspace_access for select to authenticated using (true);

drop policy if exists "camp_weeks_all_auth" on camp_weeks;
create policy "camp_weeks_all_auth" on camp_weeks for all to authenticated using (true) with check (true);

drop policy if exists "camp_guests_all_auth" on camp_guests;
create policy "camp_guests_all_auth" on camp_guests for all to authenticated using (true) with check (true);

drop policy if exists "camp_tab_items_all_auth" on camp_tab_items;
create policy "camp_tab_items_all_auth" on camp_tab_items for all to authenticated using (true) with check (true);

drop policy if exists "ledger_entries_all_auth" on ledger_entries;
create policy "ledger_entries_all_auth" on ledger_entries for all to authenticated using (true) with check (true);

drop policy if exists "location_menus_all_auth" on location_menus;
create policy "location_menus_all_auth" on location_menus for all to authenticated using (true) with check (true);

drop policy if exists "instructor_directory_all_auth" on instructor_directory;
create policy "instructor_directory_all_auth" on instructor_directory for all to authenticated using (true) with check (true);

drop policy if exists "instructor_lessons_all_auth" on instructor_lessons;
create policy "instructor_lessons_all_auth" on instructor_lessons for all to authenticated using (true) with check (true);

drop policy if exists "partners_all_auth" on partners;
create policy "partners_all_auth" on partners for all to authenticated using (true) with check (true);

drop policy if exists "bookings_all_auth" on bookings;
create policy "bookings_all_auth" on bookings for all to authenticated using (true) with check (true);

drop policy if exists "partner_month_status_all_auth" on partner_month_status;
create policy "partner_month_status_all_auth" on partner_month_status for all to authenticated using (true) with check (true);
create extension if not exists "pgcrypto";

alter table public.camp_weeks
  add column if not exists closed_at timestamptz,
  add column if not exists draft_kind text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.camp_guests
  add column if not exists pax integer not null default 1,
  add column if not exists sort_order integer not null default 100,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.camp_tab_items
  add column if not exists price_type text,
  add column if not exists sort_order integer not null default 100,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.location_menus
  add column if not exists description text,
  add column if not exists staff_price_local numeric(10,2),
  add column if not exists sort_order integer not null default 100;

create table if not exists public.camp_staff_directory (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_camp_staff_directory_unique_name
on public.camp_staff_directory (location_id, lower(name));

alter table public.camp_staff_directory enable row level security;

drop policy if exists "camp_staff_directory_all_auth" on public.camp_staff_directory;
create policy "camp_staff_directory_all_auth"
on public.camp_staff_directory
for all
to authenticated
using (true)
with check (true);
create table if not exists public.location_state_store (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  state_key text not null,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (location_id, state_key)
);

create index if not exists idx_location_state_store_location_key
on public.location_state_store (location_id, state_key);

alter table public.location_state_store enable row level security;

drop policy if exists "location_state_store_all_auth" on public.location_state_store;
create policy "location_state_store_all_auth"
on public.location_state_store
for all
to authenticated
using (true)
with check (true);

-- Add index so camp-tab can efficiently delete ledger entries by week
-- Run this in Supabase SQL Editor after the main schema.sql

create index if not exists idx_ledger_entries_linked_item
on public.ledger_entries (location_id, linked_item)
where linked_item is not null;
