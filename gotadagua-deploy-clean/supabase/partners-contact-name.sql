-- Partner contact name (the "Hello <name>," of the statement email).
-- Until 7 Nov 2026 it only lived in the browser's localStorage, so it was
-- lost in incognito / on the other computer.
alter table public.partners add column if not exists contact_name text;

update public.partners set contact_name = v.contact
from (values
  ('Wave Culture', 'Stefan'),
  ('SOLID SURF HOUSE CAPARICA', 'Stefania'),
  ('AASHA', 'Amit'),
  ('The Surf Tribe', 'Ric'),
  ('Ocean Adventure', 'Nicolas'),
  ('Surfwise Travel', 'Armando'),
  ('SURFWISE', 'Armando')
) as v(name, contact)
where partners.name = v.name and coalesce(partners.contact_name, '') = '';
