// Wave 4 (audit 18 Nov 2026) — the Bookinglayer importers, no browser.
//   · WEEK-09: what the camp decided on a trip (vehicle, «Separate», «Charge guest») survives the hourly import,
//     with ONE rule shared by the camp hub's manual import and lib/bl-ingest.js
//   · PRT-19 / SEAM-18: a realized booking that left the Revenue report is listed «left the report — check», never changed
const { test, expect } = require('@playwright/test');
const I = require('../lib/bl-ingest.js');
const BR = require('../lib/bl-report.js');
const RV = require('../lib/bl-revenue.js');
const { csvPriced } = require('./bl-report-csv');
const { maRows } = require('./catalog-fixtures');
const MA_CAT = maRows();
const ROOM = '13 - Anchor Point mixed shared room (8pax)';

test('WEEK-09: keepCampEdits — vehicle, «Separate» and «Charge guest» stand; nothing else changes', () => {
  const price = (kind, vehicle) => (vehicle === 'Van' ? 50 : 30);
  const trips = [
    { key: 'k1', kind: 'airport_arrival', vehicle: 'Car', expected_price: 30, flags: ['no transfer paid'], charge: 'bookinglayer' },
    { key: 'k2', kind: 'airport_arrival', vehicle: 'Car', expected_price: 30, flags: ['3 people, 1 transfer paid — one covers 2'], charge: 'bookinglayer' },
    { key: 'k3', kind: 'airport_departure', vehicle: 'Car', expected_price: 30, flags: [], charge: 'bookinglayer' },
    { key: 'k4', kind: 'airport_departure', vehicle: 'Car', expected_price: 30, flags: ['no transfer paid'], charge: 'bookinglayer' },
  ];
  const app = [
    { import_key: 'k1', edited_fields: ['money_charge:no transfer paid'] },
    { import_key: 'k2', edited_fields: ['together_split'] },
    { import_key: 'k3', edited_fields: ['vehicle'], vehicle: 'Van' },
    { import_key: 'k4', edited_fields: [] },
  ];
  const out = BR.keepCampEdits(trips, app, price);
  expect(out[0].charge).toBe('camp_tab');                     // «Charge guest» is not undone
  expect(out[1].flags).toEqual([]);                           // «Separate» keeps the split
  expect(out[2].expected_price).toBe(50);                     // the hand-picked van, priced as a van
  expect(out[3]).toEqual(trips[3]);                           // no edit → the report's trip as it is
  expect(trips[0].charge).toBe('bookinglayer');               // the input is not mutated
});

test('WEEK-09: the hourly import keeps «Charge guest» on a «no transfer paid» trip (it used to go back to «In booking»)', () => {
  // a booking with an unpaid airport line → the parser flags «no transfer paid» and sends charge «bookinglayer»
  const bk = { ref: '2026-300', ci: '2026-11-21', co: '2026-11-28', guests: [{ name: 'Ann A', arrT: '10:00', arrF: 'FR1234' }],
    lines: [{ p: ROOM, person: 'Ann A', start: '2026-11-21', end: '2026-11-28', price: 300 }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Ann A', start: '2026-11-21', price: 0 }] };
  const text = csvPriced([bk]);
  const base = { text, fileName: 'r.csv', slug: 'morocco', appGuests: [], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17' };
  const first = I.planCampReport({ ...base, appTrips: [] });
  expect(first.ok).toBe(true);
  const t = first.rpc.p_trips.find(x => x.booking_ref === '2026-300' && x.kind === 'airport_arrival');
  expect(t.flags).toContain('no transfer paid');
  expect(t.charge).toBe('bookinglayer');
  // the camp tapped «Charge guest» → the stored trip carries the mark; the next hourly run must keep camp_tab
  const stored = { id: 't1', booking_ref: '2026-300', kind: 'airport_arrival', trip_date: t.trip_date, trip_time: t.trip_time, place: t.place, pax: 1, status: 'planned', source: 'bookinglayer',
    import_key: t.key, booking_checkout: '2026-11-28', guest_names: 'Ann A', payment_entry_id: null, charge: 'camp_tab', import_flags: ['no transfer paid'], edited_fields: ['money_charge:no transfer paid'] };
  const again = I.planCampReport({ ...base, now: '2026-11-17T11:00', appTrips: [stored] });
  const t2 = again.rpc.p_trips.find(x => x.key === t.key);
  expect(t2 && t2.charge).toBe('camp_tab');
});

test('PRT-19 / SEAM-18: a realized booking inside the report window but not in the file is listed, never changed', () => {
  const head = ['Booking: Reference', 'Booking: Status', 'Booking: Check-in date', 'Booking: Check-out date', 'Booking: Final price incl. tax', 'Booking: Due amount', 'Booking: Currency', 'Company/Channel', 'Booking: Commission %', 'List of locations'];
  const line = r => r.map(v => `"${v}"`).join(',');
  const text = [line(head), line(['2026-500', 'Paid', 'Mon 2 Nov 2026', 'Mon 9 Nov 2026', '700.00', '0.00', 'EUR', '', '0', 'MA']),
    line(['2026-501', 'Paid', 'Tue 10 Nov 2026', 'Tue 17 Nov 2026', '700.00', '0.00', 'EUR', '', '0', 'MA'])].join('\n');
  const inWindow = [
    { booking_ref: '2026-500', check_in_on: '2026-11-02', location: 'Tamraght Camp', raw_payload: { status: 'paid' } },
    { booking_ref: '2026-502', check_in_on: '2026-11-05', location: 'Tamraght Camp', raw_payload: { status: 'paid' } },       // left the report
    { booking_ref: '2026-503', check_in_on: '2026-11-06', location: 'Tamraght Camp', raw_payload: { status: 'Canceled' } },   // not realized → not listed
    { booking_ref: 'APP-12', check_in_on: '2026-11-06', location: 'Tamraght Camp', raw_payload: { status: 'paid' } },          // made in the app → never listed
  ];
  const left = RV.leftReport(inWindow, ['2026-500', '2026-501']);
  expect(left.map(b => b.booking_ref)).toEqual(['2026-502']);
  const parsed = RV.parse(text);
  expect(parsed.missing).toEqual([]);
  const plan = RV.plan(parsed.rows, inWindow.filter(b => b.booking_ref === '2026-500'), []);
  const s = RV.summarize(plan, parsed, left);
  expect(s.leftReport).toEqual(['2026-502 check-in 2026-11-05 · Tamraght Camp — left the report — check']);
  expect(s.counts.leftReport).toBe(1);
  // outside the file's check-in range → not judged
  expect(RV.leftReport(inWindow, ['2026-500'], { from: '2026-11-06', to: '2026-11-10' }).map(b => b.booking_ref)).toEqual([]);
  // the plan writes nothing for it
  expect((plan.upserts || []).some(r => r.booking_ref === '2026-502')).toBe(false);
});
