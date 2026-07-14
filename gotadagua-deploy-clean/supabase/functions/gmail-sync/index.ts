// ════════════════════════════════════════════════════════════════════════════
//  gmail-sync — server-side polling of the shared mailbox (groups@)
//
//  GET/POST .../gmail-sync   → triggers an incremental pull. Returns
//                              { ok, fetched, newInbound, matched, advanced }.
//
//  Designed to be safe to call from:
//   - The CRM's manual "Sync inbox" button (browser fetch — no auth needed
//     because we deploy with --no-verify-jwt; worst case is an extra poll)
//   - pg_cron / supabase scheduled trigger every ~5 minutes
//
//  Mirrors the browser-side sync logic but reads from groups@ via the
//  shared refresh token in gmail_account. Inbound rows land in
//  email_messages with thread_id so the existing activity log links
//  them back to the original outbound automatically.
//
//  Secrets required:
//    GOOGLE_OAUTH_CLIENT_ID
//    GOOGLE_OAUTH_CLIENT_SECRET
//    SUPABASE_URL                (set by Supabase)
//    SUPABASE_SERVICE_ROLE_KEY   (set by Supabase)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// Hard-coded list of free providers we MUST NOT match by domain — a
// reply from a personal gmail would otherwise stick to the first random
// gmail-using lead in the table.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.fr','yahoo.es',
  'hotmail.com','hotmail.co.uk','hotmail.fr','outlook.com','outlook.fr','live.com',
  'icloud.com','me.com','mac.com','aol.com','protonmail.com','proton.me',
  'gmx.com','gmx.de','mail.com','msn.com','yandex.com','yandex.ru',
  'zoho.com','tutanota.com','fastmail.com','sapo.pt','mail.ru',
])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

// Refresh the shared mailbox's access token in-place when expired.
// Mirrors gmail-send's helper; duplicated here so each function can be
// deployed independently without a shared module.
async function ensureAccessToken(supa: ReturnType<typeof createClient>) {
  const { data: acct, error } = await supa.from('gmail_account')
    .select('*').limit(1).single()
  if (error || !acct) throw new Error('No gmail_account row — admin must visit /gmail-oauth/start first')
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0
  if (acct.access_token && expiresAt > Date.now() + 60_000) return { token: acct.access_token, account: acct }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: acct.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!resp.ok) throw new Error(`Token refresh failed: HTTP ${resp.status} ${await resp.text()}`)
  const tk = await resp.json() as { access_token: string; expires_in: number }
  const newExpiry = new Date(Date.now() + (tk.expires_in - 30) * 1000).toISOString()
  await supa.from('gmail_account').update({
    access_token: tk.access_token,
    access_expires_at: newExpiry,
    updated_at: new Date().toISOString(),
  }).eq('id', acct.id)
  return { token: tk.access_token, account: { ...acct, access_token: tk.access_token, access_expires_at: newExpiry } }
}

// Extracts the email portion from a From header: "Name <a@b>" → "a@b".
function parseEmail(header: string | undefined): string | null {
  if (!header) return null
  const m = header.match(/<([^>]+)>/)
  const email = (m ? m[1] : header).trim().toLowerCase()
  return email.includes('@') ? email : null
}

// Gmail returns each MIME part body in base64url. Decode to UTF-8.
function decodeB64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
    // atob is binary; decodeURIComponent + escape preserves UTF-8.
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4))
    return decodeURIComponent(escape(bin))
  } catch { return '' }
}

// Crude HTML → text: strip tags, collapse whitespace. Good enough for
// preview; we keep the original HTML available if we want to render
// rich later.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Walks a Gmail message's MIME payload looking for the best body to
// store. Prefers text/plain; falls back to text/html (stripped).
// Returns up to ~8KB so we don't bloat the DB with massive newsletters.
function extractBody(payload: any): string {
  if (!payload) return ''
  const parts: any[] = []
  const walk = (p: any) => {
    if (!p) return
    parts.push(p)
    if (Array.isArray(p.parts)) p.parts.forEach(walk)
  }
  walk(payload)
  const plain = parts.find(p => p.mimeType === 'text/plain' && p.body?.data)
  if (plain) return decodeB64Url(plain.body.data).slice(0, 8000)
  const html = parts.find(p => p.mimeType === 'text/html' && p.body?.data)
  if (html) return htmlToText(decodeB64Url(html.body.data)).slice(0, 8000)
  return ''
}

