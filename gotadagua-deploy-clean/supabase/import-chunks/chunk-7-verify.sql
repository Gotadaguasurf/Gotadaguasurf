-- Chunk 7/7: verificação final
select count(*) as total_contacts from public.outreach_contacts;
-- Esperado ~1849 (628 + ~1212 novos)

select segment, count(*) as n
  from public.outreach_contacts
 group by segment order by n desc;
-- Esperado 10 buckets
