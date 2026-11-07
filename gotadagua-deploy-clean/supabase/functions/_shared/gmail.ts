// ════════════════════════════════════════════════════════════════════════════
//  Send one email through the shared Gmail mailbox (gmail_account, groups@).
//  Used by send-password-reset (7 Nov 2026). Same token logic as
//  create-platform-invite: refresh the access token when it is about to expire.
// ════════════════════════════════════════════════════════════════════════════
import { buildRaw } from './mail.ts';

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '';

// deno-lint-ignore no-explicit-any
export async function gmailAccessToken(supa: any): Promise<{ token: string; email: string; display: string }> {
  const { data: acct, error } = await supa.from('gmail_account').select('*').limit(1).single();
  if (error || !acct) throw new Error('No gmail_account row — connect the shared mailbox via /gmail-oauth/start first');
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0;
  if (acct.access_token && expiresAt > Date.now() + 60_000) {
    return { token: acct.access_token, email: acct.email, display: acct.display_name || 'Gota Dagua' };
  }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: acct.refresh_token, grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`Gmail token refresh failed: HTTP ${resp.status} ${await resp.text()}`);
  const tk = await resp.json() as { access_token: string; expires_in: number };
  const newExpiry = new Date(Date.now() + (tk.expires_in - 30) * 1000).toISOString();
  await supa.from('gmail_account').update({ access_token: tk.access_token, access_expires_at: newExpiry, updated_at: new Date().toISOString() }).eq('id', acct.id);
  return { token: tk.access_token, email: acct.email, display: acct.display_name || 'Gota Dagua' };
}

// deno-lint-ignore no-explicit-any
export async function sendViaGmail(supa: any, msg: { to: string; subject: string; text: string; html: string }) {
  const { token, email: fromEmail, display } = await gmailAccessToken(supa);
  const raw = buildRaw({ fromEmail, fromDisplay: display, to: msg.to, subject: msg.subject, body: msg.text, html: msg.html });
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!resp.ok) throw new Error(`Gmail send failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
}
