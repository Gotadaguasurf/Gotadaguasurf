// Camp hub · Transport (19 Nov 2026, Miguel: «o Nadith tem de ter acesso a isso para ele pagar… e ter um sítio onde vejo
// sempre o overview dos transportes»). Sri Lanka stub (tests/transport-sl-stub.js), invented trips; «now» = Fri 13 Nov 2026.
//   · the Operations Ledger's «Pay driver» opens THE SAME window as Transport → «Pay another driver» (one way to pay) —
//     for the team and for the local manager (?view=local);
//   · the owners' month card on top of Transport: owners only (never the local manager, never another team member);
//     per driver paid / to pay from the trips, unpaid for more than 7 days, cost per guest from camp_week_guests.
// Screenshots (390 / 1280) go to TRANSPORT_SHOTS when set.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const { SL_LOC, SAMPATH, openSl } = require('./transport-sl-stub');

const SHOTS = process.env.TRANSPORT_SHOTS || '';
const shot = async (page, name, el) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await (el || page).screenshot({ path: path.join(SHOTS, name) }); };

let seq = 0;
const id = p => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const DILAN = 'dddddddd-0000-4000-8000-000000000001';
function trip(o) {
  return { id: id('bbbbbbbb'), location_id: SL_LOC, kind: 'airport_arrival', trip_date: '2026-11-03', trip_time: '10:55', pickup_time: null, flight: 'QR664', place: 'CMB', route: 'Airport → Surfcamp', purpose: 'guests',
    tour_name: null, guest_names: 'Guest One', guest_phone: '+491700000001', booking_ref: '2026-5001', booking_checkout: '2026-11-10', pax: 1, vehicle: 'Car', driver_id: DILAN, expected_price: 20500, currency: 'LKR',
    status: 'done', source: 'bookinglayer', charge: 'bookinglayer', import_key: null, import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null,
    created_at: '2026-11-01T08:00:00Z', ...o };
}
const run = o => trip({ kind: 'tuktuk', guest_names: null, guest_phone: null, flight: null, booking_ref: null, place: null, route: 'Weligama', purpose: 'surf', driver_id: SAMPATH, expected_price: 1500, status: 'done',
  source: 'manual', charge: null, vehicle: 'Tuk-tuk', trip_time: '07:30', ...o });
// November: Dilan 1 arrival owed (3 Nov, > 7 days); Sampath 2 runs owed (2 Nov, > 7 days · 12 Nov) and 1 run paid (5 Nov).
const TRIPS = () => [
  trip({}),
  run({ trip_date: '2026-11-02' }),
  run({ trip_date: '2026-11-05', payment_entry_id: 'eeeeeeee-0000-4000-8000-000000000001' }),
  run({ trip_date: '2026-11-12', route: 'Ahangama', expected_price: 500 }),
];

test('Operations Ledger «Pay driver» opens the same «Pay a driver» window as Transport; ticking a driver is the same sheet', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openSl(page, { trips: TRIPS() });
  // Transport's own door first: «Pay another driver».
  await page.click('#trPayOther');
  await expect(page.locator('#trOv.open .mhdr-title')).toHaveText('Pay a driver');
  const fromTransport = await page.locator('#trOv.open .tr-picks').innerText();
  await page.evaluate(() => TransportUI.closeModal());
  // The ledger's door.
  await page.evaluate(() => showPage('expenses'));
  const btn = page.locator('#payDriverBtn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#trOv.open .mhdr-title')).toHaveText('Pay a driver');
  expect(await page.locator('#trOv.open .tr-picks').innerText()).toBe(fromTransport);
  await page.click(`#trOv.open [data-pay-driver="${SAMPATH}"]`);
  await expect(page.locator('#trOv.open .mhdr-title')).toHaveText('Pay Sampath');
  await expect(page.locator('#trOv.open #py_save')).toHaveText('Save payment');
  await expect(page.locator('#trOv')).toHaveCount(1);   // one overlay, shared
  expect(errors).toEqual([]);
});

