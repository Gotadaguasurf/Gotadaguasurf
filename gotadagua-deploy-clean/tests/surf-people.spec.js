// Camp hub · Transport · people per surf spot → vans / tuk-tuks (19 Nov 2026) — stubbed Supabase, invented data.
//
// Miguel: «Sri Lanka e Marrocos: quando marcamos uns transporte de surf, meter o numero de pessoas que vao para cada
// local de surf e faz o calculo automatico de quantas carrinhas ou tuk tuks (tuk tuks leva 3 pessoas)».
// The seats and prices below are the real /prices numbers of 19 Nov 2026 (Car 3 · Minivan 8 · Big Van 15 seats; Mounir's
// per-vehicle prices; the Sri Lanka surf rows have no capacity → 3 per tuk-tuk from lib/camp-config.js).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const G = require('../lib/guests-trips.js');
const TC = require('../lib/transport-catalog.js');
const CC = require('../lib/camp-config.js');
const H = require('./ma-helpers');

const SHOTS = process.env.SURFPAX_SHOTS || path.join(__dirname, '..', 'test-results', 'surfpax-shots');
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt }); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
};
const noHScroll = page => page.evaluate(() => {
  const m = document.querySelector('#trOv .modal');
  return document.documentElement.scrollWidth <= window.innerWidth && (!m || m.scrollWidth <= m.clientWidth + 1);
});

// ── The real /prices seats and prices (copied 19 Nov 2026 into an invented fixture) ─────────────────────────
const MA_REAL = H.CATALOG.filter(c => c.picker_tab === 'airport')
  .concat([['Surf', 'surf', 300, 500, 700], ['Tamri / Anza', 'surf', 400, 600, 800], ['Imsouane', 'surf', 800, 900, 1200],
    ['Dunes', 'tours', 500, 700, 800], ['Paradise Valley', 'tours', 500, 700, 800], ['Souk', 'tours', 300, 400, 600]]
    .flatMap(([dest, tab, car, mini, big], j) => [['Car', car, 3], ['Minivan', mini, 8], ['Big Van', big, 15]].map(([v, cost, cap], k) => ({
      id: `real-${j}${k}`, name: `${dest} — ${v}`, cost_per_guest: cost, currency: 'MAD', capacity: cap, notes: '', linked_transport_preset_id: `p-${dest}`,
      linked_camp_tab_id: null, picker_tab: tab, sort_order: 20 + j * 3 + k }))));
const maVehicles = route => {
  const P = TC.group(MA_REAL); const p = P.surf.find(x => x.name === route);
  return p.vehicles.map(v => ({ label: v.label, capacity: v.capacity, price: v.cost }));
};
const words = r => r.plan.map(x => `${x.count} ${x.label}`).join(' + ');

