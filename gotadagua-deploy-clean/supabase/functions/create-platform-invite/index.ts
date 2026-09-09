import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildRaw } from '../_shared/mail.ts';

// ── Fallback mailer ──────────────────────────────────────────────────
// Supabase Auth's own SMTP failed on 9 Sep 2026 ("Error sending invite
// email", HTTP 500). Instead of depending on it, we generate the invite link
// ourselves (admin.generateLink, no email) and send it through the shared
// Gmail mailbox the CRM already uses (gmail_account, groups@).
const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '';

// deno-lint-ignore no-explicit-any
async function gmailAccessToken(supa: any): Promise<{ token: string; email: string; display: string }> {
  const { data: acct, error } = await supa.from('gmail_account').select('*').limit(1).single();
  if (error || !acct) throw new Error('No gmail_account row — connect the shared mailbox via /gmail-oauth/start first');
  const expiresAt = acct.access_expires_at ? new Date(acct.access_expires_at).getTime() : 0;
  if (acct.access_token && expiresAt > Date.now() + 60_000) {
    return { token: acct.access_token, email: acct.email, display: acct.display_name || "Gota d'Água" };
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
  return { token: tk.access_token, email: acct.email, display: acct.display_name || "Gota d'Água" };
}

const escHtml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// deno-lint-ignore no-explicit-any
async function sendInviteViaGmail(supa: any, args: { to: string; fullName: string; actionLink: string; invitedBy: string }) {
  const { token, email: fromEmail, display } = await gmailAccessToken(supa);
  const first = (args.fullName || '').trim().split(/\s+/)[0] || 'Olá';
  const subject = "Convite para a plataforma Gota d'Água";
  const body = `${first},\n\n${args.invitedBy} convidou-te para a plataforma da Gota d'Água.\n\nAbre este link para criares a tua password e entrares:\n${args.actionLink}\n\nO link é pessoal e expira em 7 dias.\n\nGota d'Água Surf`;
  const html = `<div style="font-family:Outfit,Helvetica,Arial,sans-serif;font-size:15px;color:#14212e;line-height:1.55">
    <p>${escHtml(first)},</p>
    <p>${escHtml(args.invitedBy)} convidou-te para a plataforma da Gota d'Água.</p>
    <p><a href="${escHtml(args.actionLink)}" style="display:inline-block;background:#1e6fa8;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700">Criar password e entrar</a></p>
    <p style="font-size:13px;color:#5d7185">Se o botão não abrir, copia este link: <br><span style="word-break:break-all">${escHtml(args.actionLink)}</span></p>
    <p style="font-size:13px;color:#5d7185">O link é pessoal e expira em 7 dias.</p>
    <p>Gota d'Água Surf</p>
  </div>`;
  const raw = buildRaw({ fromEmail, fromDisplay: display, to: args.to, subject, body, html });
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Admin client (service role) — can invite users + read/write any table
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the calling user is authenticated and is owner/admin.
    // IMPORTANT: auth.getUser() does NOT read the Authorization header from `global.headers`
    // (that's only used for PostgREST queries). The JWT must be passed as an explicit argument.
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !caller) {
      return new Response(JSON.stringify({ ok: false, error: callerError?.message || 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    // Caller authorization. Accept any of:
    //   - platform_role in (super_admin, owner, admin) — covers fresh DBs
    //     and DBs where Phase 5 hasn't yet promoted Miguel.
    //   - workspace_membership with can_manage_team=true.
    // Always requires active=true.
    const { data: callerProfile } = await supabaseAdmin
      .from('platform_profiles')
      .select('platform_role, active')
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
    if (!hasPrivilegedRole && !canManageTeam) {
      return new Response(JSON.stringify({ ok: false, error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { email, fullName, role, accessRows, redirectTo } = await req.json();
    if (!email || !role) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing email or role' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    // super_admin is the ONLY role that bypasses workspace_memberships
    // (see is_global_admin in tighten-rls-phase5). It must never be settable
    // via the invite UI — promotion to super_admin happens only by an
    // operator running SQL directly against the database.
    if (role === 'super_admin') {
      return new Response(JSON.stringify({ ok: false, error: 'super_admin is not an invitable role' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ── RATE LIMITING ────────────────────────────────────────────────────────
    // Three guards, in order of strictness:
    //
    //   A) Global burst:    no more than 20 invites in the last 5 minutes
    //                       (across all admins) — catches scripted spam.
    //   B) Daily cap:       no more than 100 invites in the last 24 hours
    //                       (across all admins) — sane upper bound for normal
    //                       onboarding.
    //   C) Per-email cool:  the same email can't be invited twice within the
    //                       last 5 minutes — catches accidental double-clicks
    //                       and typo retries.
    //
    // Any breach returns HTTP 429 with a Retry-After header so the client can
    // back off cleanly.
    const now = Date.now();
    const FIVE_MIN_AGO  = new Date(now - 5  * 60 * 1000).toISOString();
    const ONE_DAY_AGO   = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const lowerEmail    = email.toLowerCase();

    // (A) Burst window
    const { count: burstCount, error: burstErr } = await supabaseAdmin
      .from('workspace_invitations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', FIVE_MIN_AGO);
    if (burstErr) throw burstErr;
    if ((burstCount ?? 0) >= 20) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Too many invites sent in the last 5 minutes. Please wait a moment and try again.',
        rate_limit: 'burst'
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '300' }
      });
    }

    // (B) Daily window
    const { count: dailyCount, error: dailyErr } = await supabaseAdmin
      .from('workspace_invitations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', ONE_DAY_AGO);
    if (dailyErr) throw dailyErr;
    if ((dailyCount ?? 0) >= 100) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Daily invite limit reached (100 in 24h). Try again tomorrow.',
        rate_limit: 'daily'
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' }
      });
    }

    // (C) Same-email cooldown
    const { count: dupeCount, error: dupeErr } = await supabaseAdmin
      .from('workspace_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('email', lowerEmail)
      .gte('created_at', FIVE_MIN_AGO);
    if (dupeErr) throw dupeErr;
    if ((dupeCount ?? 0) >= 1) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'This email was just invited a moment ago — wait 5 minutes before re-sending.',
        rate_limit: 'duplicate_email'
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '300' }
      });
    }

    // Create invitation record first
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('workspace_invitations')
      .insert({
        email: email.toLowerCase(),
        full_name: fullName || '',
        platform_role: role,
        status: 'sent',
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (inviteError) throw inviteError;

    // Create invitation workspace access rows
    if (Array.isArray(accessRows) && accessRows.length) {
      const accessInsert = accessRows.map((row: Record<string, unknown>) => ({
        invitation_id: invite.id,
        workspace_id: row.workspace_id,
        member_role: row.member_role || role,
        can_view: row.can_view ?? true,
        can_edit: row.can_edit ?? false,
        can_manage_team: row.can_manage_team ?? false,
        can_manage_finance: row.can_manage_finance ?? false,
      }));
      const { error: accessError } = await supabaseAdmin
        .from('invitation_workspace_access')
        .insert(accessInsert);
      if (accessError) throw accessError;
    }

    // Send the Supabase invite email. inviteUserByEmail creates the auth.users
    // row (if it doesn't already exist) and emails the secure link. We capture
    // the returned user_id so we can pre-create memberships below — that way
    // the invitee has access the moment they finish the password screen, with
    // no client-side RLS dance required during invite acceptance.
    let invitedUserId: string | null = null;
    const { data: inviteData, error: inviteEmailError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      {
        redirectTo: redirectTo || Deno.env.get('SITE_URL') || '',
        data: {
          full_name: fullName || '',
          platform_role: role,
          invitation_id: invite.id,
        }
      }
    );
    let emailSent = !inviteEmailError;
    let inviteLinkForAdmin: string | null = null;
    if (inviteEmailError) {
      if (inviteEmailError.message?.includes('already been registered')) {
        // fine — the person exists; memberships are refreshed below
      } else {
        // Supabase Auth could not email. Make the link ourselves and send it
        // through the shared Gmail mailbox; if even that fails, hand the link
        // to the admin so it can be forwarded by hand.
        console.error('create-platform-invite: inviteUserByEmail failed, falling back to generateLink + Gmail', inviteEmailError);
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: 'invite',
          email: lowerEmail,
          options: {
            redirectTo: redirectTo || Deno.env.get('SITE_URL') || '',
            data: { full_name: fullName || '', platform_role: role, invitation_id: invite.id },
          },
        });
        if (linkErr || !linkData?.properties?.action_link) {
          await supabaseAdmin.from('invitation_workspace_access').delete().eq('invitation_id', invite.id);
          await supabaseAdmin.from('workspace_invitations').delete().eq('id', invite.id);
          return new Response(JSON.stringify({
            ok: false,
            error: `Supabase Auth could not send the invite email (${inviteEmailError.message || 'unknown'}) and could not generate a link either (${linkErr?.message || 'no link'}). Check Authentication → SMTP settings in the Supabase dashboard.`,
          }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        invitedUserId = linkData.user?.id ?? null;
        inviteLinkForAdmin = linkData.properties.action_link;
        try {
          await sendInviteViaGmail(supabaseAdmin, { to: lowerEmail, fullName: fullName || '', actionLink: inviteLinkForAdmin, invitedBy: caller.email || "Gota d'Água" });
          emailSent = true;
        } catch (mailErr) {
          console.error('create-platform-invite: Gmail fallback failed', mailErr);
          emailSent = false;
        }
      }
    } else {
      invitedUserId = inviteData?.user?.id ?? null;
    }
    // If "already registered", look the user up via platform_profiles
    // (the on_auth_user_created trigger guarantees a row exists for any
    // auth.users entry).
    if (!invitedUserId) {
      const { data: existingProfile } = await supabaseAdmin
        .from('platform_profiles')
        .select('id')
        .eq('email', lowerEmail)
        .maybeSingle();
      invitedUserId = existingProfile?.id ?? null;
    }

    // Pre-create the workspace_memberships rows so the invitee enters the app
    // with the right access immediately after setting their password. Service
    // role bypasses Phase 4 RLS, which is what makes this reliable. Idempotent
    // via onConflict: a re-invite to the same email refreshes the rows.
    if (invitedUserId && Array.isArray(accessRows) && accessRows.length) {
      const membershipRows = accessRows.map((row: Record<string, unknown>) => ({
        user_id: invitedUserId,
        workspace_id: row.workspace_id,
        member_role: row.member_role || role,
        can_view: row.can_view ?? true,
        can_edit: row.can_edit ?? false,
        can_manage_team: row.can_manage_team ?? false,
        can_manage_finance: row.can_manage_finance ?? false,
        active: true,
        updated_at: new Date().toISOString(),
      }));
      const { error: membershipError } = await supabaseAdmin
        .from('workspace_memberships')
        .upsert(membershipRows, { onConflict: 'user_id,workspace_id' });
      if (membershipError) throw membershipError;

      // Also align the platform_profiles row to the invited role so the
      // Settings UI shows the right label.
      await supabaseAdmin
        .from('platform_profiles')
        .update({ platform_role: role, full_name: fullName || undefined, active: true, updated_at: new Date().toISOString() })
        .eq('id', invitedUserId);
    }

    return new Response(JSON.stringify({
      ok: true,
      invite: { id: invite.id, expires_at: expiresAt, user_id: invitedUserId },
      email_sent: emailSent,
      // Only present when neither Supabase Auth nor Gmail could deliver: the
      // admin forwards it by hand. Never logged, never stored.
      invite_link: emailSent ? undefined : inviteLinkForAdmin,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('create-platform-invite error:', err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
