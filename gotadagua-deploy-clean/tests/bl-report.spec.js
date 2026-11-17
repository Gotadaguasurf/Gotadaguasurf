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
const F = require('./catalog-fixtures');
// The camp settings + the /prices vehicles (capacity column, Car = 3), as the camp hub passes them to the parser.
const SLC = F.slCfg(), MAC = F.maCfg();

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
  const p = B.parse(t, '2026-11-16 2007 - test.csv', undefined, SLC);
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
  const p = B.parse(t, 'x.csv', '2026-11-16', SLC);
  expect(p.trips.map(x => x.kind)).toEqual(['airport_arrival']);
  expect(p.trips[0].flags.join(' ')).toMatch(/night arrival/);
});

test('one person, two transfer lines on one day (plain + with surfboards) = one seat with boards', () => {
  const t = csv([sl('2026-12', { guests: [{ name: 'Di D', arrT: '08:45' }], lines: [{ p: SLROOM, person: 'Di D', start: '2026-11-21', end: '2026-11-28' },
    { p: 'Airport Transfer Sri Lanka', person: 'Di D', start: '2026-11-21' }, { p: 'Airport Transfer Sri Lanka (with surfboards)', person: 'Di D', start: '2026-11-21' }] })]);
  const [tr] = B.parse(t, 'x.csv', '2026-11-16', SLC).trips;
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
  const p = B.parse(t, 'x.csv', '2026-11-16', MAC);
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
  const p = B.parse(t, 'x.csv', '2026-11-16', MAC);
  expect(p.trips.map(x => [x.key, x.place, x.pax])).toEqual([['bl:2026-30:arr:gilg', 'AGA', 1], ['bl:2026-30:arr:halh', 'AGA', 1], ['bl:2026-30:arr:ivyi', 'RAK', 1]]);
});

