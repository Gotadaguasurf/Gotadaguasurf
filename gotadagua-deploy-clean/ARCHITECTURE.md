# Gota d'Água Platform — Architecture

> The 2-page map. If you (future Miguel, or the first hire) read nothing else,
> read this. Last updated: July 2026.

## The one-paragraph version

A multi-country surf-camp ERP: **static HTML apps** (no framework, no build
step) served by **Vercel** from the `main` branch, talking directly to
**Supabase** (Postgres + RLS + Edge Functions + cron). Each app is one
self-contained `index.html` with inline CSS + JS. Security lives in the
database (RLS policies), not in the UI — the UI only *hides* things; Postgres
*enforces* them.

```
Browser (staff phone/laptop)
   │  supabase-js 2.110.4 (pinned CDN)
   ▼
Supabase Postgres ──── RLS policies (has_location_access, is_hq_member)
   │        ▲
   │        └── pg_cron → Edge Functions (gmail-sync, email-dispatch, …)
   ▼
Gmail API (shared mailbox groups@gotadaguasurf.com)
```

## The apps (all in this repo, each a folder with index.html)

| Path | What it is | Who uses it |
|---|---|---|
| `/` (root) | Login + app hub + **Settings → Team Access** (invites) | everyone |
| `/camp-hub` | Ops per location: Overview, Camp Tab POS, Ledger (local + HQ-paid invoices, totals by month/category), Weekly P&L. Location via `?location=<slug>` | camp managers + staff |
| `/camp-hub/camp-tab-inner.html` | The POS iframe inside camp-hub (charge guests, bar tab) | camp staff |
| `/surf-school` | Mobile-first rentals: new rental, open boards, history | school staff |
| `/contabilista` | Read-only page for the accountant (Goretti), opened with `?k=<token>` — no login. Per month: invoices with/without PDF, Santander debits with no expense row, Drive folder links, "visto" mark. Only `accountant_portal*` SECURITY DEFINER RPCs (`supabase/accountant-portal.sql`); tokens in `accountant_portal_tokens`; HQ 📦 panel gets links via `accountant_hq_links()` | Goretti + Miguel |
| `/hq` | Consolidated finance: Overview (profit, needs attention, result by month × location + CSV, Import bookings), Expenses, Month close (incl. «Faturas do email»), Cash flow, Investments | Miguel |
| `/crm` | B2B outreach: contacts, pipeline, templates, **drip campaigns**, shared Gmail | Miguel + sales |
| `/partners` | Partner commissions: who owes whom, month status, invoices, advances, statements (one page since 22 Oct 2026) | Miguel |
| `/prices` | Pricing catalog per location (tours, transfers, accommodation grid). Since 17 Nov 2026 the ONE source of transport vehicles, seats (`capacity`), people one paid transfer covers (`covers_pax`), Bookinglayer product (`bl_product`), driver cost and guest € price — `lib/transport-catalog.js` groups it, `GuestsTrips.pickVehicle` picks (bl_product row, then smallest capacity ≥ people, over → largest + «2nd vehicle?»), SQL `transport_vehicle_for` / `camp_trips_reprice` (`supabase/transport-catalog-one-source.sql`) do the same; no vehicle list or seed price anywhere else | Miguel + managers |
| `/instructors` | Instructor hours/payroll helper | Miguel |
| `/wild` | Wild Wednesday (weekly party): Overview (season P&L), Close night | Miguel + Max |
| `/suk` | The Suk (Manjar Lda restaurant + catering): Overview, Expenses (with «Without PDF»), Bank · Water ↔ Manjar | Miguel |

**One number, one formula (22 Oct 2026, `supabase/one-formula.sql`):** `hq_overview_rollup()` is the single source for revenue / expenses / profit per location and month (bookings realized only = Paid/Confirmed/Deposit paid; invoices not deleted, not duplicate, not Manjar, personal flagged; ledger slug resolved attributed_location → paid_from → location). `hq_doc_status(invoice)` is the single «has a document» rule (ok / isento / n/a / falta) used by the accountant view, `hq_todo`, the Month close, the Excel and the Suk. `hq_bank_unmatched_co(company, from, to)` is the single «bank debit without a line» rule (Suk uses it; Water keeps `hq_bank_unmatched`). The weekly digest reads the same rules. Never re-derive these in a page.

