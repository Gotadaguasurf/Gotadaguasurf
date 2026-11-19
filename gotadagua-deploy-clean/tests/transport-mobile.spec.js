// Camp hub · Transport on a phone (19 Nov 2026, Miguel: «mais mobile version esta área toda») — stubbed Supabase,
// invented data. Every Transport screen at 390 × 844: no sideways scroll (page or sheet), no text under 11 px, every
// button / field / select at least 40 px tall, one blue button. Screenshots go to SURFPAX_SHOTS (default test-results).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const { SL_LOC, SAMPATH, openSl } = require('./transport-sl-stub');
const H = require('./ma-helpers');

const SHOTS = process.env.SURFPAX_SHOTS || path.join(__dirname, '..', 'test-results', 'surfpax-shots');
const TAG = process.env.SURFPAX_TAG || 'after';

// What a phone check measures on the open sheet (or the page when no sheet is open).
async function measure(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const sheet = document.querySelector('#trOv.open .modal');
    const root = sheet || document.querySelector('#transportRoot');
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const name = el => (el.id ? '#' + el.id + ' ' : '') + (el.getAttribute('title') || el.textContent || el.value || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
    const small = []; const short = []; const wide = [];
    root.querySelectorAll('*').forEach(el => {
      if (!vis(el)) return;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 11) small.push(name(el) + ' ' + getComputedStyle(el).fontSize);
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && !el.closest('.tr-scroll-x')) wide.push(name(el));
    });
    root.querySelectorAll('button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), a.btn, [role=button]').forEach(el => {
      if (!vis(el) || el.closest('.mclose')) return;
      const r = el.getBoundingClientRect(); if (r.height < 39.5) short.push(name(el) + ' ' + Math.round(r.height));
    });
    const blue = [...root.querySelectorAll('.btn-p')].filter(vis).length;
    return { pageScroll: document.documentElement.scrollWidth > vw, sheetScroll: !!sheet && sheet.scrollWidth > sheet.clientWidth + 1, small, short, wide: wide.slice(0, 8), blue };
  });
}
async function check(page, name, report, opts = {}) {
  await page.waitForTimeout(250);
  fs.mkdirSync(SHOTS, { recursive: true });
  const sheet = await page.locator('#trOv.open').count();
  await page.screenshot({ path: path.join(SHOTS, `mobile-${name}-390-${TAG}.png`), fullPage: !sheet });
  const m = await measure(page);
  report[name] = m;
  if (TAG === 'before') return m;   // the «before» run only records
  expect(m.pageScroll, `${name}: page scrolls sideways`).toBe(false);
  expect(m.sheetScroll, `${name}: sheet scrolls sideways`).toBe(false);
  expect(m.wide, `${name}: past the right edge`).toEqual([]);
  expect(m.small, `${name}: text under 11px`).toEqual([]);
  expect(m.short, `${name}: tap targets under 40px`).toEqual([]);
  if (opts.blue !== undefined) expect(m.blue, `${name}: blue buttons`).toBe(opts.blue);
  return m;
}
const close = page => page.evaluate(() => TransportUI.closeModal());

let seq = 0;
const id = p => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const DILAN = 'dddddddd-0000-4000-8000-000000000001';
function trip(o) {
  return { id: id('aaaaaaaa'), location_id: SL_LOC, kind: 'airport_arrival', trip_date: '2026-11-14', trip_time: '10:55', pickup_time: null, flight: 'QR664', place: 'CMB', route: 'Airport → Surfcamp', purpose: 'guests',
    tour_name: null, guest_names: 'Guest', guest_phone: '+491700000001', booking_ref: '2026-5001', booking_checkout: '2026-11-21', pax: 1, vehicle: 'Car', driver_id: DILAN, expected_price: 20500, currency: 'LKR',
    status: 'planned', source: 'bookinglayer', charge: 'bookinglayer', import_key: null, import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null,
    created_at: '2026-11-10T08:00:00Z', ...o };
}
const run = o => trip({ kind: 'tuktuk', guest_names: null, guest_phone: null, flight: null, booking_ref: null, place: null, route: 'Ahangama', purpose: 'surf', driver_id: SAMPATH, expected_price: 500, status: 'done',
  source: 'manual', charge: null, vehicle: 'Tuk-tuk', trip_date: '2026-11-12', trip_time: '07:30', ...o });
