-- ════════════════════════════════════════════════════════════════════════════
--  hq_invoices — drive_link column + drop the PDF-storage habit
-- ════════════════════════════════════════════════════════════════════════════
--
--  Miguel's decision: PDFs live in Google Drive, not in the app. From now on
--  the AI reads each invoice for extraction only — the file is discarded
--  after parse-invoice returns. We keep the filename (so the row can be
--  matched back to the Drive PDF by name) and add drive_link so Miguel can
--  paste the PDF's Drive URL and jump straight from the row to the archive.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. New column: user-editable Drive URL. Nullable — retrofitting old rows
--    happens gradually as Miguel scrubs the list.
alter table public.hq_invoices
  add column if not exists drive_link text;

comment on column public.hq_invoices.drive_link is
  'User-pasted Google Drive URL to the original PDF. Preferred over file_url; file_url is legacy for pre-migration rows still stored in the hq-invoices bucket.';

-- 2. (Optional) Reclaim Storage space for rows that ARE already backed up
--    in Drive. Do NOT run this blindly — first verify every PDF exists in
--    Drive. When ready, uncomment and run in the SQL editor.
--
--   Pre-check: how many rows still point at Storage?
--     select count(*) from public.hq_invoices where file_url is not null;
--
--   Nuke Storage AND clear the DB pointer:
--     -- a) delete the Storage objects (they live under the hq-invoices bucket)
--     delete from storage.objects
--     where bucket_id = 'hq-invoices';
--     -- b) clear the pointers so the UI stops trying to open them
--     update public.hq_invoices
--        set file_url = null
--      where file_url is not null;
--
-- 3. To slim future imports even more, you could drop file_url entirely once
--    every row's PDF is confirmed in Drive:
--     alter table public.hq_invoices drop column if exists file_url;
--     alter table public.hq_invoices drop column if exists file_mime;
--    (Leave file_name — it's the anchor that lets Miguel find the PDF in Drive.)
