-- ════════════════════════════════════════════════════════════════════════════
--  FIX upsert_partner_month_status — auto-create partner if missing
-- ════════════════════════════════════════════════════════════════════════════
--
--  Symptom: clicking "Paid" / "Pending" / etc. on a partner row in the
--  Partners app fired "Could not save the status to Supabase. Partner not
--  found: <NAME>".
--
--  Root cause: the RPC threw an exception when no row existed in
--  public.partners with that name. Bookings are imported with partner name
--  as free text and don't auto-create partner rows, so the partners table
--  was empty for any name that wasn't manually added via the Partners &
--  Rates editor.
--
--  Fix: if no partner row matches, insert a default one (active, 0%
--  commission, surfcamp type) using the provided name, then proceed with
--  the upsert as before. The user can adjust commission / type later via
--  Partners & Rates — the row just needs to exist so we can attach
--  monthly status to it.
--
--  Idempotent. Safe to re-run.
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

  -- Look up existing partner (case-insensitive).
  select id into v_partner_id
  from public.partners
  where lower(trim(name)) = lower(v_clean_name)
  limit 1;

  -- Auto-create on first reference. The user can refine commission %,
  -- type, email later via the Partners & Rates editor — we just need a
  -- row to attach monthly status to.
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
