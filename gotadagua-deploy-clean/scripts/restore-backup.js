#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  restore-backup.js — turn the nightly JSON copy (Storage bucket «backups»,
//  written by supabase/functions/daily-backup) into ONE SQL file that you read
//  and then run yourself. It never connects to a database.
//
//    node scripts/restore-backup.js <folder | table.json.gz | table.json> [options]
//
//    <folder>          a downloaded day: daily/2026-11-18/ with <table>.json.gz
//                      (older folders: <table>.json) and _manifest.json
//    --tables a,b      only these tables (default: every file in the folder)
//    --out file.sql    where to write (default: restore-<folder name>.sql)
//    --replace         on a row that already exists, overwrite it with the
//                      backup (default: keep the current row, add only the
//                      missing ones — «on conflict do nothing»)
//    --keep-triggers   leave the tables' triggers on (default: off for the
//                      restore, so ledger mirrors and audit lines are not
//                      written a second time)
//
//  What the copy does NOT hold: auth.users (logins: Supabase's own backups),
//  the token tables (gmail_account, drive_account, mail_ingest_account,
//  accountant_portal_tokens, password_reset_requests), Storage files, and
//  audit_log beyond the last 35 days of that day's file.
//
//  Audit 18 Nov 2026 (AUT-03): «no restore was ever scripted». Doc:
//  .github/workflows/backup-readme.md → «Restore from the nightly JSON copy».
// ════════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CHUNK = 500;                         // rows per INSERT (keeps each statement small)
const NAME = /^[a-z_][a-z0-9_]*$/;         // a table name we will write into the SQL

function parseArgs(argv) {
  const o = { src: null, tables: null, out: null, replace: false, keepTriggers: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tables') o.tables = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--replace') o.replace = true;
    else if (a === '--keep-triggers') o.keepTriggers = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.src) o.src = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function readJsonFile(file) {
  const buf = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
}

// Every table file in a folder (or the one file given), .json.gz preferred over .json.
function listFiles(src) {
  const st = fs.statSync(src);
  if (st.isFile()) return { dir: path.dirname(src), files: [src] };
  const byTable = new Map();
  for (const f of fs.readdirSync(src).sort()) {
    const m = /^([a-z_][a-z0-9_]*)\.json(\.gz)?$/.exec(f);
    if (!m || f.startsWith('_')) continue;
    if (!byTable.has(m[1]) || m[2]) byTable.set(m[1], path.join(src, f));
  }
  return { dir: src, files: [...byTable.values()] };
}

// A dollar-quote tag that does not occur in the text.
function dollarTag(text) {
  let n = 0, tag;
  do { tag = `$gota${n ? n : ''}$`; n++; } while (text.includes(tag));
  return tag;
}

// One call per 500 rows. The column list is worked out IN THE DATABASE at run time
// (pg_temp.gota_restore below): only the columns the backup holds, never a generated
// column (camp_cash_counts.counted_total, instructor_lessons.total), and OVERRIDING SYSTEM
// VALUE for an «always» identity (bookings_snapshots.id) — so a schema change never
// breaks the restore.
function tableSql(table, rows, { replace }) {
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const json = JSON.stringify(rows.slice(i, i + CHUNK));
    const tag = dollarTag(json);
    out.push(`select pg_temp.gota_restore('${table}', ${tag}${json}${tag}::jsonb, ${replace ? 'true' : 'false'});`);
  }
  return out.join('\n');
}

const HELPER = `-- the restore helper: lives only in this session (pg_temp), gone when the tab closes
create or replace function pg_temp.gota_restore(p_table text, p_rows jsonb, p_replace boolean)
returns bigint language plpgsql as $fn$
declare
  v_keys text[]; v_cols text; v_set text; v_ident boolean; v_n bigint; v_seq text;
begin
  select array_agg(distinct k) into v_keys from jsonb_array_elements(p_rows) e, jsonb_object_keys(e) k;
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position) filter (where c.column_name <> 'id'),
         coalesce(bool_or(c.identity_generation = 'ALWAYS'), false)
    into v_cols, v_set, v_ident
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table
     and c.is_generated <> 'ALWAYS' and c.column_name = any (v_keys);
  if v_cols is null then raise exception 'restore: table public.% not found or no matching columns', p_table; end if;
  execute format('insert into public.%I (%s) %s select %s from jsonb_populate_recordset(null::public.%I, $1) %s',
                 p_table, v_cols, case when v_ident then 'overriding system value' else '' end, v_cols, p_table,
                 case when p_replace and v_set is not null then format('on conflict (id) do update set %s', v_set) else 'on conflict do nothing' end)
    using p_rows;
  get diagnostics v_n = row_count;
  -- a numeric id with a counter (identity / serial): move the counter past the restored ids,
  -- so the next row the app adds does not collide with one that came back from the backup
  if 'id' = any (v_keys) then
    v_seq := pg_get_serial_sequence(format('public.%I', p_table), 'id');
    if v_seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(id), 1) from public.%I), (select last_value from %s)))', v_seq, p_table, v_seq);
    end if;
  end if;
  raise notice 'restore: % — % rows written', p_table, v_n;
  return v_n;
end $fn$;`;

