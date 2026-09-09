-- Surf School check-in: NIF do cliente para a fatura (9 Set 2026).
-- Opcional — estrangeiros não têm. Validado no browser (dígito de controlo PT).
alter table public.surf_school_rentals add column if not exists nif text;
comment on column public.surf_school_rentals.nif is 'NIF do cliente para fatura; opcional';
