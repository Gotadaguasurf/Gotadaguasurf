-- ════════════════════════════════════════════════════════════════════════════
--  DIAGNOSE — onde estão as weeks e guests do Morocco
-- ════════════════════════════════════════════════════════════════════════════
--
--  Há duas fontes de weeks/guests no sistema:
--    A) location_state_store · state_key='camphub_v2_morocco'
--       → state_json.weeks[] (o hub usa)
--    B) camp_weeks + camp_guests (o Camp Tab usa)
--
--  Esta query mostra QUANTAS linhas cada fonte tem, e a amostra mais
--  recente. Se A está vazio mas B tem dados → o hub pode rehidratar
--  de B. Se ambos vazios → a data foi mesmo apagada e temos de
--  recuperar de outro backup.
--
--  NÃO altera nada. Só lê.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. location_state_store (hub state) ──────────────────────────────────
select
  l.slug,
  lss.state_key,
  jsonb_array_length(coalesce(lss.state_json->'weeks','[]'::jsonb)) as weeks_in_state,
  lss.updated_at
from public.location_state_store lss
join public.locations l on l.id = lss.location_id
where l.slug = 'morocco'
  and lss.state_key like 'camphub%'
order by lss.updated_at desc;

-- ── 2. camp_weeks (Camp Tab source) ──────────────────────────────────────
select
  l.slug,
  count(*)                         as week_count,
  min(cw.start_date)               as earliest,
  max(cw.start_date)               as latest,
  max(cw.closed_at)                as last_closed
from public.camp_weeks cw
join public.locations l on l.id = cw.location_id
where l.slug = 'morocco'
group by l.slug;

-- ── 3. camp_guests (Camp Tab source) ─────────────────────────────────────
select
  l.slug,
  count(*)                              as guest_count,
  count(*) filter (where cg.paid)       as paid_count,
  count(distinct cg.week_id)            as weeks_with_guests
from public.camp_guests cg
join public.locations l on l.id = cg.location_id
where l.slug = 'morocco'
group by l.slug;

-- ── 4. Sample — last 3 weeks + their guests (if any) ────────────────────
select
  cw.id                  as week_id,
  cw.start_date,
  cw.end_date,
  cw.status,
  cw.closed_at,
  count(cg.id)           as guests_in_week
from public.camp_weeks cw
join public.locations    l  on l.id  = cw.location_id
left join public.camp_guests cg on cg.week_id = cw.id
where l.slug = 'morocco'
group by cw.id, cw.start_date, cw.end_date, cw.status, cw.closed_at
order by cw.start_date desc
limit 5;
