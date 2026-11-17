// Bookinglayer reports by email → the app (mail-ingest, 17 Nov 2026), no browser.
//
//   · routing: which email is which — and an invoice (any PDF) is never a report, never archived
//   · the window guard: «vanished = cancelled» only with the booking's check-out inside −3..+32
//   · Revenue & Partners: header aliases and the HQ import's rules (lib/bl-revenue.js)
//   · supabase/functions/mail-ingest/reports.ts end to end against a fake database and a fake Gmail:
//     idempotent, dry run writes nothing, oldest first / newest per camp, archive only reports
//   · the Edge Function's copies of lib/*.js are identical to lib/, and they load as Deno loads them
//   · the real 17 Nov report files when BL_REPORT_SAMPLES points at their folder (not committed: guest data)
const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const I = require('../lib/bl-ingest.js');
const RV = require('../lib/bl-revenue.js');
const { csvPriced } = require('./bl-report-csv');

const pdf = n => ({ filename: n, mime: 'application/pdf' });
const csvA = n => ({ filename: n, mime: 'text/csv' });

// ── Routing ─────────────────────────────────────────────────────────────────
test('routing: each report title goes to its handler', () => {
  const r = (subject, atts) => I.routeEmail({ subject, attachments: atts });
  expect(r('AUTO Marrocos - hourly para a app (so accounting)', [csvA('report.csv')])).toMatchObject({ kind: 'camp', camp: 'morocco', archivable: true });
  expect(r('AUTO Sri Lanka - hourly para a app (so accounting)', [csvA('report.csv')])).toMatchObject({ kind: 'camp', camp: 'sri-lanka', archivable: true });
  expect(r('Report ready', [csvA('AUTO_Sri_Lanka_-_hourly_para_a_app_(so_accounting).csv')])).toMatchObject({ kind: 'camp', camp: 'sri-lanka' });
  expect(r('App - Semana Marrocos (Week + Transfers)', [csvA('x.csv')])).toMatchObject({ kind: 'staff_copy', camp: 'morocco', archivable: true });
  expect(r('App - Semana Sri Lanka (Week + Transfers)', [csvA('x.csv')])).toMatchObject({ kind: 'staff_copy', camp: 'sri-lanka', archivable: true });
  expect(r('App - Revenue & Partners (check-in last 30 days)', [csvA('x.csv')])).toMatchObject({ kind: 'revenue', camp: null, archivable: true });
  expect(r('app – revenue and partners', [csvA('x.csv')])).toMatchObject({ kind: 'revenue' });
});

test('routing: invoices are never reports and never archivable', () => {
  const r = (subject, atts) => I.routeEmail({ subject, attachments: atts });
  const cases = [
    ['Fatura FT 2026/1234', [pdf('FT 2026-1234.pdf')]],
    ['Invoice Marina - yoga lessons', [pdf('invoice.pdf')]],
    ['AUTO Marrocos - hourly para a app (so accounting)', [csvA('r.csv'), pdf('fatura.pdf')]],   // a report title with a PDF
    ['App - Revenue & Partners (check-in last 30 days)', [pdf('x.pdf')]],
    ['Extrato Santander', [csvA('extrato.csv')]],                                                // a CSV that is not a report
    ['Bookings for October 2026 — confirmation', []],
    ['', [{ filename: 'scan.PDF', mime: 'application/octet-stream' }]],
  ];
  cases.forEach(([s, a]) => { const x = r(s, a); expect(x.kind, s).toBe('none'); expect(x.archivable, s).toBe(false); });
  // whatever the title, a message with a PDF is never archivable
  ['AUTO Sri Lanka - hourly para a app', 'App - Semana Marrocos', 'App - Revenue & Partners'].forEach(s => expect(r(s, [csvA('a.csv'), pdf('b.pdf')]).archivable).toBe(false));
});

test('routing: a report without its CSV is not imported nor archived', () => {
  expect(I.routeEmail({ subject: 'AUTO Marrocos - hourly para a app', attachments: [] })).toMatchObject({ kind: 'camp', csv: null, archivable: false });
  expect(I.routeEmail({ subject: 'AUTO Marrocos - hourly para a app', attachments: [csvA('a.csv'), csvA('b.csv')] })).toMatchObject({ csv: null, archivable: false });
});

