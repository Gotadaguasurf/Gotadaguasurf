import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildRaw } from '../_shared/mail.ts';
import { acceptLink, inviteEmailContent, inviteExpiry, inviteSiteBase } from '../_shared/invite.ts';

// ════════════════════════════════════════════════════════════════════════════
//  Settings → Team Access → «Send invite» / «Resend invite».
//
//  Since 6 Nov 2026 the email links to OUR page (/?accept=<invitation_token>)
//  and the accept-invite function sets the password, so the invite no longer
//  dies with the 24-hour Supabase link (Francisco, 2 Nov). The invite stays
//  open until the person creates the password or an admin cancels it.
//
//  What a call does:
//   • the person already has a password → only refresh their access (no email);
//   • otherwise reuse their open invite (same token, so the first email keeps
//     working) or create one, store the areas, create the auth user if needed
//     (no Supabase email), pre-create the memberships, and send the link
//     through the shared Gmail mailbox (gmail_account, groups@).
//   • if Gmail cannot send, the link comes back to the admin to forward by hand.
// ════════════════════════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '';

// deno-lint-ignore no-explicit-any
async function gmailAccessToken(supa: any): Promise<{ token: string; email: string; display: string }> {
  const { data: acct, error } = await supa.from('gmail_account').select('*').limit(1).single();
  if (error || !acct) throw new Error('No gmail_account row — connect the shared mailbox via /gmail-oauth/start first');
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0;
  if (acct.access_token && expiresAt > Date.now() + 60_000) {
    return { token: acct.access_token, email: acct.email, display: acct.display_name || "Gota Dagua" };
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
  return { token: tk.access_token, email: acct.email, display: acct.display_name || "Gota Dagua" };
}

// deno-lint-ignore no-explicit-any
async function sendInviteViaGmail(supa: any, args: { to: string; fullName: string; actionLink: string; invitedBy: string }) {
  const { token, email: fromEmail, display } = await gmailAccessToken(supa);
  const { subject, text, html } = inviteEmailContent({ fullName: args.fullName, invitedBy: args.invitedBy, link: args.actionLink });
  const raw = buildRaw({ fromEmail, fromDisplay: display, to: args.to, subject, body: text, html });
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!resp.ok) throw new Error(`Gmail send failed: HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Missing authorization' }, 401);

    // Admin client (service role) — can create users + read/write any table
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // auth.getUser() does NOT read the Authorization header from `global.headers`
    // (that's only used for PostgREST queries). The JWT must be passed explicitly.
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !caller) return json({ ok: false, error: callerError?.message || 'Not authenticated' }, 401);

    // Caller authorization: platform_role super_admin/owner/admin, or a
    // workspace_membership with can_manage_team=true. Always requires active=true.
    const { data: callerProfile } = await supabaseAdmin
      .from('platform_profiles')
      .select('id, full_name, platform_role, active')
      .eq('id', caller.id)
      .maybeSingle();
    const callerRole = callerProfile?.platform_role ?? '';
    const isActive = callerProfile?.active === true;
    const hasPrivilegedRole = isActive && ['super_admin', 'owner', 'admin'].includes(callerRole);
    let canManageTeam = false;
    if (!hasPrivilegedRole) {
      const { data: mgmtRows } = await supabaseAdmin
        .from('workspace_memberships')
        .select('id')
        .eq('user_id', caller.id)
        .eq('active', true)
        .eq('can_manage_team', true)
        .limit(1);
      canManageTeam = (mgmtRows?.length ?? 0) > 0;
    }
    if (!hasPrivilegedRole && !canManageTeam) return json({ ok: false, error: 'Insufficient permissions' }, 403);

    const { email, fullName, role, accessRows, redirectTo, siteUrl } = await req.json();
    const lowerEmail = String(email || '').trim().toLowerCase();
    if (!lowerEmail || !role) return json({ ok: false, error: 'Missing email or role' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail)) return json({ ok: false, error: `${lowerEmail} is not a valid email address.` }, 400);
    // super_admin is the ONLY role that bypasses workspace_memberships
    // (is_global_admin). It is never settable from the invite UI.
    if (role === 'super_admin') return json({ ok: false, error: 'super_admin is not an invitable role' }, 400);
    const name = String(fullName || '').trim();
    const rows: Record<string, unknown>[] = Array.isArray(accessRows) ? accessRows : [];

    // ── RATE LIMITING ────────────────────────────────────────────────────
    //   A) no more than 20 invites created in the last 5 minutes (all admins)
    //   B) no more than 100 in the last 24 hours
    //   C) the same email can't be (re)sent twice within 5 minutes
    const now = Date.now();
    const FIVE_MIN_AGO = new Date(now - 5 * 60 * 1000).toISOString();
    const ONE_DAY_AGO  = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { count: burstCount, error: burstErr } = await supabaseAdmin
      .from('workspace_invitations').select('id', { count: 'exact', head: true }).gte('created_at', FIVE_MIN_AGO);
    if (burstErr) throw burstErr;
    if ((burstCount ?? 0) >= 20) {
      return json({ ok: false, error: 'Too many invites sent in the last 5 minutes. Please wait a moment and try again.', rate_limit: 'burst' }, 429, { 'Retry-After': '300' });
    }
    const { count: dailyCount, error: dailyErr } = await supabaseAdmin
      .from('workspace_invitations').select('id', { count: 'exact', head: true }).gte('created_at', ONE_DAY_AGO);
    if (dailyErr) throw dailyErr;
    if ((dailyCount ?? 0) >= 100) {
      return json({ ok: false, error: 'Daily invite limit reached (100 in 24h). Try again tomorrow.', rate_limit: 'daily' }, 429, { 'Retry-After': '3600' });
    }
    const { count: dupeCount, error: dupeErr } = await supabaseAdmin
      .from('workspace_invitations').select('id', { count: 'exact', head: true })
      .eq('email', lowerEmail)
      .or(`created_at.gte."${FIVE_MIN_AGO}",last_sent_at.gte."${FIVE_MIN_AGO}"`);
    if (dupeErr) throw dupeErr;
    if ((dupeCount ?? 0) >= 1) {
      return json({ ok: false, error: `An invite went to ${lowerEmail} a moment ago — wait 5 minutes before sending it again.`, rate_limit: 'duplicate_email' }, 429, { 'Retry-After': '300' });
    }

    const nowIso = () => new Date().toISOString();
    const { data: existingProfile } = await supabaseAdmin
      .from('platform_profiles')
      .select('id, platform_role, password_set_at, active, full_name')
      .eq('email', lowerEmail)
      .maybeSingle();

    // Memberships + profile for a known user id. Idempotent: a re-invite refreshes
    // the rows. Never touches a super_admin's role.
    const applyAccess = async (userId: string, currentRole: string | null) => {
      if (rows.length) {
        const membershipRows = rows.map((row) => ({
          user_id: userId,
          workspace_id: row.workspace_id,
          member_role: row.member_role || role,
          can_view: row.can_view ?? true,
          can_edit: row.can_edit ?? false,
          can_manage_team: row.can_manage_team ?? false,
          can_manage_finance: row.can_manage_finance ?? false,
          active: true,
          updated_at: nowIso(),
        }));
        const { error: membershipError } = await supabaseAdmin
          .from('workspace_memberships').upsert(membershipRows, { onConflict: 'user_id,workspace_id' });
        if (membershipError) throw membershipError;
      }
      const profileUpdate: Record<string, unknown> = { active: true, updated_at: nowIso() };
      if (currentRole !== 'super_admin') profileUpdate.platform_role = role;
      if (name) profileUpdate.full_name = name;
      await supabaseAdmin.from('platform_profiles').update(profileUpdate).eq('id', userId);
    };

    // ── 1. Already has a password: this is an access change, not an invite ──
    if (existingProfile?.password_set_at) {
      await applyAccess(existingProfile.id, existingProfile.platform_role);
      return json({ ok: true, already_active: true, email_sent: false, invite: { user_id: existingProfile.id } });
    }

    // ── 2. One open invite per email: reuse it (same token) or create it ──
    const expiresAt = inviteExpiry();
    const { data: openInvites, error: openErr } = await supabaseAdmin
      .from('workspace_invitations')
      .select('id, invitation_token, created_at')
      .eq('email', lowerEmail)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false });
    if (openErr) throw openErr;
    let invite = openInvites?.[0] || null;
    const reused = !!invite;
    if (invite) {
      const { error: updErr } = await supabaseAdmin.from('workspace_invitations').update({
        full_name: name, platform_role: role, status: 'sent', expires_at: expiresAt, updated_at: nowIso(),
      }).eq('id', invite.id);
      if (updErr) throw updErr;
      const older = (openInvites || []).slice(1).map((r: { id: string }) => r.id);
      if (older.length) {
        await supabaseAdmin.from('workspace_invitations').update({ status: 'canceled', updated_at: nowIso() }).in('id', older);
      }
      const { error: delErr } = await supabaseAdmin.from('invitation_workspace_access').delete().eq('invitation_id', invite.id);
      if (delErr) throw delErr;
    } else {
      const { data: created, error: inviteError } = await supabaseAdmin
        .from('workspace_invitations')
        .insert({
          email: lowerEmail,
          full_name: name,
          platform_role: role,
          status: 'sent',
          expires_at: expiresAt,
          invited_by: callerProfile?.id ?? null,
        })
        .select('id, invitation_token, created_at')
        .single();
      if (inviteError) throw inviteError;
      invite = created;
    }

    if (rows.length) {
      const { error: accessError } = await supabaseAdmin.from('invitation_workspace_access').insert(rows.map((row) => ({
        invitation_id: invite.id,
        workspace_id: row.workspace_id,
        member_role: row.member_role || role,
        can_view: row.can_view ?? true,
        can_edit: row.can_edit ?? false,
        can_manage_team: row.can_manage_team ?? false,
        can_manage_finance: row.can_manage_finance ?? false,
      })));
      if (accessError) throw accessError;
    }

    // ── 3. The auth user (no email from Supabase) + memberships up front ──
    let invitedUserId: string | null = existingProfile?.id ?? null;
    if (!invitedUserId) {
      const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: lowerEmail,
        email_confirm: false,
        user_metadata: { full_name: name, platform_role: role, invitation_id: invite.id },
      });
      if (createErr && !/already|registered|exists/i.test(createErr.message || '')) {
        if (!reused) {
          await supabaseAdmin.from('invitation_workspace_access').delete().eq('invitation_id', invite.id);
          await supabaseAdmin.from('workspace_invitations').delete().eq('id', invite.id);
        }
        throw createErr;
      }
      invitedUserId = createdUser?.user?.id ?? null;
      if (!invitedUserId) {
        const { data: again } = await supabaseAdmin.from('platform_profiles').select('id').eq('email', lowerEmail).maybeSingle();
        invitedUserId = again?.id ?? null;
      }
    }
    // Belt and braces: before supabase/team-access-invites.sql the auth trigger
    // marked the invite accepted the moment the user was created. Keep it open.
    await supabaseAdmin.from('workspace_invitations').update({ status: 'sent', accepted_at: null }).eq('id', invite.id);
    if (invitedUserId) await applyAccess(invitedUserId, existingProfile?.platform_role ?? null);

    // ── 4. The email, with our link ──
    const link = acceptLink(inviteSiteBase(siteUrl, redirectTo), invite.invitation_token);
    const invitedBy = (callerProfile?.full_name || '').trim() || caller.email || 'Gota Dagua';
    let emailSent = false;
    try {
      await sendInviteViaGmail(supabaseAdmin, { to: lowerEmail, fullName: name, actionLink: link, invitedBy });
      emailSent = true;
      await supabaseAdmin.from('workspace_invitations').update({ last_sent_at: nowIso() }).eq('id', invite.id);
    } catch (mailErr) {
      console.error('create-platform-invite: Gmail send failed', mailErr);
    }

    return json({
      ok: true,
      reused,
      invite: { id: invite.id, expires_at: expiresAt, user_id: invitedUserId },
      email_sent: emailSent,
      // Only when the email could not go out: the admin forwards it by hand
      // (WhatsApp). Never logged, never stored anywhere else.
      invite_link: emailSent ? undefined : link,
    });
  } catch (err) {
    console.error('create-platform-invite error:', err);
    // deno-lint-ignore no-explicit-any
    const msg = err instanceof Error ? err.message : ((err as any)?.message || 'Unknown error');
    return json({ ok: false, error: msg }, 500);
  }
});
