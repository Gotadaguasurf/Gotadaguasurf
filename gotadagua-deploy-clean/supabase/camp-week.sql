-- ════════════════════════════════════════════════════════════════════════════
--  Camp week — the Week area of the Sri Lanka camp hub (13 Nov 2026).
--  Design: sl_design/opportunities.md B1 + BUILD2.md (agent «week»).
--
--  Francisco (location manager, full view) imports the Bookinglayer Guests
--  file every Monday (camp_week_guests, supabase/camp-trips.sql). The Week tab
--  turns it into one WhatsApp text per team (Cleaning, Kitchen, Surf) and day.
--  Every message he sends or copies is stored here, so a re-import can show
--  «Changed since sent: Cleaning (Tue)» and a «Send update».
--  Transfers keep their own sent state on camp_trips; they never land here.
--
--  Nadith (local manager, ?view=local) has no Week tab and no access here.
--  Needs supabase/camp-trips.sql first (camp_trips_can_manage, camp_drivers).
--  Idempotent: safe to run again. NOT run against production by the agent.
--  Checks at the bottom (SELECT only).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.camp_week_messages (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  week_start date not null,                       -- Saturday of the Sat–Fri week (Colombo date)
  team text not null check (team in ('cleaning','kitchen','surf')),
  day text not null check (day = 'week' or day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),   -- a Colombo date or 'week'
  text text not null,                             -- the message body as sent (without the UPDATE header)
  hash text not null,                             -- hash of text; the app recomputes and compares
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid()
);
create index if not exists camp_week_messages_week on public.camp_week_messages(location_id, week_start, team, day, sent_at desc);

alter table public.camp_week_messages enable row level security;
drop policy if exists camp_week_messages_select on public.camp_week_messages;
create policy camp_week_messages_select on public.camp_week_messages for select using (public.camp_trips_can_manage(location_id));
drop policy if exists camp_week_messages_insert on public.camp_week_messages;
create policy camp_week_messages_insert on public.camp_week_messages for insert
  with check (public.camp_trips_can_manage(location_id) and sent_by is not distinct from auth.uid());
-- «Undo» right after Send / Copy removes the row just written.
drop policy if exists camp_week_messages_delete on public.camp_week_messages;
create policy camp_week_messages_delete on public.camp_week_messages for delete using (public.camp_trips_can_manage(location_id));
grant select, insert, delete on public.camp_week_messages to authenticated;
revoke all on public.camp_week_messages from anon;

-- ── Team contacts, in the same directory as the drivers (camp_drivers) ──────
-- kinds = {'contact'} keeps them out of the driver-payment matching
-- (camp_transport__driver_in). Phones unknown: the Week tab shows «add phone».
-- The transfers contact (Nadith, 'transfers_contact') already exists.
insert into public.camp_drivers (location_id, name, label, aliases, kinds, default_for)
select l.id, v.name, v.label, array[]::text[], array['contact'], v.default_for
  from public.locations l,
       (values ('Cleaning lead', 'Cleaning', array['cleaning_contact']),
               ('Kitchen lead',  'Kitchen',  array['kitchen_contact']),
               ('Surf head',     'Surf',     array['surf_contact'])) as v(name, label, default_for)
 where l.slug = 'sri-lanka'
   and not exists (select 1 from public.camp_drivers d where d.location_id = l.id and v.default_for[1] = any(d.default_for))
on conflict (location_id, lower(name)) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
--  Checks after running (SELECT only)
-- ════════════════════════════════════════════════════════════════════════════
-- select column_name, data_type from information_schema.columns where table_name = 'camp_week_messages' order by ordinal_position;  -- 9 rows
-- select policyname, cmd from pg_policies where tablename = 'camp_week_messages' order by cmd;                                      -- delete, insert, select
-- select name, label, kinds, default_for from public.camp_drivers d join public.locations l on l.id = d.location_id
--  where l.slug = 'sri-lanka' and 'contact' = any(kinds) order by name;                                                          -- Cleaning lead, Kitchen lead, Nadith, Surf head
