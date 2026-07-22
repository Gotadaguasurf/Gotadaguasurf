# CRM email engine

Everything sends from one shared mailbox, **groups@gotadaguasurf.com**. The OAuth
refresh token lives server-side in `gmail_account`; no client ever holds it. Each
sender's display name comes from `team_users.full_name`, so the From reads as the
person while the mailbox stays shared.

## Naming trap

- `outreach_contacts` = **companies** (one row per business)
- `contacts` = **people** (many per company, FK `company_id`)

Get this backwards and every join is wrong. `email_messages` is the full audit of
both directions.

## Sending paths

**Instant** (≤5 recipients, replies, one-offs): `gmail-send` Edge Function. Verifies
the caller's JWT, refreshes the access token, builds RFC 2822, records
`email_messages`.

**Bulk = drip campaign** (6+ recipients). The client renders every email up front
(so editing a template later can't change what an in-flight campaign sends) and
inserts `email_campaigns` + `email_queue` rows. The `email-dispatch` Edge Function
(pg_cron, every 5 min) does the actual sending.

### Why a queue instead of a browser loop

The old batch send looped in the browser at 1 email/second. 200 emails in ~3.5
minutes from one mailbox is exactly the burst pattern Google's abuse heuristics
flag — and closing the tab killed the batch with no record of where it stopped.

### Dispatcher rules

Checked in order, each run:

1. **Send window** — `window_start`–`window_end` in the campaign's timezone
   (default 08:30–19:30 Europe/Lisbon). Emails at 3am read as spam.
2. **Global cap** — 150/day across *all* outbound (campaigns + manual + replies),
   counted from `email_messages`.
3. **Campaign cap** — `daily_cap`, default 80 (UI offers 50 warm-up / 80 safe /
   120 max).
4. **Stop-on-reply** — any inbound from that company since the campaign started
   skips their remaining queued mail. A templated drip landing mid-conversation
   kills deals.
5. **Suppression** — `email_suppression` checked per batch.

Pacing: ≤3 emails per 5-min run with 20–50s random gaps (~36/hour worst case).
On Google 429/403 the campaign **auto-pauses** rather than hammering.

Bookkeeping per send mirrors the old client path exactly: `email_messages` audit
row, `outreach_contacts` status auto-advance (not_started → first_email →
follow_up), `outreach_activity` log.

## Suppression, bounces, unsubscribes

`email_suppression` is the never-email-again list (`unsubscribe` | `bounce` |
`manual`, emails stored lowercase via trigger). Every campaign email carries a
one-line opt-out footer — a working opt-out means fewer spam complaints, and
complaints hurt reputation far more than unsubscribes do.

`gmail-sync` (cron, 5 min) detects both on the inbox pass:

- **Bounces** — DSNs from mailer-daemon/postmaster. The dead address is recovered
  via the DSN's thread → the original outbound's `to_addr`. Suppress + cancel
  pending queue rows + log `email_bounced`. Repeatedly mailing dead addresses is
  the top "you bought a list" signal.
- **Unsubscribes** — opt-out keywords (multi-language) in the **typed** part of a
  reply only. Quoted text is stripped first: our own footer contains the word
  "unsubscribe", so trusting the raw body would suppress every reply that quotes
  it. Capped at 400 chars — people asking out write two words, not four
  paragraphs. Suppress + cancel pending + set company `excluded` + log. These
  companies are excluded from the replied/in_conversation advance: "leave me
  alone" must not land in the hot-leads shelf.

## Analytics

`email_campaign_stats` view (security_invoker): `sent_count` and `replied_count`
per campaign. A reply = a distinct company with any inbound **after** their queue
row's `sent_at`, so one chatty contact can't inflate the rate. The Campaigns
section (Sequences tab) shows progress, pause/resume/cancel, reply rate, and a
per-template rollup that crowns the winner across campaigns.

## Deliverability (outside the code)

Throttling stops the account being blocked; it does **not** decide inbox vs spam.
That is DNS: SPF, DKIM, DMARC on gotadaguasurf.com. As of last check DKIM and
DMARC are fine but the SPF record ends `~al` instead of `~all` (a missing L),
which can invalidate it. Fix in GoDaddy DNS, then verify with mail-tester.com —
9+/10 before any large campaign.

## Tables

`email_campaigns`, `email_queue`, `email_suppression`, `email_messages`,
`email_campaign_stats` (view), `gmail_account`, `outreach_contacts`, `contacts`,
`outreach_activity`, `outreach_sequences`, `outreach_sequence_runs`,
`outreach_templates`, `pipelines`, `pipeline_stages`, `contact_pipeline`, `tasks`.
