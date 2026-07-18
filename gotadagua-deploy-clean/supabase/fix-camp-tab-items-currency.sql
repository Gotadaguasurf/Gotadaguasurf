-- ════════════════════════════════════════════════════════════════════════════
--  CAMP_TAB_ITEMS — heal the hardcoded-LKR currency stamps
--
--  The POS item sync inserted every row with currency='LKR' regardless of
--  location (fixed in camp-tab-inner.html to stamp LOCAL_CURRENCY). The
--  amounts were always correct local prices — only the label column was
--  wrong, which surfaced as "LKR 30" for €30 Portugal merch in the
--  Activity feed. This aligns the stored labels with each location's
--  real currency. Sri Lanka rows are already correct.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

update public.camp_tab_items i
   set currency = 'EUR'
  from public.locations l
 where l.id = i.location_id
   and l.slug in ('portugal','junior-camp','surf-school')
   and i.currency is distinct from 'EUR';

update public.camp_tab_items i
   set currency = 'MAD'
  from public.locations l
 where l.id = i.location_id
   and l.slug = 'morocco'
   and i.currency is distinct from 'MAD';

-- Sanity: currency por location — nada de LKR fora do Sri Lanka.
select l.slug, i.currency, count(*)
  from public.camp_tab_items i
  join public.locations l on l.id = i.location_id
 group by l.slug, i.currency
 order by l.slug;
