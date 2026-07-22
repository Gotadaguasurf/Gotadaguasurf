---
name: gotadagua-platform
description: Complete map of the Gota d'Água surf-camp platform — its 8 apps (camp-hub POS, HQ finance, CRM, prices, partners, surf-school, instructors, root/settings), the Supabase schema and RLS access model, the three money flows, deploy workflow, and the known traps that have caused real data loss. Use this skill for ANY work on this codebase: adding features, fixing bugs, writing SQL for Supabase, importing expenses or bookings, touching the POS/Camp Tab, the CRM email engine, invoices, pricing, or team access — even when the request sounds simple ("add a tab", "import this CSV", "why is this showing the wrong currency"). Also use it when asked how the platform works, where something lives, or what a table/column means.
---

# Gota d'Água Platform

A multi-country surf-camp ERP run by one owner (Miguel, miguel@gotadaguasurf.com).
Static HTML apps on Vercel talking straight to Supabase. **No framework, no build
step** — each app is one self-contained `index.html` with inline CSS + JS.

```
Browser ──supabase-js 2.110.4 (pinned CDN)──▶ Supabase Postgres
                                              │  RLS policies
                                              │  pg_cron ─▶ Edge Functions
                                              ▼
                                        Gmail API (groups@gotadaguasurf.com)
```

**Canonical repo: `~/Documents/GitHub/gotadagua-deploy-clean`.** A stale copy
exists at `~/Desktop/Gotadaguasurf-main/` — never edit that one; check you are in
the Documents path before writing.

## Before you touch anything

1. **Read the relevant reference file below** — the subtleties are where the bugs live.
2. **`npm test` before every push.** 31 Playwright smoke tests, ~1 min, hermetic
   (local static server + a fake JWT that RLS rejects, so it cannot touch production).
3. **Never push to main without the user asking.** Vercel deploys from `main` only.
   Auto-mode blocks it; the user runs `git push origin main` themselves.

## The apps

| Path | What it is | Notes |
|---|---|---|
| `/` | Login + app hub + **Settings → Team Access** (invites) | `index.html` at repo root |
| `/camp-hub` | Per-location ops: Overview, Camp Tab (POS), Operations Ledger, Weekly P&L | location via `?location=<slug>` |
| `/camp-hub/camp-tab-inner.html` | The POS itself, **an iframe** inside camp-hub | ⚠️ see POS trap below |
| `/surf-school` | Mobile-first board/wetsuit rentals | own app, embeds in camp-hub via `?embedded=1` |
| `/hq` | Consolidated finance: profit per location, Despesas HQ (invoices + AI extract), cash flow per company | owner-facing |
| `/crm` | B2B outreach: contacts, pipeline, templates, drip campaigns, shared Gmail | see `references/crm-email.md` |
| `/prices` | Pricing catalog per location — **the master source for POS menus** | |
| `/partners` | Partner commissions | |
| `/instructors` | Instructor hours | |

**Locations** (slug → currency): `sri-lanka` LKR · `morocco` MAD · `portugal` EUR ·
`junior-camp` EUR · `surf-school` EUR. Currency is **pinned in JS**
(`LOCAL_CURRENCY_PINNED` in camp-hub) so a bad DB row can never stamp the wrong one.

**Legal entities**: Water Movements Lda (PT) · MGRP SARL (MA) · Wave Movements (LK).
Never mix Morocco camp-hub data into HQ operations for another entity.

## Access model

- `platform_profiles` — one row per auth user, `platform_role` ('owner', 'admin',
  'location_manager', …).
- `workspaces` — one row per grantable area. Slugs mirror location slugs plus `hq`,
  `crm`, `prices-*`. **Trap**: workspace slug `junior` maps to location slug
  `junior-camp`.
- `workspace_memberships` — (user, workspace, `can_view`, `can_edit`, `active`).
  **`can_edit=false` on a camp workspace means "Camp Tab only"** — same slug,
  restricted scope. There is no separate `-camp-tab` workspace; deriving scope from
  the slug is a bug that shipped once.
- RLS helpers in Postgres: `has_location_access(location_id)`, `is_hq_member()`.
  **Never query `auth.users` inside a policy** — it runs as the caller role and
  fails with "permission denied for table users". Use `auth.jwt()->>'email'`.
- Owner allow-list lives in `/owner-config.js` (`window.__PLATFORM_OWNER_EMAILS`),
  read by 8 client-side bypass sites. Client-side convenience only — RLS is the
  real enforcement.
- Invites: Settings → `create-platform-invite` Edge Function → writes
  `workspace_invitations` + `invitation_workspace_access` and pre-creates
  memberships. Verified working end-to-end.

