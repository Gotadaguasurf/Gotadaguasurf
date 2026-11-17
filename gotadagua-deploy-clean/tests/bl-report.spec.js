// Bookinglayer camp report (booking lines × guests) → lib/bl-report.js, no browser.
//
// Small invented files with the shapes of the two real reports of 16 Nov 2026 (Sri Lanka, Morocco):
// one row per booking line × guest of the booking, legs as their own dated lines, nameless groups,
// a booker who is not on the guest list, a booking of another camp, rooms with beds in segment order.
const { test, expect } = require('@playwright/test');
const B = require('../lib/bl-report.js');
const G = require('../lib/guests-trips.js');
const CC = require('../lib/camp-config.js');

const { csv } = require('./bl-report-csv');

const SLROOM = 'Kabalana Beach Shared Room (4p)';
const sl = (ref, extra) => ({ ref, ci: '2026-11-21', co: '2026-11-28', ...extra });

test('report header is recognised, and it is not a Guests export', () => {
  const t = csv([sl('2026-1', { guests: [{ name: 'Ann A' }], lines: [{ p: SLROOM, person: 'Ann A', start: '2026-11-21', end: '2026-11-28' }] })]);
  expect(B.isReportHeader(t)).toBe(true);
  expect(G.isGuestsExportHeader(t)).toBe(false);
  expect(B.isReportHeader('Booking,Guest,Has transfer,Arrival flight\n')).toBe(false);
});

test('cross join: 2 guests × 4 lines = 8 rows → 2 guests, one arrival and one departure trip of 2 people', () => {
  const t = csv([sl('2026-10', { channel: 'AASHA', due: 589, bphone: '+31 6 1111 1111',
    guests: [{ name: 'Ann A', phone: '+44 07700 900001', arrT: '08:45', arrF: 'QR 664', depT: '15:00', depF: 'QR655', beds: '1' }, { name: 'Bob B', beds: '2' }],
    lines: [{ p: SLROOM, person: 'Ann A', start: '2026-11-21', end: '2026-11-28', time: '14:00' }, { p: SLROOM, person: 'Bob B', start: '2026-11-21', end: '2026-11-28' },
      { p: 'Airport Transfer Sri Lanka', person: 'Ann A', start: '2026-11-21' }, { p: 'Airport Transfer Sri Lanka', person: 'Bob B', start: '2026-11-21' },
      { p: 'Airport Transfer Sri Lanka', person: 'Ann A', start: '2026-11-28' }, { p: 'Airport Transfer Sri Lanka', person: 'Bob B', start: '2026-11-28' }] })]);
  const p = B.parse(t, '2026-11-16 2007 - test.csv', undefined, CC.SL);
  expect(p.export_date).toBe('2026-11-16');
  expect(p.trips.map(x => [x.key, x.date, x.pax, x.time, x.flight, x.place])).toEqual([
    ['bl:2026-10:arr', '2026-11-21', 2, '08:45', 'QR664', 'CMB'], ['bl:2026-10:dep', '2026-11-28', 2, '15:00', 'QR655', 'CMB']]);
  expect(p.trips[0].phone).toBe('+447700900001');
  const g = B.guestRows(t, 'x.csv', CC.SL);
  expect(g.map(x => [x.guest_name, x.accommodation, x.bed_number, x.partner, x.booking_due, x.has_transfer])).toEqual([
    ['Ann A', SLROOM, '1', 'AASHA', 589, true], ['Bob B', SLROOM, '2', 'AASHA', 589, true]]);
  // Bob has no phone: the booker's phone, said where it comes from
  expect(g[1].phone).toBe('+31611111111'); expect(g[1].raw.phone_from).toBe('booker');
  expect(B.guestAudit(t, 'x.csv', CC.SL)).toMatchObject({ rows: 2, guests: 2, left: [] });
});

test('legs are facts: a booking with only the arrival line gets no departure; a cancelled leg (absent) is absent', () => {
  const t = csv([sl('2026-11', { guests: [{ name: 'Cy C', arrT: '02:45' }], lines: [{ p: SLROOM, person: 'Cy C', start: '2026-11-21', end: '2026-11-28' }, { p: 'Airport Transfer Sri Lanka', person: 'Cy C', start: '2026-11-21' }] })]);
  const p = B.parse(t, 'x.csv', '2026-11-16', CC.SL);
  expect(p.trips.map(x => x.kind)).toEqual(['airport_arrival']);
  expect(p.trips[0].flags.join(' ')).toMatch(/night arrival/);
});

