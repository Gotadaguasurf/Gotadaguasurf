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

test('overview (Morocco): the Overview pill → this month: four numbers (MAD + €), one row per kind (Airport · Surf vans · Tours), by driver; no-show counted, cancelled out, totals = the pure function', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openOverview(page);
  await expect(page.locator('.tr-ov-period')).toHaveText('November 2026');
  await expect(page.locator('[data-ov-mode="month"]')).toHaveClass(/active/);
  await expect(page.locator('#transportRoot [data-view="overview"]')).toHaveClass(/active/);
  const labels = (await page.locator('[data-ov-table="summary"] tbody tr[data-ov-row] td:first-child').allInnerTexts()).map(l => l.split('\n')[0]);
  expect(labels).toEqual(['Airport', 'Surf vans', 'Tours']);                                  // the page's pills, in that order
  await expect(page.locator('[data-ov-row="vans"] td').first()).toContainText('Surf Taghazout 2');
  await expect(page.locator('[data-ov-row="tours"] td').first()).toContainText('Dunes 1');
  await expect(page.locator('[data-ov-row="tours"] td').first()).not.toContainText('Souk');   // its only run was cancelled
  await expect(page.locator('[data-ov-row="airport"] td').first()).toContainText(/Arrivals \d+ · Departures \d+/);
  await expect(page.locator('[data-ov-table="summary"] tbody')).toContainText('incl. 1 no-show');
  // The page shows what the pure function computes from the same trips (owed = the «Owed to drivers» rule: no-shows are not owed).
  const want = await page.evaluate(() => TransportUI.ovData().Sm.total);
  const { trips } = data();
  const node = O.summary({ trips, cfg: H.CC.MA, mode: 'month', from: '2026-11-01', to: '2026-11-30', goLive: H.CC.MA.goLive, now: '2026-11-14T10:00' }).total;
  expect(want).toEqual(node);
  expect(node.trips).toBe(trips.filter(t => t.trip_date.startsWith('2026-11') && !['cancelled', 'merged'].includes(t.status)).length);
  const tot = await cells(page.locator('[data-ov-table="summary"] tfoot tr'));
  expect(tot[1]).toBe(String(node.trips));
  expect(tot[2]).toBe(String(node.people));
  // Four numbers, each with euros at the ledger's own rate (10.8 MAD per € in this fixture).
  const kpi = k => page.locator(`[data-ov-kpi="${k}"]`);
  await expect(kpi('cost').locator('.kpi-value')).toHaveText(sp(`MAD ${node.cost.toLocaleString('en-US')}`));
  await expect(kpi('cost').locator('.tr-eur')).toHaveText(`≈ €${Math.round(node.cost / 10.8).toLocaleString('en-US')}`);
  await expect(kpi('owed').locator('.kpi-value')).toHaveText(sp(`MAD ${node.owed.toLocaleString('en-US')}`));
  await expect(page.locator('[data-ov-note]')).toContainText('€ ≈ at 10.8 MAD per €');
  // By driver: Let Us Tours (airport) and Fathoune (vans).
  expect((await page.locator('[data-ov-table="drivers"] tbody tr td:first-child').allInnerTexts()).map(l => l.split('\n')[0])).toEqual(expect.arrayContaining(['Let Us Tours', 'Fathoune']));
  // October: the trips added for 1 Oct–12 Nov count (go-live 1 Oct) and are owed, not «Before go-live».
  await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  await expect(page.locator('[data-ov-table="summary"] tfoot')).toContainText('MAD 250');
  await expect(page.locator('[data-ov-row="ledger"]')).toHaveCount(0);
  // Week: Transport's Sat–Fri week.
  await page.click('[data-ov-mode="week"]');
  await page.evaluate(() => { TransportUI._state.ov.anchor = '2026-11-14'; TransportUI.render(); });
  await expect(page.locator('.tr-ov-period')).toHaveText('14–20 Nov');
  // A pill goes back to the day list.
  await page.click('#transportRoot .tr-cats .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot .tr-day').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('overview (Morocco): before go-live a month shows the ledger\'s Transport payments — one «Payments with no trip list» row, by supplier under it and in By driver', async ({ page }) => {
  await openOverview(page);
  await page.click('button[title="Previous"]'); await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('September 2026');
  const row = page.locator('[data-ov-row="ledger"]');
  await expect(row).toContainText('Payments with no trip list');
  await expect(row.locator('td').first()).toContainText('Let Us Tours 1 · Fathoune 1 · Other transport 1');
  await expect(page.locator('[data-ov-kpi="cost"] .kpi-value')).toHaveText(sp('MAD 6,780'));
  await expect(page.locator('[data-ov-kpi="paid"] .kpi-value')).toHaveText(sp('MAD 6,780'));
  expect(await page.locator('[data-ov-table="drivers"] tbody tr').evaluateAll(rs => rs.map(r => [r.children[0].innerText.split('\n')[0], r.children[2].innerText.split('\n')[0].replace(/\s/g, ' ')])))
    .toEqual([['Let Us Tours', 'MAD 4,000'], ['Fathoune', 'MAD 2,600'], ['Other transport', 'MAD 180']]);
  await expect(page.locator('[data-ov-note]')).toContainText('pay no trip of the app');
});

test('overview (Morocco): a payment after go-live that pays no trip shows in the month it was paid; once linked it is its trips\' «Paid» (QA 16 Nov 2026)', async ({ page }) => {
  const extra = [ledgerRow('September · Let Us Tours', 16000, '2026-10-12'), ledgerRow('Afriquia diesel', 300, '2026-10-13')];
  const st = await openOverview(page, { ledger: data().ledger.concat(extra) });
  await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  await expect(page.locator('[data-ov-row="ledger"] td').first()).toContainText('Let Us Tours 1');
  await expect(page.locator('[data-ov-row="ledger"] td').first()).not.toContainText('Other transport');   // after go-live: driver payments only
  await expect(page.locator('[data-ov-table="drivers"] tr[data-ov-driver="Let Us Tours"]')).toContainText('MAD 16,250'.replace(' ', ' '));
});

test('overview (Morocco): year — cost by month as bars (Sep from payments, lighter), a bar opens that month; Export = the matrix with € total last', async ({ page }) => {
  await openOverview(page);
  await page.click('[data-ov-mode="year"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('2026');
  await expect(page.locator('[data-ov-bars] .tr-bar')).toHaveCount(12);
  await expect(page.locator('[data-ov-bars] .tr-bar.tr-bar-paym')).toHaveCount(9);          // Jan–Sep: before the trip list (go-live 1 Oct)
  await expect(page.locator('[data-ov-table="summary"] [data-ov-row="ledger"]')).toContainText('Let Us Tours 2');   // Aug + Sep
  const Y = await page.evaluate(() => TransportUI.ovData().Y);
  expect(Y.totals.cost[8]).toBe(4000 + 2600 + 180);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ov-export]')]);
  expect(dl.suggestedFilename()).toBe('transport-overview-morocco-year-2026-cost.csv');
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split('\r\n');
  expect(lines[0]).toBe('"Cost (MAD)","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Total","Total (EUR)"');
  expect(lines.length).toBe(Y.rows.length + 2);
  expect(lines).toContain(`"Let Us Tours (from payments)","0","0","0","0","0","0","0","3500","4000","0","0","0","7500","${Math.round(7500 / 10.8)}"`);
  await page.click('[data-ov-month="2026-10"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  await expect(page.locator('[data-ov-mode="month"]')).toHaveClass(/active/);
});

test('overview (Morocco): screenshots Week, Month, Year at 1280 and 390 — no page overflow, no table scrolls sideways', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await openOverview(page);
  await page.addStyleTag({ content: '#toast { display: none !important; }' });
  for (const [w, hgt] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const [mode, anchor] of [['week', '2026-11-14'], ['month', '2026-11'], ['year', '2026']]) {
      await page.evaluate(([m, a]) => { TransportUI.ovMode(m); TransportUI._state.ov.anchor = a; TransportUI.render(); }, [mode, anchor]);
      await page.waitForTimeout(120);
      expect(await H.noOverflow(page), `${mode} at ${w}`).toBe(true);
      expect(await page.locator('.tr-ov-card .tbl-wrap').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth)), `${mode} tables at ${w}`).toBe(true);   // no table scrolls sideways (the year is bars + the kind table)   // only the year scrolls inside its card
      await page.locator('.tr-tripview').screenshot({ path: path.join(SHOTS, `overview-${mode}-${w}.png`) });
    }
  }
});
