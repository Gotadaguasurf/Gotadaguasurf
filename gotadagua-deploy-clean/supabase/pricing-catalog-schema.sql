-- ════════════════════════════════════════════════════════════════════════════
--  PRICING CATALOG — Phase 1 schema
-- ════════════════════════════════════════════════════════════════════════════
--
--  Adds two tables that back the new Pricing Catalog feature:
--
--    1. pricing_catalog        — every price entry (Tour / Transport /
--                                Surf Pack / Accommodation / Per Night /
--                                Lesson / Other Service) per location.
--                                Master record for sell + cost prices.
--
--    2. pricing_access         — per-email permission rows so the owner
--                                can grant view-only / view-costs /
--                                edit access to specific people without
--                                relying on platform_role.
--
--  How to apply:
--    Paste this whole file into Supabase SQL Editor and run.
--    Idempotent — safe to re-run.
--
--  How to undo (only if needed):
--    drop table if exists public.pricing_access cascade;
--    drop table if exists public.pricing_catalog cascade;
--
--  No existing tables are touched. Ledger / bookings / camp_weeks /
--  monthly_cost_profiles / partners / etc. all stay exactly as they are.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. pricing_catalog table ────────────────────────────────────────────────

create table if not exists public.pricing_catalog (
  id                          uuid          primary key default gen_random_uuid(),
  location_id                 uuid          not null references public.locations(id) on delete cascade,
  name                        text          not null,
  category                    text          not null default 'Tour',
    -- Tour / Transport / Surf Pack / Accommodation / Per Night /
    -- Lesson / Other Service
  audience                    text          not null default 'general',
    -- general (per-guest) / group (fixed amount per booking)
  sell_price                  numeric(12,2) not null default 0,
  cost_per_guest              numeric(12,2) not null default 0,
  currency                    text          not null default 'EUR',
    -- LKR / MAD / EUR (or any future location currency)
  linked_transport_preset_id  text,
    -- Optional reference to a transport_presets entry (name match)
    -- so the catalog can compute transport-split margin per tour.
    -- Not enforced as FK — transport_presets live in
    -- location_state_store JSON, not a relational table.
  linked_camp_tab_id          text,
    -- Optional reference to a Camp Tab menu item (matched by name
    -- on the camp-tab side). Future phases will use this to keep
    -- Camp Tab menus in sync with the catalog.
  show_in_camp_tab            boolean       not null default false,
    -- Whether the Camp Tab Tours menu should surface this item
    -- (future phase 4 reads this flag).
  show_in_transport_picker    boolean       not null default false,
    -- Whether the Hub Transport quick-add picker should surface this
    -- item (future phase 3 reads this flag).
  notes                       text,
  active                      boolean       not null default true,
  sort_order                  integer       not null default 100,
  created_at                  timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now()
);

create index if not exists idx_pricing_catalog_location  on public.pricing_catalog(location_id);
create index if not exists idx_pricing_catalog_category  on public.pricing_catalog(location_id, category);
create index if not exists idx_pricing_catalog_active    on public.pricing_catalog(location_id, active);

-- Auto-bump updated_at on every row update
create or replace function public.pricing_catalog_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists pricing_catalog_touch_trigger on public.pricing_catalog;
create trigger pricing_catalog_touch_trigger
  before update on public.pricing_catalog
  for each row execute function public.pricing_catalog_touch();

-- ── 2. pricing_access table ─────────────────────────────────────────────────

create table if not exists public.pricing_access (
  id                uuid        primary key default gen_random_uuid(),
  user_email        text        not null,
  location_id       uuid        references public.locations(id) on delete cascade,
    -- NULL = applies to ALL locations (handy for an owner-equivalent
    -- collaborator who should see everything).
  can_view_sell     boolean     not null default true,
  can_view_costs    boolean     not null default false,
  can_edit          boolean     not null default false,
  invited_by        uuid,
    -- references platform_profiles.id of whoever granted the access.
    -- Not enforced as FK to avoid coupling to that table here.
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_email, location_id)
);

create index if not exists idx_pricing_access_email      on public.pricing_access(lower(user_email));
create index if not exists idx_pricing_access_location   on public.pricing_access(location_id);

drop trigger if exists pricing_access_touch_trigger on public.pricing_access;
create or replace function public.pricing_access_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger pricing_access_touch_trigger
  before update on public.pricing_access
  for each row execute function public.pricing_access_touch();

-- ── 3. Row-Level Security ───────────────────────────────────────────────────
--
--  Phase 1 policy is intentionally permissive for any authenticated user:
--  every signed-in user can read/write the catalog. Granular per-email
--  enforcement happens client-side via the pricing_access table.
--
--  When phase 4 (per-email access UI) lands, we'll tighten these
--  policies to consult pricing_access.* and platform_profiles.platform_role.

alter table public.pricing_catalog enable row level security;
alter table public.pricing_access  enable row level security;

drop policy if exists pricing_catalog_select on public.pricing_catalog;
drop policy if exists pricing_catalog_modify on public.pricing_catalog;
create policy pricing_catalog_select on public.pricing_catalog
  for select to authenticated using (true);
create policy pricing_catalog_modify on public.pricing_catalog
  for all to authenticated using (true) with check (true);

drop policy if exists pricing_access_select on public.pricing_access;
drop policy if exists pricing_access_modify on public.pricing_access;
create policy pricing_access_select on public.pricing_access
  for select to authenticated using (true);
create policy pricing_access_modify on public.pricing_access
  for all to authenticated using (true) with check (true);

-- ── 4. Realtime publication ─────────────────────────────────────────────────
--
--  Add the new tables to supabase_realtime so cross-PC live sync works
--  out of the box. (Same approach as ledger_entries, location_state_store,
--  daily_fx_rates.)

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pricing_catalog'
  ) then
    execute 'alter publication supabase_realtime add table public.pricing_catalog';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pricing_access'
  ) then
    execute 'alter publication supabase_realtime add table public.pricing_access';
  end if;
end $$;

-- ── 5. Verify ───────────────────────────────────────────────────────────────
--  Returns a row per table confirming the schema landed and is empty.

select 'pricing_catalog' as table_name, count(*) as row_count from public.pricing_catalog
union all
select 'pricing_access',                count(*)              from public.pricing_access;
