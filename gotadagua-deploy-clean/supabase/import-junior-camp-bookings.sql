-- ════════════════════════════════════════════════════════════════════════════
--  Junior Camp bookings import (Bookinglayer export 2026-07-02)
--
--  Source: Downloads/Bookinglayer-Bookings-2026-07-02 10_51.csv
--  33 bookings, all location = 'Junior Camp'.
--
--  Idempotent:
--   - Partners upserted by name (creates if missing, updates rate if present)
--   - Bookings upserted by booking_ref (re-runnable, no duplicates)
--
--  Per-booking commission rate lives on bookings.partner_commission_pct
--  (respects the CSV row-by-row) — the rate on public.partners is the
--  most common one but not authoritative per booking.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Partners referenced in this file
insert into public.partners (name, commission_pct, partner_type, is_active)
values
  ('JUVIGO',                    15.00, 'surfcamp', true),
  ('Ocean Adventure',           20.00, 'surfcamp', true),
  ('Caixa Geral de Depositos',   0.00, 'surfcamp', true),
  ('SURFCAMP IT',               20.00, 'surfcamp', true)
on conflict (name) do update set
  is_active = true,
  updated_at = now();

-- 2. Bookings — one INSERT per row from the CSV
--    Booking date parsing: 'Sat 27 Jun 2026 14:00:00' → 2026-06-27
--    commission_amount = total * pct / 100
--    net_amount        = total - commission_amount
--    booking_type: 'direct' when partner_name is blank, else 'partner'
insert into public.bookings
  (booking_ref, booker, check_in_on, month_key, total, pax, location,
   partner_name, partner_id, booking_type,
   partner_commission_pct, commission_amount, net_amount)
values
  ('2026-2569','Alexandra Maria Malitzki de Sousa','2026-06-27','2026-06',699.00,1,'Junior Camp','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,104.85,594.15),
  ('2026-2410','João Tomás Madeira dos Santos','2026-06-27','2026-06',699.00,1,'Junior Camp','Caixa Geral de Depositos',(select id from public.partners where name='Caixa Geral de Depositos'),'partner',0.00,0.00,699.00),
  ('2026-2368','Izabella Noelle Tjærby','2026-06-27','2026-06',859.00,1,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,171.80,687.20),
  ('2026-2366','Lidia Viktorova','2026-06-27','2026-06',629.00,1,'Junior Camp',null,null,'direct',0.00,0.00,629.00),
  ('2026-2296','Gregory Chanteux','2026-06-20','2026-06',789.00,1,'Junior Camp',null,null,'direct',0.00,0.00,789.00),
  ('2026-2219','Simão Cortegaça','2026-06-20','2026-06',664.05,1,'Junior Camp',null,null,'direct',0.00,0.00,664.05),
  ('2026-2180','Antoine Chanteux','2026-06-20','2026-06',789.00,1,'Junior Camp',null,null,'direct',0.00,0.00,789.00),
  ('2026-2178','Maya Tattoli','2026-06-27','2026-06',799.00,1,'Junior Camp',null,null,'direct',0.00,0.00,799.00),
  ('2026-2165','Vigga Lucie Lind Mathiesen','2026-06-27','2026-06',859.00,1,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,171.80,687.20),
  ('2026-1979','Sofía Garicano Badiola','2026-06-27','2026-06',1548.00,1,'Junior Camp','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,232.20,1315.80),
  ('2026-1978','Belen Muñoz Lopez','2026-06-27','2026-06',1548.00,1,'Junior Camp','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,232.20,1315.80),
  ('2026-1977','Paula Rodriguez Calatayud','2026-06-27','2026-06',3096.00,2,'Junior Camp','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,464.40,2631.60),
  ('2026-1759','Karolina Olczak','2026-06-27','2026-06',1518.00,2,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,303.60,1214.40),
  ('2026-1743','Alzbeta Vranova','2026-06-20','2026-06',1658.00,2,'Junior Camp',null,null,'direct',0.00,0.00,1658.00),
  ('2026-1741','Yann Yalenghadian','2026-06-20','2026-06',1518.00,1,'Junior Camp',null,null,'direct',0.00,0.00,1518.00),
  ('2026-1731','Izabela Wysocka','2026-06-27','2026-06',1398.00,2,'Junior Camp',null,null,'direct',0.00,0.00,1398.00),
  ('2026-1727','Nikita Tatarchenko','2026-06-27','2026-06',1738.00,2,'Junior Camp',null,null,'direct',0.00,0.00,1738.00),
  ('2026-1702','Andrii Krasovskyi','2026-06-27','2026-06',829.00,1,'Junior Camp',null,null,'direct',0.00,0.00,829.00),
  ('2026-1693','Yuki Castroni','2026-06-27','2026-06',1488.00,1,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,297.60,1190.40),
  ('2026-1553','Juliette Mollard','2026-06-20','2026-06',789.00,1,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,157.80,631.20),
  ('2026-1540','Agata Bravi','2026-06-20','2026-06',759.00,1,'Junior Camp',null,null,'direct',0.00,0.00,759.00),
  ('2026-1108','Muller Alix','2026-06-27','2026-06',729.00,1,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,145.80,583.20),
  ('2026-1028','Agathe BEC','2026-06-20','2026-06',759.00,1,'Junior Camp',null,null,'direct',0.00,0.00,759.00),
  ('2026-0884','francesco ragazzini','2026-06-20','2026-06',759.00,1,'Junior Camp','SURFCAMP IT',(select id from public.partners where name='SURFCAMP IT'),'partner',20.00,151.80,607.20),
  ('2026-0855','Lavinia Maior','2026-06-27','2026-06',1528.00,2,'Junior Camp',null,null,'direct',0.00,0.00,1528.00),
  ('2026-0740','Catalina Soler','2026-06-27','2026-06',1428.00,1,'Junior Camp',null,null,'direct',0.00,0.00,1428.00),
  ('2026-0681','Arlo Kirschner','2026-06-20','2026-06',1638.00,2,'Junior Camp','Ocean Adventure',(select id from public.partners where name='Ocean Adventure'),'partner',20.00,327.60,1310.40),
  ('2026-0505','Keira Sitnikova','2026-06-20','2026-06',1518.00,2,'Junior Camp',null,null,'direct',0.00,0.00,1518.00),
  ('2026-0431','David Burzew','2026-06-27','2026-06',859.00,1,'Junior Camp','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,128.85,730.15),
  ('2026-0416','Aline Gusella','2026-06-20','2026-06',799.00,1,'Junior Camp',null,null,'direct',0.00,0.00,799.00),
  ('2026-0409','Vito Pezer','2026-06-27','2026-06',859.00,1,'Junior Camp','JUVIGO',(select id from public.partners where name='JUVIGO'),'partner',15.00,128.85,730.15),
  ('2026-0242','Marco Martinez Villalba','2026-06-27','2026-06',1488.00,1,'Junior Camp',null,null,'direct',0.00,0.00,1488.00),
  ('2026-0149','Nicolina Langenbach','2026-06-20','2026-06',1718.00,2,'Junior Camp',null,null,'direct',0.00,0.00,1718.00)
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
select 'Junior Camp bookings' as label, count(*) as n
  from public.bookings where location = 'Junior Camp';
