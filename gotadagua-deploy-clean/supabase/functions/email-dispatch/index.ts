// ════════════════════════════════════════════════════════════════════════════
//  email-dispatch — the drip engine behind CRM campaigns
//
//  Invoked by pg_cron every 5 minutes (see crm-email-campaigns.sql). Each
//  run sends AT MOST `PER_RUN` emails across all running campaigns, with a
//  randomized 20–50s pause between each — so the mailbox never bursts.
//  Combined with the 5-min cadence that's a worst case of ~36 emails/hour,
//  and the caps below keep the daily total far under Google's radar.
//
//  Guards, in the order they're checked:
//    1. Send window   — campaign.window_start–window_end in its timezone
//    2. Global cap    — GLOBAL_DAILY_CAP across ALL outbound today
//                       (campaigns + manual sends, read from email_messages)
//    3. Campaign cap  — campaign.daily_cap sent today for that campaign
//    4. Stop-on-reply — inbound email from the same company since the
//                       campaign started → row skipped, not sent
//
//  After each send: email_messages row (audit), outreach_contacts status
//  auto-advance (not_started → first_email → follow_up), outreach_activity
//  log — identical bookkeeping to the old client-side batch, minus the
//  fragility.
//
//  Deploy:  supabase functions deploy email-dispatch --no-verify-jwt
//  Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (already set
//           for gmail-send; shared here).
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// How many emails one cron run may send, across all campaigns. 3 per
// 5-min run ≈ 36/hour max — human-plausible pacing.
const PER_RUN = 3
// Absolute daily ceiling for the shared mailbox: campaigns + manual
// compose + replies all counted (from email_messages.direction=outbound).
const GLOBAL_DAILY_CAP = 150
// Random pause between sends inside one run.
const GAP_MIN_MS = 20_000
const GAP_MAX_MS = 50_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

// ── Gmail helpers (same logic as gmail-send) ────────────────────────────
async function ensureAccessToken(supa: ReturnType<typeof createClient>) {
  const { data: acct, error } = await supa.from('gmail_account')
    .select('*').limit(1).single()
  if (error || !acct) throw new Error('No gmail_account row')
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0
  if (acct.access_token && expiresAt > Date.now() + 60_000) return { token: acct.access_token, account: acct }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: acct.refresh_token, grant_type: 'refresh_token',
    }),
  })
  if (!resp.ok) throw new Error(`Token refresh failed: HTTP ${resp.status}`)
  const tk = await resp.json() as { access_token: string; expires_in: number }
  const newExpiry = new Date(Date.now() + (tk.expires_in - 30) * 1000).toISOString()
  await supa.from('gmail_account').update({
    access_token: tk.access_token, access_expires_at: newExpiry,
    updated_at: new Date().toISOString(),
  }).eq('id', acct.id)
  return { token: tk.access_token, account: { ...acct, access_token: tk.access_token } }
}

