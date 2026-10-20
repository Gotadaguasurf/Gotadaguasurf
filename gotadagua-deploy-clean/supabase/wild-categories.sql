-- ════════════════════════════════════════════════════════════════════════════
--  Wild Wednesday — categorias iguais ao Excel do Max (Miguel, 20 Out 2026: «bora»)
--  Despesas: categorias HQ com prefixo «Wild ·» (a antiga «Wild» fica inactiva).
--  Receita: categoria no ledger «Wild · Gota / Pure / Surfin / Porta / Online».
--  O total da Wild é a location wild-wednesday; o Overview/P&L por location não muda.
-- ════════════════════════════════════════════════════════════════════════════
insert into hq_invoice_categories (name, sort_order, is_personal, active) values
 ('Wild · DJs',151,false,true),('Wild · Som/luz',152,false,true),('Wild · Foto/vídeo',153,false,true),
 ('Wild · Marketing',154,false,true),('Wild · Porta',155,false,true),('Wild · Comissões',156,false,true),('Wild · Outros',157,false,true)
on conflict do nothing;
update hq_invoice_categories set active=false where name='Wild';

-- despesas pagas pelo banco → sub-categoria pelo fornecedor
update hq_invoices i set category_id=c.id, category_name=c.name
  from hq_invoice_categories c
 where i.deleted_at is null and i.category_name='Wild'
   and c.name = case
     when i.company like 'raimundo%' then 'Wild · Som/luz'
     when i.company in ('namor cayres lobo elifio','namor cayres lobo','david van der heyden','luis spencer','debeat','uljc') then 'Wild · DJs'
     when i.company='blow your mind consulting' then 'Wild · Foto/vídeo'
     when i.company='meta ads' then 'Wild · Marketing'
     else 'Wild · Outros' end;

-- custos em dinheiro (ledger manual)
update ledger_entries set category = case
     when description ilike '%DJ pago%' then 'Wild · DJs'
     when description ilike '%foto/v%' then 'Wild · Foto/vídeo'
     when description ilike 'Porta%' then 'Wild · Porta'
     when description ilike 'Comiss%' then 'Wild · Comissões'
     else category end
 where location_id='798a1d70-7cc6-449d-a23f-494137e48e44' and type='expense' and source_kind='manual' and category='Wild';

