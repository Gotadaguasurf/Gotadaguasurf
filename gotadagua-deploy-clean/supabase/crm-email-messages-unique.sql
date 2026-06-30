-- ════════════════════════════════════════════════════════════════════════════
--  UNIQUE constraint on email_messages.provider_msg_id
--
--  Defensive: the gmail-sync function already dedups by reading existing
--  provider_msg_ids before insert, but two concurrent sync runs (e.g. the
--  cron fires while a user clicks "Sync inbox") could race and insert the
--  same message twice. A UNIQUE index turns the race into a clean
--  ON CONFLICT DO NOTHING when we switch the insert to an upsert.
--
--  If you already have duplicate rows, this migration will FAIL on the
--  unique index step — clean them up first with the provided dedup CTE.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Clean up existing duplicates (keep oldest per provider_msg_id).
delete from public.email_messages a
  using public.email_messages b
 where a.provider_msg_id is not null
   and a.provider_msg_id = b.provider_msg_id
   and a.created_at > b.created_at;

-- 2. Add the unique constraint. Partial so NULL provider_msg_id stays
--    valid (legacy rows from before the sync existed have no Gmail id).
create unique index if not exists idx_email_messages_provider_msg_id_unique
  on public.email_messages(provider_msg_id)
  where provider_msg_id is not null;

-- 3. Verify
select count(*) as dupes_remaining
  from (
    select provider_msg_id, count(*)
      from public.email_messages
     where provider_msg_id is not null
     group by 1
    having count(*) > 1
  ) t;
-- Expected: 0
