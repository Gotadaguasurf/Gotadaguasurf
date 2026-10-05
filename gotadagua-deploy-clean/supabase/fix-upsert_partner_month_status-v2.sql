-- ════════════════════════════════════════════════════════════════════════════
--  upsert_partner_month_status v2 — pick the right partner when two rows
--  only differ by case
-- ════════════════════════════════════════════════════════════════════════════
--
--  Symptom (5 Oct 2026): setting a month status on "The Surf Tribe" looked
--  like it never saved. It did save, but on "THE SURF TRIBE", a duplicate
--  partner row created by a Connect import. The lookup was
--  lower(name) = lower(p_partner_name) LIMIT 1 with no ORDER BY, so either
--  row could win; the app then read the status under the other spelling.
--
--  Fix: prefer the exact spelling, then active rows, then the row with
--  bookings, then the oldest. Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

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

  select p.id into v_partner_id
  from public.partners p
  where lower(trim(p.name)) = lower(v_clean_name)
  order by (trim(p.name) = v_clean_name) desc,
           p.is_active desc,
           (select count(*) from public.bookings b where b.partner_id = p.id) desc,
           p.created_at asc
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
        notes      = excluded.notes,
        updated_at = now();
end;
$$;

-- Status label rename (app ≥ 5 Oct 2026 reads "Overview Sent"; it still
-- understands "PDF Sent" from older rows, so this is cosmetic):
-- update public.partner_month_status set status = 'Overview Sent' where status = 'PDF Sent';
