// scripts/restore-backup.js — the nightly JSON copy back into SQL you read and run yourself (audit 18 Nov 2026, AUT-03).
// Node only: builds a fake backup folder in a temp dir, runs the script, reads the SQL. Never touches a database.
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'restore-backup.js');
function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gota-restore-'));
  for (const [name, doc] of Object.entries(files)) {
    const text = JSON.stringify(doc);
    fs.writeFileSync(path.join(dir, name), name.endsWith('.gz') ? zlib.gzipSync(text) : text);
  }
  return dir;
}
const run = (args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('restore: a day folder becomes one SQL transaction that only adds missing rows, with the manifest warnings on top', () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({ id: `r${i}`, amount: i, note: i === 7 ? "it's $gota$ odd" : null }));
  const dir = folder({
    'hq_invoices.json.gz': { table: 'hq_invoices', backed_up_at: '2026-11-18T03:00:12Z', rows: rows.length, data: rows },
    'ledger_entries.json': { table: 'ledger_entries', rows: 1, data: [{ id: 'l1', amount_local: 10 }] },        // an older folder's plain .json
    'audit_log.json.gz': { table: 'audit_log', rows: 0, only_last_days: 35, data: [] },
    '_manifest.json': { tables: { hq_invoices: { rows: 1203, expected: 1203, complete: true }, ledger_entries: { rows: 1, expected: 7990, complete: false } } },
  });
  const out = path.join(dir, 'restore.sql');
  const log = run([dir, '--out', out]);
  expect(log).toContain('3 table(s), 1204 rows');
  expect(log).toContain('WARNING ledger_entries: the backup marked this table INCOMPLETE (1 of 7990 rows)');
  expect(log).toContain('Nothing was written to any database');
  const sql = fs.readFileSync(out, 'utf8');
  expect(sql.match(/^begin;$/m)).toBeTruthy();
  expect(sql.trim().endsWith('commit;')).toBe(true);
  expect(sql).toContain('set local session_replication_role = replica;');
  expect((sql.match(/select pg_temp\.gota_restore\('hq_invoices', /g) || []).length).toBe(3);      // 500 rows per call
  expect((sql.match(/::jsonb, false\);/g) || []).length).toBe(4);                                     // add missing rows only
  expect(sql).toContain('create or replace function pg_temp.gota_restore');
  expect(sql).toContain("c.is_generated <> 'ALWAYS'");                                            // never a generated column
  expect(sql).toContain('overriding system value');
  expect(sql).not.toContain("gota_restore('audit_log'");                                           // nothing to restore
  expect(sql).toContain('$gota1$');                                                                 // the data held «$gota$»: another tag
  expect(sql).toContain('-- WARNING audit_log: only the last 35 days are in this file');
  // every statement's JSON is intact
  const chunks = [...sql.matchAll(/(\$gota\d*\$)(.*?)\1::jsonb/gs)].map(m => JSON.parse(m[2]));
  expect(chunks.flat().length).toBe(1204);                                                          // 1,203 invoices + 1 ledger row
});

test('restore: --tables, --replace and --keep-triggers; a bad table name is refused', () => {
  const dir = folder({
    'camp_guests.json.gz': { table: 'camp_guests', rows: 1, data: [{ id: 'g1', full_name: 'Guest One', room: '3' }] },
    'hq_month_checks.json.gz': { table: 'hq_month_checks', rows: 1, data: [{ month_key: '2026-10', item: 'bank' }] },
  });
  const out = path.join(dir, 'x.sql');
  run([dir, '--tables', 'camp_guests,missing_table', '--replace', '--keep-triggers', '--out', out]);
  const sql = fs.readFileSync(out, 'utf8');
  expect(sql).toContain("select pg_temp.gota_restore('camp_guests', $gota$[{\"id\":\"g1\",\"full_name\":\"Guest One\",\"room\":\"3\"}]$gota$::jsonb, true);");
  expect(sql).not.toContain('hq_month_checks');
  expect(sql).not.toContain('session_replication_role');
  expect(sql).toContain('-- WARNING missing_table: no file for this table');
  // --replace on a table without id stops with a clear message
  expect(() => run([path.join(dir, 'hq_month_checks.json.gz'), '--replace', '--out', out])).toThrow(/needs an id column/);
  const evil = folder({ 'x.json': { table: 'x"; drop table bookings; --', rows: 0, data: [] } });
  expect(() => run([evil, '--out', path.join(evil, 'e.sql')])).toThrow(/table name I will not write/);
});
