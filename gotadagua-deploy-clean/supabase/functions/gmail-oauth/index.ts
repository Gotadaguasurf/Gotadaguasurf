// ════════════════════════════════════════════════════════════════════════════
//  gmail-oauth — admin connects the shared mailbox (groups@) ONCE
//
//  Two routes via the path:
//    GET .../gmail-oauth/start     → redirects to Google's consent screen
//                                    with access_type=offline so we get a
//                                    refresh_token. ?return_to=<url> sends
//                                    the admin back to that page after.
//    GET .../gmail-oauth/callback  → handles Google's redirect, swaps the
//                                    code for refresh + access tokens,
//                                    upserts the gmail_account row, returns
//                                    a tiny success page.
//
//  Secrets required (set via `supabase secrets set ...`):
//    GOOGLE_OAUTH_CLIENT_ID
//    GOOGLE_OAUTH_CLIENT_SECRET
//    SHARED_GMAIL_ADDRESS          (e.g. groups@gotadaguasurf.com — guards
//                                   the email matches what we expect)
//    SUPABASE_URL                  (set automatically by Supabase)
//    SUPABASE_SERVICE_ROLE_KEY     (set automatically by Supabase)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ')

const CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const EXPECTED_EMAIL = (Deno.env.get('SHARED_GMAIL_ADDRESS') || '').toLowerCase()

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Shared Gmail</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;color:#0d1b2a}h1{color:#28394b}code{background:#f0f5fa;padding:2px 6px;border-radius:4px}.err{color:#b91c1c}.ok{color:#1a7a40}</style>
${body}`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

function buildRedirectUri(_req: Request) {
  // Edge Functions see an internal URL via req.url (no /functions/v1/ prefix,
  // http not https), so we can't derive the public redirect from it. Build
  // from SUPABASE_URL — the public origin Supabase sets as a secret.
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')
  return `${base}/functions/v1/gmail-oauth/callback`
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const path = url.pathname.split('/').pop() || ''

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return html(`<h1>Setup incomplete</h1><p class="err">GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set as Supabase secrets.</p>`, 500)
  }

  // ── /start — redirect admin to Google's consent screen ─────────────────
  if (path === 'start') {
    const returnTo = url.searchParams.get('return_to') || ''
    const state = encodeURIComponent(returnTo)
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    auth.searchParams.set('client_id', CLIENT_ID)
    auth.searchParams.set('redirect_uri', buildRedirectUri(req))
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', SCOPES)
    // offline + consent forces Google to issue a refresh_token even when
    // the admin has previously consented to this client.
    auth.searchParams.set('access_type', 'offline')
    auth.searchParams.set('prompt', 'consent')
    auth.searchParams.set('include_granted_scopes', 'true')
    if (state) auth.searchParams.set('state', state)
    return Response.redirect(auth.toString(), 302)
  }

  // ── /callback — handle Google's redirect ───────────────────────────────
  if (path === 'callback') {
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (error) return html(`<h1>OAuth refused</h1><p class="err">Google returned: <code>${error}</code></p>`, 400)
    if (!code)  return html(`<h1>OAuth failed</h1><p class="err">Missing <code>code</code> param.</p>`, 400)

    // 1. Exchange code for tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: buildRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenResp.ok) {
      const t = await tokenResp.text()
      return html(`<h1>Token exchange failed</h1><pre class="err">${t}</pre>`, 502)
    }
    const tokens = await tokenResp.json() as {
      access_token: string; refresh_token?: string; expires_in: number; scope: string
    }
    if (!tokens.refresh_token) {
      return html(`<h1>No refresh token returned</h1>
        <p>Google only emits a refresh_token on the FIRST consent for a given client+account. To force one:</p>
        <ol>
          <li>Visit <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a></li>
          <li>Remove the CRM's access</li>
          <li>Try this flow again</li>
        </ol>`, 400)
    }

    // 2. Verify the email matches the expected shared mailbox (defends
    //    against a wrong-account consent that would happily save the
    //    wrong refresh token).
    const profile = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    ).then(r => r.ok ? r.json() : null) as { emailAddress?: string } | null
    const connectedEmail = (profile?.emailAddress || '').toLowerCase()
    if (EXPECTED_EMAIL && connectedEmail !== EXPECTED_EMAIL) {
      return html(`<h1>Wrong account</h1>
        <p class="err">Expected <code>${EXPECTED_EMAIL}</code> but you consented as <code>${connectedEmail}</code>.</p>
        <p>Go to <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, remove the CRM's access, then retry — pick the shared mailbox this time.</p>`, 400)
    }

    // 3. Upsert into gmail_account (single row — UNIQUE on email).
    const supa = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    )
    const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString()
    const { error: upErr } = await supa.from('gmail_account').upsert({
      email: connectedEmail,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email' })
    if (upErr) return html(`<h1>DB upsert failed</h1><pre class="err">${upErr.message}</pre>`, 500)

    // 4. Success — send the admin back if a return_to was set.
    const returnTo = decodeURIComponent(url.searchParams.get('state') || '')
    return html(`
      <h1 class="ok">✓ Shared Gmail connected</h1>
      <p>Connected as <code>${connectedEmail}</code>.</p>
      <p>The CRM can now send and sync via this mailbox without any user keeping a tab open.</p>
      ${returnTo ? `<p><a href="${returnTo}">Return to CRM →</a></p>` : ''}
    `)
  }

  return html(`<h1>gmail-oauth</h1>
    <p>Use <code>/start</code> to begin the OAuth flow as the admin.</p>`, 404)
})
