// Camp hub · Transport → Overview for Morocco (16 Nov 2026) — stubbed Supabase, synthetic trips, invented ledger lines.
// Week | Month | Year by transport type; before go-live (1 Oct 2026) the months come from the ledger's Transport payments.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');
const O = require('../lib/transport-overview.js');

const SHOTS = process.env.FLO_SHOTS || path.join(__dirname, '..', 'test-results', 'overview-shots');
let k = 0;
const uuid = p => `${p}-0000-4000-8000-${String(++k).padStart(12, '0')}`;
function ledgerRow(desc, amount, date) {
  return { id: uuid('cccccccc'), location_id: H.LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: null, description: desc, payment_method: 'Bank Transfer', qty: 1, amount_local: amount, currency: 'MAD',
    entry_date: date, business_area: 'Transport', fx_rate: 10.8, amount_eur: amount / 10.8, recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: 'morocco', attributed_location: 'morocco', created_at: '2026-11-16T09:00:00Z' };
}
const base = H.tripsFromFile()[0];
const run = (route, date, pax, price, o = {}) => ({ ...base, id: uuid('bbbbbbbb'), kind: 'other', route, purpose: route === 'Surf' ? 'surf' : 'tour', place: null, flight: null, guest_names: null, guest_phone: null,
  trip_date: date, trip_time: '09:00', pax, vehicle: 'Minivan', driver_id: H.D.fat, expected_price: price, status: 'done', import_key: null, ...o });
function data() {
  const trips = H.tripsFromFile().map((t, i) => i === 0 ? { ...t, status: 'no_show' } : t)
    .concat([run('Surf', '2026-11-03', 7, 500), run('Surf', '2026-11-04', 3, 300, { payment_entry_id: null }), run('Dunes', '2026-11-11', 8, 700), run('Souk', '2026-11-12', 5, 400, { status: 'cancelled' }),
      { ...base, id: uuid('aaaaaaaa'), import_key: 'hist2026:MA-0901:arr:AGA', source: 'manual', trip_date: '2026-10-12', trip_time: '12:00', status: 'done', guest_names: 'Old Example' }]);
  const ledger = [ledgerRow('Let Us Tours September', 4000, '2026-09-05'), ledgerRow('Mounir vans September', 2600, '2026-09-28'), ledgerRow('Taxi Agadir', 180, '2026-09-12'), ledgerRow('Let Us Tours August', 3500, '2026-08-30')];
  return { trips, ledger };
}
async function openOverview(page, opts = {}) {
  const st = await H.open(page, { ...data(), ...opts });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  await page.click('#transportRoot [data-view="overview"]');
  return st;
}
const sp = x => x.replace(/\s/g, ' ');   // Intl puts a no-break space after «MAD»
const cells = async loc => (await loc.locator('td').allInnerTexts()).map(sp);

