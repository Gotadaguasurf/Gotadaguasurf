-- Small cleanup for the "Teste ClaudeQA" guest Miguel created while
-- reproducing the parser bug. Run in Supabase SQL Editor.
--
-- Deletes the guest row + any items still linked to it. Ledger entries
-- generated from paid items stay untouched (they only reference the
-- guest via denormalised name, not by id, so they don't cascade).

-- Preview what would be removed:
--   select id, name, is_staff, paid, created_by
--   from public.camp_guests
--   where name ilike '%Teste ClaudeQA%';

-- Actual delete — items go first because they FK to camp_guests(id).
delete from public.camp_tab_items
where guest_id in (
  select id from public.camp_guests where name ilike '%Teste ClaudeQA%'
);

delete from public.camp_guests
where name ilike '%Teste ClaudeQA%';
