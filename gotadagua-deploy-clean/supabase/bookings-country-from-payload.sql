-- ════════════════════════════════════════════════════════════════════════════
--  7 Nov 2026 (Miguel): the KILROY statement e-mail is split by country
--  (Sweden / Norway / Netherlands / …), read from bookings.country. The hub's
--  Bookinglayer CSV import kept the country only inside raw_payload.country, so
--  every booking imported since 26 Oct 2026 showed up under «NO COUNTRY».
--
--  Trigger (any import path): when bookings.country is empty, take it from
--  raw_payload.country; a re-import without a country never blanks one that is
--  already set. Plus a one-off backfill of the rows already affected.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bookings_fill_country()
returns trigger language plpgsql as $$
begin
  if coalesce(trim(new.country), '') = '' then
    new.country := nullif(trim(coalesce(new.raw_payload->>'country', '')), '');
    if new.country is null and tg_op = 'UPDATE' then
      new.country := nullif(trim(coalesce(old.country, '')), '');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_fill_country on public.bookings;
create trigger bookings_fill_country before insert or update on public.bookings
  for each row execute function public.bookings_fill_country();

update public.bookings
   set country = trim(raw_payload->>'country')
 where coalesce(trim(country), '') = ''
   and coalesce(trim(raw_payload->>'country'), '') <> '';
