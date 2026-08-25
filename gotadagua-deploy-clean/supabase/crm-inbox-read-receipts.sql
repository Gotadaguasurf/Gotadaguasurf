-- ════════════════════════════════════════════════════════════════════════════
--  CRM Inbox — read receipts for inbound emails
--
--  Adds email_messages.read_at so the Inbox tab can show unread replies
--  (null = unread; set when someone opens the conversation). Existing
--  inbound mail is backfilled as read so the inbox starts clean.
--
--  How to run: paste into Supabase → SQL Editor → Run. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.email_messages
  add column if not exists read_at timestamptz;

-- Start clean: everything received before this migration counts as read.
update public.email_messages
   set read_at = now()
 where direction = 'inbound'
   and read_at is null;

-- Fast unread lookups (badge count + inbox list).
create index if not exists idx_email_messages_unread
  on public.email_messages(company_id)
  where direction = 'inbound' and read_at is null;
