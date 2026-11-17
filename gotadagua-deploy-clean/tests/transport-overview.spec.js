// Transport → Overview (16 Nov 2026; v2 the same day): the pure aggregation (lib/transport-overview.js), no browser.
// Invented trips and ledger lines; the camp settings are the real lib/camp-config.js.
const { test, expect } = require('@playwright/test');
const O = require('../lib/transport-overview.js');
const CC = require('../lib/camp-config.js');

let n = 0;
const trip = o => ({ id: `t${++n}`, kind: 'airport_arrival', trip_date: '2026-11-10', trip_time: '10:00', place: 'AGA', pax: 1, expected_price: 250, status: 'planned', payment_entry_id: null, route: null, purpose: 'guests', tour_name: null, ...o });
const run = (route, o = {}) => trip({ kind: 'other', route, place: null, purpose: (CC.MA.vanRates.find(r => r.route === route) || {}).purpose || 'surf', ...o });
const led = (date, description, amount, linkedItem = '', o = {}) => ({ id: `l${++n}`, type: 'expense', category: 'Transport', businessArea: 'Transport', date, description, amountLocal: amount, linkedItem, quantity: 1, ...o });
const SL_DRIVERS = [{ id: 's1', name: 'Dilan', aliases: ['Dilan'], kinds: ['airport', 'other'] }, { id: 's2', name: 'Sampath', aliases: ['Sampath'], kinds: ['tuktuk'] }, { id: 's3', name: 'Nishantha', aliases: ['Nishantha'], kinds: ['airport'] }, { id: 's4', name: 'Nadith', kinds: ['contact'] }];
const DRIVERS = [{ id: 'd1', name: 'Let Us Tours', aliases: ['LUT'], kinds: ['airport'] }, { id: 'd2', name: 'Fathoune', aliases: ['Mounir'], kinds: ['van'] }, { id: 'd3', name: 'Floriane', kinds: ['contact'] }];
const NOW = '2026-11-16T12:00';
const MA = { trips: [], drivers: DRIVERS, cfg: CC.MA, goLive: '2026-10-01', now: NOW };
const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);

