// Acceptance on a REAL Morocco Guests export (14 Nov 2026): the app's Week against the independent
// oracle. Skipped unless ma_week/oracle_check.sh sets MA_GUESTS_FILE (the real file never enters the
// repository) and MA_ORACLE_JSON (the oracle's output for it). Writes the differences to MA_DIFF_OUT.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./ma-helpers');
const { dumpWeeks, diff } = require('./ma-dump');

const FILE = process.env.MA_GUESTS_FILE, ORACLE = process.env.MA_ORACLE_JSON, OUT = process.env.MA_DIFF_OUT;
test.skip(!FILE || !ORACLE, 'set by ma_week/oracle_check.sh');

test('real Morocco Guests file: Week = oracle (nights, beds, arrivals, departures, room and bed changes, meals)', async ({ page }) => {
  test.setTimeout(120000);
  const text = fs.readFileSync(FILE, 'utf8');
  const name = path.basename(FILE);
  const guests = H.GT.guestRows(text, name, H.CC.MA).filter(g => H.GT.OK_STATUS.has(g.booking_status) && g.check_in && g.check_out)
    .map((g, i) => ({ id: `99999999-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: H.LOC, ...g, hq_match: null, import_id: '22222222-0000-4000-8000-0000000000ff', updated_at: '2026-11-14T08:00:00Z' }));
  const o = JSON.parse(fs.readFileSync(ORACLE, 'utf8'));
  const days = Object.keys(o.days).sort();
  const weeks = []; for (let ws = H.GT.weekStart(days[0]); ws <= days[days.length - 1]; ws = H.GT.addDaysIso(ws, 7)) weeks.push(ws);
  await H.openWeek(page, { guests, now: `${H.GT.weekStart(days[0])}T10:00` });
  const app = await dumpWeeks(page, weeks);
  const audit = H.GT.guestAudit(text, name, H.CC.MA);
  const d = diff(app, o);
  if (audit.rows !== o.rows) d.unshift(`rows: app ${audit.rows} / oracle ${o.rows}`);
  const appLeft = audit.left.map(x => `${x.line} ${x.name} ${x.kind}`), oLeft = o.left_out.map(x => `${x.line} ${x.name} ${x.reason}`);
  if (JSON.stringify(appLeft) !== JSON.stringify(oLeft)) d.unshift(`left out: app ${JSON.stringify(appLeft)} / oracle ${JSON.stringify(oLeft)}`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ weeks, differences: d, app }, null, 1));
  expect(d).toEqual([]);
});