// We previously built a giant (from:@d1 OR from:@d2 OR from:a@b OR ...)
// query but Gmail caps query length and our 100-entry cap silently
// dropped every specific gmail.com/hotmail.com address — so personal
// replies from those domains were never matched. Now we just pull the
// recent inbox window and match each message's From client-side
// against the CRM tables. More metadata fetches but bounded by inbox
// volume, not contact count.
function buildInboxQuery(days = 7): string {
  return `in:inbox newer_than:${days}d`
}

// ── Suppression detection helpers ────────────────────────────────────────

// Delivery-failure notifications. From is the strongest signal;
// subject patterns catch non-Google MTAs.
function isBounce(fromEmail: string, subject: string): boolean {
  if (/^(mailer-daemon|postmaster)@/i.test(fromEmail)) return true
  return /delivery status notification|undeliver|returned mail|failure notice|delivery has failed|address not found|mail delivery failed/i
    .test(subject || '')
}

// Keep only the text the person actually typed: drop ">"-quoted lines
// and everything below the "On ... wrote:" marker. Critical for
// unsubscribe detection — our own footer says 'reply "unsubscribe"',
// so a genuine interested reply that QUOTES our email would otherwise
// trip the keyword match and suppress an engaged lead.
function replyTextOnly(body: string): string {
  const lines = (body || '').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (/^On .{5,120} wrote:\s*$/.test(t)) break
    if (/^-{2,}\s*(Original|Forwarded) Message/i.test(t)) break
    if (t.startsWith('>')) continue
    out.push(line)
  }
  return out.join('\n').trim()
}