function buildRaw(args: {
  fromEmail: string; fromDisplay: string;
  to: string; subject: string; body: string;
}) {
  const toUtf8 = (s: string) => unescape(encodeURIComponent(s || ''))
  const subjB64 = btoa(toUtf8(args.subject || ''))
  const escapedDisplay = (args.fromDisplay || '').replace(/"/g, "'")
  const fromHeader = escapedDisplay ? `"${escapedDisplay}" <${args.fromEmail}>` : args.fromEmail
  const lines = [
    `From: ${fromHeader}`,
    `Reply-To: ${args.fromEmail}`,
    `To: ${args.to}`,
    `Subject: =?utf-8?B?${subjB64}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ]
  const message = lines.join('\r\n') + '\r\n\r\n' + (args.body || '')
  return btoa(toUtf8(message)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Is `now` inside the campaign's local send window?
function insideWindow(campaign: { window_start: string; window_end: string; timezone: string }) {
  try {
    const now = new Date()
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: campaign.timezone || 'Europe/Lisbon',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now) // "14:37"
    const cur = local.replace(':', '')
    const start = (campaign.window_start || '08:30').slice(0, 5).replace(':', '')
    const end   = (campaign.window_end   || '19:30').slice(0, 5).replace(':', '')
    return cur >= start && cur <= end
  } catch { return true } // bad tz string → don't wedge the queue forever
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const summary = { sent: 0, skipped: 0, failed: 0, reason: '' }

  // 0. Any running campaigns at all? (Cheap early exit for most runs.)
  const { data: campaigns, error: campErr } = await supa
    .from('email_campaigns')
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: true })
  if (campErr) return json({ error: campErr.message }, 500)
  if (!campaigns?.length) return json({ ...summary, reason: 'no running campaigns' })

  // 1. Global daily cap — every outbound email today from the shared box.
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
  const { count: sentToday } = await supa
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .gte('sent_at', dayStart.toISOString())
  if ((sentToday ?? 0) >= GLOBAL_DAILY_CAP) {
    return json({ ...summary, reason: `global cap reached (${sentToday}/${GLOBAL_DAILY_CAP})` })
  }
  let budget = Math.min(PER_RUN, GLOBAL_DAILY_CAP - (sentToday ?? 0))

  for (const campaign of campaigns) {
    if (budget <= 0) break
    if (!insideWindow(campaign)) { continue }

    // 2. Campaign daily cap.
    const { count: campSentToday } = await supa
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'sent')
      .gte('sent_at', dayStart.toISOString())
    let campBudget = Math.min(budget, (campaign.daily_cap ?? 80) - (campSentToday ?? 0))
    if (campBudget <= 0) continue

    // 3. Pull the next pending rows for this campaign.
    const { data: rows } = await supa
      .from('email_queue')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(campBudget)
    if (!rows?.length) {
      // Nothing pending → campaign is finished.
      await supa.from('email_campaigns')
        .update({ status: 'done' }).eq('id', campaign.id).eq('status', 'running')
      continue
    }

    // Sender display name once per campaign.
    let displayName = ''
    if (campaign.sender_user_id) {
      const { data: tu } = await supa.from('team_users')
        .select('full_name, email').eq('id', campaign.sender_user_id).maybeSingle()
      displayName = (tu?.full_name || tu?.email || '').trim()
    }

    for (const row of rows) {
      if (budget <= 0) break

      // 4. Stop-on-reply: any inbound from this company since the campaign
      //    started means a human conversation is live — a templated drip
      //    landing mid-thread reads as robotic and can kill the deal.
      if (campaign.stop_on_reply && row.company_id) {
        const { count: replies } = await supa
          .from('email_messages')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', row.company_id)
          .eq('direction', 'inbound')
          .gte('created_at', campaign.created_at)
        if ((replies ?? 0) > 0) {
          await supa.from('email_queue').update({
            status: 'skipped', error: 'contact replied — drip stopped',
          }).eq('id', row.id)
          summary.skipped++
          continue
        }
      }

      // 5. Send.
      try {
        const { token, account } = await ensureAccessToken(supa)
        const raw = buildRaw({
          fromEmail: account.email, fromDisplay: displayName,
          to: row.to_email, subject: row.subject, body: row.body,
        })
        const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        })
        if (!resp.ok) {
          const errTxt = (await resp.text()).slice(0, 300)
          // 429/403 = Google throttling us — back off HARD: pause the
          // campaign so a human decides when to resume. Anything else is
          // per-row (bad address etc.), mark failed and continue.
          if (resp.status === 429 || resp.status === 403) {
            await supa.from('email_campaigns').update({ status: 'paused' }).eq('id', campaign.id)
            await supa.from('email_queue').update({
              attempts: (row.attempts ?? 0) + 1, error: `HTTP ${resp.status}: ${errTxt}`,
            }).eq('id', row.id)
            summary.reason = `campaign ${campaign.name} auto-paused on HTTP ${resp.status}`
            budget = 0
            break
          }
          throw new Error(`HTTP ${resp.status}: ${errTxt}`)
        }
        const sent = await resp.json() as { id: string; threadId: string }
        const nowIso = new Date().toISOString()

        await supa.from('email_queue').update({
          status: 'sent', sent_at: nowIso,
          provider_msg_id: sent.id, thread_id: sent.threadId,
          attempts: (row.attempts ?? 0) + 1,
        }).eq('id', row.id)

        // Bookkeeping — identical to what the client batch used to do.
        if (row.company_id) {
          await supa.from('email_messages').insert({
            company_id: row.company_id, contact_id: row.contact_id || null,
            direction: 'outbound', from_addr: account.email, to_addr: row.to_email,
            subject: row.subject, body: (row.body || '').slice(0, 8000),
            thread_id: sent.threadId, provider_msg_id: sent.id,
            status: 'sent', sent_at: nowIso,
            sender_user_id: campaign.sender_user_id || null,
          })
          const { data: contact } = await supa.from('outreach_contacts')
            .select('id, status').eq('id', row.company_id).maybeSingle()
          if (contact) {
            let newStatus = contact.status
            if (contact.status === 'not_started') newStatus = 'first_email'
            else if (contact.status === 'first_email') newStatus = 'follow_up'
            const patch: Record<string, unknown> = { last_contacted_at: nowIso }
            if (newStatus !== contact.status) patch.status = newStatus
            await supa.from('outreach_contacts').update(patch).eq('id', contact.id)
          }
          await supa.from('outreach_activity').insert({
            contact_id: row.company_id, action: 'email_sent',
            old_value: null, new_value: null,
            meta: { via: 'campaign', campaign_id: campaign.id, campaign_name: campaign.name, subject: row.subject },
            created_by: campaign.created_by || 'campaign-dispatch',
          })
        }

        summary.sent++
        budget--
        campBudget--

        // Human-plausible spacing inside the run.
        if (budget > 0 && campBudget > 0) {
          await sleep(GAP_MIN_MS + Math.floor(Math.random() * (GAP_MAX_MS - GAP_MIN_MS)))
        }
      } catch (e) {
        await supa.from('email_queue').update({
          status: 'failed', error: String((e as Error).message || e).slice(0, 500),
          attempts: (row.attempts ?? 0) + 1,
        }).eq('id', row.id)
        summary.failed++
      }
    }
  }

  return json(summary)
})
