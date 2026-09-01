-- ════════════════════════════════════════════════════════════════════════════
--  CRM files — photos and decks the sales team sends to prospects
--
--  A public bucket, deliberately: the files are marketing collateral whose
--  whole purpose is to be opened by someone outside the company, straight
--  from an email, with no login. Nothing private belongs here — invoices and
--  backups keep their own private buckets.
--
--  Only signed-in team members can upload or delete; anyone with the link
--  can read. Emails carry the link (or, for images, render it inline), which
--  keeps the message light: a first email dragging a 10 MB deck behind it is
--  a first email that lands in spam.
--
--  How to run: paste into Supabase → SQL Editor → Run. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-assets', 'crm-assets', true, 26214400)   -- 25 MB, Gmail's own cap
on conflict (id) do update set public = true, file_size_limit = 26214400;

drop policy if exists "crm assets are readable by anyone" on storage.objects;
create policy "crm assets are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'crm-assets');

drop policy if exists "team can upload crm assets" on storage.objects;
create policy "team can upload crm assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'crm-assets');

drop policy if exists "team can replace crm assets" on storage.objects;
create policy "team can replace crm assets"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'crm-assets');

drop policy if exists "team can delete crm assets" on storage.objects;
create policy "team can delete crm assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'crm-assets');
