-- ═══════════════════════════════════════════════════════════════════════════
-- Audit 18 Nov 2026 — wave 4 (camps: camp hub, Camp Tab, Week, Transport, imports)
-- ═══════════════════════════════════════════════════════════════════════════
-- Miguel runs this file by hand in the Supabase SQL editor, after reading it.
-- It is idempotent (create or replace / if not exists). The pages work before and after it runs.
--
-- PART A — schema: run as it is.
-- PART B — data corrections: every statement is COMMENTED OUT. Each one carries the count a read-only SELECT gave on
--          18 Nov 2026; run the SELECT again, and only if the count is the same, uncomment and run the change.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── PART A1 · CH-20: the «line comes from HQ» refusal in English ───────────────
-- The live trigger function (pg_get_functiondef, 18 Nov 2026) raised a Portuguese message that the camp hub puts in
-- its toast. Same body, same errcode 42501, English text. Nothing else changes (not security definer, as live).
create or replace function public.fn_ledger_mirror_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.hq_mirror', true),'') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.hq_invoice_id is not null or old.internal_transfer_id is not null then
      raise exception 'This line comes from HQ (invoice or transfer). Change or archive it in HQ, not here.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.hq_invoice_id is not null or new.hq_invoice_id is not null or old.internal_transfer_id is not null or new.internal_transfer_id is not null then
    raise exception 'This line comes from HQ (invoice or transfer). Change or archive it in HQ, not here.' using errcode = '42501';
  end if;
  return new;
end $function$;
-- (the triggers that call it are unchanged; supabase/hq-invoices-mirror-to-ledger.sql and
--  supabase/internal-transfers-mirror-to-ledger.sql still hold the Portuguese copy — re-running them brings it back.)
