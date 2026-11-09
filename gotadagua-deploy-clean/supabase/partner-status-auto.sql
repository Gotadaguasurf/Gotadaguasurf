-- Partner month status moves forward on its own (Miguel, 9 Nov 2026:
-- «estas coisas têm de ser automáticas… está lá overview sent e já
-- enviámos os invoices»).
--
-- 1. partner_status_rank(): '' / Pending < Overview Sent < Confirmed <
--    Invoice Sent < Paid.
-- 2. advance_partner_month_status(): like upsert_partner_month_status but
--    only ever moves the status FORWARD and never wipes the notes. Used by
--    the automatic marks (opening the statement email, invoices, agents),
--    so a stale browser tab can no longer push a Confirmed month back to
--    Overview Sent (happened to KILROY 2026-10 on 9 Nov 2026).
-- 3. upsert_partner_month_status() (the manual dropdown) keeps the notes
--    when it is called without notes (p_notes null) instead of erasing them.
-- 4. Trigger: a new row in partner_invoices moves that partner/month to
--    «Invoice Sent» (unless it is already Paid).
-- 5. Backfill for 2026-10 (KILROY, Solid).

create or replace function public.partner_status_rank(p_status text)
returns int language sql immutable as $$
  select case coalesce(p_status, '')
    when 'Paid' then 4
    when 'Invoice Sent' then 3
    when 'Confirmed' then 2
    when 'Overview Sent' then 1
    when 'PDF Sent' then 1
    else 0 end
$$;

create or replace function public.advance_partner_month_status(
  p_partner_name text,
  p_month_key    text,
  p_status       text,
  p_notes        text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
  v_current    text;
begin
  select id into v_partner_id from public.partners
   where lower(trim(name)) = lower(trim(p_partner_name)) limit 1;
  if v_partner_id is null then
    raise exception 'unknown partner %', p_partner_name;
  end if;

  select status into v_current from public.partner_month_status
   where partner_id = v_partner_id and month_key = p_month_key;

  if public.partner_status_rank(p_status) <= public.partner_status_rank(v_current) then
    return coalesce(v_current, '');
  end if;

  insert into public.partner_month_status (partner_id, month_key, status, notes)
  values (v_partner_id, p_month_key, p_status, p_notes)
  on conflict (partner_id, month_key) do update
    set status     = excluded.status,
        notes      = case
                       when excluded.notes is null or excluded.notes = '' then partner_month_status.notes
                       when coalesce(partner_month_status.notes, '') = '' then excluded.notes
                       else partner_month_status.notes || E'\n' || excluded.notes
                     end,
        updated_at = now();
  return p_status;
end;
$$;

grant execute on function public.advance_partner_month_status(text, text, text, text) to authenticated;
grant execute on function public.partner_status_rank(text) to authenticated;

-- Manual dropdown: same as before, but a call without notes keeps them.
create or replace function public.upsert_partner_month_status(
  p_partner_name text,
  p_month_key    text,
  p_status       text,
  p_notes        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
  v_clean_name text := trim(p_partner_name);
begin
  if v_clean_name = '' or v_clean_name is null then
    raise exception 'partner name is required';
  end if;

  select id into v_partner_id
  from public.partners
  where lower(trim(name)) = lower(v_clean_name)
  limit 1;

  if v_partner_id is null then
    insert into public.partners (name, commission_pct, partner_type, is_active)
    values (v_clean_name, 0, 'surfcamp', true)
    on conflict (name) do update set is_active = true, updated_at = now()
    returning id into v_partner_id;
  end if;

  insert into public.partner_month_status (partner_id, month_key, status, notes)
  values (v_partner_id, p_month_key, coalesce(p_status, ''), p_notes)
  on conflict (partner_id, month_key) do update
    set status     = excluded.status,
        notes      = coalesce(excluded.notes, partner_month_status.notes),
        updated_at = now();
end;
$$;

-- New invoice row → month «Invoice Sent».
create or replace function public.partner_invoices_advance_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.month_key !~ '^\d{4}-\d{2}$' then
    return new;
  end if;
  select name into v_name from public.partners where id = new.partner_id;
  if v_name is null then
    select name into v_name from public.partners
     where lower(trim(name)) = lower(trim(new.partner_name)) limit 1;
  end if;
  if v_name is not null then
    perform public.advance_partner_month_status(
      v_name, new.month_key, 'Invoice Sent',
      '[' || to_char(now(), 'DD Mon YYYY') || '] invoice ' || new.invoice_number || ' (automatic)');
  end if;
  return new;
end;
$$;

drop trigger if exists partner_invoices_advance_status on public.partner_invoices;
create trigger partner_invoices_advance_status
  after insert on public.partner_invoices
  for each row execute function public.partner_invoices_advance_status();

-- Backfill October 2026.
select public.advance_partner_month_status('KILROY', '2026-10', 'Invoice Sent',
  '[9 Nov 2026] KILROY: «All good – please issue invoice». 2026-1369 Nieuwenhuis Netherlands → Norway. 7 invoices FT IN2/17645–17651 (8.484,80) sent from accounting@ 9 Nov 10:19.');
select public.advance_partner_month_status('SOLID SURF HOUSE CAPARICA', '2026-10', 'Invoice Sent',
  '[9 Nov 2026] Stefania: «Yes, all correct!». Invoice FT IN2/17653 (7.846,40).');
