// Bookinglayer Guests export → airport trips (lib/guests-trips.js), no browser.
//
// The two real files (phones and emails replaced by fake values, structure
// kept) must give exactly what the reference parser
// sl_design/trips/guests_to_trips.py gave on them (*.expected.json), plus the
// rules that this week's data cannot show (a 2-guest booking, a booking whose
// guests fly separately) and the WhatsApp text in Miguel's fixed format.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const G = require('../lib/guests-trips.js');

const FIX = path.join(__dirname, 'fixtures');
const PRESET = 'Bookinglayer-Guests-2026-11-07 14_23';
const ALL = 'guests-13h47';
const read = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

function pythonShape(out, expected) {
  const o = {};
  for (const k of Object.keys(expected)) o[k] = out[k];
  o.trips = out.trips.map(t => { const r = {}; for (const k of Object.keys(expected.trips[0])) r[k] = t[k]; return r; });
  return o;
}

for (const name of [PRESET, ALL]) {
  test(`guests parser: ${name} gives the same trips as the reference parser`, () => {
    const out = G.parse(read(name + '.csv'), name + '.csv');
    const expected = JSON.parse(read(name + '.expected.json'));
    expect(pythonShape(out, expected)).toEqual(expected);
  });
}

test('guests parser: the 7 Nov preset — 4 trips, Lorena at night, Beliz both ways, preset detected', () => {
  const out = G.parse(read(PRESET + '.csv'), PRESET + '.csv');
  expect(out.export_date).toBe('2026-11-07');
  expect(out.is_preset).toBe(true);
  expect(out.trips.map(t => t.key)).toEqual(['bl:2026-4070:arr', 'bl:2026-4070:dep', 'bl:2026-4936:arr', 'bl:2026-4660:arr']);
  const lorena = out.trips.find(t => t.key === 'bl:2026-4660:arr');
  expect(lorena).toMatchObject({ date: '2026-11-14', time: '01:55', flight: 'QR658', pax: 1, booking_ref: '2026-4660', vehicle: 'Car' });
  expect(lorena.flags.some(f => f.startsWith('night arrival: lands 01:55 on Sat 14 Nov, driver leaves camp Fri 13 Nov'))).toBe(true);
  const beliz = out.trips.find(t => t.key === 'bl:2026-4070:arr');
  expect(beliz.boards).toBe(true);
  expect(beliz.vehicle).toBe('Minivan'); // surfboards → at least a Minivan
  expect(out.trips.find(t => t.key === 'bl:2026-4070:dep')).toMatchObject({ kind: 'airport_departure', date: '2026-11-21', booking_checkout: '2026-11-21' });
  expect(out.guests_total).toBe(18);
  expect(out.refs_active.length).toBe(16); // 18 guests in 16 bookings
});

test('guests parser: the all-locations file — 3 trips, 3 cancelled refs, duplicates and other camps counted, not a preset', () => {
  const out = G.parse(read(ALL + '.csv'), ALL + '.csv');
  expect(out.export_date).toBe(null); // no date in the name → the hub asks for it
  expect(out.is_preset).toBe(false);
  expect(out.trips.length).toBe(3);
  expect(out.cancel_refs.length).toBe(3);
  expect(out.counts['duplicate row']).toBe(2);
  expect(out.counts['other location']).toBe(38);
  const dirty = Object.fromEntries(out.dirty_no_transfer.map(d => [d[1], d[3].join(' | ')]));
  expect(dirty['Lilly Krüger']).toContain('time 13:00 typed in the flight field');
  expect(Object.values(dirty).some(f => f.includes('two times 14:00 / 02:50'))).toBe(true);
});

// Synthetic rows for rules 11 and 13 (no multi-guest transfer in this week's files).
const HEAD = '"Guest","Booking status","Booking","Arrival time","Arrival flight","Phone","Accommodations","Check-in on","Check-out on","Packages","Has transfer","Transfers","Transfer comment","Departure time","Departure flight"';
const row = (guest, ref, time, flight, transfers = 'Airport Transfer Sri Lanka, Airport Transfer Sri Lanka') =>
  `"${guest}","paid","${ref}","${time}","${flight}","+44 07700 900123","Kabalana","Sat 14 Nov 2026","Sat 21 Nov 2026","Surf Camp Ahangama","Yes","${transfers}","",""`;

test('guests parser: two guests of one booking on the same flight → one trip, 2 persons', () => {
  const csv = [HEAD, row('Ana Silva', '2026-9001', '10:30', 'QR 668'), row('Rui Chaves', '2026-9001', '10:30', 'QR668')].join('\n');
  const out = G.parse(csv, 'Bookinglayer-Guests-2026-11-13 10_00.csv');
  const arr = out.trips.filter(t => t.kind === 'airport_arrival');
  expect(arr.length).toBe(1);
  expect(arr[0]).toMatchObject({ key: 'bl:2026-9001:arr', pax: 2, guests: ['Ana Silva', 'Rui Chaves'], flight: 'QR668', phone: '+447700900123' });
});

test('guests parser: guests of one booking on different flights → one trip each with a :name key', () => {
  const csv = [HEAD, row('Ana Silva', '2026-9002', '10:30', 'QR668'), row('Rui Chaves', '2026-9002', '22:05', 'EK650')].join('\n');
  const out = G.parse(csv, 'x-2026-11-13.csv');
  const keys = out.trips.filter(t => t.kind === 'airport_arrival').map(t => t.key);
  expect(keys).toEqual(['bl:2026-9002:arr:anasilva', 'bl:2026-9002:arr:ruichaves']);
  expect(out.trips[0].flags).toContain('guests of this booking travel separately');
});

