import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ════════════════════════════════════════════════════════════════════════════
//  remove-platform-user — HARD delete of an account (auth user + profile +
//  memberships + invitations). Nothing in the real app calls it: Settings
//  deactivates softly. Since 18 Nov 2026 (audit SEC-11) only Miguel (platform
//  super_admin) may call it, and never on an Owner or super_admin account;
//  before, every team manager could delete any account, Miguel's included.
//  Kept (not deleted) because the separate booking prototype still calls it.
// ════════════════════════════════════════════════════════════════════════════

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

    // The caller's login
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
    // Caller authorization: Miguel only (active super_admin) — SEC-11.
    const { data: callerProfile } = await supabaseAdmin
      .from('platform_profiles')
      .select('platform_role, active')
      .eq('id', caller.id)
      .maybeSingle();
    if (!(callerProfile?.active === true && callerProfile?.platform_role === 'super_admin')) {
      return new Response(JSON.stringify({ ok: false, error: 'Only Miguel can delete an account. Use «Deactivate» in Settings.' }), {
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

    // Never an Owner or the super_admin (SEC-11)
    const { data: targetProfile } = await supabaseAdmin
      .from('platform_profiles')
      .select('platform_role')
      .eq('id', targetUserId)
      .maybeSingle();
    if (['super_admin', 'owner'].includes(String(targetProfile?.platform_role || ''))) {
      return new Response(JSON.stringify({ ok: false, error: 'An Owner account cannot be deleted. Deactivate it in Settings instead.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
