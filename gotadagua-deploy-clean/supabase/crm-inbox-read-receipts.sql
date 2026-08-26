-- ════════════════════════════════════════════════════════════════════════════
--  CRM Inbox — read receipts + archive
--
--  Two columns on email_messages, both driving the Inbox tab:
--
--    read_at      null = unread. Set when someone opens the conversation.
--    archived_at  null = still in the working inbox. Set by the ✓ button on
--                 a row, for mail that needed no reply (booking confirmations,
--                 pre-travel notices). Archived threads drop out of "Needs
--                 reply" but stay in "All received" and in search.
--
--  Existing mail is backfilled as read and NOT archived, so the inbox starts
--  clean without hiding anything.
--
--  How to run: paste into Supabase → SQL Editor → Run. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.email_messages
  add column if not exists read_at     timestamptz,
  add column if not exists archived_at timestamptz;

-- Start clean: everything received before this migration counts as read.
update public.email_messages
   set read_at = now()
 where direction = 'inbound'
   and read_at is null;

-- Fast unread lookups (badge count + inbox list).
create index if not exists idx_email_messages_unread
  on public.email_messages(company_id)
  where direction = 'inbound' and read_at is null;

-- The Inbox's default view is "inbound, not archived", newest first.
create index if not exists idx_email_messages_open
  on public.email_messages(sent_at desc)
  where direction = 'inbound' and archived_at is null;
