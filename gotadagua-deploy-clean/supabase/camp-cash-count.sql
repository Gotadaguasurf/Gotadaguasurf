-- ════════════════════════════════════════════════════════════════════════════
--  Camp cash count (Sri Lanka Phase 1, 13 Nov 2026)
--
--  Every evening the local manager (Nadith) counts the camp cash — bar box +
--  pocket/office — and declares cash taken from the ATM after the last bank
--  statement in the app. The hub shows Counted vs Expected (the ledger's cash
--  rule, ledgerDrawerDelta in camp-hub/index.html, up to the count day).
--  Francisco or Miguel then SETTLE the count: within the tolerance it closes
--  with no row; otherwise ONE adjustment row is posted in the ledger:
--    money_sent · method 'Cash' (more cash) or 'Cash Out' (less cash)
--    · category 'Cash count' · source_kind 'cash_count'
--  A transfer, so it is not a P&L expense.
--
--  NOT RUN against production by the build agent. Run it once, after Miguel's
--  OK, in the SQL editor. Idempotent (create if not exists / or replace).
--  The checks at the bottom are SELECT only.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.camp_cash_counts (
  id                            uuid primary key default gen_random_uuid(),
  location_id                   uuid not null references public.locations(id) on delete cascade,
  -- Colombo date as entered (never derived through UTC).
  count_date                    date not null,
  bar_box                       numeric not null default 0 check (bar_box >= 0),
  pocket                        numeric not null default 0 check (pocket >= 0),
  counted_total                 numeric generated always as (bar_box + pocket) stored,
  -- Cash taken from the ATM after the statement date, not in the app yet.
  -- Stored here only, never written as a ledger row (withdrawals come from
  -- the bank statement).
  declared_unloaded_withdrawals numeric not null default 0 check (declared_unloaded_withdrawals >= 0),
  -- «The bank statement in the app goes up to …» when the count was saved
  -- (last ATM Withdrawal row dated on or before the count day). Real
  -- withdrawals later loaded in (statement_through, count_date] are taken
  -- off the declared figure — otherwise a statement loaded between the count
  -- and the settle would count them twice (see camp_cash_settle).
  statement_through             date,
  expected_at_save              numeric,          -- what the manager's screen showed (history only)
  reason                        text check (reason is null or reason in ('payments_not_entered','revenue_not_entered','unknown')),
  note                          text,
  status                        text not null default 'open' check (status in ('open','settled')),
  settled_expected              numeric,
  settled_difference            numeric,
  settle_note                   text,
  settled_by                    uuid,
  settled_at                    timestamptz,
  adjustment_entry_id           uuid references public.ledger_entries(id) on delete set null,
  created_by                    uuid default auth.uid(),
  created_at                    timestamptz not null default now()
);
create index if not exists camp_cash_counts_loc_date on public.camp_cash_counts (location_id, count_date desc, created_at desc);

-- ── Settings (constants Miguel may change) ─────────────────────────────────
-- Difference up to this many local units closes a count with no ledger row.
create or replace function public.camp_cash_tolerance()
returns numeric language sql immutable as $$ select 1000::numeric $$;

