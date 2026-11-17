-- ════════════════════════════════════════════════════════════════════════════
--  OPTIONAL · /prices change → upcoming trips follow it at once (17 Nov 2026).
--
--  NOT run against production by the agent — Miguel runs it after his OK, AFTER supabase/transport-catalog-one-source.sql.
--  Without it, nothing changes on its own: run `select public.camp_trips_reprice('<location uuid>');` after editing /prices.
--
--  When a Transport row of /prices changes its driver cost, seats, name, active / picker flag (or a row is added or
--  removed), camp_trips__reprice(location) runs for that camp: upcoming, unpaid, planned / sent / confirmed trips whose
--  price was not typed by hand take the new vehicle / price (rules in transport-catalog-one-source.sql §5). A paid or
--  past trip is never touched. A sent / confirmed trip whose VEHICLE changes gets «changed, resend».
--  Idempotent: safe to run again.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pricing_catalog__reprice_trips()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_loc uuid := coalesce(new.location_id, old.location_id);
begin
  if coalesce(new.category, old.category) = 'Transport' and v_loc is not null then
    perform public.camp_trips__reprice(v_loc);
  end if;
  return null;
end $$;
revoke all on function public.pricing_catalog__reprice_trips() from public, anon, authenticated;

drop trigger if exists tr_pricing_catalog_reprice_trips on public.pricing_catalog;
create trigger tr_pricing_catalog_reprice_trips
  after insert or delete or update of cost_per_guest, capacity, name, active, show_in_transport_picker, picker_tab
  on public.pricing_catalog
  for each row execute function public.pricing_catalog__reprice_trips();

-- Rollback:
--   drop trigger if exists tr_pricing_catalog_reprice_trips on public.pricing_catalog;
--   drop function if exists public.pricing_catalog__reprice_trips();
