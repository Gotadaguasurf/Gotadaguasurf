# Code Review — July 2026

Findings from a focused three-track review (POS money paths · financial
server-side · security surface). Three independent reviewers read the critical
paths end-to-end; the top 5 were re-verified by hand against the code. Nothing
here is speculative — each item cites a real file:line and a concrete failure.

**Status: reported, not yet fixed.** Ordered by severity. The app works day to
day; most of these need either a malicious authenticated user or a rare timing
coincidence. But the security items (esp. #1–#2) and POS money items (#7–#8)
should be fixed before widening staff access.

Verified-sound areas are listed at the bottom so future work doesn't re-check them.

---

## CRITICAL — Security

### S1. Privilege escalation via create-platform-invite
`supabase/functions/create-platform-invite/index.ts:56-88, 177-256`
The auth gate accepts `can_manage_team=true` on **any single workspace** (a
location-level grant), then lets that caller set the invitee's `role` to anything
except `super_admin` — **including `admin`, which `is_global_admin()` treats as
full cross-location access** — and grant `accessRows` for any workspace incl. HQ.
No check that granted role ≤ caller's role, or granted workspaces ⊆ caller's.
- **Attack:** a Morocco camp manager invites `attacker@x.com` as `role:'admin'` →
  new account is global admin over all locations + HQ finances.
- **Fix direction:** require platform_role in (owner, admin) to invite admins;
  clamp granted role to ≤ caller's; restrict accessRows to workspaces the caller
  actually manages.

### S2. Non-owner can delete any user via remove-platform-user
`supabase/functions/remove-platform-user/index.ts:39-65, 73-103`
Same weak gate (`can_manage_team` on one workspace). Only guard is "can't remove
yourself." A location manager can `deleteUser()` the owner or any admin (cascade
wipes profile + memberships).
- **Fix direction:** same clamp as S1 — only owner/admin (or super_admin) may
  remove users, and never someone of ≥ their own role.

### S3. Anonymous can burn the shared-mailbox quota (email-dispatch)
`supabase/functions/email-dispatch/index.ts:23, 119-141` — deployed
`--no-verify-jwt`, no CRON secret, no internal auth.
Any anonymous POST forces drip sends of real cold emails up to 150/day, outside
pacing → sender-reputation / deliverability damage for groups@gotadaguasurf.com.
`gmail-sync` is also `--no-verify-jwt` but only polls the inbox → low blast radius.
- **Fix direction:** add a shared-secret header the cron sends and the function
  checks (`Deno.env` + the pg_cron `net.http_post` header). Cheap, closes both.

