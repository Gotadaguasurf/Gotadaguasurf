-- Audit 18 Nov 2026, wave 4 — Partners, The Suk, Wild Wednesday, Dipløria.
-- Idempotent. Run once in the SQL editor. The pages work before and after it.
--
-- Part 1 (schema) runs as is. Part 2 (data corrections) is COMMENTED OUT: each
-- statement carries the count a read-only SELECT returned on 18 Nov 2026; run the
-- SELECT again, and only if it still returns that count, uncomment and run the fix.
-- Nothing here grants anything to anon or public.

-- ════════════════════════════════════════════════════════════════════════════
-- Part 1 — schema
-- ════════════════════════════════════════════════════════════════════════════

-- PRT-11 · Partner contact name (the «Hello <name>,» of the statement email).
-- supabase/partners-contact-name.sql was committed on 7 Nov but never run: the live
-- table has no contact_name, so names typed in Partners & Rates were lost on reload.
-- The page detects the column; once it exists it reads and saves it with no code change.
alter table public.partners add column if not exists contact_name text;


-- ════════════════════════════════════════════════════════════════════════════
-- Part 2 — data corrections (for Miguel to approve; all commented)
-- ════════════════════════════════════════════════════════════════════════════

-- PRT-11 · Seed the seven contact names recorded on 7 Nov 2026 (only where empty).
-- Before (18 Nov): 7 partner records carry the seven seed names; the column did not exist, so none has a contact name.
--   select count(*) from public.partners
--    where name in ('Wave Culture','SOLID SURF HOUSE CAPARICA','AASHA','The Surf Tribe','Ocean Adventure','Surfwise Travel','SURFWISE');   -- expect 7
-- Fix: run the update in supabase/partners-contact-name.sql (it fills contact_name only where it is empty).

-- DATA-09 (1) · The Ocean Adventure payment of 3,136.61 (5 Oct 2026, «acerto final Jan–Ago») is in
-- partner_ledger without its bank movement, although the CGD debit «PAG COMISSOES» -3,136.61 of
-- 5 Oct is loaded (the HQ line of the same payment already points at it).
-- Before (18 Nov): 1 row.
--   select count(*) from public.partner_ledger
--    where id = '738b0f99-b5c6-449c-a391-1a9300c08a98' and kind = 'payment' and amount = 3136.61 and bank_movement_id is null;   -- expect 1
--   select count(*) from public.hq_bank_movements
--    where id = 'e69ecaf4-7e2f-4604-bd79-4ebb0ce2b2c2' and amount = -3136.61 and movement_date = '2026-10-05';                -- expect 1
-- Fix:
--   update public.partner_ledger set bank_movement_id = 'e69ecaf4-7e2f-4604-bd79-4ebb0ce2b2c2'
--    where id = '738b0f99-b5c6-449c-a391-1a9300c08a98' and bank_movement_id is null;

-- DATA-09 (2) · Surfwise Travel 2026-05 is Paid with an empty note. The money is in the bank:
-- partner_ledger 775a8259 (received 1,179.16, CGD 18 Sep 2026, applies to 2026-05) is filed under
-- the other record of the same company, «SURFWISE» (see lib/partner-alias.js). The note only cites it;
-- the status does not change. Merging the two records is a separate decision.
-- Before (18 Nov): 1 row.
--   select count(*) from public.partner_month_status s join public.partners p on p.id = s.partner_id
--    where s.id = 'f2aafccd-7eba-4bc4-b509-42064c179f94' and p.name = 'Surfwise Travel' and s.month_key = '2026-05'
--      and s.status = 'Paid' and coalesce(s.notes, '') = '';                                                                    -- expect 1
-- Fix:
--   update public.partner_month_status
--      set notes = 'Paid: CGD 18-09-2026 +1.179,16 (partner_ledger 775a8259, filed under SURFWISE)'
--    where id = 'f2aafccd-7eba-4bc4-b509-42064c179f94' and coalesce(notes, '') = '';

-- Check after Part 1:
select count(*) as contact_name_column
  from information_schema.columns
 where table_schema = 'public' and table_name = 'partners' and column_name = 'contact_name';   -- expect 1