## The three money flows

1. **Camp POS → ledger.** A Camp Tab charge writes `ledger_entries`
   (type=revenue, location-scoped). Every row carries `paid_from` +
   `attributed_location` so HQ can split "who paid" from "whose cost it is".
2. **Surf-school rental → ledger.** INSERT on `surf_school_rentals` fires
   `tr_surf_rental_ledger` (SECURITY DEFINER) which creates the revenue row and
   stamps `ledger_entry_id` back, atomically. Deletes cascade **both** directions.
   The client never writes the ledger for rentals.
3. **HQ invoices.** `hq_invoices` (+ `hq_recurring_expenses`,
   `hq_invoice_categories`), entered manually or via `parse-invoice` (Anthropic
   vision reads the PDF/photo). `internal_transfers` moves money between entities.
   `bookings` (Bookinglayer CSV) feeds revenue.

**Camp expenses vs HQ invoices** — a recurring confusion worth getting right:
expenses paid from the camp's local float belong in `ledger_entries`
(Operations Ledger, shows as "Local expenses" in HQ). Only invoices the HQ pays
belong in `hq_invoices`. If the user says "these are the location's expenses",
they mean the ledger. See `references/sql-recipes.md` for the migration recipe.

## Deploy workflow

```bash
cd ~/Documents/GitHub/gotadagua-deploy-clean
npm test                 # 31 smoke tests — must be green
git push origin main     # user runs this; Vercel deploys in ~1 min
```

- **Schema changes are SQL files in `supabase/`**, run by hand in the Supabase SQL
  Editor. Idempotent by convention (`create … if not exists`, `drop … if exists`
  before create, `on conflict do …`). ~100 files live there as history.
- **Order matters**: when code reads a new column, run the SQL *before* pushing.
- Edge Functions: `supabase functions deploy <name>` (add `--no-verify-jwt` for
  cron-invoked ones). Deployed: create-platform-invite, remove-platform-user,
  gmail-oauth, gmail-send, gmail-sync, email-dispatch, parse-invoice,
  daily-backup, hq-weekly-digest.
- Cron (pg_cron → pg_net → Edge Function): `gmail-sync-5min`,
  `email-dispatch-5min`, daily backup, weekly digest.
- **Give the user SQL as a copy-paste block in chat**, not just a file path — that
  is how they run it. End every block with a sanity `select` and state the expected
  numbers so they can self-verify.
- Terminal commands: **no inline `#` comments** — zsh passes them as arguments and
  breaks the command.

## Known traps

These all caused real incidents. Read the relevant reference before touching that area.

- **Never open `/camp-hub/camp-tab-inner.html` directly.** It is an iframe fed by
  its parent. Standalone it boots with the Sri Lanka `DEFAULT_MENU` and the menu
  sync is delete-all-then-write — this replaced Portugal's entire POS menu once.
  A `MENU_HYDRATED` guard now blocks the write, but always go via
  `/camp-hub?location=<slug>` → Camp Tab. Cache-stale iframe? Cmd+Shift+R.
- **Fail closed on access.** `?location=` used to silently fall back to
  `sri-lanka` for users without access — a Portugal-only user saw LKR prices
  ("the cafe@ bug"). `enforceLocationAccess` now blocks with a picker. Don't
  reintroduce fallbacks.
- **PostgREST caps responses at 1000 rows.** Paginate anything that can grow
  (see the `fetchAll` pattern in gmail-sync).
- **Fresh-localStorage (incognito) boots** hit TDZ errors if `let` declarations sit
  below code that runs at module load. The logged-out smoke tests exist for this.
- **Diagnose from real errors.** Surface the actual Supabase error in a toast
  before speculating — hours have been lost to silent catch blocks.
- **`team_users.role` is cosmetic** (CRM display only). Permissions come from
  `workspace_memberships` + `platform_profiles`.

## Reference files

Read the one matching your task — each has the detail this map omits.

- **`references/pos-camp-tab.md`** — the POS: iframe contract, catalog→menu push,
  category tabs per location, the stock models (Merch family-grouped vs standalone),
  guest lifecycle and History. Read before any Camp Tab work.
- **`references/crm-email.md`** — the drip engine: campaign queue, sending caps and
  windows, suppression/bounce/unsubscribe, reply-rate analytics, shared mailbox.
  Read before touching CRM email.
- **`references/sql-recipes.md`** — the SQL patterns used over and over: importing
  camp expenses, seeding POS stock, restoring a corrupted menu, diagnosing access,
  sanity queries. Start here for any data task.
- **`ARCHITECTURE.md`** (repo root) — the older 2-page summary; this skill supersedes
  it but it stays as a quick orientation doc.
