// Transport → Overview (16 Nov 2026): the pure aggregation (lib/transport-overview.js), no browser.
// Invented trips and ledger lines; the camp settings are the real lib/camp-config.js.
const { test, expect } = require('@playwright/test');
const O = require('../lib/transport-overview.js');
const CC = require('../lib/camp-config.js');

let n = 0;
const trip = o => ({ id: `t${++n}`, kind: 'airport_arrival', trip_date: '2026-11-10', trip_time: '10:00', place: 'AGA', pax: 1, expected_price: 250, status: 'planned', payment_entry_id: null, route: null, purpose: 'guests', tour_name: null, ...o });
const run = (route, o = {}) => trip({ kind: 'other', route, place: null, purpose: (CC.MA.vanRates.find(r => r.route === route) || {}).purpose || 'surf', ...o });
const led = (date, description, amount) => ({ id: `l${++n}`, type: 'expense', category: 'Transport', date, description, amountLocal: amount });
const DRIVERS = [{ id: 'd1', name: 'Let Us Tours', aliases: ['LUT'], kinds: ['airport'] }, { id: 'd2', name: 'Fathoune', aliases: ['Mounir'], kinds: ['van'] }, { id: 'd3', name: 'Floriane', kinds: ['contact'] }];
const NOW = '2026-11-16T12:00';

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

