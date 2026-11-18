// Synthetic Morocco guests and trips in the shape the Bookinglayer camp report stores them (18 Nov 2026 audit,
// WEEK-02 / WEEK-03 / WEEK-04). Fake people only. The week is Sat 21 – Fri 27 Nov 2026.
//
//   raw.transfers = one entry per airport leg the guest really has in Bookinglayer (lib/bl-report.js guestRow):
//   a guest with only the departure leg has has_transfer = true and still comes on their own.
const H = require('./ma-helpers');

const IMPORT_ID = '33333333-0000-4000-8000-000000000001';
const BOILERS = '2 - Boilers Private Room';
const SOURCE = '3 - La Source Private Room';
const CROCRO = '4 - Crocro Private Room';
const ANCHOR = '13 - Anchor Point mixed shared room (8pax)';
const BANANA = '8 - Banana Point mixed shared room (4pax)';
const TRANSFER = 'Airport Transfer Morocco (Agadir)';

let n = 0;
// o = { ref, name, ci, co, room | segs: [{ room, from, to, bed }], bed, legs: ['2026-11-28', …], arrT, arrF, depT }
function guest(o) {
  const ci = o.ci || '2026-11-21', co = o.co || '2026-11-28';
  const segs = o.segs || [{ room: o.room || BOILERS, from: ci, to: co, bed: o.bed || '' }];
  const legs = o.legs || [];
  return {
    id: `99999999-0000-4000-8000-${String(900 + (++n)).padStart(12, '0')}`, location_id: H.LOC, week_start: ci, booking_ref: o.ref, guest_key: o.name.toLowerCase(), guest_name: o.name,
    phone: o.phone === undefined ? `+4915100000${String(10 + n)}` : o.phone, check_in: ci, check_out: co,
    accommodation: [...new Set(segs.map(s => s.room))].join(', '), bed_number: segs.map(s => s.bed).filter(Boolean).join(', '),
    packages: 'Weekly package Morocco', activities: 'Standard Surf Course ( 5 surf lessons)', level: 'Beginner', diet: 'Continental', allergies: '', nights: 7,
    arrival_time: o.arrT || null, arrival_flight: o.arrF || '', departure_time: o.depT || null, departure_flight: '',
    has_transfer: legs.length > 0, booking_status: 'paid', booking_due: 0, partner: '', hq_match: null,
    raw: { source: 'bl-report', segments: segs, lessons: [], courses: [], transfers: legs.map(date => ({ date, title: TRANSFER })), phone_from: 'guest' },
    import_id: IMPORT_ID, updated_at: '2026-11-18T17:02:00Z',
  };
}
// The four ways to come and go, plus two room moves the report dates exactly.
const guests = () => { n = 0; return [
  guest({ ref: '2026-9001', name: 'Dana Departs', room: BOILERS, legs: ['2026-11-28'], arrT: '16:00', arrF: 'By Car', depT: '11:00' }),   // only the departure leg
  guest({ ref: '2026-9002', name: 'Arno Arrives', room: SOURCE, legs: ['2026-11-21'], arrT: '10:15', arrF: 'FR1234' }),                  // only the arrival leg
  guest({ ref: '2026-9003', name: 'Bo Both', room: ANCHOR, bed: '1', legs: ['2026-11-21', '2026-11-28'], arrT: '12:40', arrF: 'U2 2286', depT: '09:00' }),
  guest({ ref: '2026-9004', name: 'Nina None', room: ANCHOR, bed: '2', legs: [], arrT: '15:00' }),
  // the report says the move is on the changeover Saturday (what Week also shows): nothing to confirm
  guest({ ref: '2026-9005', name: 'Sam Saturday', ci: '2026-11-21', co: '2026-12-05', legs: [],
    segs: [{ room: BANANA, from: '2026-11-21', to: '2026-11-28', bed: '3' }, { room: CROCRO, from: '2026-11-28', to: '2026-12-05', bed: '' }] }),
]; };
// the report says Wednesday 25, Week takes the Saturday 28: the item must say so
const midweekMover = () => guest({ ref: '2026-9006', name: 'Mia Midweek', ci: '2026-11-21', co: '2026-12-05', legs: [],
  segs: [{ room: BANANA, from: '2026-11-21', to: '2026-11-25', bed: '4' }, { room: '7 - Anza Private Room', from: '2026-11-25', to: '2026-12-05', bed: '' }] });

let t = 0;
function trip(o) {
  const dep = o.kind === 'airport_departure';
  return { id: o.id || `aaaaaaaa-0000-4000-8000-${String(900 + (++t)).padStart(12, '0')}`, location_id: H.LOC, kind: 'airport_arrival', trip_date: '2026-11-21', trip_time: null, pickup_time: null, flight: null, place: 'AGA',
    route: dep ? 'Surfcamp → Airport' : 'Airport → Surfcamp', purpose: 'guests', tour_name: null, guest_names: 'Guest', guest_phone: '+491510000099', booking_ref: null, booking_checkout: '2026-11-28',
    pax: 1, vehicle: 'Car', driver_id: H.D.lut, expected_price: 250, currency: 'MAD', status: 'planned', source: 'bookinglayer', charge: 'bookinglayer', import_key: `bl:${o.booking_ref}:${dep ? 'dep' : 'arr'}`,
    import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null, last_import_at: '2026-11-18T16:02:00Z', last_export_date: '2026-11-18',
    bl_checked_at: '2026-11-18T16:02:00Z', created_at: '2026-11-17T08:00:00Z', ...o };
}
const trips = () => { t = 0; return [
  trip({ booking_ref: '2026-9002', guest_names: 'Arno Arrives', trip_time: '10:15', flight: 'FR1234' }),
  trip({ booking_ref: '2026-9003', guest_names: 'Bo Both', trip_time: '12:40', flight: 'U2 2286' }),
  trip({ booking_ref: '2026-9001', guest_names: 'Dana Departs', kind: 'airport_departure', trip_date: '2026-11-28', trip_time: '11:00' }),
  trip({ booking_ref: '2026-9003', guest_names: 'Bo Both', kind: 'airport_departure', trip_date: '2026-11-28', trip_time: '09:00' }),
]; };

module.exports = { IMPORT_ID, BOILERS, SOURCE, CROCRO, ANCHOR, BANANA, TRANSFER, guest, guests, midweekMover, trip, trips };