-- receita: bilhetes Gota (camp tab + acerto) e online
update ledger_entries set category='Wild · Gota' where location_id='798a1d70-7cc6-449d-a23f-494137e48e44' and type='revenue' and category='Wild money' and (source_kind='camp_tab_per_item' or description ilike '%bilhetes Gota%');
update ledger_entries set category='Wild · Online' where location_id='798a1d70-7cc6-449d-a23f-494137e48e44' and type='revenue' and category='Wild money' and payment_method='Online';
-- receita em dinheiro: a linha combinada Pure+Surfin+porta passa a três linhas
delete from ledger_entries where location_id='798a1d70-7cc6-449d-a23f-494137e48e44' and type='revenue' and source_kind='manual' and category='Wild money' and payment_method='Cash';
insert into ledger_entries (location_id,type,entry_date,amount_eur,amount_local,currency,fx_rate,business_area,category,description,payment_method,source_kind,paid_from,attributed_location) values
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-05-15',230,230,'EUR',1,'Wild','Wild · Pure','Wild 15/05 — bilhetes Pure Surf Camp 23×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-05-15',10,10,'EUR',1,'Wild','Wild · Surfin','Wild 15/05 — bilhetes Surfin/Base 1×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-05-15',155,155,'EUR',1,'Wild','Wild · Porta','Wild 15/05 — dinheiro na porta 155 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-03',230,230,'EUR',1,'Wild','Wild · Pure','Wild 03/06 — bilhetes Pure Surf Camp 23×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-03',120,120,'EUR',1,'Wild','Wild · Porta','Wild 03/06 — dinheiro na porta 120 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-10',360,360,'EUR',1,'Wild','Wild · Pure','Wild 10/06 — bilhetes Pure Surf Camp 36×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-17',150,150,'EUR',1,'Wild','Wild · Pure','Wild 17/06 — bilhetes Pure Surf Camp 15×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-17',260,260,'EUR',1,'Wild','Wild · Surfin','Wild 17/06 — bilhetes Surfin/Base 26×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-17',35,35,'EUR',1,'Wild','Wild · Porta','Wild 17/06 — dinheiro na porta 35 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-24',170,170,'EUR',1,'Wild','Wild · Pure','Wild 24/06 — bilhetes Pure Surf Camp 17×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-06-24',120,120,'EUR',1,'Wild','Wild · Surfin','Wild 24/06 — bilhetes Surfin/Base 12×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-08',200,200,'EUR',1,'Wild','Wild · Pure','Wild 08/07 — bilhetes Pure Surf Camp 20×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-08',70,70,'EUR',1,'Wild','Wild · Surfin','Wild 08/07 — bilhetes Surfin/Base 7×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-15',290,290,'EUR',1,'Wild','Wild · Pure','Wild 15/07 — bilhetes Pure Surf Camp 29×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-15',40,40,'EUR',1,'Wild','Wild · Surfin','Wild 15/07 — bilhetes Surfin/Base 4×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-15',20,20,'EUR',1,'Wild','Wild · Porta','Wild 15/07 — dinheiro na porta 20 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-22',360,360,'EUR',1,'Wild','Wild · Pure','Wild 22/07 — bilhetes Pure Surf Camp 36×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-22',160,160,'EUR',1,'Wild','Wild · Surfin','Wild 22/07 — bilhetes Surfin/Base 16×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-22',40,40,'EUR',1,'Wild','Wild · Porta','Wild 22/07 — dinheiro na porta 40 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-29',210,210,'EUR',1,'Wild','Wild · Pure','Wild 29/07 — bilhetes Pure Surf Camp 21×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-29',120,120,'EUR',1,'Wild','Wild · Surfin','Wild 29/07 — bilhetes Surfin/Base 12×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-07-29',70,70,'EUR',1,'Wild','Wild · Porta','Wild 29/07 — dinheiro na porta 70 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-05',170,170,'EUR',1,'Wild','Wild · Pure','Wild 05/08 — bilhetes Pure Surf Camp 17×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-05',260,260,'EUR',1,'Wild','Wild · Surfin','Wild 05/08 — bilhetes Surfin/Base 26×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-05',75,75,'EUR',1,'Wild','Wild · Porta','Wild 05/08 — dinheiro na porta 75 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-12',120,120,'EUR',1,'Wild','Wild · Pure','Wild 12/08 — bilhetes Pure Surf Camp 12×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-12',350,350,'EUR',1,'Wild','Wild · Surfin','Wild 12/08 — bilhetes Surfin/Base 35×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-12',50,50,'EUR',1,'Wild','Wild · Porta','Wild 12/08 — dinheiro na porta 50 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-19',240,240,'EUR',1,'Wild','Wild · Pure','Wild 19/08 — bilhetes Pure Surf Camp 24×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-19',160,160,'EUR',1,'Wild','Wild · Surfin','Wild 19/08 — bilhetes Surfin/Base 16×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-19',20,20,'EUR',1,'Wild','Wild · Porta','Wild 19/08 — dinheiro na porta 20 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-26',360,360,'EUR',1,'Wild','Wild · Pure','Wild 26/08 — bilhetes Pure Surf Camp 36×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-26',160,160,'EUR',1,'Wild','Wild · Surfin','Wild 26/08 — bilhetes Surfin/Base 16×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-08-26',60,60,'EUR',1,'Wild','Wild · Porta','Wild 26/08 — dinheiro na porta 60 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-09-02',260,260,'EUR',1,'Wild','Wild · Pure','Wild 02/09 — bilhetes Pure Surf Camp 26×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-09-02',200,200,'EUR',1,'Wild','Wild · Surfin','Wild 02/09 — bilhetes Surfin/Base 20×10 € em dinheiro (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday'),
('798a1d70-7cc6-449d-a23f-494137e48e44','revenue','2026-09-02',15,15,'EUR',1,'Wild','Wild · Porta','Wild 02/09 — dinheiro na porta 15 € (folha Wild)','Cash','manual','wild-wednesday','wild-wednesday');

select json_build_object(
 'rev',(select json_agg(x order by x.category) from (select category, count(*) n, sum(amount_eur) eur from ledger_entries where location_id='798a1d70-7cc6-449d-a23f-494137e48e44' and type='revenue' group by 1) x),
 'exp',(select json_agg(x order by x.category) from (select category, count(*) n, sum(amount_eur) eur from ledger_entries where location_id='798a1d70-7cc6-449d-a23f-494137e48e44' and type='expense' group by 1) x),
 'inv',(select json_agg(x order by x.category_name) from (select category_name, count(*) n, sum(amount_eur) eur from hq_invoices where deleted_at is null and location_slug='wild-wednesday' group by 1) x),
 'leftover',(select count(*) from ledger_entries where category='Wild money' or (category='Wild' and location_id='798a1d70-7cc6-449d-a23f-494137e48e44'))) j;