test('overview: types — airport arrivals / departures (split by airport only when there are several), van runs by vanRates label, tours, other; Sri Lanka tuk-tuks', () => {
  expect(O.classify(trip({}), CC.MA)).toMatchObject({ group: 'arr', key: 'arr:AGA' });
  expect(O.classify(trip({ kind: 'airport_departure', place: 'RAK' }), CC.MA)).toMatchObject({ group: 'dep', key: 'dep:RAK' });
  expect(O.classify(run('Surf'), CC.MA)).toMatchObject({ group: 'runs', label: 'Surf Taghazout' });
  expect(O.classify(run('Tamri / Anza'), CC.MA)).toMatchObject({ group: 'runs', label: 'Surf Tamri / Anza' });
  expect(O.classify(run('Paradise + Souk'), CC.MA)).toMatchObject({ group: 'tours', label: 'Paradise + Souk' });
  expect(O.classify(run(null, { purpose: null }), CC.MA)).toMatchObject({ group: 'other', label: 'Other' });
  expect(O.classify(trip({ kind: 'tuktuk', route: 'Weligama', purpose: 'surf', place: null }), CC.SL)).toMatchObject({ group: 'runs', label: 'Surf · Weligama' });
  expect(O.classify(trip({ kind: 'tuktuk', route: 'Market / food', purpose: 'food', place: null }), CC.SL)).toMatchObject({ group: 'runs', label: 'Market / food' });
  expect(O.classify(trip({ kind: 'tuktuk', route: 'Galle', purpose: 'tour', tour_name: 'Galle Fort', place: null }), CC.SL)).toMatchObject({ group: 'tours', label: 'Galle Fort' });
  expect(O.classify(trip({ kind: 'other', route: 'x', place: null }), CC.SL)).toMatchObject({ group: 'other' });
  expect(O.period('week', '2026-11-14')).toMatchObject({ from: '2026-11-14', to: '2026-11-20' });
  expect(O.period('month', '2026-02')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  expect([O.shift('month', '2026-12', 1), O.shift('month', '2026-01', -1), O.shift('week', '2026-11-14', -1), O.shift('year', '2026', 1)]).toEqual(['2027-01', '2025-12', '2026-11-07', '2027']);
});

test('overview v2: a ledger line is read like a person would — route → kind, tuk-tuk words, airport item, the supplier named, a route said in words, else «Fuel & other» named by what it is', () => {
  const c = (e, cfg = CC.MA, d = DRIVERS) => { const x = O.classifyLine(e, cfg, d); return [x.kind, x.part, x.supplier]; };
  // Morocco: the weekly van lines (no description) are the route's; the supplier is the camp's van supplier.
  expect(c(led('2026-05-01', '', 8800, 'Surf'))).toEqual(['vans', 'Surf Taghazout', 'Fathoune']);
  expect(c(led('2026-05-05', '', 880, 'Dunes'))).toEqual(['tours', 'Dunes', 'Fathoune']);
  expect(c(led('2026-07-01', '+Souk', 1430, 'Paradise Valley'))).toEqual(['tours', 'Paradise + Souk', 'Fathoune']);
  expect(c(led('2026-05-06', 'Fathoune Mounir — transport, trips until 20 Apr', 30800))).toEqual(['vans', 'Fathoune lump sum', 'Fathoune']);
  expect(c(led('2026-05-06', 'April · Let Us Tours (bank statement)', 20000, 'Airport'))).toEqual(['airport', 'Monthly invoice', 'Let Us Tours']);
  expect(c(led('2026-10-12', 'September · Let Us Tours — airport transfers', 15000))).toEqual(['airport', 'Monthly invoice', 'Let Us Tours']);
  expect(c(led('2026-01-22', 'Atlas Vans — Transporte SURF', 19000))).toEqual(['vans', 'Surf Taghazout', 'Atlas Vans']);
  expect(c(led('2026-04-05', 'Afriquia — car diesel', 800))).toEqual(['other', 'Fuel', '']);
  expect(c(led('2026-02-09', 'Example Car — car rental', 4000))).toEqual(['other', 'Car rental', '']);
  expect(c(led('2026-02-25', 'Example Tours · old sheet', 14000))).toEqual(['other', 'Example Tours', '']);
  // Sri Lanka: tuk-tuk words, the «Transport Surf Lesson» item, the driver's kind, scooter fuel.
  expect(c(led('2026-10-28', 'Sampath For Tuk Tuks (12/10-24/10)', 120000), CC.SL, SL_DRIVERS)).toEqual(['tuktuk', 'Payments to Sampath', 'Sampath']);
  expect(c(led('2026-08-16', 'Tuk Payments', 45000), CC.SL, SL_DRIVERS)).toEqual(['tuktuk', 'Tuk-tuk payments', 'Sampath']);   // the camp's only tuk-tuk driver
  expect(c(led('2026-11-03', 'Sampath 25/10-31/10', 90000, 'Transport Surf Lesson'), CC.SL, SL_DRIVERS)).toEqual(['tuktuk', 'Payments to Sampath', 'Sampath']);
  expect(c(led('2026-09-20', 'Dilan', 80000), CC.SL, SL_DRIVERS)).toEqual(['airport', 'Payments to Dilan', 'Dilan']);
  expect(c(led('2026-09-01', 'Host Example (Social Host)', 20000, 'Airport → Surfcamp'), CC.SL, SL_DRIVERS)).toEqual(['airport', 'Other payments', '']);   // two airport drivers: nobody guessed
  expect(c(led('2026-09-04', 'Fuel For Scooter', 1500), CC.SL, SL_DRIVERS)).toEqual(['other', 'Fuel', '']);
});

test('overview v2: a monthly airport invoice counts in the month it names (at most two months back); every other line on its date', () => {
  expect(O.serviceDate(led('2026-05-06', 'April · Let Us Tours', 1))).toBe('2026-04-30');
  expect(O.serviceDate(led('2026-06-30', 'June', 1))).toBe('2026-06-30');
  expect(O.serviceDate(led('2027-01-05', 'December · Let Us Tours', 1))).toBe('2026-12-31');
  expect(O.serviceDate(led('2026-09-10', 'May', 1))).toBe('2026-09-10');                        // too far back: not a month tag
  expect(O.serviceDate(led('2026-05-06', 'Let Us Tours April', 1))).toBe('2026-05-06');          // only a month at the start
});

// A month before the trip list, shaped like Morocco's May (invented amounts): weekly van lines per route (N × 110), one van lump
// sum, the previous month's airport invoice paid in it; this month's invoice is paid the next month.
function mayLedger() {
  return [led('2026-05-01', '', 8800, 'Surf'), led('2026-05-05', '', 990, 'Dunes'), led('2026-05-06', 'Fathoune Mounir — trips until 20 Apr (one payment)', 30800),
    led('2026-05-06', 'April · Let Us Tours', 20000, 'Airport'), led('2026-05-08', '', 1430, 'Paradise Valley'), led('2026-05-08', '', 4400, 'Surf'), led('2026-05-12', '', 770, 'Dunes'),
    led('2026-05-15', '', 5500, 'Surf'), led('2026-05-19', '', 1650, 'Dunes'), led('2026-05-22', '', 9900, 'Surf'), led('2026-05-26', '', 880, 'Dunes'), led('2026-05-29', '', 6600, 'Surf'), led('2026-05-30', '', 2200, 'Surf'),
    { ...led('2026-05-19', '3 people offer', 600, 'Dunes — Sandboarding', { quantity: 12 }), category: 'Tours & activities', businessArea: 'Tours' },   // a tour's cost, not transport
    led('2026-06-10', 'May', 22000, 'Airport')];
}
test('overview v2: an old month reads like a new one — Airport · Surf vans · Tours with people (N × 110) and per person; the lump sum has no head count; drivers add up to the total', () => {
  const C = O.collect({ ...MA, ledger: mayLedger() });
  const V = O.view(C, O.period('month', '2026-05'), CC.MA);
  expect(V.total.cost).toBe(95920);                                                       // April's invoice out, May's (paid 10 Jun) in
  expect(V.total.trips).toBe(0);
  expect(V.kinds.map(k => [k.label, k.cost, k.people, k.perPerson])).toEqual([['Airport', 22000, 0, null], ['Surf vans', 68200, 340, 110], ['Tours', 5720, 52, 110]]);
  expect(V.kinds[1].parts.map(p => [p.label, p.cost, p.people])).toEqual([['Surf Taghazout', 37400, 340], ['Fathoune lump sum', 30800, 0]]);
  expect(V.kinds[0].parts.map(p => p.label)).toEqual(['Monthly invoice']);
  expect(V.suppliers.map(s => [s.label, s.cost, s.payments, s.lastPaid])).toEqual([['Fathoune', 73920, 12, '2026-05-30'], ['Let Us Tours', 22000, 1, '2026-06-10']]);
  expect(sum(V.kinds, 'cost')).toBe(V.total.cost);
  expect(sum(V.suppliers, 'cost')).toBe(V.total.cost);
  expect(O.view(C, O.period('month', '2026-04'), CC.MA).total.cost).toBe(20000);
  expect(O.view(C, O.period('month', '2026-06'), CC.MA).empty).toBe(true);
  expect(C.start).toEqual({ airport: null, vans: null, tours: null });
  // One trip list per driver: the first van run (a tour) starts it for the surf vans too, so a later lump sum is «paid for earlier trips».
  const C2 = O.collect({ ...MA, trips: [run('Dunes', { trip_date: '2026-11-15', status: 'done', driver_id: 'd2' })], ledger: [led('2026-11-20', 'Fathoune Mounir — October runs', 5000)] });
  expect(C2.start).toEqual({ airport: null, vans: '2026-11-15', tours: '2026-11-15' });
  expect(O.view(C2, O.period('month', '2026-11'), CC.MA).suppliers.find(s => s.label === 'Fathoune')).toMatchObject({ cost: 250, earlier: 5000 });
});

test('overview v2: after the trip list — trips are the cost; an unlinked payment for earlier trips is «Paid» only (never cost twice); a linked one never shows; fuel is always cost; a kind with no trips yet keeps its payments as cost', () => {
  const air = trip({ trip_date: '2026-10-10', status: 'done', expected_price: 16000, driver_id: 'd1' });
  const ledger = [led('2026-10-12', 'Let Us Tours transfers', 16000), led('2026-10-13', 'Afriquia diesel', 300), { ...led('2026-10-20', 'Let Us Tours', 500), id: 'linked-1' },
    led('2026-10-03', '', 3850, 'Surf'), led('2026-10-12', 'September · Let Us Tours', 15000)];
  const C = O.collect({ ...MA, trips: [air], ledger, linked: ['linked-1'] });
  expect(C.start.airport).toBe('2026-10-10');
  const V = O.view(C, O.period('month', '2026-10'), CC.MA);
  expect(V.kinds.map(k => [k.kind, k.cost, k.trips, k.fromPayments])).toEqual([['airport', 16000, 1, 0], ['vans', 3850, 0, 3850], ['other', 300, 0, 300]]);
  const lut = V.suppliers.find(s => s.label === 'Let Us Tours');
  expect(lut).toMatchObject({ cost: 16000, owed: 16000, earlier: 16000, trips: 1 });           // the trip once; the payment «for earlier trips»
  expect(V.suppliers.find(s => s.label === 'Fathoune')).toMatchObject({ cost: 3850, earlier: 0 });   // no van trips yet: the van line is the cost
  // «September · Let Us Tours» paid 12 Oct belongs to September, before the trip list: September's airport cost.
  expect(O.view(C, O.period('month', '2026-09'), CC.MA).kinds.map(k => [k.kind, k.cost])).toEqual([['airport', 15000]]);
  // Owed now: the one rule (a custom isOwed wins).
  expect(O.owedNow(C)).toEqual({ total: 16000, rows: [{ driverId: 'd1', label: 'Let Us Tours', amount: 16000, trips: 1 }] });
  expect(O.owedNow(O.collect({ ...MA, trips: [air], isOwed: () => false })).total).toBe(0);
});

test('overview v2: trips — kinds with their parts, trips, people, owed, to come; no-show counted, cancelled and merged out; Sri Lanka\'s November merges payments (1–13) and trips (from 14) in the same rows', () => {
  const trips = [
    trip({ trip_date: '2026-11-02', pax: 2, expected_price: 300, status: 'done', payment_entry_id: 'p1', driver_id: 'd1' }),
    trip({ trip_date: '2026-11-05', status: 'confirmed', driver_id: 'd1' }), trip({ trip_date: '2026-11-06', status: 'no_show', driver_id: 'd1' }),
    trip({ trip_date: '2026-11-20', driver_id: 'd1' }), trip({ trip_date: '2026-11-21', place: 'RAK', expected_price: 1200, driver_id: 'd1' }),
    trip({ trip_date: '2026-11-07', status: 'cancelled' }), trip({ trip_date: '2026-11-08', status: 'merged' }), trip({ trip_date: '2026-11-09', kind: 'airport_departure', driver_id: 'd1' }),
    run('Surf', { trip_date: '2026-11-03', pax: 6, expected_price: 500, status: 'done', driver_id: 'd2' }), run('Dunes', { trip_date: '2026-11-11', pax: 8, expected_price: 700, status: 'done', payment_entry_id: 'p2', driver_id: 'd2' }),
  ];
  const V = O.view(O.collect({ ...MA, trips }), O.period('month', '2026-11'), CC.MA);
  expect(V.total).toMatchObject({ trips: 8, people: 21, cost: 3700, paid: 1000, owed: 1000, toCome: 1450, noShow: 1, perPerson: 176 });
  expect(V.kinds.map(k => [k.label, k.trips, k.cost, k.owed, k.perPerson])).toEqual([['Airport', 6, 2500, 500, 357], ['Surf vans', 1, 500, 500, 83], ['Tours', 1, 700, 0, 88]]);
  expect(V.kinds[0].parts.map(p => [p.label, p.trips])).toEqual([['Arrivals', 5], ['Departures', 1]]);
  expect(V.suppliers.map(s => [s.label, s.cost, s.owed, s.toCome])).toEqual([['Let Us Tours', 2500, 500, 1450], ['Fathoune', 1200, 500, 0]]);
  // Sri Lanka, go-live 14 Nov: the payments of 1–13 and the trips of 14–30 are one «Airport» row; a trip before go-live is not counted.
  const sl = O.collect({ trips: [trip({ trip_date: '2026-11-10', place: 'CMB', expected_price: 21000 }), trip({ trip_date: '2026-11-16', place: 'CMB', expected_price: 21000, driver_id: 's1' })],
    ledger: [led('2026-11-05', 'Dilan airport', 42000), led('2026-11-16', 'Dilan airport', 21000)], drivers: SL_DRIVERS, cfg: CC.SL, goLive: '2026-11-14', now: NOW });
  const S = O.view(sl, O.period('month', '2026-11'), CC.SL);
  expect(S.kinds.map(k => [k.label, k.cost, k.trips, k.fromPayments])).toEqual([['Airport', 63000, 1, 42000]]);
  expect(S.suppliers).toEqual([expect.objectContaining({ label: 'Dilan', cost: 63000, earlier: 21000, trips: 1, payments: 2 })]);
});

test('overview v2: year by month × kind, up or down against the period before and a year earlier, the CSV with euros last', () => {
  const trips = [trip({ trip_date: '2026-10-05', pax: 2, expected_price: 300 }), trip({ trip_date: '2026-11-05' }), run('Surf', { trip_date: '2026-11-06', pax: 5, expected_price: 500 })];
  const C = O.collect({ ...MA, trips, ledger: [led('2025-11-20', '', 1100, 'Surf'), led('2026-08-03', '', 4400, 'Surf'), led('2026-09-03', 'Afriquia diesel', 100)] });
  const Y = O.yearView(C, '2026', CC.MA);
  expect(Y.rows.map(r => [r.label, r.total.cost])).toEqual([['Airport', 550], ['Surf vans', 4900], ['Fuel & other', 100]]);
  expect(Y.rows[1].people.slice(7, 11)).toEqual([40, 0, 0, 5]);                                      // 4,400 ÷ 110
  expect(Y.rows[2].people[8]).toBe(null);                                                            // fuel: no head count
  expect(Y.totals.cost.slice(7, 11)).toEqual([4400, 100, 300, 750]);
  expect(O.compare(C, O.period('month', '2026-11'))).toEqual({ prev: { anchor: '2026-10', name: 'October 2026', cost: 300, pct: 150 }, lastYear: { anchor: '2025-11', name: 'November 2025', cost: 1100, pct: -32 } });
  expect(O.compare(C, O.period('month', '2026-08')).prev).toBe(null);                               // nothing in July: no comparison
  const t = O.yearTable(Y, 'cost', 'MAD', 10);
  expect(t[0]).toEqual(['Cost (MAD)', ...O.MON, 'Total', 'Total (EUR)']);
  expect(t[t.length - 1]).toEqual(['Total', 0, 0, 0, 0, 0, 0, 0, 4400, 100, 300, 750, 0, 5550, 555]);
  expect(O.yearTable(Y, 'people', 'MAD')[3]).toEqual(['Fuel & other', 0, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, 0]);
  const V = O.view(C, O.period('month', '2026-11'), CC.MA);
  const csv = O.viewTable(V, 'MAD', 10);
  expect(csv[0]).toEqual(['Kind', 'Detail', 'Trips', 'People', 'Cost (MAD)', 'Paid (MAD)', 'Owed (MAD)', 'Cost per person (MAD)', 'From payments (MAD)', 'Cost (EUR)', 'Paid (EUR)', 'Owed (EUR)']);
  expect(csv.find(r => r[0] === 'Total')).toEqual(['Total', '', 2, 6, 750, 0, 750, 125, 0, 75, 0, 75]);
  expect(csv.some(r => r[0] === 'Driver / supplier')).toBe(true);
});

test('overview: euros — one rate per period from the camp\'s ledger (median of amount_local / amount_eur), out-of-range rows skipped (the 389.63 «MAD» row), fallbacks range-checked', () => {
  const L = (date, local, eurAmt, currency = 'MAD') => ({ date, amountLocal: local, amount: eurAmt, currency });
  const ledger = [L('2026-11-02', 1080, 100), L('2026-11-03', 2160, 200), L('2026-11-04', 38963, 100), L('2026-11-05', 100, 100, 'EUR'), L('2026-10-01', 1100, 100)];
  expect(O.eurRate({ ledger, cur: 'MAD', from: '2026-11-01', to: '2026-11-30' })).toEqual({ rate: 10.8, source: 'period', n: 2, skipped: 1 });
  expect(O.eurRate({ ledger, cur: 'MAD', from: '2026-12-01', to: '2026-12-31' })).toMatchObject({ rate: 10.8, source: 'ledger', n: 3 });
  expect(O.eurRate({ ledger: [L('2026-11-04', 38963, 100)], cur: 'MAD', from: '2026-11-01', to: '2026-11-30', fallback: 389.63, defaultRate: 10.5 })).toMatchObject({ rate: 10.5, source: 'default' });
  expect(O.eurRate({ ledger: [], cur: 'MAD', fallback: 10.9 })).toMatchObject({ rate: 10.9, source: 'app' });
  expect(O.eurRate({ ledger: [L('2026-11-02', 34000, 100, 'LKR')], cur: 'LKR', from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ rate: 340, source: 'period' });
  expect(O.eur(21050, 10.8)).toBe(1949);
});

test('overview: the week is Transport\'s week (Sat–Fri, the closing Saturday\'s departures in, the opening Saturday\'s out)', () => {
  const trips = [trip({ trip_date: '2026-11-14' }), trip({ trip_date: '2026-11-14', kind: 'airport_departure' }), trip({ trip_date: '2026-11-21', kind: 'airport_departure' }), trip({ trip_date: '2026-11-21' })];
  const V = O.view(O.collect({ trips, cfg: CC.MA, goLive: '2026-10-01', now: NOW }), O.period('week', '2026-11-14'), CC.MA);
  expect(V.kinds[0].parts.map(p => [p.label, p.trips])).toEqual([['Arrivals', 1], ['Departures', 1]]);
});


test('overview: Morocco van runs with no head count (17 Nov 2026: «People in the van» removed) — people unknown, the kind\'s «per person» hides; airport keeps its people', () => {
  const runs = [run('Surf', { pax: null, status: 'done', driver_id: 'd2', expected_price: 500, trip_date: '2026-11-12' }), run('Dunes', { pax: null, status: 'done', driver_id: 'd2', expected_price: 700, trip_date: '2026-11-12' })];
  const air = trip({ status: 'done', driver_id: 'd1', pax: 2, expected_price: 250, trip_date: '2026-11-12' });
  const C = O.collect({ ...MA, trips: [...runs, air] });
  expect(C.items.filter(i => i.src === 'trip' && i.kind !== 'airport').map(i => i.people)).toEqual([null, null]);
  const V = O.view(C, O.period('month', '2026-11'), CC.MA);
  const k = kd => V.kinds.find(x => x.kind === kd);
  expect([k('vans').cost, k('vans').people, k('vans').perPerson]).toEqual([500, 0, null]);
  expect([k('tours').cost, k('tours').people, k('tours').perPerson]).toEqual([700, 0, null]);
  expect([k('airport').people, k('airport').perPerson]).toEqual([2, 125]);
});

test('surf vans per SURFER-DAY (17 Nov 2026): surfers from the guests\' Bookinglayer lessons — dated day lessons on their date, a course Mon–Fri while in camp (from its date when it has one), once a day; cost ÷ surfer-days', () => {
  const g = (name, ci, co, raw, o = {}) => ({ booking_ref: 'R-' + name, guest_key: name.toLowerCase(), guest_name: name, check_in: ci, check_out: co, booking_status: 'paid', raw, ...o });
  const guests = [
    g('Ann', '2026-11-01', '2026-11-08', { lessons: [], courses: [{ type: 'standard', date: null }] }),                    // Mon 2 – Fri 6 = 5
    g('Bob', '2026-11-01', '2026-11-08', { lessons: [{ date: '2026-11-03', type: 'intensive' }, { date: '2026-11-07', type: 'standard' }], courses: [] }),   // Tue 3, Sat 7 = 2
    g('Cy', '2026-11-01', '2026-11-08', { lessons: [{ date: '2026-11-04', type: 'standard' }], courses: [{ type: 'standard', date: '2026-11-04' }] }),       // Wed 4 – Fri 6 = 3 (the lesson on the 4th counts once)
    g('Dee', '2026-11-01', '2026-11-08', { lessons: [], courses: [{ type: 'standard', date: null }] }, { booking_status: 'cancelled' }),                       // not counted
    g('Eve', '2026-11-05', '2026-11-12', { source: 'guests' }, { activities: 'Surf Course Standard' }),                                                       // older row: Week's rule → Thu 5, Fri 6, Mon 9 – Wed 11 = 5
  ];
  const sd = O.surferDays(guests, '2026-11-01', '2026-11-15', { courseDays: CC.MA.surfCourseDays, ok: x => x.booking_status !== 'cancelled', hasCourse: x => /surf course/i.test(x.activities || '') });
  expect(Object.entries(sd.byDay).filter(([, n]) => n).map(([d, n]) => `${d.slice(8)}:${n}`)).toEqual(['02:1', '03:2', '04:2', '05:3', '06:3', '07:1', '09:1', '10:1', '11:1']);
  expect(sd.total).toBe(15);
  expect(CC.MA.surfCourseDays).toEqual([1, 2, 3, 4, 5]);
  const C = O.collect({ ...MA, trips: [run('Surf', { trip_date: '2026-11-03', status: 'done', expected_price: 500 }), run('Surf', { trip_date: '2026-11-05', status: 'done', expected_price: 700 }),
    run('Surf', { trip_date: '2026-11-14', status: 'done', expected_price: 300 }), run('Dunes', { trip_date: '2026-11-05', status: 'done', expected_price: 800 })] });
  const r = O.perSurferDay(C, O.period('month', '2026-11'), sd);
  // vans only (Dunes is a tour); the 14th has no surfer in the list → left out, said apart
  expect(r).toEqual({ cost: 1200, surferDays: 15, per: 80, uncovered: 300, days: 2 });
});
