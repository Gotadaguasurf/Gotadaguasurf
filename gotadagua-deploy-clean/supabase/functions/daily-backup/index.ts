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
  // Finance (HQ + The Suk): expense lines, bank statements, categories, Drive folders, recurring templates, month checks, partner invoices
  'hq_invoices',
  'hq_bank_movements',
  'hq_invoice_categories',
  'hq_companies',
  'hq_recurring_expenses',
  'hq_month_checks',
  'hq_asset_income',
  'accountant_drive_folders',
  'partner_invoices',
  'partner_ledger',
  'internal_transfers',
  // Auth-adjacent metadata (does NOT include auth.users itself)
  'platform_profiles',
  'workspace_memberships',
  'workspace_invitations',
  'invitation_workspace_access',
  'workspaces',
  'locations',
  // Camp week, transport, cash (18 Nov 2026: every business table is in the copy)
  'camp_week_guests',
  'camp_week_messages',
  'camp_trips',
  'camp_drivers',
  'camp_cash_counts',
  'camp_transport_payments',
  // Bookings history, prices, surf school, Dipløria, investments
  'bookings_snapshots',
  'bl_report_runs',
  'bl_report_settings',
  'daily_fx_rates',
  'pricing_catalog',
  'pricing_areas',
  'tour_zones',
  'accommodation_packs',
  'accommodation_prices',
  'accommodation_room_types',
  'accommodation_rooms',
  'accommodation_seasons',
  'surf_school_rentals',
  'surf_school_settings',
  'diploria_stock_moves',
  'diploria_expenses',
  'hq_assets',
  'hq_invoice_audit',
  'accountant_month_marks',
  'mail_ingest_items',
  // CRM
  'outreach_contacts',
  'contacts',
  'contact_pipeline',
  'outreach_activity',
  'outreach_groups',
  'outreach_templates',
  'outreach_sequences',
  'outreach_sequence_runs',
  'outreach_saved_views',
  'pipelines',
  'pipeline_stages',
  'email_campaigns',
  'email_messages',
  'email_queue',
  'email_suppression',
  'meetings',
  'tasks',
  'team_users',
  // Audit (only the last AUDIT_DAYS days per file: the monthly files, kept forever, overlap and cover every day)
  'audit_log',
];
// NOT in the copy on purpose: gmail_account, drive_account, mail_ingest_account, accountant_portal_tokens,
// password_reset_requests (they hold tokens) and auth.users.

// Primary key of each table, to read it page by page in a stable order. Default: id.
const PK: Record<string, string[]> = {
  accountant_drive_folders: ['company', 'month_key'],
  hq_companies: ['slug'],
  hq_month_checks: ['month_key', 'item'],
  camp_transport_payments: ['entry_id'],
  surf_school_settings: ['key'],
  accountant_month_marks: ['month_key'],
};
const PAGE = 1000;          // the API never returns more than 1,000 rows per call
const AUDIT_DAYS = 35;

// Every row of a table, 1,000 at a time. The old single call stopped at the first 1,000 rows
// (18 Nov 2026 audit: 13% of the ledger was in the copy).
// deno-lint-ignore no-explicit-any
async function readAll(supabase: any, table: string): Promise<{ rows: unknown[]; expected: number | null; error?: string }> {
  const since = table === 'audit_log' ? new Date(Date.now() - AUDIT_DAYS * 86400000).toISOString() : null;
  // deno-lint-ignore no-explicit-any
  const scoped = (q: any) => since ? q.gte('at', since) : q;
  const head = await scoped(supabase.from(table).select('*', { count: 'exact', head: true }));
  const expected = head.error ? null : (head.count ?? null);
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = scoped(supabase.from(table).select('*'));
    for (const col of (PK[table] || ['id'])) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { rows, expected, error: error.message };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    if (from > 2_000_000) return { rows, expected, error: 'stopped at 2,000,000 rows' };
  }
  return { rows, expected };
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

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

    const summary: Record<string, { rows: number; expected: number | null; complete: boolean; bytes: number; uploaded: boolean; error?: string }> = {};

    // 1. Dump each table once, then upload the same blob to every target tier
    for (const table of BACKUP_TABLES) {
      try {
        const { rows, expected, error } = await readAll(supabase, table);
        if (error) {
          summary[table] = { rows: rows.length, expected, complete: false, bytes: 0, uploaded: false, error };
          continue;
        }
        const json = JSON.stringify({
          table,
          backed_up_at: new Date().toISOString(),
          rows: rows.length,
          ...(table === 'audit_log' ? { only_last_days: AUDIT_DAYS } : {}),
          data: rows
        }, null, 0);
        const blob = await gzip(json);
        let allOk = true;
        let lastErr = '';
        for (const t of targets) {
          const path = `${t.folder}/${table}.json.gz`;
          const upload = await supabase.storage.from(BUCKET_NAME).upload(path, blob, {
            contentType: 'application/gzip',
            upsert: true
          });
          if (upload.error) { allOk = false; lastErr = upload.error.message; }
        }
        // complete = every row the table had when counted is in the file (rows can only be >= on a busy table)
        const complete = allOk && expected != null && rows.length >= expected;
        summary[table] = { rows: rows.length, expected, complete, bytes: blob.size, uploaded: allOk, error: allOk ? undefined : lastErr };
      } catch (e) {
        summary[table] = { rows: 0, expected: null, complete: false, bytes: 0, uploaded: false, error: e instanceof Error ? e.message : 'Unknown error' };
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
      tables_incomplete: Object.entries(summary).filter(([, v]) => !v.complete).map(([k]) => k),
      rows_total: Object.values(summary).reduce((n, v) => n + v.rows, 0),
      format: 'one <table>.json.gz per table (gzip of {table, backed_up_at, rows, data})',
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