test('people → vehicles (pure): Sri Lanka 7 → 3 tuk-tuks, 3 → 1, 0 → none; Morocco with the real seats 4 / 8 / 12 / 20 → the cheapest vans; the people split per vehicle', () => {
  const tuk = [{ label: 'Tuk-tuk', capacity: CC.SL.runs.seats, price: 500 }];
  expect(CC.SL.runs.seats).toBe(3);
  expect(G.planVehicles(7, tuk)).toMatchObject({ count: 3, total: 1500, seats: 9, flag: '' });
  expect(G.planVehicles(3, tuk)).toMatchObject({ count: 1, total: 500 });
  expect(G.planVehicles(4, tuk).count).toBe(2);
  expect(G.planVehicles(0, tuk)).toMatchObject({ plan: [], count: 0, total: 0, flag: '' });
  expect(G.splitPax(7, [3, 3, 3])).toEqual([3, 2, 2]);
  expect(G.splitPax(4, [3, 3])).toEqual([2, 2]);
  expect(G.splitPax(2, [3, 3, 3])).toEqual([1, 1, null]);         // more vehicles than people: the extra one is not saved

  const surf = maVehicles('Surf');
  expect(surf.map(v => [v.label, v.capacity, v.price])).toEqual([['Car', 3, 300], ['Minivan', 8, 500], ['Big Van', 15, 700]]);
  const at = n => G.planVehicles(n, surf);
  expect([words(at(4)), at(4).total]).toEqual(['1 Minivan', 500]);     // a Car seats 3 (the capacity column): 2 Cars = 600
  expect([words(at(8)), at(8).total]).toEqual(['1 Minivan', 500]);
  expect([words(at(12)), at(12).total]).toEqual(['1 Big Van', 700]);
  expect([words(at(20)), at(20).total]).toEqual(['1 Big Van + 1 Minivan', 1200]);
  expect([words(at(3)), at(3).total]).toEqual(['1 Car', 300]);
  // a tie on price and count (16: Big Van + Car = 2 × Minivan = 1,000): fewer empty seats wins
  expect(words(at(16))).toBe('2 Minivan');
  expect(G.splitPax(20, [15, 8])).toEqual([14, 6]);
  const ims = maVehicles('Imsouane');
  expect(words(G.planVehicles(4, ims))).toBe('1 Minivan');
  expect(words(G.planVehicles(20, ims))).toBe('1 Big Van + 1 Minivan');
  // a row at price 0 never wins; no seats in /prices → nothing planned, the sheet says so
  expect(words(G.planVehicles(2, [...surf, { label: 'Free car', capacity: 4, price: 0 }]))).toBe('1 Car');
  expect(G.planVehicles(5, [{ label: 'Van', capacity: null, price: 500 }])).toMatchObject({ plan: [], flag: 'seats unknown in /prices — choose the vehicle' });
  // the Sri Lanka surf rows (no capacity) keep that on the route: null → the camp's 3
  const sl = TC.group([{ id: 'x', name: 'Ahangama', cost_per_guest: 500, capacity: null, picker_tab: 'surf' }, { id: 'y', name: 'Weligama', cost_per_guest: 1500, capacity: 4, picker_tab: 'surf' }]);
  expect(sl.surf.map(p => [p.name, p.unitPrice, p.capacity])).toEqual([['Ahangama', 500, null], ['Weligama', 1500, 4]]);
});

const { SAMPATH, openSl } = require('./transport-sl-stub');
const inserts = st => st.calls.filter(c => c.t === 'trip_insert').map(c => c.rows[0]);

