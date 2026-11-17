// Camp hub · Transport → Overview for Morocco (16 Nov 2026; v2 the same day) — stubbed Supabase, synthetic trips, invented
// ledger lines. Week | Month | Year: three numbers (cost with up / down, owed now, per person), the year as bars by kind, one
// bar per kind, drivers and suppliers. Before the trip list the months come from the ledger's payments, read by kind.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');
const O = require('../lib/transport-overview.js');

const SHOTS = process.env.FLO_SHOTS || path.join(__dirname, '..', 'test-results', 'overview-shots');
let k = 0;
const uuid = p => `${p}-0000-4000-8000-${String(++k).padStart(12, '0')}`;
function ledgerRow(desc, amount, date, linked = null) {
  return { id: uuid('cccccccc'), location_id: H.LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: linked, description: desc, payment_method: 'Bank Transfer', qty: 1, amount_local: amount, currency: 'MAD',
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
  // September before the trip list: an airport payment, a weekly van line (30 × 110), a van lump sum, a taxi; August's invoice paid 9 Sep.
  const ledger = [ledgerRow('Let Us Tours', 4000, '2026-09-05', 'Airport'), ledgerRow(null, 3300, '2026-09-12', 'Surf'), ledgerRow('Mounir vans September', 2600, '2026-09-28'),
    ledgerRow('Taxi Agadir', 180, '2026-09-12'), ledgerRow('August · Let Us Tours', 3500, '2026-09-09', 'Airport')];
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

const kindLabels = async page => (await page.locator('[data-ov-table="summary"] [data-ov-row] .tr-kind-t').allInnerTexts()).map(x => x.trim());
const money = n => `MAD ${n.toLocaleString('en-US')}`;

test('overview (Morocco): the Overview pill → this month: cost (≈ €, up / down), owed now with Pay, per person; one bar per kind (Airport · Surf vans · Tours); drivers; = the pure function', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openOverview(page);
  await expect(page.locator('.tr-ov-period')).toHaveText('November 2026');
  await expect(page.locator('[data-ov-mode="month"]')).toHaveClass(/active/);
  await expect(page.locator('#transportRoot [data-view="overview"]')).toHaveClass(/active/);
  expect(await kindLabels(page)).toEqual(['Airport', 'Surf vans', 'Tours']);                 // the page's pills, in that order
  await expect(page.locator('[data-ov-row="vans"]')).toContainText('Surf Taghazout 2');
  await expect(page.locator('[data-ov-row="tours"]')).toContainText('Dunes 1');
  await expect(page.locator('[data-ov-row="tours"]')).not.toContainText('Souk');                // its only run was cancelled
  await expect(page.locator('[data-ov-row="airport"]')).toContainText(/Arrivals \d+ · Departures \d+/);
  await expect(page.locator('[data-ov-row="airport"]')).toContainText('incl. 1 no-show');
  // The page shows what the pure function computes from the same trips and ledger.
  const { trips, ledger } = data();
  const hub = await page.evaluate(() => { const D = TransportUI.ovData(); return { T: D.V.total, owed: D.owed.total }; });
  const L = ledger.map(r => ({ id: r.id, date: r.entry_date, type: 'expense', category: 'Transport', businessArea: 'Transport', linkedItem: r.linked_item || '', amountLocal: r.amount_local, description: r.description || '' }));
  const C = O.collect({ trips, ledger: L, drivers: H.DRIVERS, cfg: H.CC.MA, goLive: H.CC.MA.goLive, now: '2026-11-14T10:00' });
  const node = O.view(C, O.period('month', '2026-11'), H.CC.MA).total;
  expect(hub.T).toEqual(node);
  expect(node.trips).toBe(trips.filter(t => t.trip_date.startsWith('2026-11') && !['cancelled', 'merged'].includes(t.status)).length);
  const kpi = k => page.locator(`[data-ov-kpi="${k}"]`);
  await expect(kpi('cost').locator('.kpi-value')).toHaveText(sp(money(node.cost)));
  await expect(kpi('cost').locator('.tr-eur')).toHaveText(`≈ €${Math.round(node.cost / 10.8).toLocaleString('en-US')}`);
  await expect(kpi('cost').locator('[data-ov-delta]')).toHaveText(/(more|less) than October 2026|times October 2026/);
  await expect(kpi('owed').locator('.kpi-value')).toHaveText(sp(money(hub.owed)));
  await expect(kpi('owed').locator(`[data-ov-pay="${H.D.fat}"]`)).toContainText('Pay Fathoune');
  await expect(kpi('pp').locator('.kpi-value')).toHaveText(sp(money(node.perPerson)));
  await expect(page.locator('[data-ov-note]')).toContainText('€ ≈ at 10.8 MAD per €');
  await expect(page.locator('#transportRoot')).not.toContainText('*');                         // no footnote marks
  // Drivers and suppliers add up to the cost.
  expect((await page.locator('[data-ov-drivers] [data-ov-driver]').evaluateAll(rs => rs.map(r => r.dataset.ovDriver))).sort()).toEqual(['Fathoune', 'Let Us Tours']);
  // October: the trips added for 1 Oct–12 Nov count (go-live 1 Oct) and are owed.
  await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  expect(await kindLabels(page)).toEqual(['Airport']);
  await expect(page.locator('[data-ov-kpi="cost"] .kpi-value')).toHaveText(sp('MAD 250'));
  // Week: Transport's Sat–Fri week.
  await page.click('[data-ov-mode="week"]');
  await page.evaluate(() => { TransportUI._state.ov.anchor = '2026-11-14'; TransportUI.render(); });
  await expect(page.locator('.tr-ov-period')).toHaveText('14–20 Nov');
  // An empty period says so in a sentence.
  await page.evaluate(() => { TransportUI._state.ov.anchor = '2026-12-26'; TransportUI.render(); });
  await expect(page.locator('[data-ov-empty]')).toContainText('No transport recorded in the week of 26 Dec – 1 Jan');
  // A pill goes back to the day list.
  await page.click('#transportRoot .tr-cats .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot .tr-day').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('overview (Morocco): a month before the trip list reads like a new one — Airport · Surf vans · Fuel & other from the payments, people = van lines ÷ 110, the suppliers; no «Payments with no trip list»', async ({ page }) => {
  await openOverview(page);
  await page.click('button[title="Previous"]'); await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('September 2026');
  expect(await kindLabels(page)).toEqual(['Airport', 'Surf vans', 'Fuel & other']);
  await expect(page.locator('#transportRoot')).not.toContainText('no trip list*');
  await expect(page.locator('#transportRoot')).not.toContainText('Other transport');
  await expect(page.locator('[data-ov-kpi="cost"] .kpi-value')).toHaveText(sp('MAD 10,080'));     // August's invoice (paid 9 Sep) is August's
  await expect(page.locator('[data-ov-kpi="cost"] [data-ov-delta]')).toHaveText(/times August 2026/);
  await expect(page.locator('[data-ov-kpi="pp"] .kpi-value')).toHaveText(sp('MAD 110'));
  await expect(page.locator('[data-ov-kpi="pp"]')).toContainText('Surf vans · 30 people');
  await expect(page.locator('[data-ov-row="vans"]')).toContainText('Surf Taghazout (30 people) · Fathoune lump sum');
  await expect(page.locator('[data-ov-row="other"]')).toContainText('Taxis');
  await expect(page.locator('[data-ov-table="summary"] .tr-kind-head')).not.toContainText('Trips');   // no trips before the list: no column of dashes
  expect(await page.locator('[data-ov-drivers] [data-ov-driver]').evaluateAll(rs => rs.map(r => [r.dataset.ovDriver, r.querySelector('.tr-sup-cost .num').textContent.replace(/\s/g, ' ')])))
    .toEqual([['Fathoune', 'MAD 5,900'], ['Let Us Tours', 'MAD 4,000'], ['Fuel & other', 'MAD 180']]);
  await expect(page.locator('[data-ov-driver="Let Us Tours"]')).toContainText('Paid · last 5 Sep');
  await expect(page.locator('[data-ov-note]')).toContainText('before the trip list');
});

test('overview (Morocco): after go-live an unlinked payment is «paid for earlier trips», never cost twice; fuel stays a cost (QA 16 Nov 2026)', async ({ page }) => {
  const extra = [ledgerRow('Let Us Tours transfers', 16000, '2026-10-12'), ledgerRow('Afriquia diesel', 300, '2026-10-13')];
  await openOverview(page, { ledger: data().ledger.concat(extra) });
  await page.click('button[title="Previous"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  expect(await kindLabels(page)).toEqual(['Airport', 'Fuel & other']);
  const lut = page.locator('[data-ov-driver="Let Us Tours"]');
  expect((await lut.locator('.tr-sup-cost .num').textContent()).replace(/\s/g, ' ')).toBe('MAD 250');      // cost = the October trip, once
  await expect(lut.locator('.tr-sup-st')).toContainText(sp('+ MAD 16,000 paid for earlier trips'));
  await expect(page.locator('[data-ov-kpi="cost"] .kpi-value')).toHaveText(sp('MAD 550'));
});

test('overview (Morocco): year — stacked bars by kind with a legend, a bar opens its month; Export = months × kinds with the € total last', async ({ page }) => {
  await openOverview(page);
  await page.click('[data-ov-mode="year"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('2026');
  await expect(page.locator('[data-ov-bars] .tr-bar')).toHaveCount(12);
  await expect(page.locator('[data-ov-bars] .tr-legend')).toHaveText(/Airport.*Surf vans.*Tours.*Fuel & other/);
  await expect(page.locator('[data-ov-month="2026-09"] .tr-seg')).toHaveCount(3);
  const Y = await page.evaluate(() => TransportUI.ovData().Y);
  expect(Y.totals.cost[7]).toBe(3500);
  expect(Y.totals.cost[8]).toBe(10080);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ov-export]')]);
  expect(dl.suggestedFilename()).toBe('transport-overview-morocco-year-2026-cost.csv');
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split('\r\n');
  expect(lines[0]).toBe('"Cost (MAD)","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Total","Total (EUR)"');
  expect(lines.length).toBe(Y.rows.length + 2);
  const air = Y.rows.find(r => r.kind === 'airport');
  expect(lines[1]).toBe(['Airport', ...air.cost, air.total.cost, Math.round(air.total.cost / 10.8)].map(v => `"${v}"`).join(','));
  await page.click('[data-ov-month="2026-10"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('October 2026');
  await expect(page.locator('[data-ov-mode="month"]')).toHaveClass(/active/);
  // Month export: kinds with their parts, the total, then the drivers — with the euros.
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-ov-export]')]);
  const m = fs.readFileSync(await dl2.path(), 'utf8').slice(1).trim().split('\r\n');
  expect(m[0]).toContain('"Cost (EUR)","Paid (EUR)","Owed (EUR)"');
  expect(m.some(l => l.startsWith('"Driver / supplier"'))).toBe(true);
});

test('overview (Morocco): screenshots Week, Month, Year at 1280 and 390 — no page overflow, no card scrolls sideways', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await openOverview(page);
  await page.addStyleTag({ content: '#toast { display: none !important; }' });
  for (const [w, hgt] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const [mode, anchor] of [['week', '2026-11-14'], ['month', '2026-11'], ['year', '2026']]) {
      await page.evaluate(([m, a]) => { TransportUI.ovMode(m); TransportUI._state.ov.anchor = a; TransportUI.render(); }, [mode, anchor]);
      await page.waitForTimeout(120);
      expect(await H.noOverflow(page), `${mode} at ${w}`).toBe(true);
      expect(await page.locator('.tr-ov-card').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1)), `${mode} cards at ${w}`).toBe(true);   // nothing scrolls sideways
      await page.locator('.tr-tripview').screenshot({ path: path.join(SHOTS, `overview-${mode}-${w}.png`) });
    }
  }
});

