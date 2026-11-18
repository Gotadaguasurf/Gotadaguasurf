// ════════════════════════════════════════════════════════════════════════════
//  Team invites (6 Nov 2026). The invite email links to OUR page —
//  https://gotadaguasurf.vercel.app/?accept=<workspace_invitations.invitation_token>
//  — and the accept-invite Edge Function sets the password. Unlike the Supabase
//  invite link (24 h), the link keeps working until the person creates the
//  password or an admin cancels the invite. expires_at is only a generous safety
//  net (INVITE_VALID_DAYS, default 60, renewed on every send; 0 = ten years).
//  Shared by create-platform-invite (sends) and accept-invite (accepts).
// ════════════════════════════════════════════════════════════════════════════
import { brandedEmail, emailButton, escHtml, C } from './email-layout.ts';

export const DEFAULT_SITE = 'https://gotadaguasurf.vercel.app/';
const ALLOWED_HOSTS = new Set(['gotadaguasurf.vercel.app', 'gotadaguasurf.com', 'www.gotadaguasurf.com', 'localhost', '127.0.0.1']);

export function inviteValidDays(): number {
  const n = Number(Deno.env.get('INVITE_VALID_DAYS') ?? '60');
  if (!Number.isFinite(n) || n < 0) return 60;
  return n === 0 ? 3650 : n;
}

export function inviteExpiry(from = Date.now()): string {
  return new Date(from + inviteValidDays() * 24 * 60 * 60 * 1000).toISOString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

// The hub the link opens. Only our own hosts — an invite must never point at
// another site, whatever the caller sends.
export function inviteSiteBase(...candidates: Array<string | null | undefined>): string {
  for (const cand of [...candidates, Deno.env.get('SITE_URL')]) {
    if (!cand) continue;
    try {
      const u = new URL(cand);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (ALLOWED_HOSTS.has(u.hostname) && (u.protocol === 'https:' || local)) return `${u.origin}/`;
    } catch (_e) { /* not a URL */ }
  }
  return DEFAULT_SITE;
}

export const acceptLink = (base: string, token: string) => `${base}?accept=${encodeURIComponent(token)}`;

// One email for every invite and every resend. English (the app is in English),
// with one line in Portuguese for the team in Portugal.
export function inviteEmailContent(args: { fullName: string; invitedBy: string; link: string }) {
  const first = (args.fullName || '').trim().split(/\s+/)[0] || '';
  const hello = first ? `Hi ${first},` : 'Hi,';
  const subject = 'Your Gota Dagua access — create your password';
  const text = `${hello}\n\n${args.invitedBy} invited you to the Gota Dagua platform.\n\nOpen this link to create your password and log in:\n${args.link}\n\nThe link is personal and keeps working until you create your password.\n\nPT: Abre o link para criares a tua password e entrares. O link não caduca até criares a password.\n\nGota Dagua Surf`;
  const html = brandedEmail({
    preheader: `${args.invitedBy} invited you to the Gota Dagua platform.`,
    bodyHtml: `
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:${C.navy}">${escHtml(hello.replace(/,$/, ''))}</h1>
      <p style="margin:0 0 20px">${escHtml(args.invitedBy)} invited you to the Gota Dagua platform. Create your password to log in.</p>
      ${emailButton('Create password', args.link)}
      <p style="margin:22px 0 0;font-size:13px;color:${C.muted}">The link is personal and keeps working until you create your password.</p>
      <p style="margin:8px 0 0;font-size:13px;color:${C.muted}">PT: Abre o link para criares a tua password e entrares. O link não caduca até criares a password.</p>
      <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid ${C.line};font-size:12px;color:${C.faint}">If the button does not open, copy this link:<br><span style="word-break:break-all">${escHtml(args.link)}</span></p>`,
  });
  return { subject, text, html };
}

// Can this invite still be used to create a password?
//   open        — yes
//   canceled    — an admin cancelled it (or it was replaced)
//   expired     — older than INVITE_VALID_DAYS since the last send
//   already_set — the account already has a password: log in instead
// An 'accepted' row whose person never set a password is still open: until
// 6 Nov 2026 the auth trigger marked invites accepted the moment the user was
// created (supabase/team-access-invites.sql).
// An 'accepted' row with NO account behind it (no profile) is not open: it is a
// leftover whose person was removed, and its token would create a brand-new
// account with the old areas (audit 18 Nov 2026, SEC-20: one such row, May 2026,
// still carried Owner access). Since 6 Nov every invite creates the account first.
export function inviteState(
  invite: { status?: string | null; expires_at?: string | null },
  profile: { password_set_at?: string | null } | null,
  now = Date.now(),
): 'open' | 'canceled' | 'expired' | 'already_set' {
  const status = String(invite.status || '').toLowerCase();
  if (profile?.password_set_at) return 'already_set';
  if (!['pending', 'sent', 'accepted'].includes(status)) return 'canceled';
  if (status === 'accepted' && !profile) return 'canceled';
  if (invite.expires_at && new Date(invite.expires_at).getTime() < now && status !== 'accepted') return 'expired';
  return 'open';
}

export const INVITE_STATE_MESSAGE: Record<string, string> = {
  invalid: 'This invite link is not valid. Ask Miguel to send you a new invite.',
  canceled: 'This invite was cancelled. Ask Miguel to send you a new one if you still need access.',
  expired: 'This invite is too old. Ask Miguel to send it again — the new link works straight away.',
  already_set: 'This account already has a password. Log in with it, or use «Forgot password?».',
};

// ── Who may give what (SA-03 / SEC-10, audit 18 Nov 2026) ──────────────────
// The same rule as the Settings form (index.html inviteGuardProblem): anyone who is not Miguel
// (platform super_admin, or the owner list) cannot change their own access, cannot give HQ or
// Settings the person does not already hold, and cannot make someone Owner / Admin they are not
// already. It only stops NEW grants: nobody loses access, a resend is unchanged.
// Returns '' when the invite may go out, else the message the form shows.
export const INVITE_ROLES = ['owner', 'admin', 'location_manager', 'local_manager', 'head_social_host', 'camp_tab_staff', 'bar_man', 'finance', 'viewer']
const GUARDED_AREAS: Record<string, string> = { hq: 'HQ (owner view)', settings: 'Settings' }
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin' }
export function ownerEmails(): string[] {
  return String(Deno.env.get('PLATFORM_OWNER_EMAILS') || 'miguel@gotadaguasurf.com').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
}
export function inviteRuleProblem(a: {
  callerRole: string; callerEmail: string; targetEmail: string; role: string;
  requestedSlugs: string[]; heldSlugs: string[]; targetRole: string | null;
}): string {
  if (!INVITE_ROLES.includes(a.role)) return `Unknown role «${a.role}».`
  if (a.callerRole === 'super_admin' || ownerEmails().includes(String(a.callerEmail || '').toLowerCase())) return ''
  if (a.callerEmail && a.targetEmail.toLowerCase() === a.callerEmail.toLowerCase()) return "You can't change your own access here — ask Miguel."
  const held = new Set(a.heldSlugs)
  const newly = Object.keys(GUARDED_AREAS).filter(s => a.requestedSlugs.includes(s) && !held.has(s))
  if (newly.length) return `Only Miguel can give ${newly.map(s => GUARDED_AREAS[s]).join(' or ')} access.`
  if (ROLE_LABEL[a.role] && a.targetRole !== a.role) return `Only Miguel can make someone ${ROLE_LABEL[a.role]}.`
  return ''
}