test('Sri Lanka: people per surf spot — 7 → 3 tuk-tuks (3 + 2 + 2) saved as three runs at the /prices price; 3 → 1; 0 → nothing; change before saving; the order and the tap lines as before; 390 px fits', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openSl(page);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Tuk-tuk runs');
  const ah = page.locator('#trOv .tr-sp[data-key="surf|Ahangama"]');
  const we = page.locator('#trOv .tr-sp[data-key="surf|Weligama"]');
  await expect(page.locator('#trOv .tr-sp')).toHaveCount(3);                         // the three surf spots, not the camp runs or tours
  await expect(page.locator('#trOv .tr-tap-main[data-key="surf|Ahangama"]')).toHaveCount(1);   // the tap line stays (one tap = one run)
  await expect(ah.locator('input')).toHaveValue('0');
  await expect(ah.locator('[data-sp-ans]')).toHaveCount(0);                         // 0 people → no answer, nothing to save
  await expect(page.locator('#tk_spsave')).toHaveCount(0);
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);                         // «Done»
  await shot(page, 'sl-sheet-empty');
  // 7 people to Ahangama: + seven times
  for (let i = 0; i < 7; i++) await ah.locator('button[title="One person more"]').click();
  await expect(ah.locator('input')).toHaveValue('7');
  await expect(ah.locator('[data-sp-ans]')).toContainText('7 people → 3 tuk-tuks');
  await expect(ah.locator('[data-sp-ans] .tr-sp-amt')).toHaveText(/1,500/);
  await expect(page.locator('#tk_spsave')).toHaveText('Save 3 tuk-tuks');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);                         // the save is now the one blue button
  await expect(page.locator('#tk_done')).toHaveClass(/btn-s/);
  // 3 people typed to Weligama → 1 tuk-tuk
  await we.locator('input').fill('3');
  await expect(we.locator('[data-sp-ans]')).toContainText('3 people → 1 tuk-tuk');
  await expect(page.locator('#tk_spsave')).toHaveText('Save 4 tuk-tuks');
  expect(await noHScroll(page)).toBe(true);
  await shot(page, 'sl-sheet-typed');
  // change before saving: Weligama one tuk-tuk more (two tuk-tuks for 3 people)
  await we.locator('[data-sp-ans]').click();
  await expect(we.locator('[data-sp-edit] .tr-sp-vrow')).toHaveCount(1);
  await expect(we.locator('[data-sp-edit] .tr-sp-vrow')).toContainText('Tuk-tuk · 3 seats');
  await we.locator('[data-sp-edit] button[title="One more"]').click();
  await expect(we.locator('[data-sp-ans]')).toContainText('3 people → 2 tuk-tuks');
  await expect(we.locator('[data-sp-ans]')).toContainText('changed');
  await shot(page, 'sl-sheet-change');
  await we.locator('.tr-sp-auto').click();                                           // back to the automatic choice
  await expect(we.locator('[data-sp-ans]')).toContainText('3 people → 1 tuk-tuk');
  await page.click('#tk_spsave');
  await expect.poll(() => inserts(st).length).toBe(4);
  const rows = inserts(st);
  expect(rows.map(r => [r.route, r.pax, r.expected_price])).toEqual([['Ahangama', 3, 500], ['Ahangama', 2, 500], ['Ahangama', 2, 500], ['Weligama', 3, 1500]]);
  rows.forEach(r => expect(r).toMatchObject({ kind: 'tuktuk', purpose: 'surf', vehicle: 'Tuk-tuk', status: 'done', source: 'manual', driver_id: SAMPATH, trip_date: '2026-11-13', trip_time: '07:30', tour_name: null }));
  // after the save: the steppers are back at 0, the tap lines count the runs, the people are shown
  await expect(ah.locator('input')).toHaveValue('0');
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('3');
  await expect(ah.locator('.tr-sp-had')).toContainText('7 in saved runs');
  await expect(page.locator('#tk_spsave')).toHaveCount(0);
  await expect(page.locator('#trOv .tr-tuk-total')).toContainText('4 runs');
  // the WhatsApp order is the same as for tapped runs
  await expect(page.locator('#tk_send')).toHaveText('Send to Sampath on WhatsApp');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
  await page.click('#tk_send');
  expect(decodeURIComponent(await page.evaluate(() => window.__opened[0])).split('?text=')[1]).toBe('*TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:30*\n\n- Ahangama: 3 tuk-tuks (7 people)\n- Weligama: 1 tuk-tuk (3 people)');
  // a tap still adds one run with no people typed (pax 1 as before)
  await page.locator('.tr-tap-main[data-key="surf|South Beach"]').click();
  await expect.poll(() => inserts(st).length).toBe(5);
  expect(inserts(st)[4]).toMatchObject({ route: 'South Beach', pax: 1, expected_price: 500 });
  expect(errors).toEqual([]);
});

// ── Morocco ───────────────────────────────────────────────────────────────────────────────────────────────
async function openMa(page, opts = {}) {
  const st = await H.open(page, { catalog: MA_REAL, ...opts });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  return st;
}