test('order: oldest first, only the newest pending report per camp is imported; older than the last import is skipped', () => {
  const m = (id, t, kind, camp) => ({ id, internalDate: t, route: { kind, camp } });
  const { order, superseded } = I.orderReports([m('c', 3000, 'camp', 'morocco'), m('a', 1000, 'camp', 'morocco'), m('s', 1500, 'camp', 'sri-lanka'), m('r', 2000, 'revenue', null), m('x', 500, 'none', null), m('b', 2000, 'camp', 'morocco')]);
  expect(order.map(x => x.id)).toEqual(['x', 'a', 's', 'b', 'r', 'c']);   // same second: by id
  expect([...superseded].sort()).toEqual(['a', 'b']);
  expect(I.olderThanLast('2026-11-17T10:00:00Z', '2026-11-17T11:00:00Z')).toBe(true);
  expect(I.olderThanLast('2026-11-17T12:00:00Z', '2026-11-17T11:00:00Z')).toBe(false);
  expect(I.olderThanLast('2026-11-17T12:00:00Z', null)).toBe(false);
});

// ── Window guard ────────────────────────────────────────────────────────────
test('window: check-out −3..+32 days around the day the report was sent; no check-out = outside', () => {
  const w = I.reportWindow('2026-11-17');
  expect(w).toEqual({ from: '2026-11-14', to: '2026-12-19' });
  expect(I.insideWindow('2026-11-14', w)).toBe(true);
  expect(I.insideWindow('2026-12-19', w)).toBe(true);
  expect(I.insideWindow('2026-11-13', w)).toBe(false);
  expect(I.insideWindow('2026-12-20', w)).toBe(false);
  expect(I.insideWindow(null, w)).toBe(false);
  expect(I.insideWindow('', w)).toBe(false);
});

const ROOM = '13 - Anchor Point mixed shared room (8pax)';
const maBk = (ref, ci, co, name, extra = {}) => ({ ref, ci, co, guests: [{ name, arrT: '10:00', arrF: 'FR1234' }], lines: [
  { p: ROOM, person: name, start: ci, end: co, price: 300 }, { p: 'Airport Transfer Morocco (Agadir)', person: name, start: ci, price: 30 }], ...extra });
const { maRows, slRows } = require('./catalog-fixtures');
const MA_CAT = maRows();   // /prices as the camp hub reads it (capacity column, covers_pax, bl_product)
const appTrip = (id, ref, date, co, extra = {}) => ({ id, booking_ref: ref, kind: 'airport_arrival', trip_date: date, trip_time: '10:00', place: 'AGA', pax: 1, status: 'planned', source: 'bookinglayer',
  import_key: `bl:${ref}:arr`, booking_checkout: co, guest_names: 'X', payment_entry_id: null, last_import_at: '2026-11-10T00:00:00Z', edited_fields: [], ...extra });

