// Camp hub · Week — «own way» per direction (audit 18 Nov 2026, WEEK-02) — stubbed Supabase, synthetic guests.
//
// The Bookinglayer camp report stores every airport leg with its date (camp_week_guests.raw.transfers). A guest with
// only the departure leg has has_transfer = true and still comes on their own: the arrival day must say so
// («On their own 16:00»), and the Guests tab must not promise a driver («own way 16:00 · transfer out Sat 28»).
// Rows of the old Guests export have no legs and keep «Has transfer» for both ways.
// «Now» = Thu 19 Nov 2026 10:00 Casablanca; the week shown is Sat 21 – Fri 27 Nov.
const { test, expect } = require('@playwright/test');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');
const F = require('./week-way-fixtures');

const NOW = '2026-11-19T10:00';
async function openNextWeek(page, opts = {}) {
  const st = await H.openWeek(page, { now: NOW, guests: F.guests(), trips: F.trips(), ...opts });
  await page.evaluate(() => WeekUI.shiftWeek(7));
  await expect.poll(() => page.evaluate(() => WeekUI._state.week)).toBe('2026-11-21');
  await expect(page.locator('#wkDay-2026-11-21')).toBeVisible();
  return st;
}
const arrivalCell = (page, name) => page.locator('.wk-grow', { hasText: name }).locator('.wk-gc[data-l="Arrival"]');

test('own way per direction: a guest with only the departure transfer comes on their own — on the arrival day and in the Guests tab', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openNextWeek(page);
  // Overview, Sat 21: the driver brings Arno and Bo; Dana (departure leg only) and Nina (no transfer) come on their own
  const sat = page.locator('#wkDay-2026-11-21');
  await expect(sat.locator('.wk-bc.arr .wk-own').first()).toHaveText('On their own: 15:00 Nina None, 16:00 Dana Departs');
  const own = await page.evaluate(() => WeekUI.model().days[0].own.map(g => g.guest_name).sort());
  expect(own).toEqual(['Dana Departs', 'Nina None', 'Sam Saturday']);            // Sam gave no arrival time: his own line
  await expect(sat.locator('.wk-bc.arr .wk-untimed')).toHaveText('On their own, no arrival time given: Sam Saturday');
  await expect(sat.locator('.wk-trlink')).toContainText('Arno Arrives');
  await expect(sat.locator('.wk-trlink')).not.toContainText('Dana Departs');     // no car goes for her on Saturday
  // Guests tab: the way in, and the booked transfer out is not lost
  await page.evaluate(() => WeekUI.setTab('guests'));
  await expect(arrivalCell(page, 'Dana Departs')).toHaveText('own way 16:00transfer out Sat 28');
  await expect(arrivalCell(page, 'Dana Departs').locator('[data-leave]')).toHaveText('transfer out Sat 28');
  await expect(arrivalCell(page, 'Arno Arrives')).toHaveText('transfer 10:15');  // arrival leg only: the way in is the transfer
  await expect(arrivalCell(page, 'Bo Both')).toHaveText('transfer 12:40');
  await expect(arrivalCell(page, 'Nina None')).toHaveText('own way 15:00');
  expect(await H.noOverflow(page)).toBe(true);
  // «Copy list» says the same
  const list = await page.evaluate(() => WeekUI.bodyOf('guests', 'week'));
  const line = name => list.split('\n').find(l => l.includes(name));
  expect(line('Dana Departs')).toMatch(/· own way · transfer out Sat 28$/);
  expect(line('Arno Arrives')).toMatch(/· transfer$/);
  expect(line('Bo Both')).toMatch(/· transfer$/);
  expect(line('Nina None')).toMatch(/· own way$/);
  expect(errors).toEqual([]);
});

test('own way per direction: somebody on the booking has the arrival transfer → not «own way»; a leg on another date goes to the nearer end', async ({ page }) => {
  const guests = [
    // two people on one booking, one transfer line (the other rides along): the booking's live arrival trip covers both
    F.guest({ ref: '2026-9010', name: 'Pia Payer', room: F.BOILERS, legs: ['2026-11-21'], arrT: '11:00' }),
    F.guest({ ref: '2026-9010', name: 'Rita Rider', room: F.BOILERS, legs: [], arrT: '11:00' }),
    // a transfer the day before check-in is the arrival; one the day after check-out is the departure
    F.guest({ ref: '2026-9011', name: 'Eve Early', room: F.SOURCE, legs: ['2026-11-20'], arrT: '23:30' }),
    F.guest({ ref: '2026-9012', name: 'Lars Late', room: F.CROCRO, legs: ['2026-11-29'], arrT: '14:00' }),
  ];
  const trips = [F.trip({ booking_ref: '2026-9010', guest_names: 'Pia Payer, Rita Rider', pax: 2, trip_time: '11:00' })];
  await openNextWeek(page, { guests, trips });
  expect(await page.evaluate(() => WeekUI.model().days[0].own.map(g => g.guest_name))).toEqual(['Lars Late']);
  await page.evaluate(() => WeekUI.setTab('guests'));
  await expect(arrivalCell(page, 'Rita Rider')).toHaveText('transfer 11:00');
  await expect(arrivalCell(page, 'Eve Early')).toHaveText('transfer 23:30');
  await expect(arrivalCell(page, 'Lars Late')).toHaveText('own way 14:00transfer out Sun 29');
});

test('own way per direction: a row of the old Guests export (no legs stored) keeps «Has transfer» for both ways', async ({ page }) => {
  const old = (name, has) => { const g = F.guest({ ref: has ? '2026-9020' : '2026-9021', name, room: has ? F.BOILERS : F.SOURCE, arrT: '13:00' }); return { ...g, has_transfer: has, raw: {} }; };
  await openNextWeek(page, { guests: [old('Olga Oldfile', true), old('Otto Oldfile', false)], trips: [] });
  expect(await page.evaluate(() => WeekUI.model().days[0].own.map(g => g.guest_name))).toEqual(['Otto Oldfile']);
  await page.evaluate(() => WeekUI.setTab('guests'));
  await expect(arrivalCell(page, 'Olga Oldfile')).toHaveText('transfer 13:00');
  await expect(arrivalCell(page, 'Otto Oldfile')).toHaveText('own way 13:00');
});