**Design v3 (22 Oct 2026, night) — `docs/DESIGN-SYSTEM.md` is the contract.** One sans-serif (Outfit; DM Serif Display dropped everywhere, DM Mono only via `.mono` for ids), type scale 24/18/15/14/12.5/11, 8px spacing, hairline cards with no resting shadow (`--r` 12, hover shadow only on clickable cards), 36px controls, pills for filters (active = ocean), badges for states, one primary button per view, `.empty-state`/`.skeleton`/`.status-msg` patterns, 74 line icons in `AppShell.icon`. Every page was also put through the UX audit in `docs/UX-AUDIT-2026-10-22.md` (English everywhere except `/contabilista/`; one name per concept, e.g. «Money from HQ»; no codes/slugs/«Supabase» in the UI; empty states that say what to do; nothing hidden on phones — stack instead). Pages keep only page-specific CSS; never redefine a shell class.

**One shell for every page (22 Oct 2026):** `lib/app-shell.css` is the design system (tokens, `.app-nav` header, cards, KPIs, scoped tables `.tbl-wrap table`/`table.tbl`, badges, buttons, fields, modal, toast, splash) and `lib/app-shell.js` holds the single app registry (`APPS`) plus `AppShell.mount(el, {app, tabs, location, actions})`, `AppShell.menu()`, `mountMenus()` (fills every `<nav class="app-switch-menu" data-app-menu>`), `setTab`, `toast`, `splash`, helpers. HQ, camp-hub, wild, suk, surf-school and instructors mount the shared nav; hub, prices, partners and CRM still keep their own header markup but take the menu from the registry. `business-shell.css/.js` are aliases. Rule: every page loads `/lib/app-shell.css` BEFORE its own `<style>` and `/lib/app-shell.js` in `<head>` (the mount script runs inline right after the `<nav id="appNav">`).

**Locations** (slug → currency): `sri-lanka` LKR · `morocco` MAD · `portugal`
EUR · `junior-camp` EUR · `surf-school` EUR. Currency is **pinned in JS**
(`LOCAL_CURRENCY_PINNED` in camp-hub) so a bad DB row can never stamp the
wrong currency. Companies: Water Movements Lda (PT), MGRP SARL (MA), Wave
Movements (LK).

## Access model (who sees what)

- `platform_profiles` — one row per auth user; `platform_role` ('owner',
  'location_manager', …).
- `workspaces` — one row per grantable area (slugs: `sri-lanka`, `portugal`,
  `surf-school`, `hq`, `crm`, `prices-*`, … NB: workspace slug `junior` maps
  to location slug `junior-camp`).
- `workspace_memberships` — (user, workspace, `can_view`, `can_edit`,
  `active`). **`can_edit=false` on a camp workspace means "Camp Tab only"** —
  same slug, restricted scope. Settings writes it; camp-hub's access guard
  redirects those users to `?view=camp-tab-only`.
- Owner bypass: `miguel@gotadaguasurf.com` short-circuits guards client-side;
  RLS still gates the data (owner has real memberships too).
- RLS helper functions in Postgres: `has_location_access(location_id)`,
  `is_hq_member()`. Never query `auth.users` inside a policy (permission
  denied for non-admin roles — bit us once).
- Invites (since 6 Nov 2026, `supabase/team-access-invites.sql`): Settings →
  `create-platform-invite` (one open invite per email, same token on resend;
  creates the auth user without any Supabase email, pre-creates memberships,
  sends `/?accept=<invitation_token>` through the shared Gmail) → the person
  opens the link and `accept-invite` (`--no-verify-jwt`) sets the password,
  stamps `password_set_at`, adds missing memberships, marks the invite
  accepted. The link has no 24 h limit: open until the password is created or
  the invite is cancelled (`expires_at` = 60-day safety net, `INVITE_VALID_DAYS`).
  Old Supabase links (`?invite=1`, `type=invite|recovery`) still work.
  Settings → Team lists each person as Active (last sign-in, from
  `team_access_people()`), Invited or Never signed in; Cancel invite /
  Deactivate are soft (invite canceled, profile + memberships inactive).

## The money flows (the three that matter)

