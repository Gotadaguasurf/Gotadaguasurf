// Camp hub · a booking that left the Bookinglayer report (audit 18 Nov 2026, WEEK-03) — stubbed Supabase, fake people.
//
// A booking cancelled in Bookinglayer simply disappears from the hourly camp report. Its airport trips used to stay live
// («Send the whole day» still sent them). Now they go on hold with a question for the camp — never cancelled automatically:
//   · Transport: the row says «Booking no longer in the Bookinglayer report — cancel this trip, or keep it…», the trip is
//     out of «Send the whole day», «Still needed» answers it for good (it is not asked again at the next import);
//   · the manual import of a camp report (Week → Import) does the same as the hourly import, and shows it before saving.
// «Now» = Thu 19 Nov 2026 10:00 Casablanca.
const { test, expect } = require('@playwright/test');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');
const F = require('./week-way-fixtures');
const { csvPriced } = require('./bl-report-csv');
const BI = require('../lib/bl-ingest.js');

const NOW = '2026-11-19T10:00';
const gone = (o = {}) => F.trip({ id: 'aaaaaaaa-0000-4000-8000-00000000e001', booking_ref: '2026-9050', guest_names: 'Gina Gone', trip_date: '2026-11-22', trip_time: '14:30', flight: 'FR77',
  import_key: 'bl:2026-9050:arr', booking_checkout: '2026-11-29', ...o });

test('Transport: a trip whose booking left the report is held with the question; «Still needed» sends it again and is not asked again', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const trips = [gone({ missing_since: '2026-11-19', import_flags: [BI.GONE_FLAG] }),
    F.trip({ id: 'aaaaaaaa-0000-4000-8000-00000000e002', booking_ref: '2026-9051', guest_names: 'Sven Stays', trip_date: '2026-11-22', trip_time: '11:00', flight: 'U2 1', import_key: 'bl:2026-9051:arr' })];
  const st = await H.openWeek(page, { now: NOW, guests: F.guests(), trips });
  await page.evaluate(() => { showPage('transport'); TransportUI.setWeek('2026-11-21'); });
  const row = id => page.locator(`.tr-row[data-trip="${id}"]`);
  await expect(row(trips[0].id).locator('[data-flag]')).toHaveText('Booking no longer in the Bookinglayer report — cancel this trip, or keep it if it is still needed');
  await expect(page.locator('.tr-strip')).toContainText('1 not in the latest Bookinglayer file');
  // «Send the whole day» carries Sven only
  await page.evaluate(() => { window.__opened.length = 0; TransportUI.sendDay('2026-11-22'); });
  let text = decodeURIComponent((await page.evaluate(() => window.__opened[0])).split('?text=')[1]);
  expect(text).toContain('Sven Stays'); expect(text).not.toContain('Gina Gone');
  // the camp checked: still needed → the flag goes, the answer is kept (edited_fields), the trip goes out again
  await page.evaluate(id => TransportUI.openTrip(id), trips[0].id);
  await expect(page.locator('#tr_keep')).toBeVisible();
  await page.click('#tr_keep');
  expect((await H.call(st, 'trip_update')).body).toEqual({ missing_since: null, import_flags: [], edited_fields: [BI.KEPT_MARK] });
  await expect(row(trips[0].id).locator('[data-flag]')).toHaveCount(0);
  await page.evaluate(() => { window.__opened.length = 0; TransportUI.sendDay('2026-11-22'); });
  text = decodeURIComponent((await page.evaluate(() => window.__opened[0])).split('?text=')[1]);
  expect(text).toContain('Gina Gone');
  // the next import does not ask again for a trip the camp kept
  const kept = (await page.evaluate(() => TransportUI._state.trips)).filter(t => t.booking_ref === '2026-9050');
  expect(BI.vanishHolds(kept, '2026-11-19')).toEqual([]);
  expect(errors).toEqual([]);
});