const SL_TRIPS = () => [
  trip({ guest_names: 'Lorena Marie Glas', flight: 'QR658', trip_time: '01:55', booking_ref: '2026-4660', import_key: 'bl:2026-4660:arr' }),
  trip({ guest_names: 'Beliz Kuyumcuoglu, Jonas Weber-Hartmann', pax: 2, vehicle: 'Minivan', expected_price: 25500, booking_ref: '2026-4070', import_key: 'bl:2026-4070:arr' }),
  trip({ kind: 'airport_departure', route: 'Surfcamp → Airport', guest_names: 'Maximilian Ehrler', trip_date: '2026-11-14', trip_time: '23:40', flight: 'EK649', booking_ref: '2026-4936', import_key: 'bl:2026-4936:dep', expected_price: 19000 }),
  run({ pax: 3 }), run({ pax: 2 }), run({ pax: 2 }), run({ route: 'Weligama', expected_price: 1500, pax: 3 }), run({ route: 'Market / food', purpose: 'food', trip_time: '14:00' }),
  run({ trip_date: '2026-11-13', pax: 3 }),
];

test('mobile (Sri Lanka): every Transport screen fits a 390 × 844 phone — trips, airport, tuk-tuks, run sheet, plan the day, trip, run edit, add transfer, pay, drivers, export, overview', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const report = {};
  await openSl(page, { trips: SL_TRIPS() });
  await check(page, 'sl-trips-all', report);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await check(page, 'sl-airport', report);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await check(page, 'sl-tuktuks', report);
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await check(page, 'sl-run-sheet', report, { blue: 1 });
  await page.click('#tk_mode .pill:has-text("Plan the day")');
  await check(page, 'sl-plan-day', report, { blue: 1 });
  await close(page);
  const air = await page.evaluate(() => TransportUI._state.trips.find(t => t.kind === 'airport_arrival' && /^Beliz/.test(t.guest_names)).id);
  await page.evaluate(i => TransportUI.openTrip(i), air);
  await check(page, 'sl-trip-sheet', report, { blue: 1 });
  // a flight time off the quarter (10:55 from Bookinglayer) shows as it is, beside the quarter choices
  await expect(page.locator('#tr_t')).toHaveValue('10:55');
  await expect(page.locator('#tr_t option[value="10:45"]')).toHaveCount(1);
  await expect(page.locator('#tr_t option[value="10:50"]')).toHaveCount(0);           // only quarters are offered
  await page.click('#trOv .btn-p');                                                    // saving without touching it keeps 10:55
  await expect.poll(() => page.evaluate(i => TransportUI._state.trips.find(t => t.id === i).trip_time, air)).toBe('10:55');
  await close(page);
  const runs = await page.evaluate(() => TransportUI._state.trips.filter(t => t.kind === 'tuktuk' && t.route === 'Ahangama' && t.trip_date === '2026-11-12').map(t => t.id));
  await page.evaluate(ids => TransportUI.openRuns(ids), runs);
  await check(page, 'sl-run-edit', report, { blue: 1 });
  await close(page);
  await page.evaluate(() => TransportUI.addOn('2026-11-14', 'airport'));
  await check(page, 'sl-add-transfer', report);
  await close(page);
  await page.evaluate(i => TransportUI.payPick(i), SAMPATH);
  await check(page, 'sl-pay', report, { blue: 1 });
  await close(page);
  await page.evaluate(() => TransportUI.openDrivers());
  await check(page, 'sl-drivers', report, { blue: 1 });
  await close(page);
  await page.evaluate(() => TransportUI.openExport());
  await check(page, 'sl-export', report);
  await close(page);
  await page.evaluate(() => TransportUI.setView('overview'));
  await check(page, 'sl-overview', report);
  fs.writeFileSync(path.join(SHOTS, `mobile-report-sl-${TAG}.json`), JSON.stringify(report, null, 1));
  expect(errors).toEqual([]);
});

test('mobile (Morocco): surf vans day list, tours, the vans sheet, plan the day, payments to check fit 390 × 844', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const report = {};
  const planned = { id: 'aaaaaaaa-0000-4000-8000-0000000000m1', location_id: H.LOC, kind: 'other', trip_date: '2026-11-15', trip_time: '08:00', route: 'Surf', purpose: 'surf', tour_name: null, vehicle: 'Big Van',
    expected_price: 700, currency: 'MAD', driver_id: H.D.fat, status: 'planned', source: 'manual', pax: 12, payment_entry_id: null, needs_resend: false, import_flags: [], edited_fields: [], created_at: '2026-11-14T08:00:00Z' };
  await H.open(page, { trips: H.tripsFromFile().concat(planned) });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  await check(page, 'ma-trips-all', report);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="vans"]');
  await check(page, 'ma-surf-vans', report);
  await page.click('#transportRoot [data-add-runs="vans"]');
  await check(page, 'ma-van-sheet', report, { blue: 1 });
  await page.click('#tk_mode .pill:has-text("Plan the day")');
  await check(page, 'ma-plan-day', report, { blue: 1 });
  await close(page);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tours"]');
  await check(page, 'ma-tours', report);
  await page.evaluate(() => TransportUI.openChecks());
  await check(page, 'ma-payments-to-check', report);
  fs.writeFileSync(path.join(SHOTS, `mobile-report-ma-${TAG}.json`), JSON.stringify(report, null, 1));
  expect(errors).toEqual([]);
});