test('overview (Morocco): the Overview pill → this month by type — airports split, van runs and tours by name, no-show counted, cancelled out, the total = the pure function', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openOverview(page);
  await expect(page.locator('.tr-ov-period')).toHaveText('November 2026');
  await expect(page.locator('[data-ov-mode="month"]')).toHaveClass(/active/);
  await expect(page.locator('#transportRoot [data-view="overview"]')).toHaveClass(/active/);
  const labels = await page.locator('[data-ov-table="summary"] tbody tr[data-ov-row] td:first-child').allInnerTexts();
  expect(labels.map(l => l.split('\n')[0])).toEqual(expect.arrayContaining(['Arrivals · Agadir', 'Arrivals · Marrakech', 'Surf Taghazout', 'Dunes']));
  expect(labels.map(l => l.split('\n')[0])).not.toContain('Souk');                       // its only run was cancelled
  const names = labels.map(l => l.split('\n')[0]);
  expect(names.indexOf('Surf Taghazout')).toBeGreaterThan(names.findIndex(l => l.startsWith('Departures')));   // airport, then runs, then tours
  await expect(page.locator('[data-ov-table="summary"] tbody')).toContainText('incl. 1 no-show');
  await expect(page.locator('#transportRoot .tr-ov-grp').first()).toHaveText('Airport');
  // The page shows what the pure function computes from the same trips.
  const want = await page.evaluate(() => TransportUI.ovData().Sm.total);
  const { trips } = data();
  const node = O.summary({ trips, cfg: H.CC.MA, mode: 'month', from: '2026-11-01', to: '2026-11-30', goLive: H.CC.MA.goLive, now: '2026-11-14T10:00' }).total;
  expect(want).toEqual(node);
  expect(node.trips).toBe(trips.filter(t => t.trip_date.startsWith('2026-11') && !['cancelled', 'merged'].includes(t.status)).length);
  const tot = await cells(page.locator('[data-ov-table="summary"] tfoot tr'));
  expect(tot[1]).toBe(String(node.trips));
  expect(tot[2]).toBe(String(node.people));
  // October: the trips added for 1 Oct–12 Nov count (go-live 1 Oct) and are owed, not «Before go-live».
  await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  await expect(page.locator('[data-ov-table="summary"] tfoot')).toContainText('MAD 250');
  await expect(page.locator('[data-ov-ledger]')).toHaveCount(0);
  // Week: Transport's Sat–Fri week.
  await page.click('[data-ov-mode="week"]');
  await page.evaluate(() => { TransportUI._state.ov.anchor = '2026-11-14'; TransportUI.render(); });
  await expect(page.locator('.tr-ov-period')).toHaveText('14–20 Nov');
  // A category pill goes back to the day list.
  await page.click('#transportRoot .tr-cats .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot .tr-day').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('overview (Morocco): before go-live a month shows the ledger\'s Transport payments by supplier, «from payments — no trip list»', async ({ page }) => {
  await openOverview(page);
  await page.click('button[title="Previous"]'); await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('September 2026');
  await expect(page.locator('[data-ov-table="summary"]')).toHaveCount(0);
  const led = page.locator('[data-ov-ledger]');
  await expect(led).toContainText('From payments — no trip list');
  expect(await led.locator('tbody tr').evaluateAll(rs => rs.map(r => [...r.children].map(c => c.innerText.replace(/\s/g, ' '))))).toEqual([['Let Us Tours', '1', 'MAD 4,000'], ['Fathoune', '1', 'MAD 2,600'], ['Other transport', '1', 'MAD 180']]);
});

test('overview (Morocco): year — type × month, Sep from payments (*), a month header opens that month, Cost / People, Export = the table', async ({ page }) => {
  await openOverview(page);
  await page.click('[data-ov-mode="year"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('2026');
  const head = await page.locator('[data-ov-table="year"] thead th').allInnerTexts();
  expect(head[0]).toBe('COST');
  expect(head.slice(8, 12)).toEqual(['AUG*', 'SEP*', 'OCT', 'NOV']);
  const lut = page.locator('[data-ov-table="year"] tr[data-ov-row="ledger:Let Us Tours"]');
  expect((await cells(lut)).slice(8, 10)).toEqual(['MAD 3,500', 'MAD 4,000']);
  await expect(page.locator('[data-ov-table="year"] .tr-ov-grp', { hasText: 'From payments — no trip list' })).toHaveCount(1);
  await page.click('[data-ov-measure="people"]');
  const total = await cells(page.locator('[data-ov-table="year"] tfoot tr'));
  const Y = await page.evaluate(() => TransportUI.ovData().Y);
  expect(total[total.length - 1]).toBe(String(Y.totals.all.people));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ov-export]')]);
  expect(dl.suggestedFilename()).toBe('transport-overview-morocco-year-2026-people.csv');
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split('\r\n');
  expect(lines[0]).toBe('"People","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Total"');
  expect(lines.length).toBe(Y.rows.length + 2);
  expect(lines).toContain('"Let Us Tours (from payments)","","","","","","","","","","","","",""');
  await page.click('[data-ov-month="2026-10"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  await expect(page.locator('[data-ov-mode="month"]')).toHaveClass(/active/);
});

test('overview (Morocco): screenshots Week, Month, Year at 1280 and 390 — no page overflow (the year table scrolls inside its card)', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await openOverview(page);
  await page.addStyleTag({ content: '#toast { display: none !important; }' });
  for (const [w, hgt] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const [mode, anchor] of [['week', '2026-11-14'], ['month', '2026-11'], ['year', '2026']]) {
      await page.evaluate(([m, a]) => { TransportUI.ovMode(m); TransportUI._state.ov.anchor = a; TransportUI.render(); }, [mode, anchor]);
      await page.waitForTimeout(120);
      expect(await H.noOverflow(page), `${mode} at ${w}`).toBe(true);
      if (mode !== 'year') expect(await page.locator('.tr-ov-card .tbl-wrap').first().evaluate(el => el.scrollWidth <= el.clientWidth), `${mode} table at ${w}`).toBe(true);   // only the year scrolls inside its card
      await page.locator('.tr-tripview').screenshot({ path: path.join(SHOTS, `overview-${mode}-${w}.png`) });
    }
  }
});
