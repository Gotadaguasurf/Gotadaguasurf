// ════════════════════════════════════════════════════════════════════════════
//  gmail-send — send an email FROM the shared mailbox with per-user display
//
//  POST { to, cc?, subject, body, sender_user_id, company_id?, contact_id?,
//         in_reply_to?, references?, thread_id? }
//
//  Authenticates the caller via their Supabase JWT (must be a logged-in
//  CRM user). Looks up the team_user.full_name to set the From display
//  name. Reads the shared mailbox's refresh token from gmail_account,
//  refreshes the access token if expired, then sends via the Gmail API.
//  Inserts an email_messages row with sender_user_id stamped so the
//  audit trail shows who actually clicked Send.
//
//  Secrets required:
//    GOOGLE_OAUTH_CLIENT_ID
//    GOOGLE_OAUTH_CLIENT_SECRET
//    SUPABASE_URL                  (set by Supabase)
//    SUPABASE_ANON_KEY             (set by Supabase — used to verify JWT)
//    SUPABASE_SERVICE_ROLE_KEY     (set by Supabase — reads tokens)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

// Refreshes the gmail_account.access_token in-place when expired and
// returns a fresh access_token. Throws on Google error.
async function ensureAccessToken(supa: ReturnType<typeof createClient>) {
  const { data: acct, error } = await supa.from('gmail_account')
    .select('*').limit(1).single()
  if (error || !acct) throw new Error('No gmail_account row — connect the shared mailbox via /gmail-oauth/start first')
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0
  // 60s safety margin so a request-in-flight doesn't 401.
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

// RFC 2822 with Q-encoded subject + base64url-encoded message for the
// Gmail API. Display name escaped to keep commas/quotes from breaking
// the header.
function buildRaw(args: {
  fromEmail: string; fromDisplay: string;
  to: string; cc?: string;
  subject: string; body: string;
  inReplyTo?: string; references?: string;
}) {
  const toUtf8 = (s: string) => unescape(encodeURIComponent(s || ''))
  const subjB64 = btoa(toUtf8(args.subject || ''))
  const escapedDisplay = (args.fromDisplay || '').replace(/"/g, "'")
  const fromHeader = escapedDisplay
    ? `"${escapedDisplay}" <${args.fromEmail}>`
    : args.fromEmail
  const lines: string[] = [
    `From: ${fromHeader}`,
    `Reply-To: ${args.fromEmail}`,
    `To: ${args.to}`,
  ]
  if (args.cc) lines.push(`Cc: ${args.cc}`)
  lines.push(
    `Subject: =?utf-8?B?${subjB64}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  )
  if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`)
  if (args.references) lines.push(`References: ${args.references}`)
  const message = lines.join('\r\n') + '\r\n\r\n' + (args.body || '')
  const utf8 = toUtf8(message)
  return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // 1. Verify the caller is a logged-in CRM user (their JWT in the
  //    Authorization header). Anyone with the function URL could otherwise
  //    send mail from the shared mailbox.
  const auth = req.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Missing Authorization' }, 401)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Bad JWT' }, 401)

  // 2. Parse body + basic validation.
  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const { to, cc, subject, body, sender_user_id, company_id, contact_id, in_reply_to, references, thread_id } = payload || {}
  if (!to || !subject) return json({ error: 'to + subject required' }, 400)

  // 3. Look up the sender's display name from team_users (service-role
  //    so we can read it regardless of the caller's RLS scope).
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY)
  let displayName = ''
  const effectiveSenderId = sender_user_id || user.id
  if (effectiveSenderId) {
    const { data: tu } = await adminClient.from('team_users')
      .select('full_name, email').eq('id', effectiveSenderId).maybeSingle()
    displayName = (tu?.full_name || tu?.email || '').trim()
  }

  // 4. Refresh access token + send.
  try {
    const { token, account } = await ensureAccessToken(adminClient)

    // Threading: a reply only lands in the same conversation on BOTH
    // sides when In-Reply-To/References carry the real RFC 2822
    // Message-ID of the message being answered. Callers historically
    // sent Gmail's internal API id here (no "@" in it), which the
    // recipient's mail client can't thread on. When we have a
    // thread_id and no usable RFC id, resolve the true headers from
    // the thread's last message server-side.
    let effInReplyTo = in_reply_to as string | undefined
    let effReferences = references as string | undefined
    const looksRfc = (s?: string) => !!s && s.includes('@')
    if (thread_id && !looksRfc(effInReplyTo)) {
      try {
        const tResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(thread_id)}` +
          `?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Message-Id&metadataHeaders=References`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (tResp.ok) {
          const tj = await tResp.json() as { messages?: Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }> }
          const last = tj.messages?.[tj.messages.length - 1]
          const h = (n: string) => last?.payload?.headers?.find(x => x.name.toLowerCase() === n.toLowerCase())?.value
          const msgId = h('Message-ID') || h('Message-Id')
          if (msgId) {
            effInReplyTo = msgId
            const prevRefs = h('References') || ''
            effReferences = (prevRefs + ' ' + msgId).trim()
          }
        }
      } catch { /* threading headers are best-effort — threadId still groups on our side */ }
    }

    const raw = buildRaw({
      fromEmail: account.email,
      fromDisplay: displayName,
      to, cc, subject, body,
      inReplyTo: looksRfc(effInReplyTo) ? effInReplyTo : undefined,
      references: looksRfc(effReferences) ? effReferences : undefined,
    })
    const sendBody: Record<string, unknown> = { raw }
    if (thread_id) sendBody.threadId = thread_id
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendBody),
    })
    if (!resp.ok) {
      const errTxt = await resp.text()
      return json({ error: `Gmail send failed: HTTP ${resp.status}`, detail: errTxt.slice(0, 500) }, 502)
    }
    const sent = await resp.json() as { id: string; threadId: string }

    // 5. Record outbound in email_messages with sender_user_id stamped.
    if (company_id) {
      await adminClient.from('email_messages').insert({
        company_id,
        contact_id: contact_id || null,
        direction: 'outbound',
        from_addr: account.email,
        to_addr: to,
        subject,
        body: (body || '').slice(0, 8000),
        thread_id: sent.threadId,
        provider_msg_id: sent.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
        sender_user_id: effectiveSenderId,
      })
    }
    return json({ ok: true, message_id: sent.id, thread_id: sent.threadId, from_display: displayName })
  } catch (e) {
    return json({ error: (e as Error).message || 'send failed' }, 500)
  }
})