test('guests parser: a multi-line Transfer comment does not break the rows', () => {
  const csv = [HEAD, `"Ana Silva","paid","2026-9003","09:00","QR1","","Kabalana","Sat 14 Nov 2026","Sat 21 Nov 2026","Surf Camp Ahangama","Yes","Airport Transfer Sri Lanka","please wait\nwe have bags",""`, row('Rui Chaves', '2026-9004', '11:00', 'QR2')].join('\r\n');
  const out = G.parse(csv, 'x.csv');
  expect(out.trips.map(t => t.booking_ref)).toEqual(['2026-9003', '2026-9004', '2026-9004']);
});

test('guests header sniff: a Guests export is recognised, a bookings export is not', () => {
  expect(G.isGuestsExportHeader(read(PRESET + '.csv'))).toBe(true);
  expect(G.isGuestsExportHeader(read(ALL + '.csv'))).toBe(true);
  expect(G.isGuestsExportHeader('"Booking #","Booker","Check-in on","Status","Total"\n"2026-1","A","Sat 14 Nov 2026","paid","999"')).toBe(false);
});

test('whatsapp text: Miguel\'s format, one field per line; the whole day is blocks separated by a blank line', () => {
  const lorena = { kind: 'airport_arrival', guest_names: 'Lorena Marie Glas', guest_phone: '+491700000000', pax: 1, flight: 'QR658', trip_time: '01:55', trip_date: '2026-11-14', vehicle: 'Car' };
  expect(G.whatsappText(lorena)).toBe('Airport to Camp\nLorena Marie Glas\n+491700000000\n1 person\nFlight Number: QR658\nTime: 01:55\nDate: 14 Nov\nSmall Car');
  const beliz = { kind: 'airport_departure', guest_names: 'Beliz Kuyumcuoglu', guest_phone: '', pax: 2, flight: '', trip_time: null, trip_date: '2026-02-25', vehicle: 'Minivan' };
  expect(G.whatsappText(beliz)).toBe('Camp to Airport\nBeliz Kuyumcuoglu\nTBC\n2 persons\nFlight Number: TBC\nTime: TBC\nDate: 25 Feb\nMinivan');
  expect(G.whatsappDayText([lorena, beliz]).split('\n\n').length).toBe(2);
  expect(G.whatsappUrl('+94 77 123 4567', 'a b')).toBe('https://wa.me/94771234567?text=a%20b');
  expect(G.whatsappUrl('', 'x')).toBe('https://wa.me/?text=x');
});

test('dates: Sat–Fri week start and day arithmetic never go through a time zone', () => {
  expect(G.weekStart('2026-11-14')).toBe('2026-11-14'); // Saturday
  expect(G.weekStart('2026-11-20')).toBe('2026-11-14'); // Friday
  expect(G.weekStart('2026-11-16')).toBe('2026-11-14'); // Monday
  expect(G.addDaysIso('2026-03-29', 1)).toBe('2026-03-30'); // DST change in Europe
});

test('guest rows (for the weekly staff lists): one normalised row per Sri Lanka guest, duplicates once', () => {
  const preset = G.guestRows(read(PRESET + '.csv'), PRESET + '.csv');
  expect(preset.length).toBe(18);
  expect(preset.every(g => g.week_start === '2026-11-14')).toBe(true);
  const lorena = preset.find(g => g.booking_ref === '2026-4660');
  expect(lorena).toMatchObject({ guest_name: 'Lorena Marie Glas', check_in: '2026-11-14', check_out: '2026-11-21', bed_number: '4', nights: 7,
    arrival_time: '01:55', arrival_flight: 'QR 658', has_transfer: true, booking_status: 'confirmed', level: 'Beginner level' });
  expect(lorena.accommodation).toContain('Unawatuna');
  expect(lorena.raw['Diet (2)']).toBeDefined(); // the second «Diet» column is kept in raw
  expect(preset.filter(g => g.has_transfer).length).toBe(3);
  const all = G.guestRows(read(ALL + '.csv'), ALL + '.csv');
  expect(all.length).toBe(21); // 23 Sri Lanka rows − 2 exact duplicates; 38 other-camp rows left out
  const byStatus = all.reduce((m, g) => (m[g.booking_status] = (m[g.booking_status] || 0) + 1, m), {});
  expect(byStatus).toEqual({ paid: 14, confirmed: 4, expired: 3 });
  // Allergy columns merge, «No»/«-» dropped; the two Diet columns join.
  const head = '"Guest","Booking status","Booking","Packages","Check-in on","Check-out on","Diet","Diet","Allergies / Intolerance","Allergies","Allergies indications"';
  const one = G.guestRows(head + '\n"Ana","paid","2026-1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","Vegetarian","Gluten free","Nuts","No","nuts, severe"', 'x.csv')[0];
  expect(one.diet).toBe('Vegetarian / Gluten free');
  expect(one.allergies).toBe('Nuts / nuts, severe');
});

test('guest rows: partner («don\'t charge») from Booking due > 0, named by the email domain and carried to the whole booking', () => {
  const head = '"Guest","Booking status","Booking","Packages","Check-in on","Check-out on","Booking due","Email"';
  const rows = G.guestRows([head,
    '"Ana","paid","2026-1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","599.00","ana@oceanadventure.surf"',
    '"Rui","paid","2026-1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","599.00",""',
    '"Eva","paid","2026-2","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","0.00","eva@gmail.com"'].join('\n'), 'x.csv');
  expect(rows.map(g => [g.guest_name, g.partner, g.booking_due])).toEqual([['Ana', 'Ocean Adventure', 599], ['Rui', 'Ocean Adventure', 599], ['Eva', '', 0]]);
  expect(rows[0].email).toBeUndefined(); // the email stays only in raw
});