1. **Camp POS → ledger**: Camp Tab charge → `ledger_entries`
   (type=revenue, location-scoped). Weekly close aggregates into P&L. All
   entries carry `paid_from` + `attributed_location` so HQ can split "who
   paid" vs "whose cost it economically is".
   Since 15 Nov 2026 a paid Camp Tab line is grouped: ONE row per guest ×
   payment day × product group (`source_kind = camp_tab_per_guest`, id
   `campguest_<guest>_<day>_<group>` → stable UUID). Drinks / Other = one row
   per category with an itemised description («Camp Tab · Anna · Drinks: Lion
   Lager ×5, Cocktail ×2»); Tours, Wild tickets and Merch = one row per
   product (`linked_item` + `qty`). The row is rebuilt from the Camp Tab state
   on every paid / unpaid message (never incremented); older one-row-per-item
   rows (`camp_tab_per_item`) stay and are left out of the group. Per-item
   analytics read `camp_tab_items`. Expense category «Drinks» = bar stock;
   «Drinking water» (area Food) = the dispenser, so the Overview «Bar»
   card is bar sales − bar drinks bought.

   **Comps (15 Nov 2026, `camp-hub/comps.js`):** a Camp Tab line at price 0
   is only added with a reason (staff · gift · compensation · marketing ·
   other + note), stored on `camp_tab_items.meta` (`comp_reason`,
   `comp_note`, `list_price`). A free line never reaches the ledger
   (`ledger_entries.is_comp` stays the Tour-expense «offered spot» flag);
   the Camp Tab «Comps» sub-tab and the Weekly P&L «Comps» line read the
   Camp Tab state. Old free lines show «No reason (before 15 Nov)».

   **Offers after the fact + Staff plus (17 Nov 2026):** «Make it an offer»
   under a tab line turns a charged, unpaid line free with the same reasons;
   the line stays (stock, Top sellers, bar counts), `meta.offer_from` keeps
   what it was so «Undo offer» restores it, `meta.comp_at/comp_by/comp_by_name`
   say when and who. A paid line is refused until «Mark unpaid» (which already
   takes its revenue out of the grouped checkout row), so no ledger row is ever
   rewritten for an offer. Staff plus (Sri Lanka only, `CampComps.STAFF_PLUS`:
   7 drinks a Sat–Fri week, category Drinks): a staff member flagged on the
   Staff roster (`camp_guests.meta.staffPlus`, every staff row with that name;
   Francisco and Federico/Frederico are Staff plus by `STAFF_PLUS.people`, every
   week, no switch)
   gets the first 7 drinks of the week free, reason «Staff plus allowance
   (k/7)»; from the 8th the staff price. Counted from the lines, never stored:
   a deleted or undone one frees a slot for the next drink (labels renumber,
   lines already charged stay charged). No SQL.

   **Dipløria (15 Nov 2026):** the brand's boardshorts are never camp revenue.
   Sri Lanka = pass-through (paid by card to the owner, no ledger row).
   Portugal = held: a paid line is a ledger TRANSFER «Into cash» (`money_sent`,
   method `Cash`, category `Dipløria`), so it is in no P&L (every sum, incl.
   `hq_overview_rollup`, reads revenue/expense rows only) but counts +cash;
   «Passed to Dipløria» (written from `/diploria/`) is a transfer «Out of cash»
   / «Out of bank», same category, `source_kind diploria_pass`. Owed by
   Portugal = paid Camp Tab lines − passes (`DiploriaCore.held`).
2. **Surf-school rental → ledger**: INSERT on `surf_school_rentals` fires the
   `tr_surf_rental_ledger` trigger (SECURITY DEFINER) which creates the
   `ledger_entries` revenue row atomically and stamps `ledger_entry_id` back.
   Deletes cascade BOTH directions (rental↔ledger). Client never writes the
   ledger for rentals — the trigger is the single source of truth.
3. **HQ invoices**: `hq_invoices` (+ `hq_recurring_expenses`,
   `hq_invoice_categories`), entered manually or via the `parse-invoice`
   Edge Function (Anthropic vision reads the PDF/photo). `internal_transfers`
   tracks money moving between the three companies. `bookings` (imported from
   Bookinglayer CSV) feeds revenue into HQ Overview.

## CRM email engine (Pipedrive-style, shared mailbox)

- All mail goes via **groups@gotadaguasurf.com** (OAuth refresh token in
  `gmail_account`, server-side only). Per-user display name on From.
- Send path: `gmail-send` Edge Function (single/instant sends, ≤5 recipients).
- **Bulk = drip campaigns**: client renders emails → `email_campaigns` +
  `email_queue` rows → `email-dispatch` Edge Function (pg_cron, every 5 min)
  sends ≤3/run with 20–50s gaps, window 08:30–19:30 Lisbon, per-campaign
  daily cap + global 150/day, auto-pause on Google 429/403.