// Opt-out intent, multi-language. Only trusted on SHORT typed replies —
// people asking out write two words, not four paragraphs; a long reply
// that merely mentions "unsubscribe" is conversation, not opt-out.
function isUnsubscribe(body: string): { hit: boolean; keyword?: string } {
  const typed = replyTextOnly(body)
  if (!typed || typed.length > 400) return { hit: false }
  const m = typed.match(
    /\b(unsubscribe|remove me|stop email(ing)?|opt.?out|remover|desinscrever|n[aã]o quero receber|no quiero recibir|d[eé]sinscrire|abmelden)\b/i
  )
  return m ? { hit: true, keyword: m[1] } : { hit: false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ?debug=1 returns the built query + raw Gmail list response so we
  // can see WHY a sync returned 0 messages without redeploying with logs.
  const url = new URL(req.url)
  const debug = url.searchParams.get('debug') === '1'
  const dbg: Record<string, unknown> = {}

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    // 1. Load CRM contacts (companies + people) so we know what
    //    emails to match against. Pull all in one go — even 5k rows
    //    is small. People is the priority match (specific contact);
    //    companies are fallback.
    // Note the legacy naming: `outreach_contacts` is the COMPANIES
    // table (one row per business), and `contacts` is the people
    // table (multiple humans per company, FK = company_id).
    // PostgREST silently caps at 1000 rows per response. Paginate so
    // a CRM with >1000 companies / people doesn't miss matches — that
    // was hiding contacts like "1 Miguel teste" beyond the first page.
    async function fetchAll(table: string, columns: string): Promise<any[]> {
      const out: any[] = []
      let from = 0
      const PAGE = 1000
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supa.from(table).select(columns).range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        out.push(...data)
        if (data.length < PAGE) break
        from += PAGE
        if (from > 50000) break  // safety stop; we should never hit this
      }
      return out
    }
    const [contacts, people, teamUsers] = await Promise.all([
      fetchAll('outreach_contacts', 'id, email, status'),
      fetchAll('contacts', 'id, company_id, email'),
      fetchAll('team_users', 'email'),
    ])
    // Own-domain filter: only the WORK domain (gotadaguasurf.com) counts
    // as "ours". If a team_user uses a personal gmail/hotmail as their
    // login, we must NOT add gmail.com to ownDomains — that would silently
    // skip every legitimate reply from any client on the same free
    // provider. Specific personal emails of team members get filtered by
    // ownEmails below instead.
    const ownDomains = new Set<string>()
    const ownEmails = new Set<string>()
    teamUsers?.forEach((u: any) => {
      const e = (u.email || '').toLowerCase()
      const at = e.lastIndexOf('@')
      if (at < 0) return
      const d = e.slice(at + 1)
      ownEmails.add(e)
      if (!FREE_EMAIL_DOMAINS.has(d)) ownDomains.add(d)
    })

    const query = buildInboxQuery(7)
    dbg.contactsCount = contacts?.length || 0
    dbg.peopleCount = people?.length || 0
    dbg.query = query

    // 2. Refresh access token + list candidate message ids.
    const { token, account } = await ensureAccessToken(supa)
    dbg.accountEmail = account.email
    // Confirm which mailbox we're actually reading from (catches the
    // "we authenticated as X but Gmail thinks we're Y" failure mode).
    if (debug) {
      const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null)
      dbg.gmailProfile = prof
    }
    const listResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!listResp.ok) {
      return json({ ok: false, error: `Gmail list failed: HTTP ${listResp.status}`, detail: (await listResp.text()).slice(0, 300), ...(debug ? { dbg } : {}) }, 502)
    }
    const listData = await listResp.json() as { messages?: { id: string }[]; resultSizeEstimate?: number }
    dbg.gmailResultSizeEstimate = listData.resultSizeEstimate
    const ids = (listData.messages || []).map(m => m.id)
    if (ids.length === 0) {
      await supa.from('gmail_account').update({ updated_at: new Date().toISOString() }).eq('id', account.id)
      return json({ ok: true, fetched: 0, newInbound: 0, matched: 0, advanced: 0, ...(debug ? { dbg } : {}) })
    }

    // 3. Dedup against existing rows so re-runs are cheap.
    const { data: existing } = await supa.from('email_messages')
      .select('provider_msg_id').in('provider_msg_id', ids)
    const seenIds = new Set((existing || []).map((r: any) => r.provider_msg_id))
    const newIds = ids.filter(id => !seenIds.has(id))
    if (newIds.length === 0) {
      return json({ ok: true, fetched: ids.length, newInbound: 0, matched: 0, advanced: 0, note: 'all already in DB' })
    }

    // 4. Fetch FULL payload for each new id so we capture the body —
    //    the CRM's conversation panel renders the full email text, not
    //    just the snippet. format=full returns the MIME tree; we walk
    //    it to extract a usable plain-text body.
    const detailResps = await Promise.all(newIds.map(id =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then(r => r.ok ? r.json() : null)
    ))

    // 5. Match each message to a contact and build insert rows.
    const inserts: any[] = []
    const touchedCompanies = new Set<string>()
    const unmatched: { from: string; reason: string }[] = []
    // Suppression candidates collected during the sync pass; processed
    // after the upsert (they need their own DB lookups).
    const bounceCandidates: { threadId: string; subject: string }[] = []
    const unsubCandidates: { email: string; companyId: string; keyword: string }[] = []
    detailResps.forEach((msg: any, i: number) => {
      if (!msg) { unmatched.push({ from: '(metadata fetch failed)', reason: 'no msg' }); return }
      const headers: Record<string, string> = Object.fromEntries(
        (msg.payload?.headers || []).map((h: any) => [h.name.toLowerCase(), h.value]),
      )
      const fromEmail = parseEmail(headers.from)
      if (!fromEmail) { unmatched.push({ from: headers.from || '?', reason: 'no email parsed' }); return }
      // Bounce? These come from mailer-daemon@googlemail.com et al. and
      // would otherwise fall through as "no contact matched" and be lost.
      // The DSN threads with the original outbound, so threadId is enough
      // to recover WHO we failed to reach — resolved after this loop.
      if (isBounce(fromEmail, headers.subject || '')) {
        if (msg.threadId) bounceCandidates.push({ threadId: msg.threadId, subject: headers.subject || '' })
        unmatched.push({ from: fromEmail, reason: 'bounce (queued for suppression)' })
        return
      }
      const at = fromEmail.lastIndexOf('@')
      const domain = fromEmail.slice(at + 1)
      if (ownDomains.has(domain)) { unmatched.push({ from: fromEmail, reason: 'own-domain skipped' }); return }
      // Also skip when the From exactly matches a team_user's personal
      // email (e.g. a team member's gmail). gmail.com itself stays
      // matchable for actual clients.
      if (ownEmails.has(fromEmail)) { unmatched.push({ from: fromEmail, reason: 'own-email skipped' }); return }
      let companyId: string | null = null
      let contactId: string | null = null
      const person = people?.find((p: any) => (p.email || '').toLowerCase() === fromEmail)
      if (person) { companyId = person.company_id; contactId = person.id }
      if (!companyId) {
        const company = contacts?.find((c: any) => (c.email || '').toLowerCase() === fromEmail)
        if (company) companyId = company.id
      }
      if (!companyId && !FREE_EMAIL_DOMAINS.has(domain)) {
        const dc = contacts?.find((c: any) => (c.email || '').toLowerCase().endsWith('@' + domain))
        if (dc) companyId = dc.id
      }
      if (!companyId) { unmatched.push({ from: fromEmail, reason: 'no contact matched' }); return }
      const fullBody = extractBody(msg.payload) || msg.snippet || null
      // Opt-out intent in the typed part of the reply → suppress after
      // the upsert. The message row still lands in email_messages so the
      // conversation panel shows WHY the contact went excluded.
      const unsub = isUnsubscribe(fullBody || '')
      if (unsub.hit) unsubCandidates.push({ email: fromEmail, companyId, keyword: unsub.keyword || '' })
      inserts.push({
        company_id:      companyId,
        contact_id:      contactId,
        direction:       'inbound',
        from_addr:       headers.from || null,
        to_addr:         headers.to || null,
        subject:         headers.subject || null,
        body:            fullBody,
        thread_id:       msg.threadId || null,
        provider_msg_id: newIds[i],
        status:          'received',
        sent_at:         headers.date ? new Date(headers.date).toISOString() : null,
      })
      touchedCompanies.add(companyId)
    })

    // 5b. Bounce suppression — resolve WHO we failed to reach via the
    //     DSN's thread: the outbound we sent lives in email_messages
    //     with the same thread_id, and its to_addr is the dead address.
    //     Runs BEFORE the empty-inserts early return: a sync window
    //     containing only bounces must still suppress them.
    let bouncesSuppressed = 0
    for (const b of bounceCandidates) {
      const { data: outbound } = await supa.from('email_messages')
        .select('to_addr, company_id')
        .eq('thread_id', b.threadId)
        .eq('direction', 'outbound')
        .limit(1)
        .maybeSingle()
      const deadEmail = (outbound?.to_addr || '').toLowerCase().trim()
      if (!deadEmail || !deadEmail.includes('@')) continue
      const { error: supErr } = await supa.from('email_suppression').upsert({
        email: deadEmail,
        reason: 'bounce',
        detail: b.subject.slice(0, 200),
        company_id: outbound?.company_id || null,
        created_by: 'gmail-sync-server',
      }, { onConflict: 'email', ignoreDuplicates: true })
      if (supErr) { console.warn('bounce suppress failed', supErr.message); continue }
      // Cancel anything still queued to the dead address.
      await supa.from('email_queue')
        .update({ status: 'cancelled', error: 'suppressed: bounce' })
        .eq('status', 'pending')
        .ilike('to_email', deadEmail)
      if (outbound?.company_id) {
        await supa.from('outreach_activity').insert({
          contact_id: outbound.company_id,
          action: 'email_bounced',
          meta: { email: deadEmail, subject: b.subject.slice(0, 120), via: 'gmail-sync-server' },
          created_by: 'gmail-sync-server',
        })
      }
      bouncesSuppressed++
    }

    if (inserts.length === 0) {
      dbg.unmatched = unmatched.slice(0, 20)
      return json({ ok: true, fetched: ids.length, newInbound: 0, matched: 0, advanced: 0, bouncesSuppressed, note: 'no inbound matched a contact', ...(debug ? { dbg } : {}) })
    }
    dbg.unmatched = unmatched.slice(0, 20)

    // 6. One bulk upsert. Defensive against races (two sync runs landing
    //    the same provider_msg_id at once) — the UNIQUE index on
    //    provider_msg_id makes this a no-op on conflict.
    const { error: insErr } = await supa.from('email_messages')
      .upsert(inserts, { onConflict: 'provider_msg_id', ignoreDuplicates: true })
    if (insErr) return json({ ok: false, error: `upsert failed: ${insErr.message}` }, 500)

    // 6b. Unsubscribe suppression — the reply is already in
    //     email_messages (visible in the conversation panel); now honour
    //     the request: suppress the address, cancel their pending queue
    //     rows, move the company to 'excluded', log why.
    const unsubbedCompanies = new Set<string>()
    let unsubsSuppressed = 0
    for (const u of unsubCandidates) {
      const { error: supErr } = await supa.from('email_suppression').upsert({
        email: u.email,
        reason: 'unsubscribe',
        detail: `matched "${u.keyword}"`,
        company_id: u.companyId,
        created_by: 'gmail-sync-server',
      }, { onConflict: 'email', ignoreDuplicates: true })
      if (supErr) { console.warn('unsub suppress failed', supErr.message); continue }
      await supa.from('email_queue')
        .update({ status: 'cancelled', error: 'suppressed: unsubscribe' })
        .eq('status', 'pending')
        .ilike('to_email', u.email)
      await supa.from('outreach_contacts')
        .update({ status: 'excluded' })
        .eq('id', u.companyId)
      await supa.from('outreach_activity').insert({
        contact_id: u.companyId,
        action: 'unsubscribed',
        new_value: 'excluded',
        meta: { email: u.email, keyword: u.keyword, via: 'gmail-sync-server' },
        created_by: 'gmail-sync-server',
      })
      unsubbedCompanies.add(u.companyId)
      unsubsSuppressed++
    }

    // 7. Per touched company: log replied_marked activity, advance
    //    status to in_conversation when in an outbound stage, and
    //    auto-stop active sequences (a reply means the drip campaign
    //    achieved its goal — no need to keep nudging).
    const ADVANCING_STATUSES = new Set(['not_started','first_email','follow_up','no_reply'])
    let advanced = 0
    let sequencesStopped = 0
    for (const companyId of touchedCompanies) {
      // An unsubscribe is technically a reply, but advancing them to
      // in_conversation (or flagging replied for triage) would put a
      // "leave me alone" straight into the hot-leads shelf. They were
      // just set to excluded above — leave them there.
      if (unsubbedCompanies.has(companyId)) continue
      // Activity row — column names mirror logActivity() in the client:
      // contact_id (yes, named that even though it FKs outreach_contacts /
      // the "company"), action, old_value, new_value, meta, created_by.
      await supa.from('outreach_activity').insert({
        contact_id: companyId,
        action: 'replied_marked',
        meta: { via: 'gmail-sync-server' },
        created_by: 'gmail-sync-server',
      })
      // Status advance + replied flag + last-contacted bump. Even when
      // the status is already past in_conversation (meeting/proposal/
      // active), we still flag replied=true and bump last_contacted_at
      // so the contact card and "Stuck" / "Cold" triage shelves reflect
      // the fresh inbound. Status only moves for the outbound stages.
      const c = contacts?.find((x: any) => x.id === companyId)
      const old = c?.status || 'not_started'
      const patch: Record<string, unknown> = {
        replied: true,
        last_contacted_at: new Date().toISOString(),
      }
      if (ADVANCING_STATUSES.has(old)) patch.status = 'in_conversation'
      const { error: updErr } = await supa.from('outreach_contacts')
        .update(patch).eq('id', companyId)
      if (!updErr && ADVANCING_STATUSES.has(old)) {
        advanced++
        await supa.from('outreach_activity').insert({
          contact_id: companyId,
          action: 'status_changed',
          old_value: old,
          new_value: 'in_conversation',
          meta: { via: 'gmail-sync-server', auto: true },
          created_by: 'gmail-sync-server',
        })
      }
      // Auto-stop active sequence runs for this company. The table is
      // outreach_sequence_runs; "active" = stopped_at IS NULL (there's
      // no status column).
      const { data: runs } = await supa.from('outreach_sequence_runs')
        .select('id').eq('company_id', companyId).is('stopped_at', null)
      if (runs && runs.length) {
        const { error: stopErr } = await supa.from('outreach_sequence_runs')
          .update({ stop_reason: 'replied', stopped_at: new Date().toISOString() })
          .in('id', runs.map((r: any) => r.id))
        if (!stopErr) sequencesStopped += runs.length
      }
    }

    return json({
      ok: true,
      fetched: ids.length,
      newInbound: inserts.length,
      matched: touchedCompanies.size,
      advanced,
      sequencesStopped,
      bouncesSuppressed,
      unsubsSuppressed,
      ...(debug ? { dbg } : {}),
    })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || 'sync failed' }, 500)
  }
})