test('group of 7 with no names: 7 separate guests in the one room of the booking, one trip of 7', () => {
  const guests = [1, 2, 3, 4, 5, 6, 7].map(n => ({ name: '', beds: String(n) }));
  const lines = [];
  guests.forEach(() => lines.push({ p: '13 - Anchor Point mixed shared room (8pax)', person: '', start: '2026-11-21', end: '2026-11-25' }, { p: 'Flexible Package Morocco', person: '', start: '2026-11-21', end: '2026-11-25' },
    { p: 'Airport Transfer Morocco (Agadir)', person: '', start: '2026-11-21' }, { p: 'Intensive Day Group surf lesson', person: '', start: '2026-11-22', time: '09:00' }));
  const t = csv([{ ref: '2026-40', ci: '2026-11-21', co: '2026-11-25', guests, lines }]);
  const g = B.guestRows(t, 'x.csv', CC.MA);
  expect(g.map(x => x.guest_key)).toEqual(['guest without name (booking 2026-40)', ...[2, 3, 4, 5, 6, 7].map(n => `guest without name (booking 2026-40) (${n})`)]);
  expect(new Set(g.map(x => x.accommodation))).toEqual(new Set(['13 - Anchor Point mixed shared room (8pax)']));
  expect(g.map(x => x.bed_number)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  // every line of the group, once per nameless guest, is that guest's: package, day lesson, transfer
  expect(g.every(x => x.packages === 'Flexible Package Morocco' && x.has_transfer && x.raw.lessons.length === 1)).toBe(true);
  expect(B.lessonsByDay(g, '2026-11-22', '2026-11-22')['2026-11-22'].intensive).toBe(7);
  const [tr] = B.parse(t, 'x.csv', '2026-11-16', MAC).trips;
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
  expect(B.parse(t, 'x.csv', '2026-11-16', SLC).trips[0].guests).toEqual(['Yehor T']);
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
  const p = B.parse(tsl, 'x.csv', '2026-11-16', SLC);
  expect(p.trips).toEqual([]); expect(p.other_bookings.map(x => x.ref)).toEqual(['2026-71']);
  expect(B.guestAudit(tsl, 'x.csv', CC.SL).left.map(x => x.kind)).toEqual(['other_camp']);
});

test('import plan: past legs without their key and legs the app has under another key are never sent; paid untouched; future created', () => {
  const t = csv([{ ref: '2026-80', ci: '2026-10-10', co: '2026-11-25', guests: [{ name: 'Max M' }], lines: [{ p: 'Weekly package Morocco', person: 'Max M', start: '2026-10-10', end: '2026-11-25' },
    { p: 'Airport Transfer Morocco (Agadir)', person: 'Max M', start: '2026-10-10' }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Max M', start: '2026-11-25' }] },
  { ref: '2026-81', ci: '2026-10-03', co: '2026-11-20', guests: [{ name: 'Ned N' }], lines: [{ p: 'Weekly package Morocco', person: 'Ned N', start: '2026-10-03', end: '2026-11-20' },
    { p: 'Airport Transfer Morocco (Agadir)', person: 'Ned N', start: '2026-10-03' }, { p: 'Airport Transfer Morocco (Agadir)', person: 'Ned N', start: '2026-11-20' }] }]);
  const p = B.parse(t, 'x.csv', '2026-11-16', MAC);
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

test('import plan: a key that would make the RPC cancel a trip of an earlier day (regrouped) is held back', () => {
  const t = csv([{ ref: '2026-90', ci: '2026-11-10', co: '2026-11-30', guests: [{ name: 'Pia P', arrT: '10:00', arrF: 'QR1' }, { name: 'Ray R', arrT: '12:00', arrF: 'QR2' }],
    lines: [{ p: SLROOM, person: 'Pia P', start: '2026-11-10', end: '2026-11-30' }, { p: 'Airport Transfer Sri Lanka', person: 'Pia P', start: '2026-11-10' }, { p: 'Airport Transfer Sri Lanka', person: 'Ray R', start: '2026-11-18' }] }]);
  const p = B.parse(t, 'x.csv', '2026-11-16', SLC);
  expect(p.trips.map(x => x.key)).toEqual(['bl:2026-90:arr:piap', 'bl:2026-90:arr:rayr']);
  // the app has the 10 Nov arrival under the plain key, still «planned» (never marked done)
  const app = [{ id: 'old', kind: 'airport_arrival', trip_date: '2026-11-10', booking_ref: '2026-90', import_key: 'bl:2026-90:arr', status: 'planned', source: 'bookinglayer', place: 'CMB', pax: 1, last_import_at: '2026-11-08' }];
  const plan = B.planTrips(p.trips, app, { today: '2026-11-17', exportDate: '2026-11-16', now: '2026-11-17T08:00' });
  expect(plan.send).toEqual([]);
  expect(plan.regroupCancel).toEqual([]);
  expect(plan.withheld.map(x => x.trip.key)).toEqual(['bl:2026-90:arr:rayr']);
  expect(plan.covered.map(x => x.trip.key)).toEqual(['bl:2026-90:arr:piap']);   // the app has the 10 Nov leg under the old key
});

test('import plan: a trip cancelled by an import but in the past is not brought back (the RPC leaves past trips alone)', () => {
  const t = csv([sl('2026-91', { ci: '2026-11-14', co: '2026-11-21', guests: [{ name: 'Sue S' }], lines: [{ p: SLROOM, person: 'Sue S', start: '2026-11-14', end: '2026-11-21' }, { p: 'Airport Transfer Sri Lanka', person: 'Sue S', start: '2026-11-14' }] })]);
  const p = B.parse(t, 'x.csv', '2026-11-16', SLC);
  const app = [{ id: 'c', kind: 'airport_arrival', trip_date: '2026-11-14', booking_ref: '2026-91', import_key: 'bl:2026-91:arr', status: 'cancelled', cancel_reason: 'split', source: 'bookinglayer', place: 'CMB', pax: 1 }];
  const plan = B.planTrips(p.trips, app, { today: '2026-11-17', exportDate: '2026-11-16', now: '2026-11-17T08:00' });
  expect(plan.revive).toEqual([]); expect(plan.untouched.map(x => x.why)).toEqual(['in the past']);
});

// ── The price column and Miguel's transfer rule (17 Nov 2026) ─────────────────────────────────────
const { csvPriced } = require('./bl-report-csv');
const MA_PKG = 'Weekly package Morocco';
const TO = (place) => `Airport Transfer Morocco (${place || 'Agadir'})`;
// one booking: each guest { name, arr: [price, flight, time], dep: [price, flight, time] }
function maBooking(ref, ci, co, people, place) {
  const guests = people.map(p => ({ name: p.name, arrF: p.arr[1], arrT: p.arr[2], depF: p.dep[1], depT: p.dep[2] }));
  const lines = [];
  people.forEach(p => {
    lines.push({ p: MA_PKG, person: p.name, start: ci, end: co, price: 400 });
    if (p.arr[0] != null) lines.push({ p: TO(place), person: p.name, start: ci, price: p.arr[0] });
    if (p.dep[0] != null) lines.push({ p: TO(place), person: p.name, start: co, price: p.dep[0] });
  });
  return { ref, ci, co, guests, lines };
}
const TOG = /^Different times — coming together\? If not, the guest at 0 € has to pay a transfer/;
const trips = (bks, header) => B.parse(csvPriced(bks, header), 'x.csv', '2026-11-17', MAC).trips;

test('price column: «Booking line: Final price incl. tax» (and other spellings) is read; without it, the old rule', () => {
  expect(B.PRICE_HEADER.test('Booking line: Final price incl. tax')).toBe(true);
  expect(B.PRICE_HEADER.test('Booking line Final price incl. tax')).toBe(true);
  expect(B.PRICE_HEADER.test('Booking line: Price')).toBe(true);
  expect(B.PRICE_HEADER.test('Booking line: Total incl. tax')).toBe(true);
  expect(B.PRICE_HEADER.test('Booking line: Start time')).toBe(false);
  expect([B.priceOf('30.00'), B.priceOf('0.00'), B.priceOf('€ 1.234,50'), B.priceOf('1,234.50'), B.priceOf('')]).toEqual([30, 0, 1234.5, 1234.5, null]);
  const bk = maBooking('2026-2158', '2026-10-25', '2026-11-05', [{ name: 'Lisa Bleichrodt', arr: [30, 'HV6491', '18:15'], dep: [30, 'HV6492', '19:05'] }, { name: 'Vera Bos', arr: [0, 'HV6491', '14:15'], dep: [0, 'HV6492', '19:05'] }]);
  const R = B.read(csvPriced([bk]), 'x.csv', CC.MA);
  expect(R.priceColumn).toBe('Booking line: Final price incl. tax');
  expect(R.missing).toEqual([]);
  // the same booking without prices: the guests' times contradict → two trips (today's rule)
  const old = B.parse(csv([bk]), 'x.csv', '2026-11-17', MAC).trips.filter(t => t.kind === 'airport_arrival');
  expect(old.length).toBe(2);
});

test('MA 2026-2158: Lisa paid, Vera at 0 € on the same flight but 4 h apart → one trip of 2 with the «coming together?» question; departure one trip, no question', () => {
  const t = trips([maBooking('2026-2158', '2026-10-25', '2026-11-05', [{ name: 'Lisa Bleichrodt', arr: [30, 'HV6491', '18:15'], dep: [30, 'HV6492', '19:05'] }, { name: 'Vera Bos', arr: [0, 'HV6491', '14:15'], dep: [0, 'HV6492', '19:05'] }])]);
  expect(t.map(x => [x.key, x.pax, x.time, x.flight, x.vehicle])).toEqual([['bl:2026-2158:arr', 2, '18:15', 'HV6491', 'Car'], ['bl:2026-2158:dep', 2, '19:05', 'HV6492', 'Car']]);
  expect(t[0].flags.filter(f => TOG.test(f))).toEqual(['Different times — coming together? If not, the guest at 0 € has to pay a transfer (Vera Bos · HV6491 · 14:15)']);
  expect(t[1].flags.some(f => TOG.test(f))).toBe(false);
  expect(t.flatMap(x => x.flags).join(' ')).not.toMatch(/refund|devol/i);
});

test('MA 2026-4297: Rebecca paid, Sera at 0 €, departures 12:00 vs 09:00 → one trip with the question; arrival (EZY vs EZY8711, same time) no question', () => {
  const t = trips([maBooking('2026-4297', '2026-10-31', '2026-11-07', [{ name: 'Rebecca Brahde', arr: [30, 'EZY', '15:40'], dep: [30, '', '12:00'] }, { name: 'Sera Choi', arr: [0, 'EZY8711', '15:40'], dep: [0, '', '09:00'] }])]);
  const [arr, dep] = t;
  expect([arr.pax, dep.pax, dep.time]).toEqual([2, 2, '12:00']);
  expect(arr.flags.some(f => TOG.test(f))).toBe(false);
  expect(dep.flags.find(f => TOG.test(f))).toMatch(/\(Sera Choi · 09:00\)$/);
});

test('MA 2026-4581: Fabienne paid Marrakesh (240), the others at 0 €; departure LX8115 vs LX8114 → one trip of 3 asking about Tobias; arrival one trip, no question', () => {
  const t = trips([maBooking('2026-4581', '2026-11-02', '2026-11-07', [
    { name: 'Fabienne Meier', arr: [240, 'LX8114', '11:35'], dep: [240, 'LX8115', '18:00'] },
    { name: 'Tobias Hinnen', arr: [0, 'LX8114', '11:35'], dep: [0, 'LX8114', '18:00'] },
    { name: 'Teijo Greuter', arr: [0, 'LX8114', '11:35'], dep: [0, 'LX8115', '18:00'] }], 'Marrakesh')]);
  expect(t.map(x => [x.key, x.place, x.pax])).toEqual([['bl:2026-4581:arr', 'RAK', 3], ['bl:2026-4581:dep', 'RAK', 3]]);
  expect(t[0].flags.some(f => TOG.test(f))).toBe(false);
  expect(t[1].flags.find(f => TOG.test(f))).toMatch(/\(Tobias Hinnen · LX8114 · 18:00\)$/);
});

test('MA 2026-4717: Hoi Yi paid, Tsz Yin at 0 € (her paid lines cancelled) — arrival U2 2621 vs LS1129 → question; departure U2 2286 = EZY2286 → same flight', () => {
  const t = trips([maBooking('2026-4717', '2026-11-15', '2026-11-20', [{ name: 'Hoi Yi Law', arr: [30, 'U2 2621', '10:55'], dep: [30, 'U2 2286', '11:55'] }, { name: 'Tsz Yin Scarlet Tang', arr: [0, 'LS1129', '11:55'], dep: [0, 'EZY2286', '11:55'] }])]);
  expect(t.map(x => [x.key, x.pax, x.flight])).toEqual([['bl:2026-4717:arr', 2, 'U22621'], ['bl:2026-4717:dep', 2, 'U22286']]);
  expect(t[0].flags.find(f => TOG.test(f))).toMatch(/\(Tsz Yin Scarlet Tang · LS1129 · 11:55\)$/);
  expect(t[1].flags.some(f => TOG.test(f))).toBe(false);
  expect(B.flightNo('U2 2286')).toBe(B.flightNo('EZY2286'));
});

test('two paid lines: same flight → one trip «2 transfers paid, same flight — confirm»; different flights → one trip per paid line, the 0 € guest with the matching one', () => {
  const same = trips([maBooking('2026-95', '2026-11-21', '2026-11-28', [{ name: 'Ada A', arr: [30, 'AT431', '22:55'], dep: [null] }, { name: 'Ben B', arr: [30, 'AT 431', ''], dep: [null] }, { name: 'Cal C', arr: [0, '', ''], dep: [null] }])]);
  expect(same.map(x => [x.pax, x.flags.filter(f => /transfers paid/.test(f))])).toEqual([[3, ['2 transfers paid, same flight — confirm they come together']]]);
  const diff = trips([maBooking('2026-96', '2026-11-21', '2026-11-28', [{ name: 'Ada A', arr: [30, 'AT431', '22:55'], dep: [null] }, { name: 'Ben B', arr: [30, 'FR185', '00:05'], dep: [null] }, { name: 'Cal C', arr: [0, 'FR 185', ''], dep: [null] }])]);
  expect(diff.map(x => [x.key, x.guests])).toEqual([['bl:2026-96:arr:adaa', ['Ada A']], ['bl:2026-96:arr:benb', ['Ben B', 'Cal C']]]);
  expect(diff.flatMap(x => x.flags).some(f => TOG.test(f) || /transfers paid/.test(f))).toBe(false);
});

// ── /prices is the one source of vehicles and seats (17 Nov 2026) ───────────────────────────────────
const TC = require('../lib/transport-catalog.js');
const air = (cat, cfg, kind, place) => TC.airportVehicles(cat, cfg, kind, place);
// a Sri Lanka booking: the guests, a room line each, and the given transfer lines
const sl0 = (ref, guests, transfers, extra) => ({ ref, ci: '2026-11-21', co: '2026-11-28', guests, ...extra,
  lines: guests.map(g => ({ p: SLROOM, person: g.name, start: '2026-11-21', end: '2026-11-28', price: 500 })).concat(transfers) });
const slArr = (bk) => B.parse(csvPriced([bk]), 'x.csv', '2026-11-16', SLC).trips.find(t => t.kind === 'airport_arrival');
const tr80 = (name, price) => ({ p: 'Airport Transfer Sri Lanka', person: name, start: '2026-11-21', price });
test('vehicle: the smallest whose /prices CAPACITY COLUMN holds the people — Car 3 → 4 people Minivan; the same file with Car 4 → Car', () => {
  const ma = air(F.maCat(), CC.MA, 'airport_arrival', 'AGA');
  expect([1, 3, 4, 8, 9, 15].map(n => G.vehicleFor(n, false, ma))).toEqual(['Car', 'Car', 'Minivan', 'Minivan', 'Big Van', 'Big Van']);
  const sl = air(F.slCat(), CC.SL, 'airport_arrival', 'CMB');
  expect([1, 3, 4, 8].map(n => G.vehicleFor(n, false, sl))).toEqual(['Car', 'Car', 'Minivan', 'Minivan']);
  // Production today: Car capacity 4 → 4 people still fit the Car (read from the column, not a constant)
  expect(G.vehicleFor(4, false, air(F.slCat({ carCap: 4 }), CC.SL, 'airport_arrival'))).toBe('Car');
  // capacity from the column even when an old note says otherwise; the note only when the column is empty
  expect(TC.capacityOf({ capacity: 3, notes: 'capacity 4' })).toBe(3);
  expect(TC.capacityOf({ capacity: null, notes: 'Imported (Car, capacity 4)' })).toBe(4);
  // no /prices rows (not loaded) → no vehicle, never a guessed one
  expect(G.vehicleFor(2, false, undefined)).toBe(null);
  expect(G.pickVehicle(2, { vehicles: [] }).flag).toMatch(/no vehicle in \/prices/);
  // Sri Lanka has no third vehicle in /prices: the import never invents a «Large Van»
  expect(sl.map(v => v.label)).toEqual(['Car', 'Minivan']);
});

test('9 people in Sri Lanka: the largest vehicle /prices has (Minivan) + «9 people over capacity — 2nd vehicle?», never price 0', () => {
  const sl = air(F.slCat(), CC.SL, 'airport_arrival', 'CMB');
  const pk = G.pickVehicle(9, { vehicles: sl });
  expect([pk.label, pk.over, pk.flag]).toEqual(['Minivan', true, '9 people over capacity — 2nd vehicle?']);
  expect(TC.costOf(sl, pk.label)).toBe(25500);
  const guests = Array.from({ length: 9 }, (_, i) => ({ name: `G${i} Nine` }));
  const t = csv([sl0('2026-901', guests, guests.map(g => ({ p: 'Airport Transfer Sri Lanka', person: g.name, start: '2026-11-21' })))]);
  const [tr] = B.parse(t, 'x.csv', '2026-11-16', SLC).trips;
  expect([tr.pax, tr.vehicle]).toEqual([9, 'Minivan']);
  expect(tr.flags).toContain('9 people over capacity — 2nd vehicle?');
});

test('surfboards → Minivan whatever the head count: by the /prices bl_product row, and (before bl_product is filled) by the product name', () => {
  const sl = air(F.slCat(), CC.SL, 'airport_arrival', 'CMB');
  expect(G.pickVehicle(1, { vehicles: sl, products: [F.SURFBOARDS] }).label).toBe('Minivan');
  expect(G.pickVehicle(2, { vehicles: sl, products: ['airport transfer sri lanka  (with SURFBOARDS)'] }).label).toBe('Minivan');   // case and spaces
  expect(G.pickVehicle(2, { vehicles: air(F.slCat({ noProduct: true }), CC.SL, 'airport_arrival'), boards: true }).label).toBe('Minivan');
  expect(G.pickVehicle(2, { vehicles: sl, products: ['Airport Transfer Sri Lanka'] }).label).toBe('Car');
  const tr = slArr(sl0('2026-902', [{ name: 'Sam S' }, { name: 'Tia T' }], [{ p: F.SURFBOARDS, person: 'Sam S', start: '2026-11-21', price: 95 }, { p: F.SURFBOARDS, person: 'Tia T', start: '2026-11-21', price: 0 }]));
  expect([tr.pax, tr.vehicle, tr.boards]).toEqual([2, 'Minivan', true]);
  expect(tr.flags.filter(f => B.UNDERPAID_RE.test(f) || B.UNDERSOLD_RE.test(f))).toEqual([]);   // 2 people, one €95 surfboards transfer: right
});

test('one paid transfer covers 3 people (covers_pax): 4 people on one €80 line → «4 people, 1 transfer paid — one covers 3» (and a Minivan, no «/prices €95»)', () => {
  const four = ['Ann A', 'Bob B', 'Cy C', 'Dee D'].map(name => ({ name }));
  const tr = slArr(sl0('2026-903', four, [tr80('Ann A', 80), ...['Bob B', 'Cy C', 'Dee D'].map(n => tr80(n, 0))]));
  expect([tr.pax, tr.vehicle, tr.paid_lines, tr.guest_eur]).toEqual([4, 'Minivan', 1, 80]);
  expect(tr.flags.filter(f => B.UNDERPAID_RE.test(f) || B.UNDERSOLD_RE.test(f))).toEqual(['4 people, 1 transfer paid — one covers 3']);
  // 3 people, one €80 line: covered, no flag; 5 people, two €80 lines: covered, and no «2 transfers paid — confirm» question
  expect(slArr(sl0('2026-904', four.slice(0, 3), [tr80('Ann A', 80), tr80('Bob B', 0), tr80('Cy C', 0)])).flags.filter(f => B.UNDERPAID_RE.test(f))).toEqual([]);
  const five = four.concat({ name: 'Eve E' });
  const t5 = slArr(sl0('2026-905', five, [tr80('Ann A', 80), tr80('Bob B', 80), ...['Cy C', 'Dee D', 'Eve E'].map(n => tr80(n, 0))]));
  expect(t5.flags.filter(f => B.UNDERPAID_RE.test(f) || /transfers paid, same flight/.test(f))).toEqual([]);
  // Morocco: the same rule (Agadir €30 / 3 persons)
  const ma = trips([maBooking('2026-906', '2026-11-21', '2026-11-28', ['Al A', 'Bo B', 'Ce C', 'Di D'].map((name, i) => ({ name, arr: [i ? 0 : 30, 'AT431', '10:00'], dep: [null] })))]);
  expect(ma[0].flags).toContain('4 people, 1 transfer paid — one covers 3');
});

test('a paid line under the /prices guest price → «paid €70, /prices €80 (name)» (not for a partner: net of commission); every line at 0 €: nothing for a partner, «no transfer paid» otherwise', () => {
  const tr = slArr(sl0('2026-907', [{ name: 'Ann A' }], [tr80('Ann A', 70)]));
  expect(tr.flags.filter(f => B.UNDERSOLD_RE.test(f))).toEqual(['paid €70, /prices €80 (Ann A)']);
  expect(slArr(sl0('2026-908', [{ name: 'Ann A' }], [tr80('Ann A', 80)])).flags.filter(f => B.UNDERSOLD_RE.test(f) || B.UNDERPAID_RE.test(f))).toEqual([]);
  expect(slArr(sl0('2026-909', [{ name: 'Ann A' }], [tr80('Ann A', 0)], { channel: 'AASHA' })).flags.filter(f => B.UNDERPAID_RE.test(f))).toEqual([]);
  // a partner's line is net of its commission (MA 2026-4020, Surfer Girls Power: €108 of €120): never «paid €108, /prices €120»
  expect(slArr(sl0('2026-911', [{ name: 'Ann A' }], [tr80('Ann A', 72)], { channel: 'AASHA' })).flags.filter(f => B.UNDERSOLD_RE.test(f))).toEqual([]);
  expect(slArr(sl0('2026-910', [{ name: 'Ann A' }], [tr80('Ann A', 0)])).flags).toContain('no transfer paid');
});

// ── Merge, never blank (Miguel, 17 Nov 2026) ───────────────────────────────────────────────────────
test('guests: an empty report diet keeps the app diet; a filled report value fills an empty app field; «Not here» set by hand stays, as a question', () => {
  const t = csv([sl('2026-97', { guests: [{ name: 'Tom T', diet: '', level: 'Beginner level', beds: '' }], lines: [{ p: SLROOM, person: 'Tom T', start: '2026-11-21', end: '2026-11-28' }] }),
    sl('2026-98', { guests: [{ name: 'Una U' }], lines: [{ p: SLROOM, person: 'Una U', start: '2026-11-21', end: '2026-11-28' }] })]);
  const rows = B.guestRows(t, 'x.csv', CC.SL);
  const app = [{ booking_ref: '2026-97', guest_key: 'tom t', diet: 'Vegan', level: '', bed_number: '3', phone: '+351900000000', raw: { transfer_comment: 'arriving by bus' }, booking_status: 'paid' },
    { booking_ref: '2026-98', guest_key: 'una u', booking_status: 'not_here' }];
  const P = B.planGuests(rows, app);
  const tom = P.rows.find(g => g.guest_key === 'tom t');
  expect([tom.diet, tom.bed_number, tom.phone, tom.level, tom.raw.transfer_comment]).toEqual(['Vegan', '3', '+351900000000', 'Beginner level', 'arriving by bus']);
  expect(P.kept[0].fields.map(f => f.field)).toEqual(['phone', 'diet', 'bed_number', 'transfer comment']);
  expect(P.fills[0].fields.map(f => f.field)).toEqual(['level']);   // rooms / packages / activities always take the report's value
  const una = P.rows.find(g => g.guest_key === 'una u');
  expect(una.booking_status).toBe('not_here');
  expect(P.conflicts.map(c => c.note)).toEqual(['Bookinglayer says: paid — use it?']);
});

test('trips: a new report flight fills an empty app flight; a time typed by hand vs a different report time → kept, with «Bookinglayer says» on the trip', () => {
  const t = csv([sl('2026-99', { guests: [{ name: 'Val V', arrT: '11:55', arrF: 'QR664' }], lines: [{ p: SLROOM, person: 'Val V', start: '2026-11-21', end: '2026-11-28' }, { p: 'Airport Transfer Sri Lanka', person: 'Val V', start: '2026-11-21' }] })]);
  const p = B.parse(t, 'x.csv', '2026-11-17', SLC);
  const base = { id: 'v1', kind: 'airport_arrival', trip_date: '2026-11-21', booking_ref: '2026-99', import_key: 'bl:2026-99:arr', status: 'planned', source: 'bookinglayer', place: 'CMB', pax: 1, vehicle: 'Car', guest_names: 'Val V', last_import_at: '2026-11-14' };
  const fill = B.planTrips(p.trips, [{ ...base, flight: null, trip_time: '11:55', edited_fields: [] }], { today: '2026-11-17', exportDate: '2026-11-17' });
  expect(fill.fills.map(x => x.fills.map(c => [c.field, c.report]))).toEqual([[['flight', 'QR664']]]);
  expect(fill.conflicts).toEqual([]);
  const conf = B.planTrips(p.trips, [{ ...base, flight: 'QR664', trip_time: '09:30', edited_fields: ['trip_time'] }], { today: '2026-11-17', exportDate: '2026-11-17' });
  expect(conf.conflicts.map(x => x.conflicts.map(c => [c.field, c.app, c.report]))).toEqual([[['trip_time', '09:30', '11:55']]]);
  expect(conf.send[0].flags).toContain('Bookinglayer says: time 11:55 — use it?');
  expect(B.blSaysOf('Bookinglayer says: time 11:55 — use it?')).toEqual({ word: 'time', field: 'trip_time', value: '11:55' });
  expect(conf.update).toEqual([]);   // nothing else changes: the hand-typed time stays
});

test('MA 2026-4717: two per-guest trips of one transfer become one (the key holder brought back), the others «merged — same transfer»; 2026-4791 (two airports) stays two', () => {
  const bks = [maBooking('2026-4717', '2026-11-15', '2026-11-20', [{ name: 'Hoi Yi Law', arr: [30, 'U2 2621', '10:55'], dep: [30, 'U2 2286', '11:55'] }, { name: 'Tsz Yin Scarlet Tang', arr: [0, 'LS1129', '11:55'], dep: [0, 'EZY2286', '11:55'] }])];
  const ma = (o) => ({ kind: 'airport_arrival', trip_date: '2026-11-15', booking_ref: '2026-4717', status: 'planned', source: 'bookinglayer', place: 'AGA', pax: 1, vehicle: 'Car', expected_price: 250, edited_fields: [], last_import_at: '2026-11-14', ...o });
  const app = [
    ma({ id: 'a0', import_key: 'bl:2026-4717:arr', status: 'cancelled', cancel_reason: 'split', guest_names: 'Hoi Yi Law, Tsz Yin Scarlet Tang', pax: 2 }),
    ma({ id: 'a1', import_key: 'bl:2026-4717:arr:hoiyilaw', guest_names: 'Hoi Yi Law', trip_time: '10:55', flight: 'U22621' }),
    ma({ id: 'a2', import_key: 'bl:2026-4717:arr:tszyinscarlettang', guest_names: 'Tsz Yin Scarlet Tang', trip_time: '11:55', flight: 'LS1129' }),
    ma({ id: 'd1', kind: 'airport_departure', trip_date: '2026-11-20', import_key: 'bl:2026-4717:dep:hoiyilaw', guest_names: 'Hoi Yi Law' }),
    ma({ id: 'd2', kind: 'airport_departure', trip_date: '2026-11-20', import_key: 'bl:2026-4717:dep:tszyinscarlettang', guest_names: 'Tsz Yin Scarlet Tang' }),
  ];
  const p = B.parse(csvPriced(bks), 'x.csv', '2026-11-17', MAC);
  const plan = B.planTrips(p.trips, app, { today: '2026-11-17', exportDate: '2026-11-17', prices: (k, v, pl) => ({ AGA: { Car: 250, Minivan: 300 } })[pl][v] });
  expect(plan.merge.map(m => [m.trip.key, m.survivor.id, m.others.map(a => a.id), m.patch.pax, m.patch.guest_names, m.patch.status || '', m.patch.import_key || ''])).toEqual([
    ['bl:2026-4717:arr', 'a0', ['a1', 'a2'], 2, 'Hoi Yi Law, Tsz Yin Scarlet Tang', 'planned', ''],
    ['bl:2026-4717:dep', 'd1', ['d2'], 2, 'Hoi Yi Law, Tsz Yin Scarlet Tang', '', 'bl:2026-4717:dep']]);
  expect(plan.merge[0].patch.import_flags.some(f => TOG.test(f))).toBe(true);
  expect(plan.merge[0].patch.expected_price).toBe(250);
  // the merged-away trips are not «regrouped» or flagged by the import; nothing is held back
  expect([plan.regroupCancel, plan.flagRemoved, plan.withheld]).toEqual([[], [], []]);
  expect(plan.send.map(t => t.key).sort()).toEqual(['bl:2026-4717:arr', 'bl:2026-4717:dep']);
  // Sri Lanka never merges a trip of an earlier day
  const sl0 = B.planTrips(p.trips, app, { today: '2026-11-17', exportDate: '2026-11-17', mergePast: false });
  expect(sl0.merge.map(m => m.trip.key)).toEqual(['bl:2026-4717:dep']);
  expect(sl0.mergeInfo.map(m => m.trip.key)).toEqual(['bl:2026-4717:arr']);
  // two airports: two trips, nothing merged
  const two = B.parse(csvPriced([{ ...maBooking('2026-4791', '2026-10-26', '2026-11-02', [{ name: 'Rosemary Keogh', arr: [30, '', ''], dep: [30, '', ''] }]),
    lines: [{ p: MA_PKG, person: 'Rosemary Keogh', start: '2026-10-26', end: '2026-11-02' }, { p: MA_PKG, person: 'Nina Van Nieuwkoop', start: '2026-10-26', end: '2026-11-02' },
      { p: TO('Agadir'), person: 'Rosemary Keogh', start: '2026-10-26', price: 30 }, { p: TO('Marrakesh'), person: 'Nina Van Nieuwkoop', start: '2026-10-26', price: 240 }],
    guests: [{ name: 'Rosemary Keogh' }, { name: 'Nina Van Nieuwkoop' }] }]), 'x.csv', '2026-11-17', MAC).trips;
  expect(two.map(t => [t.place, t.guests]).sort()).toEqual([['AGA', ['Rosemary Keogh']], ['RAK', ['Nina Van Nieuwkoop']]]);
});

test('price rule details: a 0 € guest fills the paid guest\'s empty flight (MA 2026-4241 shape); U2 286 = EZY286; vehicle and price never «Bookinglayer says»', () => {
  const t = trips([maBooking('2026-4241', '2026-11-21', '2026-11-28', [{ name: 'Stephanie Zink', arr: [30, '', ''], dep: [null] }, { name: 'Freda Lange', arr: [0, 'DE508', '12:40'], dep: [null] }])]);
  expect(t.map(x => [x.pax, x.flight, x.time, x.flags.some(f => TOG.test(f))])).toEqual([[2, 'DE508', '12:40', false]]);
  expect([B.flightNo('U2 286'), B.flightNo('EZY286'), B.flightNo('U2 2286'), B.flightNo('EZY2286'), B.flightNo('LX8115'), B.flightNo('W4 6487')]).toEqual(['286', '286', '2286', '2286', '8115', '6487']);
  const p = B.parse(csv([sl('2026-77', { guests: [{ name: 'Wim W', arrT: '10:00', arrF: 'QR664' }], lines: [{ p: SLROOM, person: 'Wim W', start: '2026-11-21', end: '2026-11-28' }, { p: 'Airport Transfer Sri Lanka', person: 'Wim W', start: '2026-11-21' }] })]), 'x.csv', '2026-11-17', SLC);
  const plan = B.planTrips(p.trips, [{ id: 'w', kind: 'airport_arrival', trip_date: '2026-11-21', booking_ref: '2026-77', import_key: 'bl:2026-77:arr', status: 'planned', source: 'bookinglayer', place: 'CMB', pax: 1, vehicle: 'Minivan', expected_price: 99, trip_time: '10:00', flight: 'QR664', guest_names: 'Wim W', edited_fields: ['vehicle', 'expected_price'], last_import_at: '2026-11-14' }],
    { today: '2026-11-17', exportDate: '2026-11-17', prices: () => 21000 });
  expect(plan.conflicts).toEqual([]);
});

test('«Separate» is not undone by the next import: the split-off trip and its original are never merged back, no «Bookinglayer says» on the people', () => {
  const bks = [maBooking('2026-4717', '2026-11-25', '2026-11-30', [{ name: 'Hoi Yi Law', arr: [30, 'U2 2621', '10:55'], dep: [null] }, { name: 'Tsz Yin Scarlet Tang', arr: [0, 'LS1129', '11:55'], dep: [null] }])];
  const p = B.parse(csvPriced(bks), 'x.csv', '2026-11-17', MAC);
  const base = { kind: 'airport_arrival', trip_date: '2026-11-25', booking_ref: '2026-4717', status: 'planned', source: 'bookinglayer', place: 'AGA', vehicle: 'Car', expected_price: 250 };
  const app = [
    { ...base, id: 'orig', import_key: 'bl:2026-4717:arr', pax: 1, guest_names: 'Hoi Yi Law', trip_time: '10:55', flight: 'U22621', last_import_at: '2026-11-17', edited_fields: ['pax', 'guest_names', 'vehicle', 'expected_price', 'together_split'] },
    { ...base, id: 'sep', import_key: 'bl:2026-4717:arr:sep', pax: 1, guest_names: 'Tsz Yin Scarlet Tang', trip_time: '11:55', flight: 'LS1129', charge: 'camp_tab', last_import_at: null, bl_checked_at: '2026-11-17T10:00:00Z', edited_fields: [] },
  ];
  const plan = B.planTrips(p.trips, app, { today: '2026-11-17', exportDate: '2026-11-17' });
  expect(plan.merge).toEqual([]);
  expect(plan.mergeInfo.map(m => m.why)).toEqual(['separated by hand in Transport — kept as it is']);
  expect(plan.conflicts).toEqual([]);
  expect([plan.regroupCancel, plan.flagRemoved]).toEqual([[], []]);
});

test('merge into a trip brought back on its key: the driver\'s «sent» is kept, with «changed, resend»', () => {
  const bks = [maBooking('2026-4717', '2026-11-25', '2026-11-30', [{ name: 'Hoi Yi Law', arr: [30, 'U2 2621', '10:55'], dep: [null] }, { name: 'Tsz Yin Scarlet Tang', arr: [0, 'LS1129', '11:55'], dep: [null] }])];
  const p = B.parse(csvPriced(bks), 'x.csv', '2026-11-17', MAC);
  const base = { kind: 'airport_arrival', trip_date: '2026-11-25', booking_ref: '2026-4717', source: 'bookinglayer', place: 'AGA', vehicle: 'Car', expected_price: 250, pax: 1, edited_fields: [], last_import_at: '2026-11-14' };
  const app = [{ ...base, id: 'k', import_key: 'bl:2026-4717:arr', status: 'cancelled', cancel_reason: 'split', pax: 2 },
    { ...base, id: 'h', import_key: 'bl:2026-4717:arr:hoiyilaw', status: 'sent', guest_names: 'Hoi Yi Law' },
    { ...base, id: 't', import_key: 'bl:2026-4717:arr:tszyinscarlettang', status: 'planned', guest_names: 'Tsz Yin Scarlet Tang' }];
  const [m] = B.planTrips(p.trips, app, { today: '2026-11-17', exportDate: '2026-11-17' }).merge;
  expect([m.survivor.id, m.patch.status, m.patch.needs_resend, m.others.map(a => a.id)]).toEqual(['k', 'sent', true, ['h', 't']]);
});

test('all lines at 0 € (e.g. a partner\'s transfer) = like one paid line: one trip, the guest with the most info leads, the question when times differ (Miguel, 17 Nov 2026)', () => {
  const t = trips([maBooking('2026-94', '2026-11-21', '2026-11-28', [{ name: 'Zoe Z', arr: [0, '', ''], dep: [0, 'FR184', '19:00'] }, { name: 'Yan Y', arr: [0, 'FR185', '00:05'], dep: [0, 'FR8167', '05:10'] }])]);
  expect(t.map(x => [x.key, x.pax, x.flight, x.time, x.all_zero])).toEqual([['bl:2026-94:arr', 2, 'FR185', '00:05', true], ['bl:2026-94:dep', 2, 'FR184', '19:00', true]]);
  expect(t[0].flags.some(f => TOG.test(f))).toBe(false);
  expect(t[1].flags.find(f => TOG.test(f))).toMatch(/\(Yan Y · FR8167 · 05:10\)$/);
});
