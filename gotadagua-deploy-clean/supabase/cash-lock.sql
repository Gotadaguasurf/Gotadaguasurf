-- ════════════════════════════════════════════════════════════════════════════
--  Cash lock (Sri Lanka, 16 Nov 2026 — Miguel: «esta tem de estar lock… ninguém pode mudar o cash na app,
--  tem de ser só com as expenses / revenues»). Idempotent. Rollback at the bottom.
--
--  1. Cash count lines (source_kind 'cash_count', e.g. the fresh start of 16 Nov, -493,581.74) are locked:
--     no new ones, and no edit of what moves money (type, method, amount, currency, date, camp, category,
--     description, source) nor delete — for everyone, HQ included. Other columns (fx, EUR, business area)
--     stay editable so bulk fixes keep working.
--  2. camp_cash_settle never writes an adjustment any more: within the tolerance (1,000) it closes the
--     count; above it, it refuses — the missing expenses / revenues must be entered first.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_ledger_cash_count_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source_kind = 'cash_count' or new.category = 'Cash count' then
      raise exception 'Cash count lines can''t be added: only expenses, revenues, withdrawals and transfers change the cash' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.source_kind = 'cash_count' then
    if tg_op = 'DELETE' then
      raise exception 'Cash count lines are locked' using errcode = '42501';
    end if;
    if (new.type, new.payment_method, new.amount_local, new.currency, new.entry_date, new.location_id, new.category, new.description, new.source_kind)
       is distinct from
       (old.type, old.payment_method, old.amount_local, old.currency, old.entry_date, old.location_id, old.category, old.description, old.source_kind) then
      raise exception 'Cash count lines are locked' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and (new.source_kind = 'cash_count' or (new.category = 'Cash count' and old.category is distinct from 'Cash count')) then
    raise exception 'A line can''t become a cash count line' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists tr_ledger_cash_count_lock on public.ledger_entries;
create trigger tr_ledger_cash_count_lock before insert or update or delete on public.ledger_entries
  for each row execute function public.fn_ledger_cash_count_lock();

CREATE OR REPLACE FUNCTION public.camp_cash_settle(p_count uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c        public.camp_cash_counts;
  loc      public.locations;
  v_bal    numeric;
  v_real   numeric;
  v_cov    boolean;
  v_decl   numeric;
  v_exp    numeric;
  v_diff   numeric;
  v_fx     numeric;
  v_who    text;
  v_row    public.ledger_entries;
  v_desc   text;
begin
  -- Lock the count: a double tap can never post two rows.
  select * into c from public.camp_cash_counts where id = p_count for update;
  if not found then
    raise exception 'Count not found' using errcode = 'P0002';
  end if;
  if not public.has_full_location_access(c.location_id) or public.is_local_manager(c.location_id) then
    raise exception 'Only Francisco or Miguel can settle a count' using errcode = '42501';
  end if;
  if c.status <> 'open' then
    raise exception 'This count is already settled' using errcode = 'P0001';
  end if;
  -- A later settled count already absorbed everything up to its day.
  if exists (select 1 from public.camp_cash_counts o
              where o.location_id = c.location_id and o.status = 'settled' and o.id <> c.id
                and (o.count_date, o.created_at) > (c.count_date, c.created_at)) then
    raise exception 'A later count is already settled' using errcode = 'P0001';
  end if;

  select * into loc from public.locations where id = c.location_id;

  v_bal := public.camp_cash_balance(c.location_id, c.count_date);
  select coalesce(sum(e.amount_local), 0) into v_real
    from public.ledger_entries e
   where e.location_id = c.location_id and e.type = 'money_sent' and e.payment_method = 'ATM Withdrawal'
     and e.entry_date > coalesce(c.statement_through, '-infinity'::date) and e.entry_date <= c.count_date;
  select exists (select 1 from public.ledger_entries e
                  where e.location_id = c.location_id and e.type = 'money_sent' and e.payment_method = 'ATM Withdrawal'
                    and e.entry_date > c.count_date) into v_cov;
  v_decl := case when v_cov then 0 else greatest(coalesce(c.declared_unloaded_withdrawals, 0) - v_real, 0) end;
  v_exp  := round(v_bal + v_decl, 2);
  v_diff := round(c.counted_total - v_exp, 2);

  -- 16 Nov 2026 (Miguel): a count never changes the cash. Only expenses, revenues, withdrawals and transfers
  -- move it, so a difference above the tolerance is refused until the missing lines are entered.
  if abs(v_diff) > public.camp_cash_tolerance() then
    raise exception 'Can''t settle: the cash is % % than the app. A count never changes the cash: enter the missing expenses or revenues first.',
      to_char(abs(v_diff), 'FM999,999,999,990.00'), case when v_diff < 0 then 'less' else 'more' end using errcode = 'P0001';
  end if;

  perform set_config('camp_cash.settling', 'on', true);
  update public.camp_cash_counts
     set status = 'settled', settled_expected = v_exp, settled_difference = v_diff,
         settle_note = nullif(trim(coalesce(p_note, '')), ''), settled_by = auth.uid(), settled_at = now(),
         adjustment_entry_id = v_row.id
   where id = c.id;
  perform set_config('camp_cash.settling', '', true);

  return jsonb_build_object(
    'status', 'settled', 'expected', v_exp, 'difference', v_diff,
    'declared_used', v_decl, 'real_withdrawals', v_real,
    'adjustment', case when v_row.id is null then null else to_jsonb(v_row) end);
end $function$;

-- ── Checks (SELECT only) ─────────────────────────────────────────────────────
-- select tgname from pg_trigger where tgname = 'tr_ledger_cash_count_lock';
-- select public.camp_cash_balance(id, '2999-12-31') from public.locations where slug = 'sri-lanka';   -- 128,900 on 16 Nov

-- ── Rollback ────────────────────────────────────────────────────────────────
-- drop trigger if exists tr_ledger_cash_count_lock on public.ledger_entries;
-- drop function if exists public.fn_ledger_cash_count_lock();
-- then re-run the camp_cash_settle definition backed up in scratchpad bak/camp_cash_settle_before_lock_2026-11-16.sql
