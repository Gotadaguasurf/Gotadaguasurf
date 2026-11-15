-- ════════════════════════════════════════════════════════════════════════════
--  Dipløria — its own expenses list (Miguel, 15 Nov 2026: «depois ter as despesas»)
--
--  Dipløria is a separate business, like The Suk / Manjar: its costs do NOT go into hq_invoices (that is
--  Water's HQ, its P&L, Month close and the accountant pack). No existing table fits (checked 15 Nov:
--  only hq_recurring_expenses, also Water's), so this is a minimal table of its own:
--    date · supplier · description · category · amount + currency · camp (optional) · file link · note
--  Categories: production, shipping (to the camps), marketing, samples, fees, other.
--  Soft delete (deleted_at), like the HQ rows; no hard delete from the app.
--
--  /diploria/ → Expenses: list + add/edit form, and the summary «sales − expenses = margin» per period.
--  Read: is_diploria_member(); add/edit: is_diploria_editor(). Needs supabase/diploria-area.sql first.
--  Idempotent. NOT run by the agent. Run order: 3 of 3.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.diploria_expenses (
  id           uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  supplier     text not null default '',
  description  text not null default '',
  category     text not null default 'other',
  amount       numeric(12,2) not null,
  currency     text not null default 'EUR',
  location_id  uuid references public.locations(id) on delete set null,
  file_url     text,
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint diploria_expenses_category check (category in ('production','shipping','marketing','samples','fees','other')),
  constraint diploria_expenses_amount check (amount >= 0),
  constraint diploria_expenses_currency check (currency ~ '^[A-Z]{3}$'),
  constraint diploria_expenses_file check (file_url is null or file_url ~* '^https?://')
);
create index if not exists diploria_expenses_date_idx on public.diploria_expenses (expense_date desc) where deleted_at is null;

create or replace function public.diploria_expenses_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists diploria_expenses_touch on public.diploria_expenses;
create trigger diploria_expenses_touch before insert or update on public.diploria_expenses for each row execute function public.diploria_expenses_touch();

alter table public.diploria_expenses enable row level security;
revoke all on public.diploria_expenses from anon, authenticated;
grant select, insert, update on public.diploria_expenses to authenticated;
drop policy if exists diploria_expenses_select on public.diploria_expenses;
create policy diploria_expenses_select on public.diploria_expenses for select to authenticated using (public.is_diploria_member());
drop policy if exists diploria_expenses_insert on public.diploria_expenses;
create policy diploria_expenses_insert on public.diploria_expenses for insert to authenticated with check (public.is_diploria_editor());
drop policy if exists diploria_expenses_update on public.diploria_expenses;
create policy diploria_expenses_update on public.diploria_expenses for update to authenticated using (public.is_diploria_editor()) with check (public.is_diploria_editor());

commit;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select policyname, cmd from pg_policies where tablename = 'diploria_expenses' order by 1;   -- 3 rows (select, insert, update)
-- select count(*) from public.diploria_expenses;                                                -- 0 to start