test('overview: month summary — trips, people, cost, paid, owed (done, unpaid, not a no-show = «Owed to drivers»), per person, no-show counted, cancelled and merged out, a total', () => {
  const trips = [
    trip({ trip_date: '2026-11-02', pax: 2, expected_price: 300, status: 'done', payment_entry_id: 'p1' }),     // paid
    trip({ trip_date: '2026-11-05', status: 'confirmed' }),                                                  // passed → owed
    trip({ trip_date: '2026-11-06', status: 'no_show' }),                                                    // no-show: counted, not owed (QA 16 Nov 2026: = reconcileStatus)
    trip({ trip_date: '2026-11-20', status: 'planned' }),                                                    // to come: cost only
    trip({ trip_date: '2026-11-21', place: 'RAK', expected_price: 1200 }),                                   // a second airport → split
    trip({ trip_date: '2026-11-07', status: 'cancelled' }), trip({ trip_date: '2026-11-08', status: 'merged' }),
    trip({ trip_date: '2026-11-09', kind: 'airport_departure', expected_price: 250 }),
    run('Surf', { trip_date: '2026-11-03', pax: 6, expected_price: 500, status: 'done' }), run('Surf', { trip_date: '2026-11-04', pax: 4, expected_price: 300, status: 'done' }),
    run('Dunes', { trip_date: '2026-11-11', pax: 8, expected_price: 700, status: 'done', payment_entry_id: 'p2' }),
    trip({ trip_date: '2026-10-31' }), trip({ trip_date: '2026-12-01' }),                                     // other months
  ];
  const s = O.summary({ trips, ledger: [led('2026-11-02', 'Let Us Tours', 999)], drivers: DRIVERS, cfg: CC.MA, mode: 'month', from: '2026-11-01', to: '2026-11-30', goLive: '2026-10-01', now: NOW });
  expect(s.rows.map(r => [r.label, r.trips, r.people, r.cost, r.paid, r.owed, r.perPerson, r.noShow])).toEqual([
    ['Arrivals · Agadir', 4, 5, 1050, 300, 250, 210, 1],
    ['Arrivals · Marrakech', 1, 1, 1200, 0, 0, 1200, 0],
    ['Departures', 1, 1, 250, 0, 250, 250, 0],
    ['Surf Taghazout', 2, 10, 800, 0, 800, 80, 0],
    ['Dunes', 1, 8, 700, 700, 0, 88, 0],
  ]);
  expect(s.total).toEqual({ trips: 9, people: 25, cost: 4000, paid: 1000, owed: 1300, noShow: 1, perPerson: 160 });
  expect(s.ledger.rows).toEqual([]);                                                // after go-live: the ledger is not counted again
  // One airport only → «Arrivals», no city.
  const one = O.summary({ trips: trips.filter(t => t.place !== 'RAK'), cfg: CC.MA, mode: 'month', from: '2026-11-01', to: '2026-11-30', goLive: '2026-10-01', now: NOW });
  expect(one.rows[0].label).toBe('Arrivals');
  // The CSV is the table: header, the rows, the total.
  const tbl = O.summaryTable(s, 'MAD');
  expect(tbl[0]).toEqual(['Type', 'Group', 'Trips', 'People', 'Cost (MAD)', 'Paid (MAD)', 'Owed (MAD)', 'Cost per person (MAD)', 'No-show']);
  expect(tbl[tbl.length - 1]).toEqual(['Total', '', 9, 25, 4000, 1000, 1300, 160, 1]);
  // With a rate, the euros are appended last (16 Nov 2026).
  const te = O.summaryTable(s, 'MAD', 10);
  expect(te[0].slice(-3)).toEqual(['Cost (EUR)', 'Paid (EUR)', 'Owed (EUR)']);
  expect(te[te.length - 1].slice(-3)).toEqual([400, 100, 130]);
  // By kind = the page's pills; parts under each; the big numbers.
  const K = O.byKind(s, CC.MA);
  expect(K.map(k => [k.kind, k.label, k.trips, k.cost, k.owed])).toEqual([['airport', 'Airport', 6, 2500, 500], ['vans', 'Surf vans', 2, 800, 800], ['tours', 'Tours', 1, 700, 0]]);
  expect(K[0].parts).toEqual([{ label: 'Arrivals', trips: 5 }, { label: 'Departures', trips: 1 }]);
  expect(O.headline(s)).toMatchObject({ cost: 4000, paid: 1000, owed: 1300, trips: 9, people: 25, perPerson: 160 });
  // By driver, the same owed rule (a custom isOwed wins).
  const D = O.byDriver({ trips, drivers: DRIVERS, cfg: CC.MA, mode: 'month', from: '2026-11-01', to: '2026-11-30', goLive: '2026-10-01', now: NOW, isOwed: () => false });
  expect(D.reduce((a, r) => a + r.owed, 0)).toBe(0);
  expect(D.reduce((a, r) => a + r.cost, 0)).toBe(4000);
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

test('overview: a Transport payment after go-live that pays no trip shows in the month it was paid (driver payments only); a linked one never (QA 16 Nov 2026)', () => {
  const ledger = [led('2026-10-12', 'September · Let Us Tours', 16000), led('2026-10-13', 'Afriquia diesel', 300), { ...led('2026-10-20', 'Let Us Tours', 500), id: 'linked-1' }];
  const o = { trips: [], ledger, drivers: DRIVERS, cfg: CC.MA, mode: 'month', from: '2026-10-01', to: '2026-10-31', goLive: '2026-10-01', now: NOW };
  expect(O.summary(o).ledger.rows).toEqual([]);                                     // no linked set given: as before
  const s = O.summary({ ...o, linked: ['linked-1'] });
  expect(s.ledger.rows).toEqual([{ label: 'Let Us Tours', payments: 1, cost: 16000 }]);
  expect(O.byDriver({ ...o, linked: ['linked-1'] })).toEqual([{ label: 'Let Us Tours', trips: 0, people: 0, cost: 16000, paid: 16000, owed: 0, payments: 1 }]);
});

test('overview: the week is Transport\'s week (Sat–Fri, the closing Saturday\'s departures in, the opening Saturday\'s out)', () => {
  const trips = [trip({ trip_date: '2026-11-14' }), trip({ trip_date: '2026-11-14', kind: 'airport_departure' }), trip({ trip_date: '2026-11-21', kind: 'airport_departure' }), trip({ trip_date: '2026-11-21' })];
  const s = O.summary({ trips, cfg: CC.MA, mode: 'week', from: '2026-11-14', to: '2026-11-20', goLive: '2026-10-01', now: NOW });
  expect(s.rows.map(r => [r.label, r.trips])).toEqual([['Arrivals', 1], ['Departures', 1]]);
});

test('overview: before go-live — the ledger\'s Transport payments per supplier (driver name or alias; contacts are not suppliers; the rest «Other transport»)', () => {
  const ledger = [led('2026-09-03', 'Let Us Tours September', 4000), led('2026-09-20', 'LUT airport', 1000), led('2026-09-10', 'Mounir vans week 37', 2200),
    led('2026-09-11', 'Taxi to Agadir (Floriane)', 150), led('2026-10-02', 'Let Us Tours October', 9999), { ...led('2026-09-05', 'Fathoune', 50), category: 'Food' }];
  const trips = [trip({ trip_date: '2026-09-15' })];                              // a trip before go-live is not counted (the ledger is)
  const s = O.summary({ trips, ledger, drivers: DRIVERS, cfg: CC.MA, mode: 'month', from: '2026-09-01', to: '2026-09-30', goLive: '2026-10-01', now: NOW });
  expect(s.rows).toEqual([]);
  expect(s.ledger.rows).toEqual([{ label: 'Let Us Tours', payments: 2, cost: 5000 }, { label: 'Fathoune', payments: 1, cost: 2200 }, { label: 'Other transport', payments: 1, cost: 150 }]);
  expect(s.ledger.total).toBe(7350);
  expect(O.summaryTable(s, 'MAD').slice(1)).toEqual([['Let Us Tours', 'From payments — no trip list', '2 payments', '', 5000, 5000, '', '', ''], ['Fathoune', 'From payments — no trip list', '1 payment', '', 2200, 2200, '', '', ''], ['Other transport', 'From payments — no trip list', '1 payment', '', 150, 150, '', '', '']]);
  // Sri Lanka's November: 1–13 from payments, 14–30 from the trips (go-live 14 Nov).
  const sl = O.summary({ trips: [trip({ trip_date: '2026-11-10', place: 'CMB', expected_price: 21000 }), trip({ trip_date: '2026-11-16', place: 'CMB', expected_price: 21000 })],
    ledger: [led('2026-11-05', 'Dilan airport', 42000), led('2026-11-16', 'Dilan airport', 21000)], drivers: [{ name: 'Dilan', kinds: ['airport'] }], cfg: CC.SL, mode: 'month', from: '2026-11-01', to: '2026-11-30', goLive: '2026-11-14', now: NOW });
  expect(sl.total.cost).toBe(21000);
  expect(sl.ledger.rows).toEqual([{ label: 'Dilan', payments: 1, cost: 42000 }]);
});

test('overview: year — type × month for cost and people, row and column totals, ledger rows for the months before go-live (no people)', () => {
  const trips = [trip({ trip_date: '2026-10-05', pax: 2, expected_price: 300 }), trip({ trip_date: '2026-11-05' }), run('Surf', { trip_date: '2026-11-06', pax: 5, expected_price: 500 }),
    trip({ trip_date: '2026-11-07', status: 'cancelled' }), trip({ trip_date: '2025-12-30' })];
  const ledger = [led('2026-08-03', 'Let Us Tours', 4000), led('2026-09-03', 'Let Us Tours', 3000), led('2026-09-04', 'Fuel', 100)];
  const Y = O.yearMatrix({ trips, ledger, drivers: DRIVERS, cfg: CC.MA, year: '2026', goLive: '2026-10-01' });
  expect(Y.months[0]).toBe('2026-01');
  expect(Y.rows.map(r => [r.label, r.total.cost, r.total.people])).toEqual([['Arrivals', 550, 3], ['Surf Taghazout', 500, 5], ['Let Us Tours', 7000, null], ['Other transport', 100, null]]);
  expect(Y.rows[0].cost.slice(9, 11)).toEqual([300, 250]);
  expect(Y.rows[2].cost.slice(7, 9)).toEqual([4000, 3000]);
  expect(Y.totals.cost.slice(7, 11)).toEqual([4000, 3100, 300, 750]);
  expect(Y.totals.all).toEqual({ cost: 8150, people: 8 });
  expect(Y.fromPayments.map((x, i) => x ? i + 1 : 0).filter(Boolean)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const t = O.yearTable(Y, 'people', 'MAD');
  expect(t[0]).toEqual(['People', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Total']);
  expect(t[3]).toEqual(['Let Us Tours (from payments)', ...Array(12).fill(''), '']);
  expect(t[t.length - 1]).toEqual(['Total', 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 0, 8]);
});