// a camp report downloaded today with one booking; the app also has Gina's trip (her booking is gone from the report)
const ROOM = '13 - Anchor Point mixed shared room (8pax)';
const report = () => csvPriced([{ ref: '2026-9100', ci: '2026-11-21', co: '2026-11-28', guests: [{ name: 'Rob Report', arrT: '10:00', arrF: 'FR1234', phone: '+491510000077' }],
  lines: [{ p: ROOM, person: 'Rob Report', start: '2026-11-21', end: '2026-11-28', price: 300 }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Rob Report', start: '2026-11-21', price: 30 }] }]);
async function importReport(page, st, name) {
  await page.click('#weekRoot button:has-text("Import Guests file")');
  await page.setInputFiles('#trGuestsFile', { name, mimeType: 'text/csv', buffer: Buffer.from(report()) });
  await expect(page.locator('#weekRoot .tr-plan-sum')).toBeVisible();
}

test('manual import of a camp report: the trips of a booking no longer in it are shown, then held with the question — nothing cancelled', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const kept = gone({ id: 'aaaaaaaa-0000-4000-8000-00000000e003', booking_ref: '2026-9052', guest_names: 'Kim Kept', import_key: 'bl:2026-9052:arr', edited_fields: [BI.KEPT_MARK] });
  const paid = gone({ id: 'aaaaaaaa-0000-4000-8000-00000000e004', booking_ref: '2026-9053', guest_names: 'Pat Paid', import_key: 'bl:2026-9053:arr', payment_entry_id: 'pay-1' });
  const st = await H.openWeek(page, { now: NOW, guests: F.guests(), trips: [gone(), kept, paid] });
  await importReport(page, st, '2026-11-19 0905 - marrocos.csv');
  const card = page.locator('#weekRoot .tr-plan', { hasText: 'Booking no longer in the report — on hold' });
  await expect(card.locator('.card-title')).toHaveText('Booking no longer in the report — on hold · 1');
  await expect(card).toContainText('Gina Gone');
  await page.click('#trImportSave');
  const imp = (await H.call(st, 'import')).body;
  expect(imp.p_cancel_refs).toEqual([]);                                  // never a cancel
  const up = await H.call(st, 'trip_update');
  expect(up.id).toBe(gone().id);
  expect(up.body).toEqual({ missing_since: '2026-11-19', import_flags: [BI.GONE_FLAG] });
  await page.waitForTimeout(200);
  expect(st.calls.filter(c => c.t === 'trip_update').map(c => c.id)).toEqual([gone().id]);   // the kept and the paid trip are left alone
  await expect(page.locator('#weekRoot .status-ok')).toContainText('1 on hold (booking no longer in the report)');
  expect(errors).toEqual([]);
});

test('manual import of an older camp report holds nothing (it does not have the bookings made since)', async ({ page }) => {
  const st = await H.openWeek(page, { now: NOW, guests: F.guests(), trips: [gone()] });
  await importReport(page, st, '2026-11-17 0905 - marrocos.csv');
  await expect(page.locator('#weekRoot .tr-plan', { hasText: 'on hold' })).toHaveCount(0);
  await page.click('#trImportSave');
  await H.call(st, 'import');
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => c.t === 'trip_update')).toEqual([]);
});

test('manual import: a trip an import already saw today is not held (the file may predate its booking) — the next hourly import judges it', async ({ page }) => {
  // NOW = 19 Nov 10:00 Casablanca; the hourly import saw this booking at 09:02 today
  const st = await H.openWeek(page, { now: NOW, guests: F.guests(), trips: [gone({ last_import_at: '2026-11-19T08:02:00Z' })] });
  await importReport(page, st, '2026-11-19 0705 - marrocos.csv');
  await expect(page.locator('#weekRoot .tr-plan', { hasText: 'on hold' })).toHaveCount(0);
  await page.click('#trImportSave');
  await H.call(st, 'import');
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => c.t === 'trip_update')).toEqual([]);
});

test('the import card says the camp report comes by itself every hour, and what the old Guests export cannot do (WEEK-05)', async ({ page }) => {
  await H.openWeek(page, { now: NOW, guests: F.guests(), trips: [] });
  await page.click('#weekRoot button:has-text("Import Guests file")');
  const hint = page.locator('#weekRoot .tr-import .card-hint');
  await expect(hint).toContainText("Bookinglayer's camp report is imported automatically every hour");
  await expect(hint).toContainText('cannot tell one transfer leg from two');
  expect(await H.noOverflow(page)).toBe(true);
});