test('window guard: only future, unpaid trips of a booking that left the report with its check-out INSIDE the window are cancelled', () => {
  const text = csvPriced([maBk('2026-100', '2026-11-20', '2026-11-27', 'Ann A')]);
  const app = [
    appTrip('t-in', '2026-200', '2026-11-25', '2026-12-01'),                                   // left the report, check-out inside → cancel
    appTrip('t-out', '2026-201', '2026-12-25', '2027-01-02'),                                  // check-out after +32 → not in the report by design
    appTrip('t-null', '2026-202', '2026-11-26', null),                                          // no check-out known → never
    appTrip('t-past', '2026-203', '2026-11-16', '2026-11-18'),                                  // inside, but the trip already happened
    appTrip('t-paid', '2026-204', '2026-11-28', '2026-12-02', { payment_entry_id: 'pay1' }),   // paid → never
    appTrip('t-hand', '2026-205', '2026-11-28', '2026-12-02', { source: 'manual' }),           // added by hand → never
    appTrip('t-gone', '2026-206', '2026-11-28', '2026-12-02', { status: 'cancelled', cancel_reason: 'guest' }),
  ];
  const r = I.planCampReport({ text, fileName: 'r.csv', slug: 'morocco', appTrips: app, appGuests: [], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17', cancelVanished: true });
  expect(r.ok).toBe(true);
  expect(r.vanish.map(a => a.id)).toEqual(['t-in']);
  expect(r.vanishOutside.map(a => a.id).sort()).toEqual(['t-null', 't-out']);
  expect(r.changes.counts.vanish).toBe(1);
  // off by default (the camp hub's import never cancels them) → nothing cancelled, the would-cancel list is still logged
  const off = I.planCampReport({ text, fileName: 'r.csv', slug: 'morocco', appTrips: app, appGuests: [], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17' });
  expect(off.vanish).toEqual([]); expect(off.vanishHeld).toMatch(/switched off/); expect(off.changes.trips.vanish.length).toBe(1);
});

test('window guard: many bookings leaving at once (a truncated file?) cancels nothing', () => {
  const text = csvPriced([maBk('2026-100', '2026-11-20', '2026-11-27', 'Ann A')]);
  const app = [1, 2, 3, 4, 5].map(n => appTrip('t' + n, '2026-30' + n, '2026-11-25', '2026-12-01'));
  const r = I.planCampReport({ text, fileName: 'r.csv', slug: 'morocco', appTrips: app, appGuests: [], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17', cancelVanished: true });
  expect(r.vanish).toEqual([]); expect(r.vanishAll.length).toBe(5); expect(r.vanishHeld).toMatch(/at once/);
});

test('window guard: Week asks «cancelled?» only for stored guests whose check-out is inside the window', () => {
  const text = csvPriced([maBk('2026-100', '2026-11-15', '2026-11-22', 'Ann A'), maBk('2026-101', '2026-11-25', '2026-12-02', 'Bea B')]);
  const g = (ref, ci, co) => ({ booking_ref: ref, guest_key: 'zoe z', guest_name: 'Zoe Z', check_in: ci, check_out: co, booking_status: 'paid' });
  const r = I.planCampReport({ text, fileName: 'r.csv', slug: 'morocco', appTrips: [], appGuests: [g('2026-400', '2026-11-21', '2026-11-26'), g('2026-401', '2026-11-22', '2026-12-30')], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17' });
  expect(r.guestPlan.wouldDrop.map(a => a.booking_ref)).toEqual(['2026-400']);
});

test('camp report: refused — no price column, no prices, nothing for this camp, not the report', () => {
  const bk = maBk('2026-100', '2026-11-20', '2026-11-27', 'Ann A');
  const base = { fileName: 'r.csv', slug: 'morocco', appTrips: [], appGuests: [], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17' };
  const { csv } = require('./bl-report-csv');
  expect(I.planCampReport({ ...base, text: csv([bk]) }).refused).toMatch(/Final price/);
  expect(I.planCampReport({ ...base, text: csvPriced([bk]), catalog: [] }).refused).toMatch(/no transfer rows/);
  expect(I.planCampReport({ ...base, text: csvPriced([{ ...bk, status: 'Cancelled' }]) }).refused).toMatch(/no live booking/);
  expect(I.planCampReport({ ...base, text: 'a,b\n1,2' }).refused).toMatch(/not the camp report/);
  const ok = I.planCampReport({ ...base, text: csvPriced([bk]) });
  expect(ok.ok).toBe(true);
  expect(ok.rpc.p_trips.map(t => [t.key, t.expected_price, t.vehicle])).toEqual([['bl:2026-100:arr', 250, 'Car']]);
  expect(ok.rpc.p_export_date).toBe('2026-11-17');
});

test('prices from /prices (lib/transport-catalog.js, as presetPrice in transport.js): Morocco per airport, Sri Lanka per direction', () => {
  const ma = I.pricesFromCatalog(MA_CAT, 'morocco');
  expect([ma('airport_arrival', 'Car', 'AGA'), ma('airport_departure', 'Minivan', 'AGA'), ma('airport_arrival', 'Car', 'RAK'), ma('airport_arrival', 'Car', 'ESU')]).toEqual([250, 300, 1200, 0]);
  expect(ma.ready).toBe(true);
  const sl = I.pricesFromCatalog(slRows(), 'sri-lanka');
  expect([sl('airport_arrival', 'Car'), sl('airport_departure', 'Car'), sl('airport_arrival', 'Large Van')]).toEqual([20500, 19000, 0]);
  expect(I.pricesFromCatalog(slRows().filter(r => !/^Surfcamp/.test(r.name)), 'sri-lanka').ready).toBe(false);   // one way missing → not ready
});

test('«Last import» line: today / yesterday / date, automatic or by hand, amber after 3 hours', () => {
  const tz = 'Asia/Colombo';
  expect(I.lastImportLine({ at: '2026-11-17T11:32:00Z', source: 'mail' }, '2026-11-17T12:00:00Z', tz)).toEqual({ text: 'Last import: today 17:02 · Bookinglayer (automatic)', amber: false });
  expect(I.lastImportLine({ at: '2026-11-17T08:00:00Z', source: 'manual', by_name: 'Miguel Pereira' }, '2026-11-17T12:00:00Z', tz)).toEqual({ text: 'Last import: today 13:30 · by hand (Miguel)', amber: true });
  expect(I.lastImportLine({ at: '2026-11-16T05:00:00Z', source: 'mail' }, '2026-11-17T12:00:00Z', tz).text).toBe('Last import: yesterday 10:30 · Bookinglayer (automatic)');
  expect(I.lastImportLine({ at: '2026-11-10T05:00:00Z', source: 'mail' }, '2026-11-17T12:00:00Z', 'Africa/Casablanca').text).toBe('Last import: 10 Nov 06:00 · Bookinglayer (automatic)');
  expect(I.lastImportLine(null, '2026-11-17T12:00:00Z', tz)).toEqual({ text: 'Last import: none yet', amber: true });
});

// ── Revenue & Partners ──────────────────────────────────────────────────────
const REV_HEAD = ['Booking: Reference', 'Booking: Status', 'Booking: Created at', 'Booking: Check-in date', 'Booking: Check-out date', 'Booking: Pax', 'Booking: Nights',
  'Booking: Final price incl. tax', 'Booking: Paid amount', 'Booking: Due amount', 'Booking: Currency', 'Booking: Via', 'Company/Channel', 'Booking: Commission total',
  'Booking: Commission %', 'Booking: List of locations', 'Booking: List of products', 'Booker: Full name', 'Booker: Email', 'Booker: Country', 'Booking: List of packages',
  'Booking: List of payment methods', 'Booking: List of payment dates', 'Booking: List of payment amounts', 'Booking: Backoffice URL'];
const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const revRow = o => [o.ref, o.status || 'Paid', 'Mon 2 Nov 2026', o.ci || 'Sat 7 Nov 2026', o.co || 'Sat 14 Nov 2026', o.pax || 1, 7, o.total, o.paid == null ? o.total : o.paid, o.due || '0.00', o.cur || 'EUR',
  o.via || 'Booking engine', o.channel || '', o.ctotal || '', o.pct || '', o.loc || 'Surf Camp Ahangama', 'x', o.booker || 'Ann B', 'ann@b.se', o.country || 'Sweden', o.pkg || 'Surf Camp Ahangama Package', 'Stripe Cards', '', '', 'https://app.bookinglayer.io/x'];
const revCsv = (rows, head = REV_HEAD) => [head.map(q).join(','), ...rows.map(r => revRow(r).map(q).join(','))].join('\n');

test('revenue: header aliases — with or without the «Booking:» prefix, other spellings, missing columns stop the run', () => {
  const plain = REV_HEAD.map(h => h.replace(/^Booking: /, ''));
  const a = RV.parse(revCsv([{ ref: '2026-1', total: '700.00' }]));
  const b = RV.parse(revCsv([{ ref: '2026-1', total: '700.00' }], plain));
  expect(a.missing).toEqual([]); expect(b.missing).toEqual([]);
  const pick = r => [r.ref, r.status, r.gross, r.due, r.currency, r.partner, r.locationCode, r.country, r.checkinMs];
  expect(pick(b.rows[0])).toEqual(pick(a.rows[0]));
  expect(pick(a.rows[0])).toEqual(['2026-1', 'paid', 700, '0.00', 'EUR', 'Direct Bookings', 'LK', 'Sweden', Date.UTC(2026, 10, 7)]);
  // the Bookings-list spelling is accepted too
  const ix = RV.headerIndex(['Booking #', 'Status', 'Check-in on', 'Total', 'Due', 'Currency', 'Partner', 'Partner commission %', 'Location']);
  expect(RV.REQUIRED.every(f => ix[f] >= 0)).toBe(true);
  // a missing partner / commission / due column must never become «direct, 0»
  const noChannel = REV_HEAD.filter(h => h !== 'Company/Channel' && h !== 'Booking: Due amount');
  expect(RV.parse([noChannel.map(q).join(','), '"2026-1"'].join('\n')).missing).toEqual(['Booking: Due amount', 'Company/Channel']);
});

test('revenue: the HQ import rules — partner, commission once, Connect source, deposit → paid, notes and overrides kept', () => {
  const rows = RV.parse(revCsv([
    { ref: '2026-10', status: 'Paid', total: '1000.00', due: '0.00', via: 'Backoffice via KILROY', channel: 'KILROY', ctotal: '200.00', pct: '20' },
    { ref: '2026-11', status: 'Deposit paid', total: '500.00', paid: '100.00', due: '400.00', via: 'Bookinglayer Connect', channel: 'THE SURF TRIBE', pct: '15' },
    { ref: '2026-12', total: '300.00' },
    { ref: '2026-13', total: '900.00', cur: 'CHF' },
    { ref: '2026-14', total: '444.00', cur: 'USD' },
  ])).rows;
  const existing = [
    { booking_ref: '2026-10', booker: 'Ann B', check_in_on: '2026-11-07', month_key: '2026-11', total: 1000, pax: 1, location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama Package',
      partner_name: 'Kilroy', booking_type: 'surfcamp', partner_commission_pct: 20, commission_amount: 200, net_amount: 800, country: 'Norway',
      raw_payload: { status: 'deposit_paid', due: '800', bookingSource: 'Partner: KILROY', note: 'paid by bank 3 Nov', external_ref: 'NO1551993' } },
    { booking_ref: '2026-12', total: 280, net_amount: 280, commission_amount: 0, raw_payload: { total_override: true, status: 'paid' } },
    { booking_ref: '2026-13', total: 960, net_amount: 960, commission_amount: 0, raw_payload: { currency: 'CHF', total_chf: 900 } },
  ];
  const p = RV.plan(rows, existing, ['Kilroy', 'The Surf Tribe']);
  const by = Object.fromEntries(p.upserts.map(u => [u.booking_ref, u]));
  // Kilroy: deposit → paid, notes and external_ref kept, source kept, country left to the trigger (raw only), app country kept + note
  expect(by['2026-10'].raw_payload).toMatchObject({ status: 'paid', due: '0.00', note: 'paid by bank 3 Nov', external_ref: 'NO1551993', bookingSource: 'Partner: KILROY', country: 'Sweden' });
  expect(by['2026-10']).not.toHaveProperty('country');
  expect(by['2026-10']).toMatchObject({ partner_name: 'Kilroy', commission_amount: 200, net_amount: 800 });
  expect(p.changes.find(c => c.ref === '2026-10').material.map(d => d.field)).toEqual(expect.arrayContaining(['raw.status', 'raw.due']));
  expect(p.notes.join('\n')).toMatch(/2026-10: KILROY — app country Norway, Booker Country Sweden/);
  // a new Connect booking: partner spelled as in Partners, commission once, «Connect: …» so Partners asks the partner flag
  expect(by['2026-11']).toMatchObject({ partner_name: 'The Surf Tribe', booking_type: 'surfcamp', partner_commission_pct: 15, commission_amount: 75, net_amount: 425 });
  expect(by['2026-11'].raw_payload).toMatchObject({ status: 'deposit_paid', due: '400.00', bookingSource: 'Connect: The Surf Tribe' });
  // total_override and a booking already in CHF keep the app's euro values
  expect([by['2026-12'].total, by['2026-12'].net_amount]).toEqual([280, 280]);
  expect([by['2026-13'].total, by['2026-13'].raw_payload.currency]).toEqual([960, 'CHF']);
  // a new booking in USD is held, never written as euros
  expect(by['2026-14']).toBeUndefined();
  expect(p.held.map(h => h.ref)).toEqual(['2026-14']);
  expect(p.created.sort()).toEqual(['2026-11']);
});

test('revenue: an empty Company/Channel never turns a partner booking direct (the 26 Oct 2026 error)', () => {
  const rows = RV.parse(revCsv([{ ref: '2026-30', total: '1000.00', via: 'Bookinglayer Connect', channel: '' }])).rows;
  const prev = { booking_ref: '2026-30', total: 1000, partner_name: 'The Surf Tribe', partner_commission_pct: 15, commission_amount: 150, net_amount: 850, booking_type: 'surfcamp', raw_payload: { bookingSource: 'Connect: The Surf Tribe' } };
  const p = RV.plan(rows, [prev], ['The Surf Tribe']);
  const u = p.upserts[0];
  expect(u).toMatchObject({ partner_name: 'The Surf Tribe', partner_commission_pct: 15, commission_amount: 150, net_amount: 850, booking_type: 'surfcamp' });
  expect(u.raw_payload).toMatchObject({ partner: 'The Surf Tribe', commissionPct: 15, bookingSource: 'Connect: The Surf Tribe' });
  expect(p.notes.join()).toMatch(/2026-30: no Company\/Channel in the report — kept the app's partner The Surf Tribe/);
});

test('revenue: idempotent — the same file again changes nothing', () => {
  const rows = RV.parse(revCsv([{ ref: '2026-20', total: '650.00', channel: 'KILROY', via: 'Backoffice via KILROY', pct: '20' }, { ref: '2026-21', total: '99.50', status: 'Deposit paid', due: '49.50' }])).rows;
  const first = RV.plan(rows, [], ['Kilroy']);
  expect(first.upserts.length).toBe(2);
  const stored = first.upserts.map(u => ({ ...u, raw_payload: JSON.parse(JSON.stringify(u.raw_payload)) }));
  const again = RV.plan(rows, stored, ['Kilroy']);
  expect(again.upserts).toEqual([]); expect(again.unchanged).toBe(2);
});

test('revenue: «List of locations» names → the stay wins (as the HQ import)', () => {
  expect(RV.locationOf('Surf Camp Portugal, Surf Camp Ahangama', 'Surf Camp Ahangama Package')).toMatchObject({ code: 'LK', name: 'Surf Camp Ahangama' });
  expect(RV.locationOf('Tamraght Camp', '')).toMatchObject({ code: 'MA', name: 'Tamraght Camp' });
  expect(RV.locationOf('PT, LK', '')).toMatchObject({ code: 'LK' });
  expect(RV.locationOf('Somewhere new', '')).toMatchObject({ code: '', unknown: ['Somewhere new'] });
});

// ── reports.ts end to end (fake database + fake Gmail) ──────────────────────
function fakeDb(seed = {}) {
  let seq = 0;
  const T = { bl_report_settings: [{ id: 1, dry_run_camp: true, dry_run_revenue: true, archive: false, cancel_vanished: true }],
    mail_ingest_account: [{ id: 'acc', email: 'accounting@gotadaguasurf.com', active: true, scopes: 'https://www.googleapis.com/auth/gmail.readonly email' }],
    bl_report_runs: [], locations: [{ id: 'L-MA', slug: 'morocco' }, { id: 'L-SL', slug: 'sri-lanka' }], camp_trips: [], camp_week_guests: [],
    pricing_catalog: MA_CAT.map(c => ({ ...c, location_id: 'L-MA' })), bookings: [], partners: [{ name: 'Kilroy' }], ...seed };
  const rpcCalls = [];
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select() { return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; } neq(k, v) { this.f.push(r => r[k] !== v); return this; }
    in(k, vs) { this.f.push(r => vs.includes(r[k])); return this; } gte(k, v) { this.f.push(r => String(r[k]) >= v); return this; }
    order(k, o) { this.ord = this.ord || [k, !!(o && o.ascending === false)]; return this; } limit(n) { this.lim = n; return this; } range(a, b) { this.rng = [a, b]; return this; }
    insert(o) { this.op = 'insert'; this.payload = o; return this; } update(o) { this.op = 'update'; this.payload = o; return this; } delete() { this.op = 'delete'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; } single() { this.one = 'single'; return this; }
    then(ok, no) { try { ok(this.exec()); } catch (e) { no(e); } }
    exec() {
      const rows = T[this.t] || (T[this.t] = []);
      if (this.op === 'insert') {
        const o = { id: 'id' + (++seq), ...this.payload };
        if (this.t === 'bl_report_runs' && o.message_id && rows.some(r => r.message_id === o.message_id)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        rows.push(o); return { data: this.one ? { ...o } : [{ ...o }], error: null };
      }
      let out = rows.filter(r => this.f.every(f => f(r)));
      if (this.op === 'update') { out.forEach(r => Object.assign(r, this.payload)); return { data: out, error: null }; }
      if (this.op === 'delete') { T[this.t] = rows.filter(r => !out.includes(r)); return { data: out, error: null }; }
      if (this.ord) { const [k, desc] = this.ord; out = out.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (desc ? -1 : 1)); }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) out = out.slice(0, this.lim);
      if (this.one) return { data: out[0] ? { ...out[0] } : null, error: this.one === 'single' && !out[0] ? { message: 'no rows' } : null };
      return { data: out.map(r => ({ ...r })), error: null };
    }
  }
  return { T, rpcCalls, from: t => new Q(t),
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      const run = T.bl_report_runs.find(r => r.id === args.p_run);
      if (run) Object.assign(run, { status: 'imported', import_id: 'imp-' + rpcCalls.length });
      return { data: { inserted: 1, import_id: 'imp-' + rpcCalls.length }, error: null };
    } };
}
function fakeGmail(msgs) {
  const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const byId = new Map(msgs.map(m => [m.id, m]));
  const modified = [];
  const deps = {
    mailToken: async () => 'tok',
    header: (msg, name) => ((msg.payload.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '',
    b64urlToBytes: s => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    modify: async (token, id, body) => { modified.push([id, body]); return {}; },
    gmail: async (token, p) => {
      if (p.startsWith('messages?')) return { messages: msgs.map(m => ({ id: m.id })) };
      const am = p.match(/^messages\/([^/]+)\/attachments\/(.+)$/);
      if (am) return { data: b64(byId.get(am[1]).files.find(f => f.aid === am[2]).text) };
      const m = byId.get(p.match(/^messages\/([^?]+)/)[1]);
      return { id: m.id, internalDate: String(Date.parse(m.at)), labelIds: ['INBOX'],
        payload: { headers: [{ name: 'Subject', value: m.subject }, { name: 'From', value: m.from || 'reports@bookinglayer.io' }],
          parts: m.files.map(f => ({ filename: f.name, mimeType: f.mime, body: { attachmentId: f.aid, size: (f.text || '').length } })) } };
    },
  };
  return { deps, modified };
}
const MA_SUBJ = 'AUTO Marrocos - hourly para a app (so accounting)';
const maFile = (aid, refs) => ({ name: 'AUTO Marrocos - hourly para a app (so accounting).csv', mime: 'text/csv', aid, text: csvPriced(refs.map(r => maBk(r, '2026-11-20', '2026-11-27', 'Guest ' + r))) });
let runReports;
test.beforeAll(async () => {
  // reports.ts loads lib/*.js for their side effect (globals on self, as in Deno); in Node they are CommonJS → put them on globalThis first
  globalThis.CampConfig = require('../lib/camp-config.js'); globalThis.TransportCatalog = require('../lib/transport-catalog.js'); globalThis.GuestsTrips = require('../lib/guests-trips.js');
  globalThis.BlReport = require('../lib/bl-report.js'); globalThis.BlIngest = I; globalThis.BlRevenue = RV;
  ({ runReports } = require('../supabase/functions/mail-ingest/reports.ts'));
});

test('reports.ts: dry run logs every email once, imports nothing, archives nothing — invoices untouched', async () => {
  const db = fakeDb();
  const { deps, modified } = fakeGmail([
    { id: 'inv', at: '2026-11-17T08:00:00Z', subject: 'Fatura FT 2026/77', files: [{ name: 'FT 2026-77.pdf', mime: 'application/pdf', aid: 'p1' }] },
    { id: 'm10', at: '2026-11-17T10:00:00Z', subject: MA_SUBJ, files: [maFile('a10', ['2026-100'])] },
    { id: 'm11', at: '2026-11-17T11:00:00Z', subject: MA_SUBJ, files: [maFile('a11', ['2026-100', '2026-101'])] },
    { id: 'cp', at: '2026-11-17T11:05:00Z', subject: 'App - Semana Sri Lanka (Week + Transfers)', files: [{ name: 'x.csv', mime: 'text/csv', aid: 'c1', text: 'a' }] },
    { id: 'spoof', at: '2026-11-17T11:10:00Z', subject: MA_SUBJ, files: [maFile('s1', ['2026-100']), { name: 'fatura.pdf', mime: 'application/pdf', aid: 's2' }] },
  ]);
  const s = await runReports(db, deps);
  const st = Object.fromEntries(db.T.bl_report_runs.map(r => [r.message_id, r.status]));
  expect(st).toEqual({ inv: 'ignored', m10: 'superseded', m11: 'dry_run', cp: 'dry_run', spoof: 'ignored' });
  expect(db.rpcCalls).toEqual([]); expect(modified).toEqual([]);
  const m11 = db.T.bl_report_runs.find(r => r.message_id === 'm11');
  expect(m11).toMatchObject({ location_id: 'L-MA', window_from: '2026-11-14', window_to: '2026-12-19' });
  expect(m11.changes.counts).toMatchObject({ create: 2, send: 2 });
  expect(s.checked).toBe(5);
  // idempotent: the same mailbox again → nothing new, nothing re-processed
  const before = JSON.stringify(db.T.bl_report_runs);
  const s2 = await runReports(db, deps);
  expect(s2.checked).toBe(0); expect(JSON.stringify(db.T.bl_report_runs)).toBe(before);
});

test('reports.ts: live — imports the newest camp report, archives reports only, and only with gmail.modify', async () => {
  const db = fakeDb();
  Object.assign(db.T.bl_report_settings[0], { dry_run_camp: false, archive: true });
  const msgs = [
    { id: 'inv', at: '2026-11-17T08:00:00Z', subject: 'Invoice 123', files: [{ name: 'invoice.pdf', mime: 'application/pdf', aid: 'p1' }] },
    { id: 'm12', at: '2026-11-17T12:00:00Z', subject: MA_SUBJ, files: [maFile('a12', ['2026-100'])] },
    { id: 'cp', at: '2026-11-17T12:05:00Z', subject: 'App - Semana Marrocos (Week + Transfers)', files: [{ name: 'x.csv', mime: 'text/csv', aid: 'c1', text: 'a' }] },
  ];
  // read-only token: imported, but not archived — the run says why
  let g = fakeGmail(msgs);
  await runReports(db, g.deps);
  expect(db.rpcCalls.map(c => c[0])).toEqual(['bl_report_camp_apply']);
  expect(db.rpcCalls[0][1]).toMatchObject({ p_location: 'L-MA', p_received_at: '2026-11-17T12:00:00.000Z', p_export_date: '2026-11-17', p_refs_present: ['2026-100'] });
  expect(g.modified).toEqual([]);
  expect(db.T.bl_report_runs.find(r => r.message_id === 'm12')).toMatchObject({ status: 'imported' });
  expect(db.T.bl_report_runs.find(r => r.message_id === 'm12').archive_error).toMatch(/read-only/);
  // reconnected with gmail.modify: new emails are archived — the invoice never
  db.T.mail_ingest_account[0].scopes = 'https://www.googleapis.com/auth/gmail.modify email';
  const more = msgs.concat([
    { id: 'm13', at: '2026-11-17T13:00:00Z', subject: MA_SUBJ, files: [maFile('a13', ['2026-100'])] },
    { id: 'inv2', at: '2026-11-17T13:01:00Z', subject: 'AUTO Marrocos - hourly para a app — fatura', files: [{ name: 'fatura.pdf', mime: 'application/pdf', aid: 'p9' }] },
    { id: 'm09', at: '2026-11-17T09:00:00Z', subject: MA_SUBJ, files: [maFile('a09', ['2026-100'])] },   // arrives late, older than the import
  ]);
  g = fakeGmail(more);
  await runReports(db, g.deps);
  expect(g.modified.map(m => m[0]).sort()).toEqual(['m09', 'm13']);
  expect(g.modified.every(m => JSON.stringify(m[1]) === JSON.stringify({ removeLabelIds: ['INBOX'] }))).toBe(true);
  const st = Object.fromEntries(db.T.bl_report_runs.map(r => [r.message_id, r.status]));
  expect(st).toMatchObject({ inv: 'ignored', inv2: 'ignored', m12: 'imported', m13: 'imported', m09: 'superseded', cp: 'copy' });
  expect(db.rpcCalls.length).toBe(2);
});

test('reports.ts: without bl_report_settings (SQL not run) nothing happens', async () => {
  const db = fakeDb({ bl_report_settings: [] });
  const { deps } = fakeGmail([{ id: 'm', at: '2026-11-17T10:00:00Z', subject: MA_SUBJ, files: [maFile('a', ['2026-100'])] }]);
  const s = await runReports(db, deps);
  expect(s.lines.join()).toMatch(/bl-report-ingest\.sql/); expect(db.T.bl_report_runs).toEqual([]);
});

// ── The Edge Function's copies ──────────────────────────────────────────────
test('the copies in supabase/functions/_shared/lib are identical to lib/ (run «npm run sync:edge» after a change)', () => {
  const { FILES, DEST, ROOT } = require('../scripts/sync-edge-libs.js');
  FILES.forEach(f => expect(fs.readFileSync(path.join(DEST, f), 'utf8'), f).toBe(fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8')));
});

test('the libraries load as Deno loads them (no «module», globals on self) and plan a report', () => {
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Number, String, Array, Object, RegExp, Error };
  ctx.self = ctx; vm.createContext(ctx);
  ['camp-config.js', 'transport-catalog.js', 'guests-trips.js', 'bl-report.js', 'bl-ingest.js', 'bl-revenue.js'].forEach(f =>
    vm.runInContext(`(function () { 'use strict'; ${fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'lib', f), 'utf8')}\n}).call(undefined);`, ctx, { filename: f }));
  expect(Object.keys(ctx).filter(k => /^(CampConfig|TransportCatalog|GuestsTrips|BlReport|BlIngest|BlRevenue)$/.test(k)).sort()).toEqual(['BlIngest', 'BlReport', 'BlRevenue', 'CampConfig', 'GuestsTrips', 'TransportCatalog']);
  const r = ctx.BlIngest.planCampReport({ text: csvPriced([maBk('2026-100', '2026-11-20', '2026-11-27', 'Ann A')]), fileName: 'r.csv', slug: 'morocco', appTrips: [], appGuests: [], catalog: MA_CAT, now: '2026-11-17T10:00', receivedYmd: '2026-11-17' });
  expect(r.ok).toBe(true); expect(r.rpc.p_trips.length).toBe(1);
});

// ── The real files of 17 Nov 2026 (BL_REPORT_SAMPLES=<folder with ma_1out.csv and sl.csv>) ──
const SAMPLES = process.env.BL_REPORT_SAMPLES;
test('real reports: routed by file name, planned without refusal, window guard on real data', () => {
  test.skip(!SAMPLES || !fs.existsSync(path.join(SAMPLES || '', 'sl.csv')), 'BL_REPORT_SAMPLES not set (the real files hold guest data and are not committed)');
  const runs = [['ma_1out.csv', 'morocco', 'AUTO Marrocos - hourly para a app (so accounting).csv', MA_CAT],
    ['sl.csv', 'sri-lanka', 'AUTO Sri Lanka - hourly para a app (so accounting).csv', slRows()]];
  for (const [f, slug, name, catalog] of runs) {
    expect(I.routeEmail({ subject: 'Report', attachments: [{ filename: name, mime: 'text/csv' }] })).toMatchObject({ kind: 'camp', camp: slug, archivable: true });
    const text = fs.readFileSync(path.join(SAMPLES, f), 'utf8');
    const r = I.planCampReport({ text, fileName: f, slug, appTrips: [], appGuests: [], catalog, now: '2026-11-17T12:00', receivedYmd: '2026-11-17' });
    expect(r.ok, r.refused).toBe(true);
    expect(r.parsed.trips.length).toBeGreaterThan(5);
    // every booking of the file checks out inside the window it was exported with (−3..+32 on 17 Nov)
    expect(r.parsed.bookings.every(b => I.insideWindow(b.co, I.reportWindow('2026-11-17')) || b.co < '2026-11-14')).toBe(true);
    // with an empty app nothing is cancelled and nothing of an earlier day is created
    expect(r.vanish).toEqual([]); expect(r.plan.create.every(x => x.trip.date >= '2026-11-17')).toBe(true);
  }
});
