// One settings block per camp for the Guests import, Week and Transport (14 Nov 2026).
//
// Sri Lanka was built first (13 Nov) with its values written into the code; Morocco
// runs the same pages, so everything that differs between the two camps lives here:
// names, time zone, money, airports, rooms, packages, vehicles, the week numbering,
// the airport transfer supplier and the surf-van runs. Pure data + small pure
// functions, no DOM and no Supabase: the camp hub and the Node tests load the same file.
//
// Sri Lanka's block holds exactly the values the code had on 13 Nov, so it behaves as
// before (tests/guests-trips.spec.js, week.spec.js, transport.spec.js pin that).
// Morocco's values marked «CONFIRM» are the best reading of the data on 14 Nov and
// wait for Miguel's word (ma_week/REPORT.md lists them).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampConfig = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const low = s => String(s || '').toLowerCase();

  // ── Sri Lanka (values as on 13 Nov 2026) ──────────────────────────────────
  const SL_ROOMS = ['hiriketeya', 'kabalana', 'marissa', 'unawatuna', 'madiha', 'midigama', 'welligama', 'weligama', 'ahangama'];
  const SL = {
    slug: 'sri-lanka',
    name: 'Sri Lanka',                                   // «Gota Dagua Sri Lanka - week 14»
    campFull: 'Gota Dagua Surf Camp Sri Lanka',           // guest messages
    manager: 'Francisco',                                 // signs the guest messages
    localManager: 'Nadith',                               // pays the drivers in ?view=local
    tz: 'Asia/Colombo',
    currency: 'LKR',
    phoneExample: '+94771234567',
    preset: 'Semana Sri Lanka',                           // the Bookinglayer Guests preset
    blLocations: ['Surf Camp Ahangama'],                  // HQ bookings.location (HQ cross-check, off)
    goLive: '2026-11-14',                                 // = camp_trips_go_live() in the SQL
    seasonWeek1: '2026-08-15',                            // a Saturday: Sat 14 Nov 2026 is week 14
    groupDescDefault: '📅 YOUR WEEKLY SCHEDULE - WEEK {week} ({dates})\n\nEdit me: write the weekly schedule here once. It is kept for the next weeks; {week} and {dates} fill themselves in.',
    // Airports: the code a place name stands for, the default when the file says nothing.
    airports: ['CMB', 'HRI'], airportDefault: 'CMB', airportCity: { CMB: 'Colombo', HRI: 'Mattala' },
    places: { cmb: 'CMB', colombo: 'CMB', bandaranaike: 'CMB', hri: 'HRI', mattala: 'HRI', agadir: 'AGA', marrakech: 'RAK', lisbon: 'LIS' },
    icaoFlights: false,                                   // 3-letter airline codes (EZY2621) not read in Sri Lanka
    ownWayWords: null,                                    // «bus» in the flight field: just «not understood»
    phoneZeroCodes: [],                                   // extra country codes whose «0» is dropped
    transferRe: /airport transfer/gi,                     // a transfer product in the «Transfers» column
    vehicles: ['Car', 'Minivan', 'Large Van'], vehicleCaps: [4, 8],
    waVehicle: { 'Car': 'Small Car', 'Minivan': 'Minivan', 'Large Van': 'Large Van' },
    // Packages that include what the Guests file does not tick (Miguel, 13 Nov).
    packages: [{ re: /with\s+jo[aã]o\s+kopke/i, label: 'Sri Lanka with João Kopke', transfer: true, course: 'Standard', yoga: true }],
    // Is this row a guest of this camp? 'yes' | 'room' (by room name, Packages empty) | ''
    matchRow(pk, acc) {
      const p = low(pk);
      if (p.includes('ahangama') || p.includes('sri lanka')) return 'yes';
      if (SL_ROOMS.some(r => low(acc).includes(r))) return pk.trim() ? 'yes' : 'room';
      return '';
    },
    // Rooms: order of the staff images, the camp's own names, the rooms that show even when empty.
    roomOrder: ['marissa', 'kabalana', 'unawatuna', 'hiriketeya', 'ahangama', 'madiha', 'midigama', 'welligama', 'weligama'],
    roomShort: { marissa: 'Mirissa room', kabalana: 'Kabalana room', unawatuna: 'Unawatuna room', hiriketeya: 'Hiriketeya room', ahangama: 'Ahangama room',
      madiha: 'Madiha room', midigama: 'Midigama room', welligama: 'Weligama room', weligama: 'Weligama room' },
    campRooms: [
      { w: 'marissa', beds: 4, note: '4 beds' }, { w: 'kabalana', beds: 4, note: '4 beds' }, { w: 'unawatuna', beds: 6, note: 'girls' },
      { w: 'hiriketeya' }, { w: 'ahangama' }, { w: 'madiha' }, { w: 'midigama' }, { w: 'welligama' },
    ],
    privateRoomBeds: 2,
    // Transport
    runs: { kind: 'tuktuk', label: 'Tuk-tuk', plural: 'Tuk-tuk runs', vehicle: 'Tuk-tuk' },
    payMethod: 'Cash',
    airportSupplier: null,
    transportHow: 'Transfers come from the Guests file (Week → Import). Tuk-tuks: plan tomorrow and send the order. Nadith pays in the Ledger (Transport · Airport) and ticks the guests, and they show as Paid here.',
  };

  // ── Morocco (14 Nov 2026) ─────────────────────────────────────────────────
  // Rooms seen on the Bookinglayer list (coordinator, 14 Nov): «N - Name …», the number and
  // «(Npax)» are part of the name. A room missing here still works (read from the file);
  // add it to show it when it is empty all week and to give it its beds.
  const MA_ROOMS = [
    { n: 2, name: 'Boilers' }, { n: 4, name: 'Crocro' },
    { n: 5, name: 'Panorama Point', shared: true, beds: 0, note: 'female' },   // CONFIRM: beds of the female room
    { n: 6, name: 'Safi', beds: 0, note: 'family' },                            // CONFIRM: beds of the family room
    { n: 8, name: 'Banana Point', shared: true, beds: 4, note: 'mixed' },
    { n: 11, name: 'Tifnit' }, { n: 12, name: 'Douira' },
    { n: 13, name: 'Anchor Point', shared: true, beds: 8, note: 'mixed' },
  ];
  // Words that say a row belongs to another camp (the real Sri Lanka export carried a
  // «17 - Castelo beach mixed dorm» row: a number in front of the room is not Morocco).
  const OTHER_CAMPS = /ahangama|sri\s*lanka|castelo|caparica|ericeira|portugal|kids\s*camp|junior\s*camp|hiriketeya|kabalana|marissa|unawatuna|madiha|midigama|wel+igama/i;
  const MA_MARK = /morocco|marrocos|maroc|tamraght|taghazout/i;
  const MA = {
    slug: 'morocco',
    name: 'Morocco',
    campFull: 'Gota Dagua Surf Camp Morocco',
    manager: 'Floriane',
    localManager: null,                                   // no ?view=local in Morocco: Floriane has the full view
    tz: 'Africa/Casablanca',
    currency: 'MAD',
    phoneExample: '+212612345678',
    preset: 'Semana Marrocos',
    blLocations: ['Tamraght Camp'],                        // HQ bookings.location; the Guests preset says «Tamraght Camp (MA)»
    goLive: '2026-11-14',                                 // CONFIRM: trips before it are «Before go-live», never owed
    // Week numbering for the group name. CONFIRM. Morocco is open all year, so week 1 is
    // the first Saturday of 2026 → Sat 14 Nov 2026 is week 46 (close to the calendar week).
    seasonWeek1: '2026-01-03',
    groupDescDefault: 'YOUR WEEKLY SCHEDULE - WEEK {week} ({dates})\n\nEdit me: write the weekly schedule here once. It is kept for the next weeks; {week} and {dates} fill themselves in.',
    airports: ['AGA', 'RAK', 'ESU'], airportDefault: 'AGA', airportCity: { AGA: 'Agadir', RAK: 'Marrakech', ESU: 'Essaouira' },
    places: { aga: 'AGA', agadir: 'AGA', 'agadir airport': 'AGA', 'al massira': 'AGA', rak: 'RAK', marrakech: 'RAK', marrakesh: 'RAK', 'marrakech airport': 'RAK',
      esu: 'ESU', essaouira: 'ESU', cmn: 'CMN', casablanca: 'CMN', tng: 'TNG', tangier: 'TNG', fez: 'FEZ', rba: 'RBA', rabat: 'RBA', lisbon: 'LIS' },
    icaoFlights: true,
    depFromArrival: true,                                 // no departure airport column: RAK in → RAK out (flagged)                                    // EJU5371, EZY2621 are easyJet flights
    ownWayWords: /^(by\s+)?(bus|coach|ctm|supratours|taxi|car|rental car|rent a car|own car|driving|by car)$/i,
    phoneZeroCodes: ['212', '351', '34'],                 // +212 06… → +212 6…
    transferRe: /airport\s+(transfer|shuttle|pick.?up|drop.?off)/gi,
    vehicles: ['Car', 'Minivan', 'Big Van'], vehicleCaps: [4, 8],   // = the /prices airport vehicles (4, 8, 15 seats)
    waVehicle: { 'Car': 'Car', 'Minivan': 'Minivan', 'Big Van': 'Big Van' },
    packages: [],                                         // CONFIRM: does a Morocco package include the transfer or lessons?
    matchRow(pk, acc) {
      const a = low(acc), p = low(pk);
      if (MA_MARK.test(p)) return 'yes';
      const rooms = String(acc || '').split(/\s*,\s*/).filter(Boolean);
      if (rooms.length && rooms.some(r => maRoomKnown(r))) return p.trim() ? 'yes' : 'room';
      if (OTHER_CAMPS.test(a) || OTHER_CAMPS.test(p)) return '';
      // A room of the «N - Name» shape that is not in the list and not another camp's: counted only
      // when the file is a Morocco file (decided in the parser) and flagged.
      return rooms.length && rooms.every(r => /^\s*\d+\s*-\s*\S/.test(r)) ? 'unknown' : '';
    },
    rooms: MA_ROOMS,
    privateRoomBeds: 2,
    runs: { kind: 'other', label: 'Van run', plural: 'Van runs', vehicle: 'Van' },
    payMethod: 'Bank Transfer',
    airportSupplier: 'Let Us Tours',
    // The surf vans (Fathoune) and tours. CONFIRM: 110 MAD is the unit of every van line in the
    // ledger (Apr–Oct 2026, 61 of 62 lines are a multiple of 110), the lines carry qty 1, so the data
    // cannot tell «per person» from «per van leg». The table says per person; change `per` to 'run'.
    vanRates: [
      { key: 'surf', label: 'Surf spot', route: 'Surf', purpose: 'surf', price: 110, per: 'person' },
      { key: 'dunes', label: 'Dunes', route: 'Dunes', purpose: 'tour', tour: 'Dunes — Sandboarding', price: 110, per: 'person' },
      { key: 'paradise', label: 'Paradise Valley', route: 'Paradise Valley', purpose: 'tour', tour: 'Paradise Valley', price: 110, per: 'person' },
      { key: 'paradise-souk', label: 'Paradise + Souk', route: 'Paradise + Souk', purpose: 'tour', tour: 'Paradise Valley', price: 110, per: 'person' },
      { key: 'souk', label: 'Souk', route: 'Souk', purpose: 'tour', tour: 'Souk Tour', price: 110, per: 'person' },
      { key: 'taghazout-party', label: 'Taghazout + Party', route: 'Taghazout + Party', purpose: 'other', price: 110, per: 'person' },
      { key: 'imsouane', label: 'Imsouane', route: 'Imsouane', purpose: 'surf', price: 110, per: 'person' },
    ],
    vanSupplier: 'Fathoune',
    transportHow: 'Airport transfers come from the Guests file (Week → Import) and go to Let Us Tours. Van runs: one tap per run. Everything is paid by SG bank transfer: link the Bank Transfer line to its trips in Reconcile.',
  };

  // «8 - Banana Point mixed shared room (4pax)» → { n: 8, core: 'Banana Point', … }
  function maRoomParse(name) {
    const s = String(name || '').trim(); if (!s) return null;
    const m = s.match(/^\s*(\d+)\s*-\s*(.+)$/);
    const rest = m ? m[2] : s;
    const lowr = rest.toLowerCase();
    const shared = /shared|dorm/.test(lowr);
    const cap = (rest.match(/\((\d+)\s*(?:pax|p|beds?|people)\)/i) || [])[1];
    const core = rest.replace(/\(.*?\)/g, '').replace(/\b(mixed|female|male|girls|family|private|shared|standard|superior|double|twin|triple|room|dorm|ensuite|sea view)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return { n: m ? Number(m[1]) : null, core: core || rest, shared, cap: cap ? Number(cap) : 0,
      female: /female|girls|women/.test(lowr), family: /family/.test(lowr) };
  }
  function maRoomKnown(name) { const r = maRoomParse(name); return !!r && MA_ROOMS.some(x => (r.n != null && x.n === r.n) || low(r.core) === low(x.name)); }

  const CAMPS = { 'sri-lanka': SL, morocco: MA };
  function get(slug) { return CAMPS[slug] || null; }
  const enabledSlugs = () => Object.keys(CAMPS);

  return { get, enabledSlugs, SL, MA, maRoomParse, maRoomKnown, CAMPS };
});