### S4. Entire CRM is unscoped — full contact DB readable/writable by any login
`crm-v2-schema-expansion.sql:186-199`, `crm-email-campaigns.sql:76-81`,
`crm-email-suppression.sql:38`, `create-outreach-crm.sql:134-160`
All `for all to authenticated using (true) with check (true)`. Never
location-scoped (phase 7 doesn't touch them).
- **Attack:** a camp-tab-only staffer exfiltrates every partner/lead email +
  note + pipeline via one REST query, or deletes the suppression list so
  unsubscribed contacts get re-mailed.
- **Fix direction:** gate these to CRM-workspace members (a `has_crm_access()`
  helper mirroring `is_hq_member()`), not blanket-authenticated.

### S5. Stored XSS — POS + CRM render DB strings into innerHTML unescaped
- POS: `camp-hub/camp-tab-inner.html:2651, 2670` (`${item.n}`/`${item.d}`), `:2490`
  (`${displayName}` guest name). The local `esc()` at `:2167` only escapes for the
  JS-string/onclick context, **not** HTML.
- CRM: `crm/index.html:5086` (`template_name`), `:5114-5116` (group `title`).
  `activityLabel()` escapes subject/body but not these meta fields.
`pricing_catalog` and `outreach_activity.meta` are both writable by any
authenticated user (see S4 / S7-below).
- **Attack:** staffer sets a menu item name or activity meta to
  `<img src=x onerror=...>` → runs in the owner's session when they open that POS /
  contact, driving S1/S2 as the owner.
- **Fix direction:** an HTML-escaping helper applied at every DB-string→innerHTML
  interpolation on these render paths.

---

## CRITICAL — Money (POS)

### M7. "Mark paid" in the Bill modal records zero revenue (per_guest mode)
`camp-hub/camp-tab-inner.html:3290` — `billPayBtn.onclick` does
`g.paid=true; save();` with no mode check, no per-item `paidAt` stamps, no
postMessage to the hub.
- **Scenario (Portugal/Morocco):** staff open Bill, tap "Mark paid" → guest shows
  fully paid (isGuestFullyPaid falls back to `!!g.paid`), Close enables, "Pay all"
  then refuses ("Already paid"). No ledger row ever written and the UI can't
  recover it. Entire tab's revenue silently missing from `ledger_entries`.
- **Fix direction:** in per_guest mode, route the Bill "Mark paid" through the
  same `payItem` loop that "Pay all" uses (stamps paidAt + writes ledger).

### M8. Unpaying one item deletes the ledger rows of all identical items
`camp-hub/index.html:9784-9795` (`camp-tab-item-unpaid` fallback sweep). Removes
every `camp_tab_per_item` row matching description + date + amount, not just the
target UUID.
- **Scenario:** John pays 2× Beer €3 same day → unpay Beer #1 → both ledger rows
  deleted, but Beer #2 still shows a green Paid pill. €3 lost. Same cascade in
  `delItem` (`camp-tab-inner.html:3072-3083`).
- **Fix direction:** the deterministic UUID match is already correct; drop the
  description+amount fallback sweep, or scope it to a single row (`LIMIT 1` on the
  earliest unmatched).

### M9. CSV import doesn't detect duplicates against the DB
`hq/index.html:3529-3532` selects `invoice_number, amount, company, invoice_date`
— no `id` — but `existingBySig` only adds `if (… && r.id)`, so the map is always
empty, `dupAgainstDb` always false. Rows already in the DB import as
`is_duplicate=false`. The UI (line 3303) promises the opposite.
- **Scenario:** re-importing the master CSV after a partial import → every
  overlapping row lands unflagged, doubling expense totals, nothing in the
  "Only duplicates" filter catches it.
- **Fix direction:** add `id` to the select (one word). The `existingKeys`-based
  `dupRows`/`newRows` path already works and is dead code — could reuse it.

---

## HIGH

### M4. Cashflow tab counts soft-deleted invoices
`hq/index.html:3972` (`renderCashflow`) fetches `hq_invoices` with **no**
`.is('deleted_at', null)`. Every other money reader has it. Soft-deleted invoices
still show as expenses-out and inter-company debt → Cashflow permanently disagrees
with Overview/Despesas. (Line 3953 period-dropdown also lacks it — cosmetic.)
- **Fix:** add `.is('deleted_at', null)` to line 3972.

### M-rental. Deleting a linked rental directly raises a Postgres error
`supabase/surf-school-rentals-ledger-trigger.sql:92-156` — bidirectional
BEFORE-DELETE cascade hits "tuple already modified by current command" when the
rental is the outer DELETE target. UI usually survives because `deleteRental`
(surf-school/index.html:1001-1005) deletes the ledger row first, but that step is
`.catch(()=>{})`; any SQL-editor/import delete of a linked rental always errors.
- **Fix direction:** make the reverse-cascade an AFTER trigger, or have the
  ledger-side trigger skip rentals currently mid-delete.

### M-pay-fail. Payment succeeds locally even when the ledger write fails
`camp-hub/camp-tab-inner.html:3143-3149` stamps `paidAt` + saves before posting
`camp-tab-item-paid`; hub `upsertClosedWeekIncome` returns false on failure and
nothing retries per-item rows (reconcile only rebuilds weekly `campclose_`).
WiFi drop mid-payment → item shows Paid forever, ledger row never exists. The
failure toast even says it'll retry (untrue for per-item).
- **Fix direction:** a pending-write queue for per-item ledger rows, replayed on
  reconnect (mirror the weekly reconcile path for camp_tab_per_item).

### M-guest-name. Deleting a closed guest deletes a same-named guest's revenue
`camp-hub/index.html:9720-9728` sweeps by name-only description prefix. Closed
"John" + active "John" → deleting the closed one nukes active John's ledger rows.
- **Fix direction:** include the guest id in the ledger description/match, or key
  the sweep on guest id rather than name.

---

## MEDIUM

- **M5. Trigger writes amount_eur=0 for non-EUR rentals**
  `surf-school-rentals-ledger-trigger.sql:73-74, 200-201`. Latent (rental UI is
  EUR-only) but a Sri Lanka surf-school would vanish from HQ revenue. Fix: compute
  amount_eur via a real fx_rate, or fetch it like the ledger path does.
- **M6. saveInvoice can store amount_eur inconsistent with its own fx_rate**
  `hq/index.html:1579-1588` — takes the stale displayed EUR field after
  auto-fetching a new fx. Non-EUR invoice entered while Frankfurter was down →
  ~10× overstated amount_eur. Fix: recompute amount_eur from the freshly-fetched
  fx at save, don't trust the displayed field.
- **email-dispatch double-send.** No queue-row claiming; rows stay `pending` until
  after a successful send. Two overlapping runs send the same 3 rows twice. Cron
  overlap unlikely (~110s vs 300s), but S3 makes it externally triggerable. Fix:
  mark rows `sending` in a claim step before the send loop.
- **gmail-sync dies on one malformed Date header**
  `gmail-sync/index.ts:363` — `new Date(headers.date).toISOString()` throws inside
  the loop before the upsert → whole run 500s, re-fetches the bad message every
  5 min for 7 days, processing no replies/bounces meanwhile. Fix: guard the date
  parse (fallback to null).
- **gmail-sync unpaginated messages.list caps at 500**
  `gmail-sync/index.ts:267-268` over `in:inbox newer_than:7d` (all inbox mail).
  A busy week drops the oldest → a missed reply keeps a lead getting dripped. Fix:
  page with `pageToken`, or narrow the query.
- **email_messages global-cap escape.** Sends where `company_id` is null never
  land in `email_messages`, so they don't count toward the 150/day cap.

## LOW

- **S6/CORS.** Wildcard `Access-Control-Allow-Origin: *` on the privileged
  functions — amplifies the XSS findings (cross-site fetch with the victim's JWT).
- **M-hq-audit.** `hq_invoice_audit` is `for all to authenticated using (true)`
  (`hq-invoices-soft-delete.sql:32-49`) — its `snapshot` holds the full invoice
  row, bypassing the phase-7 HQ SELECT gate. Any authenticated user reads deleted
  invoice financials / forges audit rows. Fix: gate to `is_hq_member()`.
- **M-rentals-rls.** UI gates rental delete on `can_edit`, but RLS checks only
  `has_location_access` (`surf-school-rentals-schema.sql:115-134`) — a
  camp-tab-only staffer can insert/update/delete rentals via API, and the
  security-definer trigger then writes the ledger. Fix: tighten the rental
  write policies to require full (`can_edit`) access.
- **phase-7 dependency.** Cross-location read isolation exists only if
  `tighten-rls-phase7` was actually run, and even then pricing_catalog,
  accommodation_*, and the CRM tables were never added to it. Confirm phase 7 is
  deployed and extend its table list.
- **Discount quick-buttons store unrounded prices**
  `camp-tab-inner.html:2947-2949` — cent-level drift between bill total and ledger
  sum. Negative prices are correctly blocked.
- **Recurring "▶ Now" double-spawns** `hq/index.html:2255→2354` — no due-check, no
  dedup; clicking twice inserts two identical invoices.

---

## Verified sound (don't re-check)

- Secrets: only the anon JWT in client files; no service_role / client_secret.
- Gmail refresh tokens: `gmail_account` locked `using(false) with check(false)`.
- `audit_log`: read gated to owner/admin, writes trigger-only.
- DELETE on core financial tables: gated to owner/admin / `has_full_location_access`.
- `parse-invoice` / `daily-backup`: verify a JWT.
- Double-click on Pay: `paidAt` stamped synchronously → idempotent; hub upsert
  keyed by deterministic id → no dup rows.
- `syncClosedWeekIncome` idempotency + `deletedCampcloseIds` resurrection block.
- Trigger basics: missing-locations fallback, `search_path` pinned, INSERT fires
  only when `ledger_entry_id` null.
- Dispatcher caps/window logic (aside from the claiming gap).
- gmail-sync matching guards (FREE_EMAIL_DOMAINS, own-domain/email split,
  quote-strip + 400-char unsub cap); DB-side pagination correct.
- Menu dedup (upsert + unique index), soft-delete filters on all readers EXCEPT
  the two flagged above.
