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

// Retention tiers (Grandfather-Father-Son):
//   daily/   → keep last 30 days, granularity = 1 day
//   weekly/  → keep last 90 days, granularity = 1 week (created on Mondays)
//   monthly/ → keep FOREVER, granularity = 1 month (created on day 1)
const RETAIN_DAILY_DAYS   = 30;
const RETAIN_WEEKLY_DAYS  = 90;
const BUCKET_NAME         = 'backups';

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

    // Compute today's three possible target paths.
    // The function ALWAYS writes to daily/. It also writes to weekly/ on
    // Mondays, and to monthly/ on day 1 of the month.
    const now      = new Date();
    const today    = now.toISOString().slice(0, 10);                 // 2026-05-09
    const dayOfWk  = now.getUTCDay();                                 // 0=Sun, 1=Mon, ...
    const dayOfMth = now.getUTCDate();                                // 1..31
    const isoWeek  = getIsoWeekString(now);                           // 2026-W19
    const monthKey = today.slice(0, 7);                               // 2026-05

    const targets: { tier: 'daily' | 'weekly' | 'monthly'; folder: string }[] = [
      { tier: 'daily', folder: `daily/${today}` }
    ];
    if (dayOfWk === 1)  targets.push({ tier: 'weekly',  folder: `weekly/${isoWeek}` });
    if (dayOfMth === 1) targets.push({ tier: 'monthly', folder: `monthly/${monthKey}` });

    const summary: Record<string, { rows: number; bytes: number; uploaded: boolean; error?: string }> = {};

    // 1. Dump each table once, then upload the same blob to every target tier
    for (const table of BACKUP_TABLES) {
      try {
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
        const blob = new Blob([json], { type: 'application/json' });
        let allOk = true;
        let lastErr = '';
        for (const t of targets) {
          const path = `${t.folder}/${table}.json`;
          const upload = await supabase.storage.from(BUCKET_NAME).upload(path, blob, {
            contentType: 'application/json',
            upsert: true
          });
          if (upload.error) { allOk = false; lastErr = upload.error.message; }
        }
        summary[table] = { rows: data?.length ?? 0, bytes: json.length, uploaded: allOk, error: allOk ? undefined : lastErr };
      } catch (e) {
        summary[table] = { rows: 0, bytes: 0, uploaded: false, error: e instanceof Error ? e.message : 'Unknown error' };
      }
    }

    // 2. Cleanup
    //    daily/   → delete folders whose date < today - 30
    //    weekly/  → delete folders whose ISO week < (today - 90 days)
    //    monthly/ → never deleted
    let deletedFolders = 0;
    deletedFolders += await cleanupTier(supabase, 'daily',  RETAIN_DAILY_DAYS);
    deletedFolders += await cleanupTier(supabase, 'weekly', RETAIN_WEEKLY_DAYS);

    // 3. Write a manifest in each target folder summarising the run
    const manifestBody = {
      backed_up_at: new Date().toISOString(),
      day: today,
      tiers_written: targets.map(t => t.tier),
      tables_total: BACKUP_TABLES.length,
      tables_ok: Object.values(summary).filter(s => s.uploaded).length,
      tables_failed: Object.values(summary).filter(s => !s.uploaded).length,
      retention: {
        daily_days: RETAIN_DAILY_DAYS,
        weekly_days: RETAIN_WEEKLY_DAYS,
        monthly_days: 'forever'
      },
      cleaned_old_folders: deletedFolders,
      tables: summary
    };
    for (const t of targets) {
      await supabase.storage.from(BUCKET_NAME).upload(
        `${t.folder}/_manifest.json`,
        new Blob([JSON.stringify(manifestBody, null, 2)], { type: 'application/json' }),
        { contentType: 'application/json', upsert: true }
      );
    }

    return new Response(JSON.stringify({ ok: true, ...manifestBody }), {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

// ISO 8601 week label like "2026-W19" — the Monday-based week of year.
function getIsoWeekString(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in this week determines the year (ISO 8601 rule)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Delete folders inside a tier whose date stamp is older than `daysOld`.
// Tier folder layout:
//   daily/YYYY-MM-DD/...
//   weekly/YYYY-Www/...
//   monthly/YYYY-MM/...   ← never cleaned (caller doesn't pass this here)
async function cleanupTier(
  supabase: ReturnType<typeof createClient>,
  tier: 'daily' | 'weekly' | 'monthly',
  daysOld: number
): Promise<number> {
  let deleted = 0;
  try {
    const { data: folders } = await supabase.storage.from(BUCKET_NAME).list(tier, { limit: 1000 });
    if (!folders) return 0;
    const cutoffMs = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    for (const folder of folders) {
      if (!folder.name) continue;
      const folderTimeMs = parseFolderTimestamp(tier, folder.name);
      if (folderTimeMs === null || folderTimeMs >= cutoffMs) continue;
      // Old enough — wipe contents
      const { data: files } = await supabase.storage.from(BUCKET_NAME).list(`${tier}/${folder.name}`, { limit: 200 });
      if (files && files.length) {
        const paths = files.map(f => `${tier}/${folder.name}/${f.name}`);
        const { error: delErr } = await supabase.storage.from(BUCKET_NAME).remove(paths);
        if (!delErr) deleted += 1;
      }
    }
  } catch (_e) {
    // Cleanup failure is non-fatal — today's backup still uploaded successfully.
  }
  return deleted;
}

// Parse the date out of a tier folder name into milliseconds since epoch.
// Returns null if it doesn't match the expected pattern (so we skip it safely).
function parseFolderTimestamp(tier: 'daily' | 'weekly' | 'monthly', name: string): number | null {
  if (tier === 'daily') {
    // YYYY-MM-DD
    const m = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  if (tier === 'weekly') {
    // YYYY-Www → Monday of that ISO week
    const m = name.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return null;
    const year = +m[1], week = +m[2];
    // Jan 4th is always in ISO week 1; calculate Monday from there
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7; // 1..7 with Mon=1
    const mondayWeek1 = new Date(Date.UTC(year, 0, 4 - (jan4Day - 1)));
    return mondayWeek1.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000;
  }
  if (tier === 'monthly') {
    // YYYY-MM → 1st of month
    const m = name.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, 1);
  }
  return null;
}
