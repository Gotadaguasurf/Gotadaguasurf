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
| `/camp-hub` | Ops per location: Overview, Camp Tab POS, Operations Ledger, Weekly P&L. Location via `?location=<slug>` | camp managers + staff |
| `/camp-hub/camp-tab-inner.html` | The POS iframe inside camp-hub (charge guests, bar tab) | camp staff |
| `/surf-school` | Mobile-first rentals: new rental, open boards, history | school staff |
| `/hq` | Consolidated finance: profit per location, Despesas HQ (invoices + AI extract), cash flow per company | Miguel |
| `/crm` | B2B outreach: contacts, pipeline, templates, **drip campaigns**, shared Gmail | Miguel + sales |
| `/partners` | Partner commissions tracking | Miguel |
| `/prices` | Pricing catalog per location (tours, transfers, accommodation grid) | Miguel + managers |
| `/instructors` | Instructor hours/payroll helper | Miguel |

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
- Invites: Settings → `create-platform-invite` Edge Function →
  `workspace_invitations` + `invitation_workspace_access`; the person sets a
  password via the invite link.

## The money flows (the three that matter)

1. **Camp POS → ledger**: Camp Tab charge → `ledger_entries`
   (type=revenue, location-scoped). Weekly close aggregates into P&L. All
   entries carry `paid_from` + `attributed_location` so HQ can split "who
   paid" vs "whose cost it economically is".
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
| daily backup | daily | `daily-backup` |
| weekly digest | weekly | `hq-weekly-digest` |

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
