-- ════════════════════════════════════════════════════════════════════════════
--  camp_tab_items — audit trail (who added / who edited)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Adds created_by / updated_by / updated_at columns to camp_tab_items so
--  Miguel can see who added each item in the Camp POS. Triggers populate
--  the columns from auth.uid() on every INSERT/UPDATE — no client change
--  needed for the write path.
--
--  The Activity tab in camp-hub joins these columns with platform_profiles
--  to show human names ("Ayoub added Coke +MAD 25 to Maria at 14:03").
--
--  Same shape applied to camp_guests so we can also see who opened each
--  guest tab, which is the other half of the "who did what" question.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Columns ────────────────────────────────────────────────────────────
alter table public.camp_tab_items
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz;

alter table public.camp_guests
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz;

comment on column public.camp_tab_items.created_by is
  'auth.uid() of the staff member who added this item to a guest tab. Set by trigger fn_stamp_audit_camp_tab on INSERT.';
comment on column public.camp_tab_items.updated_by is
  'auth.uid() of the last staff member to edit this row. Set by trigger on UPDATE.';


-- ── 2. Trigger function — stamps created_by / updated_by / updated_at ─────
create or replace function public.fn_stamp_audit_camp_tab()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    -- Only stamp if the client hasn't already supplied one (imports may
    -- pre-fill created_by; we don't want to overwrite that with the
    -- auth.uid() of whoever ran the import).
    if NEW.created_by is null then
      NEW.created_by := auth.uid();
    end if;
    NEW.updated_by := coalesce(NEW.updated_by, auth.uid());
    NEW.updated_at := coalesce(NEW.updated_at, now());
  elsif TG_OP = 'UPDATE' then
    NEW.updated_by := auth.uid();
    NEW.updated_at := now();
    -- Preserve original created_by no matter what the client sends.
    NEW.created_by := OLD.created_by;
  end if;
  return NEW;
end $$;


-- ── 3. Wire the trigger to both tables ────────────────────────────────────
drop trigger if exists tr_stamp_audit_camp_tab_items on public.camp_tab_items;
create trigger tr_stamp_audit_camp_tab_items
  before insert or update on public.camp_tab_items
  for each row execute function public.fn_stamp_audit_camp_tab();

drop trigger if exists tr_stamp_audit_camp_guests on public.camp_guests;
create trigger tr_stamp_audit_camp_guests
  before insert or update on public.camp_guests
  for each row execute function public.fn_stamp_audit_camp_tab();


-- ── 4. Verification ───────────────────────────────────────────────────────
--
-- After running, insert a test item as a specific user and confirm the
-- audit columns fill:
--
--   -- Signed in as your own account in the app, add a test item to a
--   -- test guest, then in SQL Editor:
--   select id, item_name, price_local, created_by, updated_by, added_at,
--          updated_at, (select email from auth.users where id = created_by) as who
--   from public.camp_tab_items
--   order by added_at desc
--   limit 5;
--
--   You should see `who` = your email on the newest row.
-- ════════════════════════════════════════════════════════════════════════════