test('one person, two transfer lines on one day (plain + with surfboards) = one seat with boards', () => {
  const t = csv([sl('2026-12', { guests: [{ name: 'Di D', arrT: '08:45' }], lines: [{ p: SLROOM, person: 'Di D', start: '2026-11-21', end: '2026-11-28' },
    { p: 'Airport Transfer Sri Lanka', person: 'Di D', start: '2026-11-21' }, { p: 'Airport Transfer Sri Lanka (with surfboards)', person: 'Di D', start: '2026-11-21' }] })]);
  const [tr] = B.parse(t, 'x.csv', '2026-11-16', CC.SL).trips;
  expect([tr.kind, tr.pax, tr.boards, tr.vehicle]).toEqual(['airport_arrival', 1, true, 'Minivan']);
  expect(tr.flags.join(' ')).toMatch(/one seat/);
});

test('Morocco: one leg off the check-in day is the nearer direction, flagged; Agadir + Marrakesh on one day = one seat, flagged', () => {
  const ma = (ref, extra) => ({ ref, ci: '2026-11-21', co: '2026-11-28', ...extra });
  const t = csv([
    ma('2026-20', { guests: [{ name: 'Eve E' }], lines: [{ p: 'Weekly package Morocco', person: 'Eve E', start: '2026-11-21', end: '2026-11-28' }, { p: '4 - Crocro Private Room', person: 'Eve E', start: '2026-11-21', end: '2026-11-28' },
      { p: 'Airport Transfer Morocco (Agadir)', person: 'Eve E', start: '2026-11-22' }] }),
    ma('2026-21', { guests: [{ name: 'Fay F' }], lines: [{ p: 'Weekly package Morocco', person: 'Fay F', start: '2026-11-21', end: '2026-11-28' }, { p: '2 - Boilers Private Room', person: 'Fay F', start: '2026-11-21', end: '2026-11-28' },
      { p: 'Airport Transfer Morocco (Agadir)', person: 'Fay F', start: '2026-11-21' }, { p: 'Airport Transfer Morocco (Marrakesh)', person: 'Fay F', start: '2026-11-21' }] }),
  ]);
  const p = B.parse(t, 'x.csv', '2026-11-16', CC.MA);
  const e = p.trips.find(x => x.booking_ref === '2026-20'); const f = p.trips.find(x => x.booking_ref === '2026-21');
  expect([e.kind, e.date, e.ambiguous]).toEqual(['airport_arrival', '2026-11-22', true]);
  expect(e.flags.join(' ')).toMatch(/not the check-in/);
  expect([f.pax, f.place]).toEqual([1, 'AGA']);
  expect(f.flags.join(' ')).toMatch(/booked twice/);
});

test('guests of one booking at different airports = two trips; different flights = split with the existing per-guest keys', () => {
  const t = csv([{ ref: '2026-30', ci: '2026-11-21', co: '2026-11-28', guests: [{ name: 'Gil G', arrF: 'U2 2621', arrT: '10:55' }, { name: 'Hal H', arrF: 'LS1129', arrT: '11:55' }, { name: 'Ivy I' }],
    lines: [{ p: 'Weekly package Morocco', person: 'Gil G', start: '2026-11-21', end: '2026-11-28' }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Gil G', start: '2026-11-21' },
      { p: 'Airport Transfer Morocco (Agadir)', person: 'Hal H', start: '2026-11-21' }, { p: 'Airport Transfer Morocco (Marrakesh)', person: 'Ivy I', start: '2026-11-21' }] }]);
  const p = B.parse(t, 'x.csv', '2026-11-16', CC.MA);
  expect(p.trips.map(x => [x.key, x.place, x.pax])).toEqual([['bl:2026-30:arr:gilg', 'AGA', 1], ['bl:2026-30:arr:halh', 'AGA', 1], ['bl:2026-30:arr:ivyi', 'RAK', 1]]);
});