test('Morocco: Plan the day — people per surf spot with the real seats: 4 → Minivan, 8 → Minivan, 12 → Big Van, 20 → Big Van + Minivan; «Add 2 vans to the order» = one run per van at the vehicle price with its people; the order for Fathoune; change the vehicles', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openMa(page);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="vans"]');
  await page.click('#transportRoot [data-plan]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Plan the day');
  await expect(page.locator('#tk_pday .pill.active')).toHaveAttribute('data-day', '2026-11-15');      // tomorrow
  const spots = page.locator('#trOv .tr-sp');
  await expect(spots).toHaveCount(3);                                                // Surf Taghazout · Tamri / Anza · Imsouane
  await expect(spots.locator('.tr-sp-lbl')).toHaveText(['Surf Taghazout', 'Surf Tamri / Anza', 'Surf Imsouane']);
  await expect(page.locator('#tk_spt')).toHaveValue('08:00');
  const tag = page.locator('#trOv .tr-sp[data-key="van|surf"]');
  const ans = tag.locator('[data-sp-ans]');
  for (const [n, want, amt] of [[4, '4 people → 1 Minivan', '500'], [8, '8 people → 1 Minivan', '500'], [12, '12 people → 1 Big Van', '700'], [20, '20 people → 1 Big Van + 1 Minivan', '1,200']]) {
    await tag.locator('input').fill(String(n));
    await expect(ans).toContainText(want);
    await expect(ans.locator('.tr-sp-amt')).toHaveText(new RegExp(amt));
  }
  await expect(page.locator('#tk_spsave')).toHaveText('Add 2 vans to the order');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
  // Imsouane 4 people → a Minivan at Imsouane's price
  const ims = page.locator('#trOv .tr-sp[data-key="van|imsouane"]');
  for (let i = 0; i < 4; i++) await ims.locator('button[title="One person more"]').click();
  await expect(ims.locator('[data-sp-ans]')).toContainText('4 people → 1 Minivan');
  await expect(ims.locator('[data-sp-ans] .tr-sp-amt')).toHaveText(/900/);
  await expect(page.locator('#tk_spsave')).toHaveText('Add 3 vans to the order');
  expect(await noHScroll(page)).toBe(true);
  await shot(page, 'ma-plan-typed');
  // change before saving: Imsouane a Car + a Car instead of the Minivan → 1,600, «changed»
  await ims.locator('[data-sp-ans]').click();
  await expect(ims.locator('[data-sp-edit] .tr-sp-vrow')).toHaveCount(3);
  await ims.locator('.tr-sp-vrow[data-v="Car"] button[title="One more"]').click();
  await ims.locator('.tr-sp-vrow[data-v="Car"] button[title="One more"]').click();
  await ims.locator('.tr-sp-vrow[data-v="Minivan"] button[title="One less"]').click();
  await expect(ims.locator('[data-sp-ans]')).toContainText('4 people → 2 Cars');
  await expect(ims.locator('[data-sp-ans] .tr-sp-amt')).toHaveText(/1,600/);
  await shot(page, 'ma-plan-change');
  // one Car only → 3 seats for 4 people: warned
  await ims.locator('.tr-sp-vrow[data-v="Car"] button[title="One less"]').click();
  await expect(ims.locator('[data-sp-short]')).toHaveText('Only 3 seats for 4 people — add a vehicle');
  await ims.locator('.tr-sp-auto').click();
  await expect(ims.locator('[data-sp-ans]')).toContainText('4 people → 1 Minivan');
  await page.selectOption('#tk_spt', '07:45'); await page.dispatchEvent('#tk_spt', 'change');
  await expect(page.locator('#tk_pt')).toHaveValue('07:45');                          // one time for the order
  await page.click('#tk_spsave');
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_insert').length).toBe(3);
  const rows = st.calls.filter(c => c.t === 'trip_insert').map(c => c.rows[0]);
  expect(rows.map(r => [r.route, r.vehicle, r.expected_price, r.pax])).toEqual([['Surf', 'Big Van', 700, 14], ['Surf', 'Minivan', 500, 6], ['Imsouane', 'Minivan', 900, 4]]);
  rows.forEach(r => expect(r).toMatchObject({ kind: 'other', purpose: 'surf', status: 'planned', source: 'manual', currency: 'MAD', driver_id: H.D.fat, trip_date: '2026-11-15', trip_time: '07:45' }));
  await expect(page.locator('#tk_plan .tr-plan-line')).toHaveCount(3);
  await expect(tag.locator('input')).toHaveValue('0');
  const order = await page.evaluate(() => TransportUI.orderText('2026-11-15', TransportUI._state.trips.filter(t => t.status === 'planned')));
  expect(order).toBe('*VANS - SUN 15 NOV*\n\n07:45\n- Imsouane: 1 Minivan (4 people)\n- Taghazout: 1 Big Van + 1 Minivan (20 people)');
  await expect(page.locator('#tk_send')).toHaveText('Send to Fathoune on WhatsApp');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
  await shot(page, 'ma-plan-saved');
  expect(errors).toEqual([]);
});

