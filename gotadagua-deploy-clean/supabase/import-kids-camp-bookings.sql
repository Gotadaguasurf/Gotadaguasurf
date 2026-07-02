-- ════════════════════════════════════════════════════════════════════════════
--  Kids Camp Caparica bookings import (Bookinglayer export 2026-07-02)
--
--  Source: Downloads/Bookinglayer-Bookings-2026-07-02 10_53.csv
--  CSV #2 has 70 rows but ~32 are DUPLICATES of CSV #1 (Junior Camp) —
--  Bookinglayer exports the same booking under multiple product filters
--  when the guest bought a package that touches both sites. This import
--  ONLY includes rows whose booking_ref is not in the Junior Camp file,
--  so no Junior booking gets re-labelled as Kids on re-run.
--
--  38 Kids-Camp-Caparica-only bookings. All location = 'Kids Camp Caparica'.
--
--  Idempotent:
--   - Partners upserted by name
--   - Bookings upserted by booking_ref
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Partners referenced in this file
insert into public.partners (name, commission_pct, partner_type, is_active)
values
  ('JUVIGO',                                15.00, 'surfcamp', true),
  ('Ocean Adventure',                       20.00, 'surfcamp', true),
  ('Caixa Geral de Depositos',               0.00, 'surfcamp', true),
  ('Caixa Gestão de Activos e Pensões',      0.00, 'surfcamp', true),
  ('PUMPKIN',                               12.00, 'surfcamp', true),
  ('SURFCAMP IT',                           20.00, 'surfcamp', true)
on conflict (name) do update set
  is_active = true,
  updated_at = now();

-- 2. Bookings (net-new to CSV #2, filtered against CSV #1 refs)
insert into public.bookings
  (booking_ref, booker, check_in_on, month_key, total, pax, location,
   partner_name, partner_id, booking_type,
   partner_commission_pct, commission_amount, net_amount)
values
  ('2026-2618','Pedro Nogueira Vaz Genro','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2567','Tomás Cebrian Leite Correia','2026-06-22','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2560','Jaime Mauhin Pinheiro Faria','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2515','Ricardo Jorge Colaço Tavares','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2495','Madalena dos Santos Redinha Sança','2026-06-29','2026-06',550.00,2,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,550.00),
  ('2026-2470','Matilde Bom','2026-06-29','2026-06',628.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,628.00),
  ('2026-2461','Francisco Mendes','2026-06-29','2026-06',314.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,314.00),
  ('2026-2453','Tomás Duarte Barbosa','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2426','Lucas Dos Santos','2026-06-15','2026-06',249.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,249.00),
  ('2026-2400','Guilherme Dias Vultos da Rocha','2026-06-22','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2399','Maria Martins Ferreira Roque Pires','2026-06-22','2026-06',210.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,210.00),
  ('2026-2384','Dalila Branco','2026-06-15','2026-06',249.00,1,'Kids Camp Caparica','PUMPKIN',(select id from public.partners where name='PUMPKIN'),'partner',12.00,29.88,219.12),
  ('2026-2377','Carolina Araújo','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2375','Clara Carvalho','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2373','Andreia David','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2330','Mariana Pratas Pereira','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2329','Catarina Borges Alves','2026-06-22','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2303','Ana Maria Jacinto Resende Rocha','2026-06-29','2026-06',590.00,2,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,590.00),
  ('2026-2189','Vasco Ferreira','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2179','Ellen Barends','2026-06-29','2026-06',314.00,1,'Kids Camp Caparica','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,47.10,266.90),
  ('2026-2147','Ines Pereira','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2127','Mariana Cunha','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2118','Francisca Urbano Duarte Filipe Martins Gonçalves','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Gestão de Activos e Pensões',(select id from public.partners where name='Caixa Gestão de Activos e Pensões'),'partner',0.00,0.00,275.00),
  ('2026-2116','Simão Duarte Reis Pereira','2026-06-15','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2114','Maria Francisca Almeida da Costa Bidarra Felizol','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2059','Duarte Silva Passos','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2058','Dinis Soares de Moura Fernandes','2026-06-15','2026-06',275.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,275.00),
  ('2026-2006','Beatriz Mateus Nunes','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-2004','Sofia de Azevedo Góis','2026-06-15','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2001','Diogo Tavares Folgado','2026-06-29','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-2000','Gustavo Tavares Folgado','2026-06-22','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-1999','Gustavo Tavares Folgado','2026-06-15','2026-06',275.00,1,'Kids Camp Caparica','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,275.00),
  ('2026-1968','Matilde Manilha','2026-06-15','2026-06',274.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,274.00),
  ('2026-1618','Afonso Lopes Marques Pereira','2026-06-29','2026-06',210.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,210.00),
  ('2026-1368','Andrea patricia Ambrosio','2026-06-22','2026-06',314.00,1,'Kids Camp Caparica',null,null,'direct',0.00,0.00,314.00),
  ('2026-0900','Goncalo Vaz','2026-06-22','2026-06',498.00,2,'Kids Camp Caparica',null,null,'direct',0.00,0.00,498.00),
  ('2026-0182','Heidi Prior','2026-06-15','2026-06',498.00,2,'Kids Camp Caparica',null,null,'direct',0.00,0.00,498.00),
  ('2026-0174','Edith Boeding','2026-06-29','2026-06',628.00,2,'Kids Camp Caparica',null,null,'direct',0.00,0.00,628.00)
on conflict (booking_ref) do update set
  booker = excluded.booker,
  check_in_on = excluded.check_in_on,
  month_key = excluded.month_key,
  total = excluded.total,
  pax = excluded.pax,
  location = excluded.location,
  partner_name = excluded.partner_name,
  partner_id = excluded.partner_id,
  booking_type = excluded.booking_type,
  partner_commission_pct = excluded.partner_commission_pct,
  commission_amount = excluded.commission_amount,
  net_amount = excluded.net_amount,
  updated_at = now();

-- 3. Verify
select 'Kids Camp Caparica bookings' as label, count(*) as n
  from public.bookings where location = 'Kids Camp Caparica';