- **Inbound**: `gmail-sync` (cron 5 min) pulls the shared inbox, matches
  senders to contacts, advances status, stops sequences, detects **bounces**
  (mailer-daemon → suppress dead address) and **unsubscribes** (keywords in
  the typed part of short replies → suppress + status 'excluded').
- `email_suppression` — the never-email-again list; dispatcher checks it
  before every send. `email_campaign_stats` view — reply rate per campaign.
- Naming trap: `outreach_contacts` = COMPANIES; `contacts` = PEOPLE
  (FK `company_id`). `email_messages` is the full audit of both directions.

## Cron jobs (pg_cron → net.http_post → Edge Function)

| Job | Schedule | Function |
|---|---|---|
| `gmail-sync-5min` | */5 min | inbox pull + reply/bounce/unsub detection |
| `email-dispatch-5min` | */5 min | drip campaign sender |
| `gotadagua_daily_backup` | 03:00 UTC | `daily-backup` (since 22 Oct 2026 also hq_invoices, hq_bank_movements, categories, Drive folders, partner invoices) |
| `drive-sync-4x` | 07,12,17,21 h | `drive-sync` — **has never run**: the cron command still carries the placeholder secret (401 on every call). To be rebuilt in wave 3 of docs/PLANO-interface-e-automacao.md |
| `run-sri-lanka-month-end` | 28–31 18:25 | `run-month-end` — same placeholder-secret problem, never ran |
| weekly digest | not scheduled | `hq-weekly-digest` (preview only from the HQ) |
| `mail-ingest-15min` | */15, all day (since 17 Nov 2026) | `mail-ingest`: Bookinglayer reports of accounting@ first (`reports.ts`), then the invoices |

**Bookinglayer reports by email (17 Nov 2026, `supabase/bl-report-ingest.sql`):** mail-ingest imports the hourly
«AUTO Marrocos / Sri Lanka - hourly para a app» camp reports with the camp hub's own rules (`lib/bl-report.js` via
`lib/bl-ingest.js`, copied to `supabase/functions/_shared/lib/` by `npm run sync:edge`), the daily «App - Revenue &
Partners» into `bookings` (`lib/bl-revenue.js`, every changed row snapshotted in `bookings_snapshots`), and archives only
report emails — never one with a PDF. The reports come with no attachment: only the «Download report» link to
https://downloads.bookinglayer.io/reports/… is fetched (20 MB, 30 s, redirects to cloud storage only); each CSV is kept 30 days
in the private bucket `bl-reports`. `bl_report_settings` holds dry run (default on) and archive (default off);
every email and every manual import is a row of `bl_report_runs`; Week shows the last one under its Import button.

The duplicate `gmail-sync-10min` job was removed on 22 Oct 2026.

## Development workflow

- **Canonical repo: `~/Documents/GitHub/gotadagua-deploy-clean`** (the
  Desktop copy is stale — don't edit it).
- Vercel deploys **only from `main`**. Auto-mode blocks Claude pushing to
  main; Miguel pushes (or merges a feature branch) after review.
- **Before any push: `npm test`** — 25 Playwright smoke tests (boot of every
  app logged-out + with session, surf-school pricing math, currency pins,
  CRM campaign plumbing). Hermetic: local static server + fake JWT that RLS
  rejects, zero risk to production data. First time on a machine:
  `npm install && npx playwright install chromium`.
- Schema changes = SQL files in `supabase/`, run manually in the Supabase SQL
  Editor (idempotent by convention: `create … if not exists`, `drop … if
  exists` before create). Edge Functions deploy via
  `supabase functions deploy <name>` (`--no-verify-jwt` for cron-invoked ones).
- Two-computer live sync happens through Supabase realtime
  (`location_state_store` and per-table subscriptions in camp-hub).

## Known traps (learned the hard way)

- Fresh-localStorage (incognito) boots hit TDZ errors if `let` declarations
  sit below code that runs at module load — the smoke suite's logged-out
  tier exists because of this.
- `?location=` used to silently fall back to `sri-lanka` for users without
  access (the "cafe@ sees LKR" bug) — `enforceLocationAccess` in camp-hub now
  fails closed. Don't reintroduce fallbacks.
- PostgREST caps responses at 1000 rows — paginate (`fetchAll` pattern in
  gmail-sync) for any table that can grow.
- Diagnose from real errors: surface the actual Supabase error message in a
  toast before speculating. Hours have been lost to silent catch blocks.
