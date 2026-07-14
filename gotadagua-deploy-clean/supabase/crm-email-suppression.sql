-- ════════════════════════════════════════════════════════════════════════════
--  EMAIL SUPPRESSION LIST — the "never email again" table
--
--  Three ways an address lands here:
--    'unsubscribe' — gmail-sync detected opt-out intent in a reply
--                    ("unsubscribe", "remover", "stop", …)
--    'bounce'      — gmail-sync saw a mailer-daemon delivery failure for
--                    an email we sent (bad address). Repeatedly mailing
--                    dead addresses is a top spam signal — Google reads
--                    high bounce rates as list-buying.
--    'manual'      — someone added it by hand (e.g. a partner asked by
--                    phone to stop receiving).
--
--  Enforcement: the email-dispatch Edge Function checks this table before
--  every send and skips suppressed rows. gmail-sync also cancels any
--  still-pending queue rows the moment it suppresses an address.
--
--  Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.email_suppression (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,               -- stored lowercase
  reason      text not null default 'manual'
              check (reason in ('unsubscribe','bounce','manual')),
  detail      text,                               -- e.g. bounce subject / matched keyword
  company_id  uuid,                               -- outreach_contacts.id when known
  created_by  text not null default 'system',
  created_at  timestamptz not null default now()
);

create index if not exists idx_email_suppression_email
  on public.email_suppression (email);

alter table public.email_suppression enable row level security;

drop policy if exists "suppression_all_authenticated" on public.email_suppression;
create policy "suppression_all_authenticated" on public.email_suppression
  for all to authenticated using (true) with check (true);

-- Normalise on write: emails compared lowercase everywhere.
create or replace function public.fn_suppression_lowercase()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists tr_suppression_lowercase on public.email_suppression;
create trigger tr_suppression_lowercase
  before insert or update on public.email_suppression
  for each row execute function public.fn_suppression_lowercase();