test('owners\' month card: per driver paid / to pay from the trips, unpaid for more than 7 days, cost per guest from camp_week_guests', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openSl(page, { trips: TRIPS() });
  // Three guests stay in November (one twice in the report = one guest, one cancelled = left out).
  await page.route(/rest\/v1\/camp_week_guests/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { booking_ref: '2026-5001', guest_key: 'g1', guest_name: 'Guest One', check_in: '2026-11-03', check_out: '2026-11-10', booking_status: 'confirmed' },
    { booking_ref: '2026-5001', guest_key: 'g1', guest_name: 'Guest One', check_in: '2026-11-03', check_out: '2026-11-10', booking_status: 'confirmed' },
    { booking_ref: '2026-5002', guest_key: 'g2', guest_name: 'Guest Two', check_in: '2026-11-07', check_out: '2026-11-14', booking_status: 'confirmed' },
    { booking_ref: '2026-5003', guest_key: 'g3', guest_name: 'Guest Three', check_in: '2026-11-07', check_out: '2026-11-14', booking_status: 'confirmed' },
    { booking_ref: '2026-5004', guest_key: 'g4', guest_name: 'Gone', check_in: '2026-11-07', check_out: '2026-11-14', booking_status: 'cancelled' },
  ]) }));
  await page.evaluate(() => { TransportUI._state.ocGuests = null; TransportUI.render(); });
  const card = page.locator('#transportRoot [data-owner-card]');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('open', '');                      // folded: one line, the day list stays on screen
  await expect(card.locator('.card-title')).toHaveText('Transport · November 2026');
  await expect(card.locator('[data-oc-hint]')).toHaveText('LKR 24,000 · LKR 22,500 to pay · owners only');
  await card.locator('summary').click();
  await expect(card).toHaveAttribute('open', '');
  await expect(card.locator('[data-oc-kpi="guest"] .kpi-sub')).toContainText('3 guests');
  const D = await page.evaluate(() => { const d = TransportUI.ownerCardData('2026-11'); return { drivers: d.drivers.map(r => [r.label, r.cost, r.paid, r.owed]), late: d.late.map(t => t.trip_date), total: d.V.total.cost, owed: d.V.total.owed, guests: d.guests, per: d.perGuest }; });
  expect(D.drivers).toEqual([['Dilan', 20500, 0, 20500], ['Sampath', 3500, 1500, 2000]]);
  expect(D.total).toBe(24000);
  expect(D.owed).toBe(22500);
  expect(D.late).toEqual(['2026-11-02', '2026-11-03']);   // 12 Nov is not 7 days old yet
  expect([D.guests, D.per]).toEqual([3, 8000]);
  await expect(card.locator('[data-oc-late] .tr-oc-lrow')).toHaveCount(2);
  await expect(card.locator('.tr-oc-row[data-oc-driver]')).toHaveCount(2);
  await expect(card.locator('.btn-p')).toHaveCount(0);       // the pill keeps its one blue button
  // Month picker: October has no trips.
  await card.locator('button[title="Previous month"]').click();
  await expect(card.locator('.card-title')).toHaveText('Transport · October 2026');
  await expect(card.locator('.tr-oc-kinds')).toContainText('No trips this month');
  await card.locator('button[title="Next month"]').click();
  await expect(card.locator('[data-oc-kpi="guest"] .kpi-sub')).toContainText('3 guests');   // the guest count is in: no redraw left
  await page.waitForTimeout(200);
  await shot(page, 'transportes-owner-card-1280.png', card);
  expect(errors).toEqual([]);
});

test('owners\' month card is hidden for a team member who is not an owner, and for the local manager (?view=local)', async ({ page }) => {
  await openSl(page, { trips: TRIPS() });
  await expect(page.locator('#transportRoot [data-owner-card]')).toHaveCount(1);
  await page.evaluate(() => { TransportUI._state.me = 'floriane@gotadaguasurf.com'; TransportUI.render(); });
  await expect(page.locator('#transportRoot [data-owner-card]')).toHaveCount(0);

  const p2 = await page.context().newPage(); await p2.setViewportSize({ width: 390, height: 844 });
  const errors = collectFatalErrors(p2);
  await openSl(p2, { trips: TRIPS(), query: '&view=local' });
  await expect(p2.locator('#transportRoot [data-owner-card]')).toHaveCount(0);
  expect(await p2.evaluate(() => TransportUI.isOwnerUser())).toBe(false);
  // Nadith pays from the ledger with the same window.
  await p2.evaluate(() => showPage('expenses'));
  await expect(p2.locator('#payDriverBtn')).toBeVisible();
  await shot(p2, 'transportes-ledger-pay-390.png');
  await p2.click('#payDriverBtn');
  await expect(p2.locator('#trOv.open .mhdr-title')).toHaveText('Pay a driver');
  await shot(p2, 'transportes-ledger-pay-modal-390.png');
  expect(errors).toEqual([]);
  await p2.close();
});

test('screens: owner card at 390, ledger button at 1280', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only when TRANSPORT_SHOTS is set');
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSl(page, { trips: TRIPS() });
  await page.evaluate(() => showPage('expenses'));
  await shot(page, 'transportes-ledger-pay-1280.png');
  const p2 = await page.context().newPage(); await p2.setViewportSize({ width: 390, height: 844 });
  await openSl(p2, { trips: TRIPS() });
  await expect(p2.locator('#transportRoot [data-owner-card] [data-oc-kpi="guest"] .kpi-sub')).not.toContainText('counting');
  await p2.locator('#transportRoot [data-owner-card] summary').click();
  await p2.waitForTimeout(200);
  await shot(p2, 'transportes-owner-card-390.png', p2.locator('#transportRoot [data-owner-card]'));
  await p2.close();
});
