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
