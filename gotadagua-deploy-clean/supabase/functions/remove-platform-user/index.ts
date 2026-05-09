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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify caller is owner/admin
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) {
      return new Response(JSON.stringify({ ok: false, error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    // Caller authorization: super_admin / owner / admin platform role, or
    // can_manage_team=true on at least one workspace. Mirrors the gate used
    // by create-platform-invite so the two functions are interchangeable.
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

    const { targetUserId, targetEmail } = await req.json();
    if (!targetUserId) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing targetUserId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (targetUserId === caller.id) {
      return new Response(JSON.stringify({ ok: false, error: 'Cannot remove your own account' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Look up the email so we can also clean any invitation rows.
    //    The frontend passes targetEmail too but we resolve from the DB so a
    //    bad/stale UI value doesn't leave invitations dangling.
    const { data: profileRow } = await supabaseAdmin
      .from('platform_profiles')
      .select('email')
      .eq('id', targetUserId)
      .maybeSingle();
    const emailLower = (profileRow?.email || targetEmail || '').toLowerCase();

    // 2. Delete invitation rows for this email. invitation_workspace_access
    //    cascades from workspace_invitations.id, so it goes too.
    if (emailLower) {
      await supabaseAdmin
        .from('workspace_invitations')
        .delete()
        .eq('email', emailLower);
    }

    // 3. Delete the auth.users row. The schema has:
    //      platform_profiles.id  → auth.users(id)            on delete cascade
    //      workspace_memberships → platform_profiles(id)     on delete cascade
    //    so platform_profiles + workspace_memberships rows are wiped
    //    automatically by Postgres. No "active=false" soft-delete needed.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('remove-platform-user error:', err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