test('Morocco: Log runs — the people stepper sits under each surf tap line; saving 12 people logs the planned run of that spot (Big Van, its price, the people) instead of adding one; a spot with no seats in /prices says so and keeps the manual taps', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const planned = { id: 'aaaaaaaa-0000-4000-8000-0000000000p1', location_id: H.LOC, kind: 'other', trip_date: '2026-11-14', trip_time: '08:00', route: 'Surf', purpose: 'surf', tour_name: null,
    vehicle: 'Minivan', expected_price: 500, currency: 'MAD', driver_id: H.D.fat, status: 'sent', source: 'manual', pax: null, payment_entry_id: null, needs_resend: false, sent_at: '2026-11-13T18:00:00Z',
    sent_snapshot: { trip_date: '2026-11-14', trip_time: '08:00', label: 'Surf Taghazout', vehicle: 'Minivan', to: 'Fathoune', batch: 'day' }, import_flags: [], edited_fields: [], created_at: '2026-11-13T17:00:00Z' };
  // Tamri / Anza without seats in /prices (capacity empty): no stepper there
  const cat = MA_REAL.map(r => r.name.startsWith('Tamri / Anza') ? { ...r, capacity: null } : r);
  const st = await openMa(page, { trips: [planned], catalog: cat });
  await page.evaluate(() => TransportUI.openTuktuk());
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Log runs');
  await expect(page.locator('#tk_veh .pill')).toHaveText(['Car', 'Minivan', 'Big Van']);      // tours and manual taps keep the vehicle pills
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .tr-tap-plan')).toHaveText('+1 planned');
  await expect(page.locator('#trOv .tr-sp[data-key="van|tamri"]')).toHaveCount(0);
  await expect(page.locator('#trOv [data-sp-none="van|tamri"]')).toHaveText('seats unknown in /prices — choose the vehicle');
  await expect(page.locator('#trOv .tr-sp[data-key="van|dunes"]')).toHaveCount(0);           // tours: no people
  const tag = page.locator('#trOv .tr-sp[data-key="van|surf"]');
  await tag.locator('input').fill('12');
  await expect(tag.locator('[data-sp-ans]')).toContainText('12 people → 1 Big Van');
  await expect(page.locator('#tk_spsave')).toHaveText('Save 1 van');
  expect(await noHScroll(page)).toBe(true);
  await shot(page, 'ma-log-typed');
  await page.click('#tk_spsave');
  const up = await H.call(st, 'trip_update');
  expect(up.id).toBe(planned.id);
  expect(up.body).toMatchObject({ status: 'done', needs_resend: false, pax: 12, vehicle: 'Big Van', expected_price: 700 });
  expect(st.calls.filter(c => c.t === 'trip_insert')).toHaveLength(0);
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .tr-tap-n')).toHaveText('1');
  await expect(tag.locator('.tr-sp-had')).toContainText('12 in saved runs');
  // a second save on the same spot (no planned run left) inserts new runs
  await tag.locator('input').fill('5');
  await expect(tag.locator('[data-sp-ans]')).toContainText('5 people → 1 Minivan');
  await page.click('#tk_spsave');
  const ins = (await H.call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'other', route: 'Surf', purpose: 'surf', vehicle: 'Minivan', expected_price: 500, pax: 5, status: 'done', trip_date: '2026-11-14', trip_time: '08:00', currency: 'MAD' });
  expect(errors).toEqual([]);
});