-- ── The cash rule, SQL copy of the cash half of ledgerDrawerDelta ──────────
-- camp-hub/index.html ledgerDrawerDelta (one rule for every Bank/Cash figure):
--   expense : HQ Paid / hq_invoice → 0 · Cash → −1 · anything else → 0
--   revenue : Card / Bank Transfer → 0 (bank) · anything else → +1
--   transfer: ATM Withdrawal +1 · Cash (into cash) +1 · Cash Deposit −1 · Cash Out −1
-- Pinned by check 1 below (the camp-cash.spec.js fixture → 113,500) and by the
-- live check 2 (= the hub's Cash tile).
create or replace function public.camp_cash_delta(p_type text, p_method text, p_source_kind text)
returns integer language sql immutable as $$
  select case
    when p_type = 'expense' then
      case when lower(coalesce(p_source_kind,'')) = 'hq_invoice' or p_method = 'HQ Paid' then 0
           when p_method = 'Cash' then -1 else 0 end
    when p_type = 'revenue' then
      case when p_method in ('Card','Bank Transfer') then 0 else 1 end
    when p_type = 'money_sent' then
      case p_method when 'ATM Withdrawal' then 1 when 'Cash' then 1
                    when 'Cash Deposit' then -1 when 'Cash Out' then -1 else 0 end
    else 0 end
$$;

-- Cash balance of a camp from every ledger row dated on or before p_through.
-- Amounts in local currency (EUR-recorded rows at their own rate; on 13 Nov
-- 2026 the only EUR rows in Sri Lanka are HQ Paid, which move no cash).
-- Invoker rights: a direct caller only sums the rows RLS lets them read.
create or replace function public.camp_cash_balance(p_location uuid, p_through date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(
           public.camp_cash_delta(e.type, e.payment_method, e.source_kind)
           * case when coalesce(e.currency,'') <> 'EUR' then coalesce(e.amount_local,0)
                  else coalesce(e.amount_eur,0) * coalesce(e.fx_rate,0) end), 0)
    from public.ledger_entries e
   where e.location_id = p_location and e.entry_date <= p_through
$$;

-- ── Guard: status 'settled' only through camp_cash_settle ──────────────────
create or replace function public.fn_camp_cash_counts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.status <> 'open' or new.adjustment_entry_id is not null or new.settled_at is not null then
      raise exception 'A new count is always open' using errcode = '42501';
    end if;
  elsif TG_OP = 'UPDATE' then
    new.created_by := old.created_by;
    if coalesce(current_setting('camp_cash.settling', true), '') <> 'on' and (
         new.status is distinct from old.status
      or new.adjustment_entry_id is distinct from old.adjustment_entry_id
      or new.settled_expected is distinct from old.settled_expected
      or new.settled_difference is distinct from old.settled_difference) then
      raise exception 'A count is settled with «Settle» (camp_cash_settle)' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tr_camp_cash_counts_guard on public.camp_cash_counts;
create trigger tr_camp_cash_counts_guard before insert or update on public.camp_cash_counts
  for each row execute function public.fn_camp_cash_counts_guard();

-- ── RLS: the local manager counts and reads his camp; full users settle ────
alter table public.camp_cash_counts enable row level security;

drop policy if exists camp_cash_counts_select on public.camp_cash_counts;
create policy camp_cash_counts_select on public.camp_cash_counts for select using (
  public.has_location_access(location_id) or public.is_hq_member()
);
drop policy if exists camp_cash_counts_insert on public.camp_cash_counts;
create policy camp_cash_counts_insert on public.camp_cash_counts for insert with check (
  public.has_full_location_access(location_id)
  and status = 'open' and adjustment_entry_id is null and settled_at is null and settled_by is null
);
drop policy if exists camp_cash_counts_update on public.camp_cash_counts;
create policy camp_cash_counts_update on public.camp_cash_counts for update using (
  public.has_full_location_access(location_id) and not public.is_local_manager(location_id)
) with check (
  public.has_full_location_access(location_id) and not public.is_local_manager(location_id)
);
drop policy if exists camp_cash_counts_delete on public.camp_cash_counts;
create policy camp_cash_counts_delete on public.camp_cash_counts for delete using (
  public.has_full_location_access(location_id) and not public.is_local_manager(location_id)
);

-- ── The adjustment row is not the local manager's to forge, edit or delete ─
-- The live restrictive policies ledger_local_no_bank_lines_* still let him
-- write money_sent «Cash Out» rows (a loan to staff), which is exactly what a
-- shortage adjustment is. These close that for source_kind 'cash_count'.
drop policy if exists ledger_local_no_cash_count_insert on public.ledger_entries;
create policy ledger_local_no_cash_count_insert on public.ledger_entries as restrictive for insert with check (
  not (public.is_local_manager(location_id) and coalesce(source_kind,'') = 'cash_count')
);
drop policy if exists ledger_local_no_cash_count_update on public.ledger_entries;
create policy ledger_local_no_cash_count_update on public.ledger_entries as restrictive for update using (
  not (public.is_local_manager(location_id) and coalesce(source_kind,'') = 'cash_count')
) with check (
  not (public.is_local_manager(location_id) and coalesce(source_kind,'') = 'cash_count')
);
drop policy if exists ledger_local_no_cash_count_delete on public.ledger_entries;
create policy ledger_local_no_cash_count_delete on public.ledger_entries as restrictive for delete using (
  not (public.is_local_manager(location_id) and coalesce(source_kind,'') = 'cash_count')
);

-- ── RPC: settle a count ────────────────────────────────────────────────────
-- Expected = cash rule up to count_date + the declared unloaded withdrawals
-- that the statement hasn't brought yet:
--   real    = ATM Withdrawal rows dated in (statement_through, count_date]
--   covered = an ATM Withdrawal row dated after count_date exists
--   declared used = covered ? 0 : greatest(declared − real, 0)
-- (same rule as expectedFor in camp-hub/cash-count.js). A statement loaded
-- only part of the way never drops the part still missing.
-- |difference| ≤ tolerance → settled, no row.
-- Returns {status, expected, difference, declared_used, real_withdrawals,
--          adjustment: <ledger row as json> | null}.
create or replace function public.camp_cash_settle(p_count uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  if abs(v_diff) > public.camp_cash_tolerance() then
    v_fx  := coalesce(nullif(loc.default_fx_to_eur, 0), 1);
    select split_part(coalesce(u.email, ''), '@', 1) into v_who from auth.users u where u.id = auth.uid();
    v_desc := format('Cash count %s · counted %s · expected %s · settled by %s',
                     to_char(c.count_date, 'FMDD Mon'),
                     to_char(c.counted_total, 'FM999,999,999,990.00'),
                     to_char(v_exp, 'FM999,999,999,990.00'),
                     coalesce(nullif(v_who, ''), 'HQ'));
    if coalesce(nullif(trim(p_note), ''), '') <> '' then v_desc := v_desc || ' · ' || trim(p_note); end if;
    insert into public.ledger_entries
      (location_id, type, category, description, payment_method, qty, amount_local, currency,
       entry_date, business_area, fx_rate, amount_eur, source_kind, paid_from, attributed_location, created_by)
    values
      (c.location_id, 'money_sent', 'Cash count', v_desc, case when v_diff > 0 then 'Cash' else 'Cash Out' end, 1,
       abs(v_diff), coalesce(loc.currency, 'LKR'), c.count_date, 'General', v_fx, round(abs(v_diff) / v_fx, 2),
       'cash_count', loc.slug, loc.slug, auth.uid())
    returning * into v_row;
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
end $$;

revoke all on function public.camp_cash_settle(uuid, text) from public;
grant execute on function public.camp_cash_settle(uuid, text) to authenticated;
grant execute on function public.camp_cash_balance(uuid, date) to authenticated;
grant select, insert, update, delete on public.camp_cash_counts to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. The SQL rule against the browser test fixture (tests/camp-cash.spec.js,
--    EXPECTED_CASH = 113,500). Must return 113500.
-- select sum(public.camp_cash_delta(t, m, s) * a) as cash
--   from (values ('money_sent','HQ Transfer','hq_transfer',1000000), ('money_sent','Cash Deposit','manual',10000),
--                ('expense','Bank Transfer','manual',100000), ('expense','Card','manual',20000),
--                ('money_sent','Bank Transfer','manual',50000), ('money_sent','Cash','manual',50000),
--                ('money_sent','ATM Withdrawal','manual',5000), ('money_sent','Bank Transfer','manual',30000),
--                ('revenue','Card','manual',7000), ('revenue','Bank Transfer','manual',3000),
--                ('revenue','Cash','manual',4000), ('revenue','Cash','camp_tab_per_item',2500),
--                ('expense','Cash','manual',12000), ('money_sent','Cash Out','manual',6000),
--                ('expense','HQ Paid','hq_invoice',30000), ('expense','HQ Paid','manual',40000),
--                ('expense','Loan offset','manual',20000), ('money_sent','Cash','manual',80000)) v(t, m, s, a);
--
-- 2. Live: equals the hub's Cash tile (364,403.74 on 13 Nov 2026 with 1,839 rows).
-- select public.camp_cash_balance(id, '2999-12-31') from public.locations where slug = 'sri-lanka';
--
-- 3. Objects exist.
-- select (select count(*) from pg_policies where tablename = 'camp_cash_counts') as count_policies,     -- 4
--        (select count(*) from pg_policies where policyname like 'ledger_local_no_cash_count_%') as ledger_policies, -- 3
--        to_regprocedure('public.camp_cash_settle(uuid,text)') is not null as settle_rpc;
--
-- 4. Counts so far.
-- select count_date, counted_total, expected_at_save, status, settled_difference, adjustment_entry_id
--   from public.camp_cash_counts order by count_date desc, created_at desc limit 20;
