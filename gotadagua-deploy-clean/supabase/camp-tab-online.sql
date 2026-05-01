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
