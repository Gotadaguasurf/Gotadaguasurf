import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    // Send the Supabase invite email — user clicks link → lands on app → sets password
    const { error: inviteEmailError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
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
    if (inviteEmailError) {
      // If user already exists, update their access instead of failing
      if (!inviteEmailError.message?.includes('already been registered')) {
        throw inviteEmailError;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      invite: { id: invite.id, expires_at: expiresAt }
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
