import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendViaGmail } from '../_shared/gmail.ts';
import { inviteSiteBase } from '../_shared/invite.ts';
import { brandedEmail, emailButton, escHtml, C } from '../_shared/email-layout.ts';

// ════════════════════════════════════════════════════════════════════════════
//  Login → «Forgot password?» (7 Nov 2026).
//
//  Supabase's built-in mailer only delivers to the project's own team members
//  (since 28 Apr 2026 the only recovery email that ever arrived went to
//  miguel@), so staff never got the reset link. This function asks Supabase
//  for the recovery link (admin generateLink — Supabase sends nothing) and
//  emails it through the shared Gmail mailbox, like the team invites.
//
//  • No login needed (the person forgot the password). The answer is the same
//    whether or not the email has an account, so nobody can probe for emails.
//  • At most 3 emails per address per hour and 30 per hour in total
//    (password_reset_requests).
//  • The link only ever points at our own site (inviteSiteBase) + ?reset=1,
//    where the hub already handles the recovery session.
//  • If Gmail fails the answer is { ok:false, fallback:true } and the page
//    falls back to Supabase's own email.
// ════════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_EMAIL_PER_HOUR = 3;
const TOTAL_PER_HOUR = 30;

function resetEmailContent(link: string) {
  const subject = 'Reset your Gota Dagua password';
  const text = `Hi,\n\nSomeone (hopefully you) asked to reset the password of your Gota Dagua account.\n\nOpen this link to choose a new password:\n${link}\n\nThe link works once and expires in about an hour. If you did not ask for this, ignore this email — your password stays the same.\n\nPT: Abre o link para escolheres uma password nova. Se não foste tu, ignora este email.\n\nGota Dagua Surf`;
  const html = brandedEmail({
    preheader: 'Choose a new password for your Gota Dagua account.',
    bodyHtml: `
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:${C.navy}">Reset your password</h1>
      <p style="margin:0 0 20px">Someone (hopefully you) asked to reset the password of your Gota Dagua account.</p>
      ${emailButton('Choose a new password', link)}
      <p style="margin:22px 0 0;font-size:13px;color:${C.muted}">The link works once and expires in about an hour. If you did not ask for this, ignore this email — your password stays the same.</p>
      <p style="margin:8px 0 0;font-size:13px;color:${C.muted}">PT: Abre o link para escolheres uma password nova. Se não foste tu, ignora este email.</p>
      <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid ${C.line};font-size:12px;color:${C.faint}">If the button does not open, copy this link:<br><span style="word-break:break-all">${escHtml(link)}</span></p>`,
  });
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body: { email?: string; redirectTo?: string; siteUrl?: string } = {};
  try { body = await req.json(); } catch (_e) { /* empty body */ }
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) return json({ ok: false, error: 'Add a valid email.' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Rate limit, before anything else.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: mine }, { count: total }] = await Promise.all([
    admin.from('password_reset_requests').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', hourAgo),
    admin.from('password_reset_requests').select('id', { count: 'exact', head: true }).gte('created_at', hourAgo),
  ]);
  if ((mine ?? 0) >= PER_EMAIL_PER_HOUR || (total ?? 0) >= TOTAL_PER_HOUR) {
    return json({ ok: false, error: 'Too many reset emails — wait a few minutes and try again.' }, 429);
  }

  const redirectTo = `${inviteSiteBase(body.redirectTo, body.siteUrl)}?reset=1`;
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
  const link = data?.properties?.action_link;

  // Unknown email: answer exactly as if it had worked.
  if (error || !link) {
    await admin.from('password_reset_requests').insert({ email, outcome: 'no_account' });
    return json({ ok: true });
  }

  try {
    await sendViaGmail(admin, { to: email, ...resetEmailContent(link) });
    await admin.from('password_reset_requests').insert({ email, outcome: 'sent' });
    return json({ ok: true });
  } catch (e) {
    await admin.from('password_reset_requests').insert({ email, outcome: 'gmail_failed', detail: String((e as Error)?.message || e).slice(0, 300) });
    return json({ ok: false, fallback: true, error: 'Could not send the email right now.' }, 502);
  }
});
