-- «Invoice Sent» only when the email has actually gone out (Miguel, 9 Nov 2026:
-- «confirma quando os emails estão enviados para mudar o status»).
-- A new partner_invoices row no longer moves the month on its own: the
-- invoice is registered (Drive + app) BEFORE Miguel sends the reply draft.
-- The agent checks accounting@ Sent and then calls
-- advance_partner_month_status(partner, month, 'Invoice Sent', note).
drop trigger if exists partner_invoices_advance_status on public.partner_invoices;
drop function if exists public.partner_invoices_advance_status();
select count(*) as triggers_left from pg_trigger where tgname = 'partner_invoices_advance_status';