test('overview (Morocco): «Surf vans» shows the cost per surfer-day from the guests\' Bookinglayer lessons (no typed head count)', async ({ page }) => {
  const g = (name, raw) => ({ id: uuid('99999999'), location_id: H.LOC, booking_ref: 'MA-S' + name, guest_key: name.toLowerCase(), guest_name: name, check_in: '2026-11-01', check_out: '2026-11-08',
    booking_status: 'paid', activities: '', packages: '', raw, import_id: 'imp-s', updated_at: '2026-11-14T08:00:00Z' });
  const guests = [g('Ann', { lessons: [], courses: [{ type: 'standard', date: null }] }), g('Bob', { lessons: [{ date: '2026-11-03', type: 'standard' }], courses: [] })];
  await openOverview(page, { guests });
  const row = page.locator('[data-ov-row="vans"] [data-ov-surfer-day]');
  await expect(row).toContainText('per surfer-day');
  await expect(row).toContainText('5 surfer-days from Bookinglayer lessons');      // from the first van run (Tue 3): Ann Tue 3 – Fri 6, Bob Tue 3
  // Surf runs 3 Nov (500) and 4 Nov (300) ÷ 5 surfer-days; the typed head count of the old runs is not shown beside it
  expect(await page.evaluate(() => TransportUI.ovData().surf)).toMatchObject({ cost: 800, surferDays: 5, per: 160, uncovered: 0, from: '2026-11-03', to: '2026-11-14' });
  await expect(page.locator('[data-ov-row="vans"] .tr-kind-meta')).not.toContainText('per person');
  expect(await H.noOverflow(page)).toBe(true);                                // 390 px: no sideways scroll
});