test('group of 7 with no names: 7 separate guests in the one room of the booking, one trip of 7', () => {
  const guests = [1, 2, 3, 4, 5, 6, 7].map(n => ({ name: '', beds: String(n) }));
  const lines = [];
  guests.forEach(() => lines.push({ p: '13 - Anchor Point mixed shared room (8pax)', person: '', start: '2026-11-21', end: '2026-11-25' }, { p: 'Flexible Package Morocco', person: '', start: '2026-11-21', end: '2026-11-25' },
    { p: 'Airport Transfer Morocco (Agadir)', person: '', start: '2026-11-21' }));
  const t = csv([{ ref: '2026-40', ci: '2026-11-21', co: '2026-11-25', guests, lines }]);
  const g = B.guestRows(t, 'x.csv', CC.MA);
  expect(g.map(x => x.guest_key)).toEqual(['guest without name (booking 2026-40)', ...[2, 3, 4, 5, 6, 7].map(n => `guest without name (booking 2026-40) (${n})`)]);
  expect(new Set(g.map(x => x.accommodation))).toEqual(new Set(['13 - Anchor Point mixed shared room (8pax)']));
  expect(g.map(x => x.bed_number)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  const [tr] = B.parse(t, 'x.csv', '2026-11-16', CC.MA).trips;
  expect([tr.pax, tr.vehicle]).toEqual([7, 'Minivan']);
});

test('lines in the name of the booker (not on the guest list) go to the one guest with no line, flagged; an empty-Person line stays the booking\'s', () => {
  const t = csv([sl('2026-50', { channel: 'Surfer Girls Power', due: 1122.49, status: 'Deposit paid',
    guests: [{ name: 'Yehor T', beds: '1' }, { name: 'Ana A', beds: '2' }],
    lines: [{ p: SLROOM, person: 'Natália P', start: '2026-11-21', end: '2026-11-28' }, { p: SLROOM, person: 'Ana A', start: '2026-11-21', end: '2026-11-28' },
      { p: 'Airport Transfer Sri Lanka', person: 'Natália P', start: '2026-11-21' }, { p: 'Yala Park Safari', person: '', start: '', time: '' }] })]);
  const g = B.guestRows(t, 'x.csv', CC.SL);
  expect(g.map(x => [x.guest_name, x.accommodation, x.has_transfer, x.booking_status, x.partner])).toEqual([
    ['Yehor T', SLROOM, true, 'deposit_paid', 'Surfer Girls Power'], ['Ana A', SLROOM, false, 'deposit_paid', 'Surfer Girls Power']]);
  expect(g[0].raw.lines_in_name_of).toBe('Natália P');
  expect(B.parse(t, 'x.csv', '2026-11-16', CC.SL).trips[0].guests).toEqual(['Yehor T']);
  expect(B.importWarnings(t, 'x.csv', CC.SL).map(w => w.text).join(' ')).toMatch(/Natália P.*given to Yehor T/);
});

test('mixed intensive / standard day lessons and a weekly course: per day counts, flags, Week course text', () => {
  const ma = { ref: '2026-60', ci: '2026-11-14', co: '2026-11-21', guests: [{ name: 'Joy J' }, { name: 'Kim K' }], lines: [
    { p: 'Weekly package Morocco', person: 'Joy J', start: '2026-11-14', end: '2026-11-21' }, { p: 'Weekly package Morocco', person: 'Kim K', start: '2026-11-14', end: '2026-11-21' },
    { p: 'Standard Day Group surf lesson', person: 'Joy J', start: '2026-11-15' }, { p: 'Intensive Day Group surf lesson', person: 'Joy J', start: '2026-11-16', time: '09:00' },
    { p: 'Standard Surf Course ( 5 surf lessons )', person: 'Kim K', start: '', time: '' }] };
  const g = B.guestRows(csv([ma]), 'x.csv', CC.MA);
  expect(g[0].raw.flags.join(' ')).toMatch(/two kinds/);
  expect(B.courseOf(g[0])).toBe('Intensive');
  expect(g[1].raw.courses).toEqual([{ title: 'Standard Surf Course ( 5 surf lessons )', type: 'standard', date: null, lessons: 5 }]);
  const d = B.lessonsByDay(g, '2026-11-14', '2026-11-20');
  expect([d['2026-11-15'].standard, d['2026-11-16'].intensive, d['2026-11-16'].course.standard, d['2026-11-14'].standard]).toEqual([1, 1, 1, 0]);
});

test('beds follow the room lines by start date (not number order); a booking of another camp is left out', () => {
  const t = csv([
    { ref: '2026-70', ci: '2026-11-14', co: '2026-11-21', guests: [{ name: 'Lea L', beds: '5, 4' }], lines: [{ p: 'Flexible Package Morocco', person: 'Lea L', start: '2026-11-14', end: '2026-11-21' },
      { p: '5 - Panorama Point Female shared room (6pax)', person: 'Lea L', start: '2026-11-15', end: '2026-11-21' }, { p: '13 - Anchor Point mixed shared room (8pax)', person: 'Lea L', start: '2026-11-14', end: '2026-11-15' }] },
    { ref: '2026-71', ci: '2026-11-27', co: '2026-11-29', guests: [{ name: 'Cor C' }], lines: [{ p: '17 - Castelo beach mixed dorm', person: 'Cor C', start: '2026-11-27', end: '2026-11-29' }, { p: 'Airport Shuttle', person: 'Cor C', start: '2026-11-27' }] },
  ]);
  const g = B.guestRows(t, 'x.csv', CC.MA);
  expect(g.length).toBe(1);
  expect(g[0].raw.segments).toEqual([{ room: '13 - Anchor Point mixed shared room (8pax)', from: '2026-11-14', to: '2026-11-15', bed: '5' }, { room: '5 - Panorama Point Female shared room (6pax)', from: '2026-11-15', to: '2026-11-21', bed: '4' }]);
  const tsl = csv([{ ref: '2026-71', ci: '2026-11-27', co: '2026-11-29', guests: [{ name: 'Cor C' }], lines: [{ p: '17 - Castelo beach mixed dorm', person: 'Cor C', start: '2026-11-27', end: '2026-11-29' }, { p: 'Airport Shuttle', person: 'Cor C', start: '2026-11-27' }] }]);
  const p = B.parse(tsl, 'x.csv', '2026-11-16', CC.SL);
  expect(p.trips).toEqual([]); expect(p.other_bookings.map(x => x.ref)).toEqual(['2026-71']);
  expect(B.guestAudit(tsl, 'x.csv', CC.SL).left.map(x => x.kind)).toEqual(['other_camp']);
});

test('import plan: past legs without their key and legs the app has under another key are never sent; paid untouched; future created', () => {
  const t = csv([{ ref: '2026-80', ci: '2026-10-10', co: '2026-11-25', guests: [{ name: 'Max M' }], lines: [{ p: 'Weekly package Morocco', person: 'Max M', start: '2026-10-10', end: '2026-11-25' },
    { p: 'Airport Transfer Morocco (Agadir)', person: 'Max M', start: '2026-10-10' }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Max M', start: '2026-11-25' }] },
  { ref: '2026-81', ci: '2026-10-03', co: '2026-11-20', guests: [{ name: 'Ned N' }], lines: [{ p: 'Weekly package Morocco', person: 'Ned N', start: '2026-10-03', end: '2026-11-20' },
    { p: 'Airport Transfer Morocco (Agadir)', person: 'Ned N', start: '2026-10-03' }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Ned N', start: '2026-11-20' }] }]);
  const p = B.parse(t, 'x.csv', '2026-11-16', CC.MA);
  const app = [
    { id: 'h1', kind: 'airport_arrival', trip_date: '2026-10-10', booking_ref: '2026-80', import_key: 'hist2026:2026-80:arr:AGA', status: 'done', source: 'manual', place: 'AGA', pax: 1 },
    { id: 'p1', kind: 'airport_departure', trip_date: '2026-11-20', booking_ref: '2026-81', import_key: 'bl:2026-81:dep', status: 'planned', source: 'bookinglayer', place: 'AGA', pax: 1, payment_entry_id: 'e1', guest_names: 'Ned N' },
    { id: 'x1', kind: 'airport_arrival', trip_date: '2026-11-30', booking_ref: '2026-81', import_key: 'bl:2026-81:arr:old', status: 'planned', source: 'bookinglayer', place: 'AGA', pax: 1, last_import_at: '2026-11-14' },
  ];
  const plan = B.planTrips(p.trips, app, { today: '2026-11-16', exportDate: '2026-11-16', now: '2026-11-16T21:00' });
  expect(plan.covered.map(x => x.trip.key)).toEqual(['bl:2026-80:arr']);
  expect(plan.past.map(x => x.trip.key)).toEqual(['bl:2026-81:arr']);
  expect(plan.create.map(x => x.trip.key)).toEqual(['bl:2026-80:dep']);
  expect(plan.untouched.map(x => [x.trip.key, x.why])).toEqual([['bl:2026-81:dep', 'paid']]);
  expect(plan.send.map(t => t.key).sort()).toEqual(['bl:2026-80:dep', 'bl:2026-81:dep']);
  // bl:2026-81:arr:old is not regrouped (no arrival key of 2026-81 is sent) but flagged «transfer removed»
  expect(plan.regroupCancel).toEqual([]); expect(plan.flagRemoved.map(a => a.id)).toEqual(['x1']);
});
