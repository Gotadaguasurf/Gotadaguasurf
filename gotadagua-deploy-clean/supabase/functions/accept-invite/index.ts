import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { INVITE_STATE_MESSAGE, inviteState, isUuid } from '../_shared/invite.ts';

// ════════════════════════════════════════════════════════════════════════════
//  accept-invite — the «Create your password» screen behind /?accept=<token>
//  (6 Nov 2026). Deployed with --no-verify-jwt: the person has no account yet.
//
//  POST { action: 'check',  token }                       → { ok, email, full_name }
//  POST { action: 'accept', token, password, full_name? } → { ok, email }
//
//  The token is workspace_invitations.invitation_token (random uuid, only ever
//  sent to that email address). It works until the password is created or an
//  admin cancels the invite — no 24-hour limit. Accepting:
//    1. finds or creates the auth user, sets the password, confirms the email;
//    2. stamps platform_profiles.password_set_at (+ name), active = true;
//    3. adds any membership from invitation_workspace_access that does not exist
//       yet (rows an admin already edited in Settings are left as they are);
//    4. marks the invite accepted.
//  An account that already has a password is never touched from here.
//  Business errors answer 200 { ok:false, code, error } so the page can tell
//  them apart from «function not deployed» (404).
// ════════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const fail = (code: string, extra: Record<string, unknown> = {}) =>
  json({ ok: false, code, error: INVITE_STATE_MESSAGE[code] || 'Something went wrong. Ask Miguel to send the invite again.', ...extra });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'accept' ? 'accept' : 'check';
    const token = String(body?.token || '').trim().toLowerCase();
    if (!isUuid(token)) return fail('invalid');

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: invite, error: invErr } = await admin
      .from('workspace_invitations')
      .select('id, email, full_name, platform_role, status, expires_at')
      .eq('invitation_token', token)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!invite) return fail('invalid');
    const email = String(invite.email || '').toLowerCase();

    const { data: profile } = await admin
      .from('platform_profiles')
      .select('id, full_name, password_set_at')
      .eq('email', email)
      .maybeSingle();

    const state = inviteState(invite, profile);
    if (state !== 'open') return fail(state, { email });

    if (action === 'check') {
      return json({ ok: true, email, full_name: invite.full_name || profile?.full_name || '' });
    }

    // ── accept ──
    const password = typeof body?.password === 'string' ? body.password : '';
    if (password.length < 8) return json({ ok: false, code: 'weak_password', error: 'Use a password with at least 8 characters.' });
    if (password.length > 72) return json({ ok: false, code: 'weak_password', error: 'Use a password of at most 72 characters.' });
    const fullName = String(body?.full_name || '').trim().slice(0, 120) || invite.full_name || profile?.full_name || '';

    let userId: string | null = profile?.id ?? null;
    if (userId) {
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });
      if (updErr) throw updErr;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, platform_role: invite.platform_role, invitation_id: invite.id },
      });
      if (createErr) throw createErr;
      userId = created?.user?.id ?? null;
    }
    if (!userId) throw new Error('Could not create the account.');

    const nowIso = new Date().toISOString();
    const profileUpdate: Record<string, unknown> = { password_set_at: nowIso, active: true, updated_at: nowIso };
    if (fullName) profileUpdate.full_name = fullName;
    const { error: profErr } = await admin.from('platform_profiles').update(profileUpdate).eq('id', userId);
    if (profErr) throw profErr;

    const { data: accessRows, error: accErr } = await admin
      .from('invitation_workspace_access')
      .select('workspace_id, member_role, can_view, can_edit, can_manage_team, can_manage_finance')
      .eq('invitation_id', invite.id);
    if (accErr) throw accErr;
    if (accessRows?.length) {
      const { error: memErr } = await admin.from('workspace_memberships').upsert(
        accessRows.map((r) => ({ ...r, user_id: userId, active: true, updated_at: nowIso })),
        { onConflict: 'user_id,workspace_id', ignoreDuplicates: true },
      );
      if (memErr) throw memErr;
    }

    // This invite and any other open one for the same email are done.
    await admin.from('workspace_invitations')
      .update({ status: 'accepted', accepted_at: nowIso, updated_at: nowIso })
      .eq('email', email)
      .in('status', ['pending', 'sent']);
    await admin.from('workspace_invitations')
      .update({ status: 'accepted', accepted_at: nowIso, updated_at: nowIso })
      .eq('id', invite.id);

    return json({ ok: true, email });
  } catch (err) {
    console.error('accept-invite error:', err);
    // deno-lint-ignore no-explicit-any
    const msg = err instanceof Error ? err.message : ((err as any)?.message || 'Unknown error');
    return json({ ok: false, code: 'error', error: `Could not create the password: ${msg}` }, 500);
  }
});
