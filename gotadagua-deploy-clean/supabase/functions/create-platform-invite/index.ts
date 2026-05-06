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
    // Check caller has owner or admin role
    const { data: callerProfile } = await supabaseAdmin
      .from('platform_profiles')
      .select('platform_role')
      .eq('id', caller.id)
      .maybeSingle();
    if (!['owner', 'admin'].includes(callerProfile?.platform_role ?? '')) {
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
