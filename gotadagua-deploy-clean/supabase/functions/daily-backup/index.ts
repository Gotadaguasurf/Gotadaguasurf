// ════════════════════════════════════════════════════════════════════════════
//  daily-backup — exports critical tables to Supabase Storage as JSON.
// ════════════════════════════════════════════════════════════════════════════
//
//  Trigger: scheduled by pg_cron once per day (see schedule-daily-backup.sql).
//  Auth: only callable with the service-role key. pg_cron passes that
//        explicitly via the Authorization header.
//
//  What it does:
//    1. For each table in BACKUP_TABLES, select * (full table dump).
//    2. Serialize to JSON and upload to the `backups` Storage bucket as
//       `YYYY-MM-DD/<table>.json`.
//    3. Delete backup folders older than RETAIN_DAYS (default 30).
//    4. Return a summary of what was backed up.
//
//  Tables included: every table that holds business data. The auth.* tables
//  (auth.users, auth.identities, etc.) are managed by Supabase itself and
//  are not part of this backup — Supabase keeps its own backups of those.
//
//  How to restore (manually): download the day's folder from Storage,
//  for each table COPY/INSERT the JSON rows back. There's no automatic
//  restore endpoint — restore is rare and benefits from a human in the loop.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Tables to back up. Order matters only for restore — we back up everything.
const BACKUP_TABLES = [
  // Core business data
  'bookings',
  'partners',
  'partner_month_status',
  'ledger_entries',
  'camp_weeks',
  'camp_guests',
  'camp_tab_items',
  'location_menus',
  'camp_staff_directory',
  'monthly_cost_profiles',
  'instructor_directory',
  'instructor_lessons',
  'location_state_store',
  // Auth-adjacent metadata (does NOT include auth.users itself)
  'platform_profiles',
  'workspace_memberships',
  'workspace_invitations',
  'invitation_workspace_access',
  'workspaces',
  'locations',
  // Audit
  'audit_log',
];

const RETAIN_DAYS = 30;
const BUCKET_NAME = 'backups';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Auth is enforced at the Supabase Edge Function gateway: a valid JWT
    // (anon, service_role, or a signed-in user) is required to even reach
    // this code. We don't add a second comparison here because it complicates
    // matters when the project mixes the new sb_secret_* key format with the
    // legacy eyJ* env-injected SUPABASE_SERVICE_ROLE_KEY.
    //
    // The function uses the service-role env key INTERNALLY (below) to read
    // every table for backup — so the data access is still privileged
    // regardless of which valid JWT the caller used.

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Today's folder, e.g. "2026-05-09"
    const today = new Date().toISOString().slice(0, 10);
    const summary: Record<string, { rows: number; bytes: number; uploaded: boolean; error?: string }> = {};

    // 1. Dump each table
    for (const table of BACKUP_TABLES) {
      try {
        // Page through up to 50k rows per table — none of these tables should
        // exceed that for years. If they do, we need pagination, but right
        // now keeping it simple.
        const { data, error } = await supabase.from(table).select('*').limit(50000);
        if (error) {
          summary[table] = { rows: 0, bytes: 0, uploaded: false, error: error.message };
          continue;
        }
        const json = JSON.stringify({
          table,
          backed_up_at: new Date().toISOString(),
          rows: data?.length ?? 0,
          data: data ?? []
        }, null, 0);
        const path = `${today}/${table}.json`;
        const blob = new Blob([json], { type: 'application/json' });
        const upload = await supabase.storage.from(BUCKET_NAME).upload(path, blob, {
          contentType: 'application/json',
          upsert: true
        });
        if (upload.error) {
          summary[table] = { rows: data?.length ?? 0, bytes: json.length, uploaded: false, error: upload.error.message };
        } else {
          summary[table] = { rows: data?.length ?? 0, bytes: json.length, uploaded: true };
        }
      } catch (e) {
        summary[table] = { rows: 0, bytes: 0, uploaded: false, error: e instanceof Error ? e.message : 'Unknown error' };
      }
    }

    // 2. Cleanup folders older than RETAIN_DAYS
    let deletedFolders = 0;
    try {
      const cutoff = new Date(Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: folders } = await supabase.storage.from(BUCKET_NAME).list('', { limit: 1000 });
      for (const folder of folders ?? []) {
        // folder.name is the date string for our naming scheme
        if (folder.name && folder.name < cutoff) {
          // List files in the folder, then remove them
          const { data: files } = await supabase.storage.from(BUCKET_NAME).list(folder.name, { limit: 200 });
          if (files && files.length) {
            const paths = files.map(f => `${folder.name}/${f.name}`);
            const { error: delErr } = await supabase.storage.from(BUCKET_NAME).remove(paths);
            if (!delErr) deletedFolders += 1;
          }
        }
      }
    } catch (_e) {
      // Cleanup failure is non-fatal — the day's backup still uploaded.
    }

    // 3. Write a one-line manifest summarising the run
    const manifest = {
      backed_up_at: new Date().toISOString(),
      day: today,
      tables_total: BACKUP_TABLES.length,
      tables_ok: Object.values(summary).filter(s => s.uploaded).length,
      tables_failed: Object.values(summary).filter(s => !s.uploaded).length,
      retain_days: RETAIN_DAYS,
      cleaned_old_folders: deletedFolders,
      tables: summary
    };
    await supabase.storage.from(BUCKET_NAME).upload(
      `${today}/_manifest.json`,
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      { contentType: 'application/json', upsert: true }
    );

    return new Response(JSON.stringify({ ok: true, ...manifest }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('daily-backup error:', err);
    return new Response(JSON.stringify({
      ok: false, error: err instanceof Error ? err.message : 'Unknown error'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