function build(opts) {
  const { dir, files } = listFiles(opts.src);
  let manifest = null;
  try { manifest = readJsonFile(path.join(dir, '_manifest.json')); } catch (_e) { /* a single file, or an old folder */ }
  const report = [];
  const warnings = [];
  const parts = [];
  for (const file of files) {
    const doc = readJsonFile(file);
    const table = String(doc.table || path.basename(file).replace(/\.json(\.gz)?$/, ''));
    if (!NAME.test(table)) throw new Error(`${file}: table name I will not write: ${table}`);
    if (opts.tables && !opts.tables.includes(table)) continue;
    const rows = Array.isArray(doc.data) ? doc.data : [];
    if (typeof doc.rows === 'number' && doc.rows !== rows.length) warnings.push(`${table}: the file says ${doc.rows} rows but holds ${rows.length}`);
    const m = manifest && manifest.tables && manifest.tables[table];
    if (m && m.complete === false) warnings.push(`${table}: the backup marked this table INCOMPLETE (${m.rows} of ${m.expected ?? '?'} rows${m.error ? ', ' + m.error : ''})`);
    if (m && m.expected != null && rows.length < m.expected) warnings.push(`${table}: ${rows.length} rows in the file, ${m.expected} in the table that night`);
    if (doc.only_last_days) warnings.push(`${table}: only the last ${doc.only_last_days} days are in this file`);
    if (opts.replace && rows.length && !Object.prototype.hasOwnProperty.call(rows[0], 'id')) throw new Error(`${table}: --replace needs an id column; restore it without --replace`);
    report.push({ table, rows: rows.length, backed_up_at: doc.backed_up_at || null });
    if (rows.length) parts.push(`-- ${table}: ${rows.length} rows (backed up ${doc.backed_up_at || 'at an unknown time'})\n${tableSql(table, rows, opts)}`);
  }
  if (opts.tables) for (const t of opts.tables) if (!report.find(r => r.table === t)) warnings.push(`${t}: no file for this table in ${dir}`);
  const head = [
    `-- Restore from the nightly JSON copy: ${path.resolve(opts.src)}`,
    `-- Made by scripts/restore-backup.js on ${new Date().toISOString()}. READ IT, then run it in the SQL editor`,
    `-- (best first on a scratch project). Nothing has been written anywhere yet.`,
    `-- Mode: ${opts.replace ? 'existing rows are OVERWRITTEN by the backup (--replace)' : 'only missing rows are added; existing rows stay as they are'}.`,
    `-- Not in this copy: auth.users (logins), token tables, Storage files, audit_log older than 35 days.`,
    ...warnings.map(w => `-- WARNING ${w}`),
    'begin;',
    opts.keepTriggers ? '-- triggers stay on (--keep-triggers)' : "-- triggers and foreign-key checks off for this transaction only, so mirrors and audit lines are not written twice\nset local session_replication_role = replica;",
    HELPER,
  ];
  const sql = [...head, ...parts, 'commit;', ''].join('\n\n');
  return { sql, report, warnings, dir };
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help || !opts.src) {
    console.log('Usage: node scripts/restore-backup.js <folder | table.json.gz> [--tables a,b] [--out file.sql] [--replace] [--keep-triggers]');
    process.exit(opts.help ? 0 : 2);
  }
  const { sql, report, warnings } = build(opts);
  const out = opts.out || `restore-${path.basename(path.resolve(opts.src)).replace(/\.json(\.gz)?$/, '')}.sql`;
  fs.writeFileSync(out, sql);
  const total = report.reduce((n, r) => n + r.rows, 0);
  console.log(`${report.length} table(s), ${total} rows → ${out}`);
  for (const r of report) console.log(`  ${r.table.padEnd(32)} ${String(r.rows).padStart(7)}`);
  for (const w of warnings) console.log(`WARNING ${w}`);
  console.log('Nothing was written to any database. Read the file, then run it yourself.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`restore-backup: ${e.message}`); process.exit(1); }
}
module.exports = { build, tableSql, parseArgs };
