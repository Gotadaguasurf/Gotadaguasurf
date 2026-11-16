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
    // Transport's page (16 Nov 2026 UX pass): one pill per kind of trip, the words this camp uses. `add` = the blue
    // button of a runs pill (opens today's run sheet on that pill's routes); the Airport pill's blue button sends.
    transportTabs: [{ key: 'airport', label: 'Airport' }, { key: 'tuktuk', label: 'Tuk-tuks', add: 'Add tuk-tuk runs', sheet: 'Tuk-tuk runs' }],
    transportHow: 'Airport transfers to and from Colombo, and the tuk-tuk runs. Pay a driver from «Owed to drivers».',
    localDriversHow: 'Log the tuk-tuk runs and pay the drivers in cash from «Owed to drivers».',
  };

  // ── Morocco (14 Nov 2026) ─────────────────────────────────────────────────
  // Rooms seen on the Bookinglayer list (coordinator, 14 Nov): «N - Name …», the number and
  // «(Npax)» are part of the name. A room missing here still works (read from the file);
  // add it to show it when it is empty all week and to give it its beds.
  // The real «Semana Marrocos» list of 14 Nov (77 rows) has these 13 rooms, spelled as in Bookinglayer
  // («9- Anza Triple Room Ensuite», «11 -Tifnit Private Room»: the spacing around «-» varies). Two rooms
  // share the name Anza (7 private, 9 triple): the number tells them apart. No room 10 in the list.
  const MA_ROOMS = [
    { n: 0, name: 'Tamri' }, { n: 1, name: 'Imsouane' }, { n: 2, name: 'Boilers' }, { n: 3, name: 'La Source' }, { n: 4, name: 'Crocro' },
    { n: 5, name: 'Panorama Point', shared: true, beds: 6, note: 'female' },
    { n: 6, name: 'Safi', beds: 0, note: 'family' },                            // CONFIRM: beds of the family room
    { n: 7, name: 'Anza' },
    { n: 8, name: 'Banana Point', shared: true, beds: 4, note: 'mixed' },
    { n: 9, name: 'Anza', beds: 3, note: 'triple' },
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
    // Trips before it are «Before go-live», never owed. 1 Oct 2026 (16 Nov 2026): May–Sep is settled; the unpaid Let Us
    // Tours airport trips of 1 Oct–12 Nov were added to camp_trips (source manual, import_key «hist2026:…») and are owed.
    // The SQL camp_trips_go_live() is not this date (it only gates Sri Lanka's cash auto-linking).
    goLive: '2026-10-01',
    // «N payments to check» looks at bank lines from this date only (QA 16 Nov 2026): the Oct lines pay September, before
    // the trip list, and linking them to Oct/Nov trips would mark those paid. An older line is still linked by hand.
    bankCheckFrom: '2026-11-01',
    // Week numbering for the group name. CONFIRM. Morocco is open all year, so week 1 is
    // the first Saturday of 2026 → Sat 14 Nov 2026 is week 46 (close to the calendar week).
    seasonWeek1: '2026-01-03',
    groupDescDefault: 'YOUR WEEKLY SCHEDULE - WEEK {week} ({dates})\n\nEdit me: write the weekly schedule here once. It is kept for the next weeks; {week} and {dates} fill themselves in.',
    airports: ['AGA', 'RAK', 'ESU'], airportDefault: 'AGA', airportCity: { AGA: 'Agadir', RAK: 'Marrakech', ESU: 'Essaouira' },
    places: { aga: 'AGA', agadir: 'AGA', 'agadir airport': 'AGA', 'al massira': 'AGA', rak: 'RAK', marrakech: 'RAK', marrakesh: 'RAK', 'marrakech airport': 'RAK',
      esu: 'ESU', essaouira: 'ESU', cmn: 'CMN', casablanca: 'CMN', tng: 'TNG', tangier: 'TNG', fez: 'FEZ', rba: 'RBA', rabat: 'RBA', lisbon: 'LIS' },
    icaoFlights: true,
    depFromArrival: true,
    plusOneNames: true,
    productAirport: true,                                 // «Airport Transfer Morocco (Marrakesh)»: the product names the airport
    locationColumn: /tamraght|\(ma\)/i,                   // a «Booking location» column, when the export has one
    // What the import checks so a change on the Bookinglayer side is said out loud (14 Nov):
    // columns the lists need (any one name of a group is enough), the product names and the packages seen so far.
    requiredColumns: [['Accommodations'], ['Bed number'], ['Has transfer'], ['Transfers'], ['Arrives on', 'Check-in on'], ['Departure date', 'Check-out on'],
      ['Arrival time'], ['Arrival flight'], ['Departure time'], ['Departure flight'], ['Packages'], ['Activities'], ['Diet'], ['Phone']],
    productRe: /^airport transfer morocco\s*\(([^)]+)\)/i,       // «Airport Transfer Morocco (Agadir)» / «(Marrakesh)» in the real list
    knownPackages: ['Weekly package Morocco', 'Weekly package Morocco (starting any day of the week)', 'Flexible Package Morocco'],                                   // nameless / same-name +1s are separate people on the trips too                                 // no departure airport column: RAK in → RAK out (flagged)                                    // EJU5371, EZY2621 are easyJet flights
    // A flight field that says how the guest comes («bus», «taxi»): flagged only, the trip is kept (the Guests export cannot
    // tell one transfer leg from two, so no heuristic drops a paid leg — 16 Nov 2026).
    ownWayWords: /^(by\s+)?(bus|coach|ctm|supratours|taxi|car|rental car|rent a car|own car|driving|by car)$/i,
    // A flight / time field that just says no (Floriane, 16 Nov 2026: «NON» = the guest comes on their own that way):
    // no trip in that direction, flagged on the import. «N/A» stays «empty» (ambiguous).
    noWords: /^(non|no|none|nope|nein|nee|nao|não|nada)[.!]?$/i,
    phoneZeroCodes: ['212', '351', '34'],                 // +212 06… → +212 6…
    transferRe: /airport\s+(transfer|shuttle|pick.?up|drop.?off)/gi,
    vehicles: ['Car', 'Minivan', 'Big Van'], vehicleCaps: [4, 8],   // = the /prices airport vehicles (4, 8, 15 seats)
    waVehicle: { 'Car': 'Car', 'Minivan': 'Minivan', 'Big Van': 'Big Van' },
    // The airport driver's message (Let Us Tours, driver Yassine — Floriane, 16 Nov 2026): one block per trip in
    // her shape («Surfcamp to Agadir airport:» / «Agadir airport to Surfcamp», Number of people, Name, Contact
    // WhatsApp, Departure time from camp / Flight number + Arrival time, Date dd.mm.yyyy, Car). GuestsTrips.whatsappText
    // uses it when the camp has it; Sri Lanka has none and keeps its own format.
    waDriver: 'labeled',
    waVehicleDriver: { 'Car': 'small car', 'Minivan': 'minivan', 'Big Van': 'big van' },
    // Transport's «missing information» line: a departure needs the time the driver leaves the camp (pickup_time),
    // which the Guests file never has (its «Departure time» is the flight). Sri Lanka: the flight time is enough.
    depNeedsPickup: true,
    packages: [],                                         // CONFIRM: does a Morocco package include the transfer or lessons?
    matchRow(pk, acc) {
      const a = low(acc), p = low(pk);
      if (MA_MARK.test(p)) return 'yes';
      // Another camp's words first: «13 - Castelo …» shares a number with a Morocco room.
      if (OTHER_CAMPS.test(a) || OTHER_CAMPS.test(p)) return '';
      const rooms = String(acc || '').split(/\s*,\s*/).filter(Boolean);
      if (rooms.length && rooms.some(r => maRoomKnown(r))) return p.trim() ? 'yes' : 'room';
      // A room of the «N - Name» shape that is not in the list and not another camp's: counted only
      // when the file is a Morocco file (decided in the parser) and flagged.
      return rooms.length && rooms.every(r => /^\s*\d+\s*-\s*\S/.test(r)) ? 'unknown' : '';
    },
    rooms: MA_ROOMS,
    privateRoomBeds: 2,
    runs: { kind: 'other', label: 'Van run', plural: 'Van runs', vehicle: 'Van' },
    payMethod: 'Bank Transfer',
    airportSupplier: 'Let Us Tours',
    // The surf vans (Fathoune) and tours. Miguel, 16 Nov 2026: Fathoune charges PER VEHICLE (Car / Minivan /
    // Big Van), never per person; the price is the /prices row «<catalog> — <vehicle>» (picker surf / tours).
    // This table only maps a route to its purpose, its tour(s) and its label; `catalog` names the /prices
    // destination. No catalog row → price 0 and «price to confirm» (`confirm`).
    vanRates: [
      // Mounir Travel Tours (Mounir Fathoune), prices per vehicle from October 2026 (WhatsApp from Floriane, 16 Nov 2026):
      // VAN 04 = Car, VAN 08 = Minivan, VAN 14/15 = Big Van; the prices live in /prices. Before October he charged
      // 110 MAD per person (the old ledger lines). «Taghazout + Party» is gone: the guests pay those drivers directly.
      { key: 'surf', label: 'Surf Taghazout', route: 'Surf', purpose: 'surf', catalog: 'Surf' },
      { key: 'tamri', label: 'Surf Tamri / Anza', route: 'Tamri / Anza', purpose: 'surf', catalog: 'Tamri / Anza' },
      { key: 'imsouane', label: 'Surf Imsouane', route: 'Imsouane', purpose: 'surf', catalog: 'Imsouane' },
      { key: 'dunes', label: 'Dunes', route: 'Dunes', purpose: 'tour', tour: 'Dunes — Sandboarding', catalog: 'Dunes' },
      { key: 'paradise', label: 'Paradise Valley', route: 'Paradise Valley', purpose: 'tour', tour: 'Paradise Valley', catalog: 'Paradise Valley' },
      // No special price: the van to Paradise Valley + the van for the Souk (guests pay 250 + 150). Cost split over both tours by paying guests.
      { key: 'paradise-souk', label: 'Paradise + Souk', route: 'Paradise + Souk', purpose: 'tour', tour: 'Paradise Valley', tours: ['Paradise Valley', 'Souk Tour'], catalogs: ['Paradise Valley', 'Souk'] },
      { key: 'souk', label: 'Souk', route: 'Souk', purpose: 'tour', tour: 'Souk Tour', catalog: 'Souk' },
    ],
    vanSupplier: 'Fathoune',
    // The cleaning team reads Moroccan Darija in Arabic script (Miguel, 14 Nov: «limpeza só, a cozinha é em
    // inglês por agora»). Only the Cleaning messages; every other team message stays English. Guest and room
    // names stay in Latin letters, day numbers in Western digits. Ungendered on purpose (we don't know each
    // guest's gender). The app shows the English beside it to check; only the Darija is copied / sent.
    teamLang: { cleaning: 'ar-MA' },
    darija: {
      checkOut: 'الخروج', checkIn: 'الدخول', rooms: 'البيوت', today: 'اليوم', tomorrow: 'غدا',
      // Date.getUTCDay order: Sun … Sat
      days: ['الحد', 'الثنين', 'الثلاث', 'الربع', 'الخميس', 'الجمعة', 'السبت'],
      months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'],
      nights: n => n === 1 ? 'ليلة وحدة' : n === 2 ? 'جوج ليالي' : n <= 10 ? `${n} ليالي` : `${n} ليلة`,
      from: 'من', until: 'حتى', comma: '، ',
      moveOut: (nights, room) => room ? `مزال ${nights}، من بعد ف ${room}` : `مزال ${nights}، من بعد بلا بيت`,
      bedChange: bed => `نفس البيت، ناموسية جديدة: ${bed}`,
      fromRoom: room => `من ${room}`, fromOutside: 'من برا', oneMoreWeek: 'مزال سيمانة',
      stayWeek: 'من السيمانة اللي فاتت، مزال سيمانة معانا', stayNights: nights => `من السيمانة اللي فاتت، مزال ${nights}`,
      nowInBed: bed => `، دابا ف الناموسية ${bed}`,
      outside: 'برا الكامب', outsideHeader: '*برا الكامب* _(كياكلو معانا الفطور والعشا)_',
      noMoves: 'ما كاين لا دخول لا خروج',
      lastWeek: 'من السيمانة اللي فاتت', then: room => `من بعد ${room}`,
      roomMoves: 'تبديل البيوت (سولو على النهار)',
      // The day message in two parts (Floriane, 16 Nov 2026): the rooms being left, then the rooms to prepare.
      // «Room 2: double bed/1 person» → «بيت 2: ناموسية كبيرة/شخص واحد». CONFIRM the wording with the team.
      room: n => `بيت ${n}`,
      hello: 'السلام! عافاك وجدي هادشي:', thanks: 'شكرا!',
      doubleBed: 'ناموسية كبيرة', twinBeds: 'جوج ناموسيات صغار', doubleOrTwin: 'ناموسية كبيرة ولا جوج صغار؟',
      beds: n => n === 1 ? 'ناموسية وحدة' : `${n} ناموسيات`,
      people: n => n === 1 ? 'شخص واحد' : `${n} أشخاص`,
      leaving: n => n === 1 ? 'شخص واحد خارج' : `${n} أشخاص خارجين`,
      bedChanges: n => n === 1 ? 'واحد كيبدل الناموسية' : `${n} كيبدلو الناموسية`,
    },
    // Morocco's Cleaning message for a day: «CHECK OUT» = one line per room being left, «CHECK IN» = one line per
    // room to prepare (Floriane, 16 Nov 2026). The week message keeps the guests by room.
    cleaningPrepare: true,
    transportTabs: [{ key: 'airport', label: 'Airport' }, { key: 'vans', label: 'Surf vans', add: 'Add surf vans', sheet: 'Surf vans' },
      { key: 'tours', label: 'Tours', add: 'Add tour vans', sheet: 'Tour vans' }],
    transportHow: 'Airport transfers (Let Us Tours), surf vans and tours (Fathoune). Drivers are paid by SG bank transfer from «Owed to drivers».',
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
  // A room of the list = the same name (and the same number when the file has one): a number alone is not enough.
  const maRoomMatch = (r, x) => { const a = low(r.core), b = low(x.name); const named = a === b || a.includes(b) || b.includes(a); return named && (r.n == null || r.n === x.n); };
  function maRoomKnown(name) { const r = maRoomParse(name); return !!r && MA_ROOMS.some(x => maRoomMatch(r, x)); }

  const CAMPS = { 'sri-lanka': SL, morocco: MA };
  function get(slug) { return CAMPS[slug] || null; }
  const enabledSlugs = () => Object.keys(CAMPS);

  return { get, enabledSlugs, SL, MA, maRoomParse, maRoomKnown, maRoomMatch, CAMPS };
});
