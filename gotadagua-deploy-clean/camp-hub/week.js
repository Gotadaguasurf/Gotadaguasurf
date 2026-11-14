// Camp hub · Week (Sri Lanka 13 Nov 2026; Morocco 14 Nov 2026)
//
// Per camp: everything that differs between the camps (names, time zone, rooms,
// airports, week numbering, packages) comes from lib/camp-config.js (CC below).
// Sri Lanka keeps its own room constants here, unchanged.
//
// Francisco's overview of the week (full view only; Nadith's ?view=local has
// no Week tab). The Monday Bookinglayer Guests import lands in camp_week_guests
// (supabase/camp-trips.sql) and fills six tabs:
//
//   Overview    guests in camp per night, and per day: arrivals, departures,
//               transfers, meals, surf students
//   Rooms       occupancy grid (beds × nights)        + the Cleaning message
//   Kitchen     allergies, diets, meals per day       + the Kitchen message
//   Surf        students per day, groups by level     + the Surf message
//   Transfers   every airport trip with its status    + the Transfers message
//   Guests      searchable list, «Copy list»
//
// A message is one WhatsApp text per team, for a day or the whole week: Copy or
// «Send to <contact>» (wa.me). Each send is stored in camp_week_messages
// (supabase/camp-week.sql) so a re-import shows «Changed since sent → Send
// update». Transfers keep their sent state on the trips (camp_trips).
//
// Where the import lives: the Guests import is the first thing Francisco does
// on Monday, so Week has the «Import Guests file» button at the top and shows
// the import there — the same code and state as Transport → Next week
// (TransportUI.importHtml), never a second import. Transport keeps its «Next
// week» pill as a second door to it (transfers-only view, existing habit).
//
// Week works from camp_week_guests alone: HQ bookings has no future stays, so
// hq_match / partner come from the import (bookings only when a ref matched).
// Dates are Colombo dates as strings; nothing goes through UTC.
(function () {
  'use strict';
  const GT = window.GuestsTrips;
  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const CC = (window.CampConfig && CampConfig.get(SLUG)) || (window.CampConfig && CampConfig.SL) || {};
  const IS_SL = SLUG === 'sri-lanka';
  const GTC = IS_SL ? undefined : CC;                 // the parser's settings: none = Sri Lanka's, exactly as before
  const IS_MA_ROOMS = !IS_SL && Array.isArray(CC.rooms);

  // ── Settings ────────────────────────────────────────────────────────────
  const WEEK_ENABLED_LOCATIONS = new Set(['sri-lanka', 'morocco']);
  const FILE_OLD_DAYS = 3;              // chip «Guests file is N days old» after this
  const YOGA_TIME = '08:00';            // shown in the Surf message (B1 template)
  const YOGA_PAY_CATEGORIES = ['Salary', 'Tours & activities', 'Tours'];
  const YOGA_CHECK_FROM_WEEKDAY = 5;    // 0 = Sat … 6 = Fri: the «no Yoga payment» chip for the running week shows from Thu
  const UNDO_MS = 5000;
  // Room order of the staff images (shared rooms first in the file anyway).
  const ROOM_ORDER = ['marissa', 'kabalana', 'unawatuna', 'hiriketeya', 'ahangama', 'madiha', 'midigama', 'welligama', 'weligama'];
  const TEAMS = [
    { k: 'cleaning', label: 'Cleaning', contact: 'cleaning_contact', role: 'Cleaning lead' },
    { k: 'kitchen', label: 'Kitchen', contact: 'kitchen_contact', role: 'Kitchen lead' },
    { k: 'surf', label: 'Surf', contact: 'surf_contact', role: 'Surf head' },
    { k: 'transfers', label: 'Transfers', contact: 'transfers_contact', role: 'Transfers' },
    { k: 'guests', label: 'Guests' },
  ];
  // The tabs of the page; `team` = whose message sits at the bottom of the tab.
  const TABS = [
    { k: 'overview', label: 'Overview' }, { k: 'rooms', label: 'Rooms', team: 'cleaning' }, { k: 'kitchen', label: 'Kitchen', team: 'kitchen' },
    { k: 'surf', label: 'Surf', team: 'surf' }, { k: 'transfers', label: 'Transfers', team: 'transfers' }, { k: 'guests', label: 'Guests', team: 'guests' },
  ];
  // The rooms of the camp, so a room that is empty all week still shows in the grid.
  // `beds` only for shared rooms (free beds are counted); private rooms are free or taken as a whole.
  const CAMP_ROOMS = [
    { w: 'marissa', beds: 4, note: '4 beds' }, { w: 'kabalana', beds: 4, note: '4 beds' }, { w: 'unawatuna', beds: 6, note: 'girls' },
    { w: 'hiriketeya' }, { w: 'ahangama' }, { w: 'madiha' }, { w: 'midigama' }, { w: 'welligama' },
  ];
  const NO_ALLERGY = /^(none|none known|no|n\/a|na|nothing|nope|-)$/i;   // answers that are not an allergy
  // The names the camp uses for the rooms (Miguel's own messages), by the first word of the
  // Bookinglayer accommodation name. Edit here.
  const ROOM_SHORT = {
    marissa: 'Mirissa room', kabalana: 'Kabalana room', unawatuna: 'Unawatuna room', hiriketeya: 'Hiriketeya room', ahangama: 'Ahangama room',
    madiha: 'Madiha room', midigama: 'Midigama room', welligama: 'Weligama room', weligama: 'Weligama room',
  };
  const CAMP_NAME = { 'sri-lanka': 'Sri Lanka', morocco: 'Morocco' };  // the WhatsApp group is named after the camp
  // Week group settings, kept per location in location_state_store (key GROUP_KEY): the season's first
  // Saturday (week 1), the group description template, and per week the invite link and who was invited.
  const GROUP_KEY = 'week_group_v1';
  const SEASON_WEEK1_DEFAULT = IS_SL ? '2026-08-15' : CC.seasonWeek1;   // Sri Lanka: a Saturday → Sat 14 Nov 2026 is week 14 (Morocco: lib/camp-config.js)
  const GROUP_DESC_DEFAULT = IS_SL ? '📅 YOUR WEEKLY SCHEDULE - WEEK {week} ({dates})\n\nEdit me: write the weekly schedule here once. It is kept for the next weeks; {week} and {dates} fill themselves in.' : CC.groupDescDefault;
  const CHANGEOVER_WEEKDAY = 6;         // Saturday (Date.getDay): the camp's weeks run Sat–Sat
  const PRIVATE_ROOM_BEDS = 2;          // beds of a private room (the Day Planner shows two per room)
  const LEVELS = ['Beginner', 'Experienced beginner', 'Intermediate', 'Experienced intermediate', 'Advanced', 'Level not set'];

  const enabled = () => WEEK_ENABLED_LOCATIONS.has(SLUG) && !LOCAL_MANAGER_MODE && !CAMP_TAB_ONLY_MODE;

  const W = {
    week: null, day: null, tab: 'overview', team: 'cleaning', mode: 'lists', q: '', scrollTo: '', groupOutside: true,
    group: { season_start: SEASON_WEEK1_DEFAULT, description: GROUP_DESC_DEFAULT, weeks: {} },
    cache: {},                 // ws → { rows, msgs, msgsOk }
    meta: null,                // latest import { id, at, min, max } | null
    metaLoaded: false, error: '', loading: null, undo: null, busy: new Set(),
  };

  // ── Small helpers ───────────────────────────────────────────────────────
  const TR = () => (window.TransportUI && TransportUI._state) || { trips: [], drivers: [], loaded: false };
  function colomboNow() {
    if (window.TransportUI && TransportUI.colomboNow) return TransportUI.colomboNow();
    return colomboStamp(new Date());
  }
  function colomboStamp(d) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: CC.tz || 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const cToday = () => colomboNow().slice(0, 10);
  const add = (iso, n) => GT.addDaysIso(iso, n);
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fd = iso => iso ? `${DAY[GT.weekday(iso)]} ${Number(iso.slice(8))}` : '';                     // Sat 14
  const fdm = iso => iso ? `${fd(iso)} ${MON[Number(iso.slice(5, 7)) - 1]}` : '';                      // Sat 14 Nov
  const range = (a, b) => a.slice(0, 7) === b.slice(0, 7) ? `${fd(a)} – ${fdm(b)}` : `${fdm(a)} – ${fdm(b)}`;
  const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  const h = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ic = n => (window.AppShell && AppShell.icon) ? AppShell.icon(n) : '';
  const say = (msg, kind) => { if (typeof toast === 'function') toast(msg, kind); };
  const money = n => (typeof lkr === 'function' ? lkr(n) : 'LKR ' + Math.round(n));
  const $ = id => document.getElementById(id);
  const first = name => String(name || '').split(' ')[0];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  function hash(s) {   // FNV-1a 32-bit: change detection only
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return ('0000000' + x.toString(16)).slice(-8);
  }

  // ── Guest facts (pure) ──────────────────────────────────────────────────
  function roomNames(acc) { return String(acc || '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean); }
  // Morocco: «8 - Banana Point mixed shared room (4pax)» → «8 - Banana Point», by room number.
  function maRoomInfo(n) {
    const r = CampConfig.maRoomParse(n); const known = CC.rooms.find(x => (r.n != null && x.n === r.n) || x.name.toLowerCase() === r.core.toLowerCase());
    const num = r.n != null ? r.n : known ? known.n : null;
    const label = num != null ? `${num} - ${known ? known.name : r.core}` : r.core;
    const shared = known ? !!known.shared : r.shared;
    const beds = known && known.beds ? known.beds : r.cap;
    const note = shared ? (beds ? `${beds} beds` : '') + ((known && known.note) || (r.female ? 'female' : '') ? `${beds ? ' · ' : ''}${(known && known.note) || 'female'}` : '') : (known && known.note) || (r.family ? 'family' : '');
    return { key: num != null ? 'ma-' + num : label.toLowerCase(), label, shared, note, order: num != null ? num : 99, beds: beds || 0 };
  }
  function roomInfo(name) {
    const n = String(name || '').trim(); if (!n) return null;
    if (IS_MA_ROOMS) return maRoomInfo(n);
    const low = n.toLowerCase(); const w1 = n.split(/\s+/)[0];
    const shared = /shared|dorm/.test(low);
    let label = w1, note = '';
    if (shared) { const m = n.match(/\((\d+)\s*p\)/i); note = /girls/.test(low) ? 'girls' : m ? `${m[1]} beds` : ''; }
    else label = w1 + (/sea view/.test(low) ? ' Sea View' : '') + ' Ensuite';
    label = ROOM_SHORT[w1.toLowerCase()] || label;      // the name the camp says
    const o = ROOM_ORDER.indexOf(w1.toLowerCase());
    return { key: label.toLowerCase(), label, shared, note, order: o < 0 ? 99 : o };
  }
  const roomOf = g => { const r = roomNames(g.accommodation); return roomInfo(r[r.length - 1]); };
  const movedRooms = g => { const r = roomNames(g.accommodation); return r.length > 1 ? r.map(x => roomInfo(x).label) : null; };
  function course(g) {
    const a = String(g.activities || '') + ' ' + String(g.packages || '');
    if (/intensive/i.test(a)) return 'Intensive';
    if (/coaching/i.test(a)) return 'Coaching';
    if (/surf course|surf lesson|standard surf/i.test(a)) return 'Standard';
    const inc = window.GuestsTrips && GuestsTrips.packageIncludes ? GuestsTrips.packageIncludes(g.packages, GTC) : null;   // package with lessons included
    return inc && inc.course ? inc.course : '';
  }
  function levelOf(g) {
    const l = String(g.level || '').toLowerCase();
    if (!l.trim()) return 'Level not set';
    if (/exp\w*\s+inter/.test(l)) return 'Experienced intermediate';
    if (/exp/.test(l)) return 'Experienced beginner';
    if (/beginner/.test(l)) return 'Beginner';
    if (/intermediate/.test(l)) return 'Intermediate';
    if (/advanced|expert/.test(l)) return 'Advanced';
    return 'Level not set';
  }
  // '' = not answered; 'none' = answered, no restriction («Continental»).
  function dietOf(g) {
    const d = String(g.diet || '').split(' / ').map(s => s.trim()).filter(Boolean)
      .filter(s => !/^(continental|none|no|normal|regular|omnivore|everything)$/i.test(s));
    if (!String(g.diet || '').trim()) return '';
    return d.length ? d.join(' / ') : 'none';
  }
  const allergyOf = g => String(g.allergies || '').split(' / ').map(s => s.trim()).filter(s => s && !NO_ALLERGY.test(s)).join(' / ');
  const isYoga = g => /yoga/i.test(String(g.activities || '') + ' ' + String(g.packages || '')) || !!(window.GuestsTrips && GuestsTrips.packageIncludes && (GuestsTrips.packageIncludes(g.packages, GTC) || {}).yoga);
  const inCamp = (g, d) => g.check_in && g.check_out && g.check_in <= d && d < g.check_out;
  const inWeek = (g, ws) => g.check_in && g.check_out && g.check_in <= add(ws, 6) && g.check_out > ws;
  const bedNum = b => parseInt(b, 10) || 99;
  const byStay = (a, b) => (a.check_in || '').localeCompare(b.check_in || '') || String(a.booking_ref).localeCompare(String(b.booking_ref)) || String(a.bed_number || '').localeCompare(String(b.bed_number || ''), undefined, { numeric: true }) || a.guest_name.localeCompare(b.guest_name);
  const nameSort = (a, b) => a.guest_name.localeCompare(b.guest_name);

  // Who counts, against the latest import (the file holds live guests only, so a
  // cancellation shows up as absence):
  //   in       in the latest file, or outside its check-in range
  //   carry    checked in before the file's range and still here during it → counted, «still here?»
  //   dropped  check-in inside the file's range but not in it → not counted, «cancelled?»
  //   gone     marked «Not here» (booking_status not live) → left out
  function classify(rows, meta) {
    return link(rows.map(g => {
      let st = 'in';
      if (!GT.OK_STATUS.has(String(g.booking_status || '').toLowerCase())) st = 'gone';
      else if (meta && meta.id && (g.raw || {})._kept === meta.id) st = 'in';    // Francisco answered «Still here» for this import
      else if (meta && meta.id && g.import_id !== meta.id && meta.min) {
        if (g.check_in < meta.min) st = g.check_out > meta.min ? 'carry' : 'in';
        else if (g.check_in <= meta.max) st = 'dropped';
      }
      return { ...g, _st: st };
    }));
  }
  const counted = g => g._st === 'in' || g._st === 'carry';

  // The same person on two bookings back to back (check-out of one = check-in of the
  // next) is one stay: no check-out that day, and «from last week» on the check-in list.
  // Names match without accents or case, on first + last name.
  function personKey(name) {
    const w = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    return w.length ? w[0] + ' ' + w[w.length - 1] : '';
  }
  function link(rows) {
    const by = new Map();
    rows.filter(counted).forEach(g => { const k = personKey(g.guest_name); if (k) { if (!by.has(k)) by.set(k, []); by.get(k).push(g); } });
    by.forEach(list => list.forEach(a => { const b = list.find(x => x !== a && x.check_in === a.check_out && a.check_in < a.check_out); if (b && !b._prev && !a._next) { a._next = b; b._prev = a; } }));
    resolveBeds(rows);
    return rows;
  }
  // Beds of a booking with two rooms. Bookinglayer lists the beds as «1, 4» in number order, not
  // in room order (audit of 13 Nov: rooms «Marissa, Ahangama» + beds «1, 4» = Mirissa bed 4, then Ahangama
  // bed 1). So each order is tried against the size of the room and the beds of the other guests;
  // one order fits → used; otherwise no bed is shown and the move goes to «To check».
  const bedList = g => String(g.bed_number || '').split(',').map(s => s.trim()).filter(Boolean);
  function roomCap(r) {
    if (!r) return 0;
    if (IS_MA_ROOMS) return r.shared ? (r.beds || 0) : (r.beds || CC.privateRoomBeds || PRIVATE_ROOM_BEDS);
    const c = CAMP_ROOMS.find(x => ROOM_SHORT[x.w].toLowerCase() === r.key);
    return c ? (c.beds || PRIVATE_ROOM_BEDS) : r.shared ? (parseInt(r.note, 10) || 0) : PRIVATE_ROOM_BEDS;
  }
  function resolveBeds(rows) {
    const live = rows.filter(counted);
    const fixed = live.filter(g => roomNames(g.accommodation).length === 1 && bedList(g).length === 1);
    const taken = (r, bed, from, to, me) => fixed.some(o => o !== me && sameRoom(roomOf(o), r) && bedList(o)[0] === String(bed) && o.check_in < to && from < o.check_out);
    live.forEach(g => {
      const names = roomNames(g.accommodation); if (names.length < 2) return;
      const beds = bedList(g), md = moveDay(g);
      const rs = [roomInfo(names[0]), roomInfo(names[names.length - 1])];
      const spans = md ? [[g.check_in, md], [md, g.check_out]] : [[g.check_in, g.check_out], [g.check_in, g.check_out]];
      const fits = (i, bed) => { const cap = roomCap(rs[i]); return !(cap && parseInt(bed, 10) > cap) && !taken(rs[i], bed, spans[i][0], spans[i][1], g); };
      const a = beds[0], b = beds[beds.length - 1];
      // Morocco: ONE bed number for a move between a shared and a private room = the bed of the shared room
      // (a private room has no bed to clean apart). Sri Lanka keeps its rule below.
      if (IS_MA_ROOMS && beds.length === 1 && rs[0] && rs[1] && rs[0].shared !== rs[1].shared) {
        const i = rs[0].shared ? 0 : 1;
        g._beds = fits(i, a) ? (i === 0 ? [a, ''] : ['', a]) : null; g._bedsUnclear = !g._beds; return;
      }
      const ok = (beds.length ? (a === b ? [[a, b]] : [[a, b], [b, a]]) : []).filter(o => fits(0, o[0]) && fits(1, o[1]));
      g._beds = ok.length === 1 ? ok[0] : null;
      g._bedsUnclear = !g._beds && beds.length > 0;
    });
  }
  const stayStart = g => { let x = g; while (x._prev) x = x._prev; return x.check_in; };
  const stayEnd = g => { let x = g; while (x._next) x = x._next; return x.check_out; };

  // Where a guest sleeps, night by night. Two rooms on one booking = a room move; the
  // file has no move date, so the move is taken on the changeover Saturday inside the
  // stay (the camp's weeks run Sat–Sat). With no Saturday inside, the last room counts
  // for the whole stay and the move stays in «To check».
  function moveDay(g) {
    if (!g.check_in || !g.check_out) return null;
    for (let d = add(g.check_in, 1); d < g.check_out; d = add(d, 1)) if (GT.weekday(d) === CHANGEOVER_WEEKDAY) return d;
    return null;
  }
  function segments(g) {
    const names = roomNames(g.accommodation);
    const beds = String(g.bed_number || '').split(',').map(s => s.trim());
    const two = names.length > 1 && g._beds !== undefined;   // beds matched to the rooms by resolveBeds
    const seg = (i, from, to) => ({ g, r: roomInfo(names[i]), bed: two ? (g._beds ? g._beds[i ? 1 : 0] : '') : beds[Math.min(i, beds.length - 1)] || '', from, to });
    if (!names.length) return [{ g, r: null, bed: '', from: g.check_in, to: g.check_out }];
    const md = names.length > 1 ? moveDay(g) : null;
    return md ? [seg(0, g.check_in, md), seg(names.length - 1, md, g.check_out)] : [seg(names.length - 1, g.check_in, g.check_out)];
  }
  const roomOn = (g, d) => { const s = segments(g).find(x => x.from <= d && d < x.to); return s ? s.r : null; };
  const firstRoom = g => segments(g)[0].r;
  // The room a guest is in on the day shown (on the check-out day: the room being left), or, for
  // the whole week, the first room of the week — never the last room of the booking when the guest
  // has not moved yet (audit of 13 Nov: a guest shown in the private room a week before moving there).
  function segAt(g, day, ws) {
    const s = segments(g);
    if (day && day !== 'week') return s.find(x => x.from <= day && day < x.to) || s.slice().reverse().find(x => x.to === day) || s[s.length - 1];
    return s.find(x => x.from < add(ws, 7) && x.to > ws) || s[s.length - 1];
  }
  // «Mirissa room · bed 4» + what comes before or after it on the same booking.
  function roomText(g, day, ws, sep) {
    const s = segments(g); const at = segAt(g, day, ws); const i = s.findIndex(y => y.from === at.from && y.to === at.to); const x = s[i];
    if (!x.r) return { label: '', sub: '' };
    return { label: x.r.label + (x.r.shared && x.bed ? `${sep}bed ${x.bed}` : ''),
      sub: s[i + 1] ? `then ${s[i + 1].r ? s[i + 1].r.label : OUTSIDE}, ${fd(s[i + 1].from)}` : i > 0 ? `from ${s[i - 1].r ? s[i - 1].r.label : OUTSIDE}, ${fd(x.from)}` : (moveUnknown(g) ? `from ${movedRooms(g)[0]}` : '') };
  }
  const moveUnknown = g => roomNames(g.accommodation).length > 1 && !moveDay(g);
  const sameRoom = (a, b) => (a ? a.key : '') === (b ? b.key : '');
  const OUTSIDE = 'Outside of camp';
  const nightsNote = n => `${n} ${n === 1 ? 'night' : 'nights'}`;

  // One day for the cleaning team: who leaves a room, who comes into a room, who eats but sleeps outside.
  //   outs     leaving the camp, or leaving this room for another one (with where they go)
  //   ins      new guests, guests coming from another room, and — on the changeover Saturday —
  //            the guests who stay on in the same room («from last week»)
  //   outside  the same, for guests with no room in the file
  function dayMoves(rows, d) {
    const outs = [], ins = [], outside = [], bedChanges = [], outsideOuts = [];
    const changeover = GT.weekday(d) === CHANGEOVER_WEEKDAY;
    rows.filter(counted).forEach(g => {
      const segs = segments(g); const end = stayEnd(g); const left = daysBetween(d, end);
      segs.forEach((s, i) => {
        if (s.to === d) {
          const next = segs[i + 1] || (g._next ? segments(g._next)[0] : null);
          if (!next) (s.r ? outs : outsideOuts).push({ g, r: s.r, bed: s.bed, note: '', leaves: true });   // no room in the file: still on a list
          else if (!sameRoom(next.r, s.r) && s.r) outs.push({ g, r: s.r, bed: s.bed, note: `stays ${nightsNote(left).replace(' ', ' more ')}, in ${next.r ? next.r.label : 'no room yet'}`, move: true });
          // Same room, other bed (a new booking for the next week): the bed is freed for the cleaning team.
          else if (s.r && next.bed && s.bed && String(next.bed) !== String(s.bed)) bedChanges.push({ g, r: s.r, bed: s.bed, note: `stays, moves to bed ${next.bed}`, bedChange: true });
        }
        if (s.from === d) {
          const prev = segs[i - 1] || (g._prev ? segments(g._prev).slice(-1)[0] : null);
          const short = left < 7 ? nightsNote(left) : '';
          let note = short, kind = 'new';
          if (prev && !sameRoom(prev.r, s.r)) { note = [`from ${prev.r ? prev.r.label : 'outside'}`, short || 'one more week with us'].join(', '); kind = 'move'; }
          else if (prev) { const newBed = prev.bed && s.bed && String(prev.bed) !== String(s.bed) ? `, now in bed ${s.bed}` : '';
            if (!changeover && !newBed) return; note = stayOn(left) + newBed; kind = 'stay'; }
          (s.r ? ins : outside).push({ g, r: s.r, bed: s.bed, note, kind });
        } else if (changeover && s.from < d && d < s.to) (s.r ? ins : outside).push({ g, r: s.r, bed: s.bed, note: stayOn(left), kind: 'stay' });
      });
    });
    return { outs, ins, outside, bedChanges, outsideOuts };
  }
  const stayOn = left => left >= 7 ? 'from last week, one more week with us' : `from last week, ${nightsNote(left).replace(' ', ' more ')}`;

  // ── Message builders (pure): parts = [{t:'title'|'h'|'l'|'gap', s}] ─────
  // The camp's own WhatsApp style (Miguel, 13 Nov): a bold title, one block per room or
  // group (bold), guests as «- Name», short notes in brackets (italic). No counts, codes or booking refs.
  const T = s => ({ t: 'title', s }), H = s => ({ t: 'h', s }), L = s => ({ t: 'l', s }), G = { t: 'gap', s: '' };
  const toText = parts => parts.map(p => p.s).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const UP = s => String(s).toUpperCase();
  const dayTitle = (what, d) => `*${what} - ${UP(fdm(d))}*`;                       // *CHECK IN - SAT 14 NOV*
  const weekTitle = (what, ws) => `*${what} - ${Number(ws.slice(8))} TO ${UP(GT.dMon(add(ws, 7)))}*`;   // *ROOMS - 14 TO 21 NOV* («week 14» is the season's week number)
  const dash = (name, note) => `- ${name}${note ? ` _(${note})_` : ''}`;                 // WhatsApp: _italic_ notes
  const B = s => L(`*${s}*`);                                                       // WhatsApp: *bold* headings
  // Stored and compared with the neutral title; sent with «TODAY» / «TOMORROW» when the day is today or tomorrow
  // (the message for a day normally goes out the evening before).
  function dress(text, today) {
    return String(text).replace(/^\*([A-Z ]+) - ([A-Z]{3}) (\d{1,2}) ([A-Z]{3})\*$/gm, (m, what, wd, n, mon) => {
      const hit = [[today, 'TODAY'], [add(today, 1), 'TOMORROW']].find(([d]) => UP(fdm(d)) === `${wd} ${n} ${mon}`);
      return hit ? `*${what} ${hit[1]} - ${n} ${mon}*` : m;
    });
  }
  // Blocks by room: the room name, then «- Name (note)» by bed.
  function roomBlocks(list) {
    const rooms = new Map();
    list.forEach(x => { if (!rooms.has(x.r.key)) rooms.set(x.r.key, { r: x.r, xs: [] }); rooms.get(x.r.key).xs.push(x); });
    const out = [];
    [...rooms.values()].sort((a, b) => a.r.order - b.r.order || a.r.label.localeCompare(b.r.label)).forEach(({ r, xs }) => {
      out.push(B(r.label), ...xs.slice().sort((a, b) => bedNum(a.bed) - bedNum(b.bed) || nameSort(a.g, b.g)).map(x => L(dash(x.g.guest_name, x.note))), G);
    });
    return out;
  }
  const outsideBlock = xs => xs.length ? [L(`*${OUTSIDE}* _(also guests coming for breakfast and dinner)_`), ...xs.slice().sort((a, b) => nameSort(a.g, b.g)).map(x => L(dash(x.g.guest_name, x.note))), G] : [];

  function cleaningDay(rows, d) {
    const m = dayMoves(rows, d);
    const p = [];
    // Every bed that is freed: leaving the camp, moving room, changing bed — and the guests with no room in the file.
    const outs = [...m.outs, ...m.bedChanges];
    if (outs.length || m.outsideOuts.length) p.push(T(dayTitle('CHECK OUT', d)), G, ...roomBlocks(outs), ...outsideBlock(m.outsideOuts));
    if (m.ins.length || m.outside.length) p.push(T(dayTitle('CHECK IN', d)), G, ...roomBlocks(m.ins), ...outsideBlock(m.outside));
    if (!p.length) p.push(T(dayTitle('ROOMS', d)), G, L('No check-in or check-out'));
    return p;
  }
  function stayText(g, ws) { return `${stayStart(g) < ws ? 'here' : fd(g.check_in)} → ${fd(g.check_out)}`; }
  // «from last week», «from Tue 17», «until Mon 16», «Mon 16 to Fri 20»: only what differs from the full week.
  function partOf(from, to, ws, before) {
    const we = add(ws, 7);
    const a = from > ws ? fd(from) : '', b = to < we ? fd(to) : '';
    return a && b ? `${a} to ${b}` : a ? `from ${a}` : b ? `${before ? 'from last week, ' : ''}until ${b}` : before ? 'from last week' : '';
  }
  // The week's stays by room: [{ g, r, bed, from, to, before, note }] (one per room a guest sleeps in).
  function weekStays(rows, ws) {
    const we = add(ws, 7); const out = [];
    rows.filter(counted).forEach(g => segments(g).forEach((s, i, all) => {
      if (!(s.from < we && s.to > ws)) return;
      const before = i === 0 ? stayStart(g) < ws : false;
      const bits = [partOf(s.from, s.to, ws, before)];
      if (all[i + 1]) bits.push(`then ${all[i + 1].r ? all[i + 1].r.label : OUTSIDE.toLowerCase()}`);
      if (i > 0 && all[i - 1].r) bits.unshift(`from ${all[i - 1].r.label}`);
      out.push({ ...s, before, note: bits.filter(Boolean).join(', ') });
    }));
    return out;
  }
  function cleaningWeek(rows, ws) {
    const st = weekStays(rows, ws);
    const p = [T(weekTitle('ROOMS', ws)), G, ...roomBlocks(st.filter(x => x.r)), ...outsideBlock(st.filter(x => !x.r))];
    const unknown = rows.filter(g => counted(g) && inWeek(g, ws) && moveUnknown(g));
    if (unknown.length) p.push(B('Room moves (ask the day)'), ...unknown.map(g => L(dash(g.guest_name, movedRooms(g).join(' → ')))));
    return p;
  }

  function dietGroups(gs) {
    const by = new Map(); gs.forEach(g => { const d = dietOf(g); if (d && d !== 'none') { if (!by.has(d)) by.set(d, []); by.get(d).push(g); } });
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }
  function foodBlocks(gs, note) {
    const p = [];
    dietGroups(gs).forEach(([diet, list]) => p.push(B(diet), ...list.map(g => L(dash(g.guest_name, note ? note(g) : ''))), G));
    const al = gs.filter(g => allergyOf(g));
    if (al.length) p.push(B('Allergies'), ...al.map(g => L(dash(g.guest_name, allergyOf(g).toLowerCase()))), G);
    return p;
  }
  function kitchenDay(rows, d) {
    const gs = rows.filter(g => counted(g) && inCamp(g, d)).sort(nameSort);
    return [T(dayTitle('KITCHEN', d)), G, L(`*Dinner:* ${plural(gs.length, 'person', 'people')}`), L(`*Breakfast ${fd(add(d, 1))}:* ${plural(gs.length, 'person', 'people')}`), G, ...foodBlocks(gs)];
  }
  function kitchenWeek(rows, ws) {
    const we = add(ws, 7);
    const gs = rows.filter(g => counted(g) && inWeek(g, ws)).sort(nameSort);
    const p = [T(weekTitle('KITCHEN', ws)), G, B('Dinner'), L('_(breakfast next morning is the same number)_')];
    for (let i = 0; i < 7; i++) { const d = add(ws, i); p.push(L(`- ${fd(d)}: ${gs.filter(g => inCamp(g, d)).length}`)); }
    p.push(L(`- ${fd(we)}: breakfast only`), G);
    p.push(...foodBlocks(gs, g => partOf(g.check_in, g.check_out, ws, false)));
    return p;
  }

  const courseCounts = gs => ({ S: gs.filter(g => course(g) === 'Standard').length, I: gs.filter(g => course(g) === 'Intensive').length, C: gs.filter(g => course(g) === 'Coaching').length });
  const courseNote = g => course(g) === 'Standard' ? '' : course(g).toLowerCase();
  function levelBlocks(students, note) {
    const p = [];
    LEVELS.map(lv => [lv, students.filter(g => levelOf(g) === lv)]).filter(([, l]) => l.length)
      .forEach(([lv, l]) => p.push(B(lv), ...l.map(g => L(dash(g.guest_name, note(g)))), G));
    return p;
  }
  function surfDay(rows, d) {
    const here = rows.filter(g => counted(g) && inCamp(g, d)).sort(byStay);
    const st = here.filter(g => course(g));
    const p = [T(dayTitle('SURF', d)), G, ...levelBlocks(st, courseNote)];
    if (!st.length) p.push(L('No surf students'), G);
    const yoga = here.filter(isYoga).length;
    if (yoga) p.push(L(`*Yoga ${YOGA_TIME}:* ${plural(yoga, 'guest')}`));
    return p;
  }
  function partOfWeek(g, ws) { return partOf(g.check_in, g.check_out, ws, false); }
  function surfWeek(rows, ws) {
    const gs = rows.filter(g => counted(g) && inWeek(g, ws)).sort(byStay);
    const st = gs.filter(g => course(g));
    const p = [T(weekTitle('SURF', ws)), G, ...levelBlocks(st, g => [courseNote(g), partOfWeek(g, ws)].filter(Boolean).join(', '))];
    if (!st.length) p.push(L('No surf students'), G);
    const none = gs.filter(g => !course(g));
    if (none.length) p.push(B('No lessons'), ...none.map(g => L(dash(g.guest_name, partOfWeek(g, ws)))), G);
    const yoga = gs.filter(isYoga).length;
    if (yoga) p.push(L(`*Yoga ${YOGA_TIME}:* ${plural(yoga, 'guest')}`));
    return p;
  }

  // Transfers: the trips of Transport, Miguel's fixed format (GuestsTrips.whatsappText).
  const tripDone = t => (window.TransportUI && TransportUI.isDone) ? TransportUI.isDone(t) : t.status === 'done';
  const liveTrip = t => (t.kind === 'airport_arrival' || t.kind === 'airport_departure') && !['cancelled', 'no_show', 'merged'].includes(t.status)
    && !t.payment_entry_id && !tripDone(t);   // still to do — the same trips Transport's «Send the whole day» sends
  const tripSort = (a, b) => (a.trip_date + (a.trip_time || '99')).localeCompare(b.trip_date + (b.trip_time || '99'));
  function tripsFor(day, ws) {
    const all = (TR().trips || []).filter(liveTrip);
    return (day === 'week' ? all.filter(t => t.trip_date >= ws && t.trip_date <= add(ws, 6)) : all.filter(t => t.trip_date === day)).sort(tripSort);
  }
  function guestsList(rows, day, ws) {
    const gs = rows.filter(g => counted(g) && (day === 'week' ? inWeek(g, ws) : inCamp(g, day) || g.check_out === day)).sort(byStay);
    return gs;
  }
  function guestLine(g, ws, day) {
    const rt = roomText(g, day, ws, ' '); const c = course(g); const d = dietOf(g);
    return [g.guest_name, rt.label ? rt.label + (rt.sub ? ` (${rt.sub})` : '') : 'no room', stayText(g, ws), g.phone || 'no phone',
      c ? `${c} · ${levelOf(g)}` : 'no lessons', d === 'none' ? 'no special diet' : d || 'diet ?', g.has_transfer ? 'transfer' : 'own way',
      g.partner ? `partner (${g.partner}) – don't charge` : ''].filter(Boolean).join(' · ');
  }

  // body(team, day) for the viewed week — the text compared with what was sent.
  function parts(team, day, ws, rows) {
    if (team === 'cleaning') return day === 'week' ? cleaningWeek(rows, ws) : cleaningDay(rows, day);
    if (team === 'kitchen') return day === 'week' ? kitchenWeek(rows, ws) : kitchenDay(rows, day);
    if (team === 'surf') return day === 'week' ? surfWeek(rows, ws) : surfDay(rows, day);
    if (team === 'transfers') { const list = tripsFor(day, ws); return list.length ? [L(GT.whatsappDayText(list, GTC))] : [L('No transfers')]; }
    if (team === 'guests') { const gs = guestsList(rows, day, ws); return [T(`Guests – ${day === 'week' ? 'week ' + range(ws, add(ws, 7)) : fdm(day)} (${gs.length})`), G, ...gs.map(g => L(guestLine(g, ws, day)))]; }
    return [];
  }
  const body = (team, day, ws, rows) => toText(parts(team, day, ws, rows));
  // UPDATE header + the lines that changed (a line diff of the sent text against today's).
  function lineDiff(oldText, newText) {
    const strip = t => t.split('\n').slice(1).map(s => s.trim()).filter(Boolean);
    const a = strip(oldText), b = strip(newText);
    const left = a.slice(); const added = [];
    b.forEach(x => { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else added.push(x); });
    return [...left.map(x => '– ' + x), ...added.map(x => '+ ' + x)];
  }
  // Miguel, 13 Nov: «não quero update — sempre que mando tem de ser o real». A resend is the
  // real, current message, never an UPDATE header or a diff. «Changed since sent» only tells
  // Francisco that the team has an old version.
  function updateText(oldText, newText) { return newText; }
  function transfersUpdate(list) { return GT.whatsappDayText(list, GTC); }


  // ── Data ────────────────────────────────────────────────────────────────
  const client = () => (typeof getHubSupabaseClient === 'function') ? getHubSupabaseClient() : null;
  const missingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));
  async function loadMeta() {
    const c = client(); const loc = await ensureHubLocationId().catch(() => '');
    if (!c || !loc) return;
    const { data, error } = await c.from('camp_week_guests').select('import_id,updated_at').eq('location_id', loc).order('updated_at', { ascending: false }).limit(1);
    if (error) { W.error = error.message || String(error); W.metaLoaded = true; return; }
    const top = (data || [])[0];
    if (!top) { W.meta = null; W.metaLoaded = true; W.error = ''; return; }
    let min = null, max = null;
    if (top.import_id) {
      const r = await c.from('camp_week_guests').select('check_in').eq('location_id', loc).eq('import_id', top.import_id);
      (r.data || []).forEach(x => { if (x.check_in) { if (!min || x.check_in < min) min = x.check_in; if (!max || x.check_in > max) max = x.check_in; } });
    }
    W.meta = { id: top.import_id, at: top.updated_at, min, max }; W.metaLoaded = true; W.error = '';
  }
  async function loadWeek(ws, force) {
    if (W.cache[ws] && !force) return W.cache[ws];
    const c = client(); const loc = await ensureHubLocationId().catch(() => '');
    if (!c || !loc) { W.error = 'Not connected'; return null; }
    const [g, m] = await Promise.all([
      c.from('camp_week_guests').select('*').eq('location_id', loc).lte('check_in', add(ws, 7)).gte('check_out', ws).order('check_in'),
      c.from('camp_week_messages').select('*').eq('location_id', loc).eq('week_start', ws).order('sent_at', { ascending: false }),
    ]);
    if (g.error) { W.error = g.error.message || String(g.error); return null; }
    W.error = '';
    const entry = { rows: g.data || [], msgs: m.error ? [] : (m.data || []), msgsOk: !m.error, msgsMissing: missingTable(m.error) };
    W.cache[ws] = entry;
    return entry;
  }
  async function loadAll(force) {
    if (!enabled()) return;
    if (W.loading && !force) return W.loading;
    W.loading = (async () => {
      if (force) W.cache = {};
      await Promise.all([loadMeta(), loadGroup()]);
      const ws = W.week || GT.weekStart(cToday());
      await Promise.all([loadWeek(ws, force), loadWeek(GT.weekStart(cToday()), force), loadWeek(add(GT.weekStart(cToday()), -7), force)]);
      if (window.TransportUI && !TR().loaded && TransportUI.load) { try { await TransportUI.load(); } catch (_) {} }
    })();
    try { await W.loading; } finally { W.loading = null; }
    try { window.dispatchEvent(new CustomEvent('camp-checks-changed')); } catch (_) {}
    if (typeof activePage !== 'undefined' && activePage === 'week') render();
  }
  const rowsOf = ws => classify((W.cache[ws] || { rows: [] }).rows, W.meta);

  // ── Contacts (camp_drivers rows with default_for '<team>_contact') ──────
  const contactOf = team => { const t = TEAMS.find(x => x.k === team); return t && t.contact ? (TR().drivers || []).find(d => d.active !== false && (d.default_for || []).includes(t.contact)) : null; };

  // ── Changed since sent ──────────────────────────────────────────────────
  function latestMsgs(ws) {
    const seen = new Set(); const out = [];
    ((W.cache[ws] || {}).msgs || []).forEach(m => { const k = m.team + '|' + m.day; if (!seen.has(k)) { seen.add(k); out.push(m); } });
    return out;
  }
  function changes(ws) {
    const rows = rowsOf(ws); const out = [];
    latestMsgs(ws).forEach(m => { if (m.team !== 'transfers' && hash(body(m.team, m.day, ws, rows)) !== m.hash) out.push({ team: m.team, day: m.day }); });
    const days = [...new Set(tripsFor('week', ws).filter(t => t.needs_resend).map(t => t.trip_date))].sort();
    days.forEach(d => out.push({ team: 'transfers', day: d }));
    return out;
  }
  const changeLabel = c => `${TEAMS.find(t => t.k === c.team).label} (${c.day === 'week' ? 'Week' : DAY[GT.weekday(c.day)]})`;
  function sentOf(team, day, ws) { return latestMsgs(ws).find(m => m.team === team && m.day === day) || null; }

  // ── To check: each gap belongs to one tab ───────────────────────────────
  function toCheck(ws) {
    const rows = rowsOf(ws); const wk = rows.filter(g => inWeek(g, ws));
    const live = wk.filter(counted);
    const items = [];
    const names = gs => gs.map(g => g.guest_name).join(', ');
    const noLevel = live.filter(g => course(g) && levelOf(g) === 'Level not set');
    if (noLevel.length) items.push({ tab: 'surf', short: `${noLevel.length} without level`, text: `${plural(noLevel.length, 'surf student')} without level – ask at check-in`, who: names(noLevel) });
    const noDiet = live.filter(g => !dietOf(g));
    if (noDiet.length) items.push({ tab: 'kitchen', short: `${noDiet.length} without diet answer`, text: `${plural(noDiet.length, 'guest')} didn't answer diet – ask at the welcome dinner`, who: names(noDiet) });
    // Nobody lost: every live guest of the week must have a room on every night (placement()).
    const pl = placement(ws, rows);
    const mate = g => { const m = rows.find(x => x !== g && counted(x) && x.booking_ref === g.booking_ref && roomOf(x)); return m ? ` (same booking as ${m.guest_name}, ${roomOf(m).label})` : ''; };
    if (pl.noRoom.length) items.push({ tab: 'rooms', short: `${pl.noRoom.length} without a room`, text: `${plural(pl.noRoom.length, 'guest')} without a room in the file – counted as outside of camp (meals only)`, who: pl.noRoom.map(g => g.guest_name + mate(g)).join(', ') });
    // Morocco: a room the settings do not know (no beds, not shown when empty) — add it to lib/camp-config.js.
    const unlisted = IS_MA_ROOMS ? live.filter(g => roomNames(g.accommodation).some(n => !CampConfig.maRoomKnown(n))) : [];
    if (unlisted.length) items.push({ tab: 'rooms', short: `${plural(unlisted.length, 'guest')} in a room not in the list`, text: `${plural(unlisted.length, 'guest')} in a room the app does not know yet – counted, but its beds are not checked (ask Miguel to add the room)`, who: unlisted.map(g => `${g.guest_name} (${g.accommodation})`).join(', ') });
    if (pl.clash.length) items.push({ tab: 'rooms', short: `${plural(pl.clash.length, 'bed')} with 2 guests`, text: `${plural(pl.clash.length, 'bed')} with two guests on the same night – check the Day Planner`, who: pl.clash.map(c => `${c.r.label} bed ${c.bed}: ${names(c.gs)} (${fd(c.d)})`).join('; ') });
    if (pl.double.length) items.push({ tab: 'rooms', short: `${plural(pl.double.length, 'room')} with 2 bookings`, text: `${plural(pl.double.length, 'private room')} with two bookings on the same night – check the Day Planner`, who: pl.double.map(c => `${c.r.label}: ${names(c.gs)} (${fd(c.d)})`).join('; ') });
    if (pl.over.length) items.push({ tab: 'rooms', short: `${plural(pl.over.length, 'room')} over its beds`, text: `${plural(pl.over.length, 'room')} with more guests than beds – check the Day Planner`, who: pl.over.map(c => `${c.r.label}: ${c.gs.length} guests for ${c.cap} beds (${fd(c.d)})`).join('; ') });
    if (pl.noBed.length) items.push({ tab: 'rooms', short: `${pl.noBed.length} without a bed`, text: `${plural(pl.noBed.length, 'guest')} in a shared room without a bed number`, who: pl.noBed.map(g => `${g.guest_name}${g._bedsUnclear ? ` (beds «${g.bed_number}» for ${movedRooms(g).join(' → ')}: not clear which is which)` : ''}`).join(', ') });
    const pc = peopleCheck(ws, rows);
    if (!pc.ok) items.push({ tab: 'overview', short: 'People count does not add up', text: 'The people count does not add up – tell Miguel before sending any list', who: pc.problems.join(' · '), kind: 'count' });
    const gaps = stayGaps(ws, rows);
    if (gaps.length) items.push({ tab: 'guests', short: `${plural(gaps.length, 'guest')} leaving and coming back?`, text: `${plural(gaps.length, 'guest')} with two bookings and nights with no booking in between – leaving and coming back, or staying?`, who: gaps.map(x => `${x.a.guest_name} (out ${fdm(x.a.check_out)}, back ${fdm(x.b.check_in)})`).join(', ') });
    const dates = live.filter(dateDiff);
    if (dates.length) items.push({ tab: 'guests', short: `${plural(dates.length, 'guest')} with other arrival dates`, text: `${plural(dates.length, 'guest')} with arrival or departure dates that differ from the room dates – counted by the room dates`, who: dates.map(g => `${g.guest_name} (${dateDiff(g)})`).join(', ') });
    const noTime = tripsFor('week', ws).filter(t => !t.trip_time);
    if (noTime.length) items.push({ tab: 'transfers', short: `${plural(noTime.length, 'transfer')} without time`, text: `${plural(noTime.length, 'transfer')} without flight time – ask the guest`, who: noTime.map(t => t.guest_names || 'Guest').join(', ') });
    const carry = wk.filter(g => g._st === 'carry');
    if (carry.length) items.push({ tab: 'guests', short: `${carry.length} still here?`, text: `${plural(carry.length, 'guest')} in camp ${carry.length === 1 ? 'is' : 'are'} not in the latest Guests file – still here?`, guests: carry, kind: 'carry' });
    const dropped = wk.filter(g => g._st === 'dropped');
    if (dropped.length) items.push({ tab: 'guests', short: `${dropped.length} cancelled?`, text: `${plural(dropped.length, 'guest')} dropped out of the latest Guests file – cancelled? Not counted`, guests: dropped, kind: 'dropped' });
    const zero = live.filter(g => { const raw = String((g.raw || {}).Phone || '').replace(/\s+/g, ''); return raw && g.phone && raw !== g.phone; });
    if (zero.length) items.push({ tab: 'guests', short: `${plural(zero.length, 'phone')} fixed`, text: `${plural(zero.length, 'phone')} had a wrong 0 after the country code – fixed, check before sending`, who: zero.map(g => `${g.guest_name} ${g.phone}`).join(', ') });
    const noPhone = groupPeople(ws, rows, true).filter(x => !x.phone);
    if (noPhone.length) items.push({ tab: 'guests', short: `${noPhone.length} without a phone`, text: `${plural(noPhone.length, 'guest')} without a valid phone – not in the week group contacts`, who: noPhone.map(x => x.g.guest_name + (x.g.phone ? ` (${x.g.phone})` : '')).join(', ') });
    const moves = live.filter(g => movedRooms(g));
    const fixed = moves.filter(g => !moveUnknown(g)), open = moves.filter(moveUnknown);
    if (fixed.length) items.push({ tab: 'rooms', short: `${plural(fixed.length, 'room move')} to confirm`, text: `${plural(fixed.length, 'room move')} taken on the Saturday – the file has no move date, check the Day Planner`, who: fixed.map(g => `${g.guest_name} (${movedRooms(g).join(' → ')}, ${fd(moveDay(g))})`).join(', ') });
    if (open.length) items.push({ tab: 'rooms', short: `${plural(open.length, 'room move')} without date`, text: `${plural(open.length, 'room move')} without a date – check the Day Planner`, who: open.map(g => `${g.guest_name} (${movedRooms(g).join(' → ')})`).join(', ') });
    return items;
  }

  // ── Nobody lost ─────────────────────────────────────────────────────────
  // Where every live guest of the week sleeps, night by night — straight from the rows (dates,
  // room, bed), not from the lists. What cannot be placed goes to «To check».
  function placement(ws, rows) {
    const live = rows.filter(g => counted(g) && inWeek(g, ws));
    const noRoom = new Set(), noBed = new Set(), clash = new Map(), dbl = new Map(), over = new Map();
    for (let i = 0; i < 7; i++) {
      const d = add(ws, i); const beds = new Map(), rooms = new Map();
      live.filter(g => inCamp(g, d)).forEach(g => {
        const s = segments(g).find(x => x.from <= d && d < x.to);
        if (!s || !s.r) { noRoom.add(g); return; }
        if (!rooms.has(s.r.key)) rooms.set(s.r.key, { r: s.r, gs: [] }); rooms.get(s.r.key).gs.push(g);
        if (!s.r.shared) return;
        if (!s.bed) { noBed.add(g); return; }
        const k = s.r.key + '|' + s.bed; if (!beds.has(k)) beds.set(k, { r: s.r, bed: s.bed, gs: [] }); beds.get(k).gs.push(g);
      });
      beds.forEach((x, k) => { if (x.gs.length > 1 && !clash.has(k)) clash.set(k, { ...x, d }); });
      rooms.forEach((x, k) => {
        const cap = roomCap(x.r);
        if (cap && x.gs.length > cap && !over.has(k)) over.set(k, { ...x, cap, d });
        if (!x.r.shared && new Set(x.gs.map(g => g.booking_ref)).size > 1 && !dbl.has(k)) dbl.set(k, { ...x, d });
      });
    }
    return { noRoom: [...noRoom], noBed: [...noBed], clash: [...clash.values()], double: [...dbl.values()], over: [...over.values()] };
  }
  // The same person on two bookings with nights in between that have no booking (audit of 13 Nov:
  // a guest out on Sat 14 and back on Sat 21): the file cannot say whether he leaves or stays.
  const GAP_MAX_NIGHTS = 14;
  function stayGaps(ws, rows) {
    const by = new Map(); const out = [];
    rows.filter(counted).forEach(g => { const k = personKey(g.guest_name); if (k && g.check_in && g.check_out) { if (!by.has(k)) by.set(k, []); by.get(k).push(g); } });
    by.forEach(list => { list.sort(byStay); for (let i = 1; i < list.length; i++) { const a = list[i - 1], b = list[i]; const n = daysBetween(a.check_out, b.check_in);
      if (n > 0 && n <= GAP_MAX_NIGHTS && a.check_out <= add(ws, 7) && b.check_in >= ws) out.push({ a, b, nights: n }); } });
    return out;
  }
  // «Arrives on» / «Departure date» of the file against the room dates (audit of 13 Nov: a bed from Sat 7, the guest arrives Mon 9).
  function dateDiff(g) {
    const raw = g.raw || {}; const arr = GT.ymd(raw['Arrives on']), dep = GT.ymd(raw['Departure date']);
    return [arr && g.check_in && arr !== g.check_in ? `room from ${fd(g.check_in)}, arrives ${fd(arr)}` : '', dep && g.check_out && dep !== g.check_out ? `room until ${fd(g.check_out)}, leaves ${fd(dep)}` : ''].filter(Boolean).join('; ');
  }
  // The cross-check behind «people count»: the live guests of the week, counted from the rows by
  // their dates alone, against what the lists show — the Guests list, the night counts, the meals
  // and the Rooms grid (people, not bars). Any difference is a bug in the lists: shown, never hidden.
  function peopleCheck(ws, rows) {
    const live = rows.filter(counted);
    const want = live.filter(g => g.check_in && g.check_out && g.check_in <= add(ws, 6) && g.check_out > ws);
    const M = weekModel(ws, rows), P = roomPlan(ws, rows);
    const problems = []; const ids = list => new Set(list.map(g => g.id || g.booking_ref + '|' + g.guest_name));
    const missing = (list, label) => { const have = ids(list); const lost = want.filter(g => !have.has(g.id || g.booking_ref + '|' + g.guest_name));
      if (lost.length) problems.push(`not in ${label}: ${lost.map(g => g.guest_name).join(', ')}`); };
    missing(M.guests, 'the week'); missing(guestsList(rows, 'week', ws), 'Guests');
    missing(P.rooms.flatMap(r => r.lanes.flatMap(l => l.items.flatMap(it => it.gs))), 'Rooms');
    const upside = want.filter(g => g.check_in >= g.check_out);
    if (upside.length) problems.push(`check-out is not after check-in: ${upside.map(g => g.guest_name).join(', ')}`);
    const nights = [];
    for (let i = 0; i < 7; i++) {
      const d = add(ws, i); const n = want.filter(g => g.check_in <= d && d < g.check_out).length; const x = M.days[i];
      const grid = P.rooms.reduce((s, r) => s + r.lanes.reduce((s2, l) => s2 + l.items.filter(it => it.a <= i && i < it.b).reduce((s3, it) => s3 + it.gs.length, 0), 0), 0);
      nights.push(n);
      if (x.sleep + x.outside !== n) problems.push(`${fd(d)}: ${n} guests by their dates, ${x.sleep + x.outside} in camp + outside`);
      if (x.dinner !== n) problems.push(`${fd(d)}: ${n} guests, ${x.dinner} for dinner`);
      if (M.days[i + 1].breakfast !== n) problems.push(`${fd(add(d, 1))}: ${n} slept, ${M.days[i + 1].breakfast} for breakfast`);
      if (grid !== n) problems.push(`${fd(d)}: ${n} guests, ${grid} in the Rooms grid`);
    }
    return { ok: !problems.length, guests: want.length, nights, problems };
  }

  // ── Week model (pure): what every tab draws ─────────────────────────────
  // Eight days: Sat…Fri plus the closing Saturday (check-outs and the last breakfast).
  // Arrivals and departures come from every counted row, so the people leaving on the
  // opening Saturday (last week's guests) are there too. Breakfast of a day = who slept
  // the night before; dinner = who sleeps tonight — the numbers of the Kitchen message.
  // When a guest coming on their own arrives: the Arrival time, or a time typed in the flight field («13:00», «02h50»).
  const arriveAt = g => g.arrival_time || ((String(g.arrival_flight || '').trim().match(/^(\d{1,2})[:h](\d{2})$/i) || []).slice(1).map(x => x.padStart(2, '0')).join(':')) || '';
  const flightOf = g => { const f = String(g.arrival_flight || '').trim(); return (CC.icaoFlights ? /^[A-Za-z]{2,3}\s?\d{2,4}\b/ : /^[A-Za-z]{2}\s?\d{2,4}\b/).test(f) ? f : ''; };
  const airportTrip = t => (t.kind === 'airport_arrival' || t.kind === 'airport_departure') && !['cancelled', 'merged'].includes(t.status);
  function weekModel(ws, rows) {
    const live = rows.filter(counted);
    const trips = (TR().trips || []).filter(airportTrip);
    const days = [];
    for (let i = 0; i <= 7; i++) {
      const d = add(ws, i);
      const night = live.filter(g => inCamp(g, d)).sort(byStay);          // eats in camp tonight
      const sleep = night.filter(g => roomOn(g, d));                       // sleeps in camp tonight
      const students = night.filter(g => course(g));
      const dayTrips = trips.filter(t => t.trip_date === d).sort(tripSort);
      const refs = new Set(dayTrips.filter(t => t.kind === 'airport_arrival').map(t => t.booking_ref).filter(Boolean));
      const arrivals = live.filter(g => g.check_in === d && !g._prev).sort(byStay);       // new in camp
      const mv = dayMoves(rows, d);
      days.push({
        d, i, closing: i === 7, night, sleep: sleep.length, outside: night.length - sleep.length,
        arrivals, departures: live.filter(g => g.check_out === d && !g._next).sort(byStay),
        staying: live.filter(g => g.check_in === d && g._prev).sort(byStay),               // new booking, same stay
        moves: mv.ins.filter(x => x.kind === 'move'),
        // Everyone who leaves a room or a bed that day: leaving the camp, moving room, changing bed.
        roomOuts: [...mv.outs, ...mv.bedChanges, ...mv.outsideOuts],   // outsideOuts = no room in the file: «Outside of camp»
        breakfast: live.filter(g => inCamp(g, add(d, -1))).length, dinner: night.length,
        students, courses: courseCounts(students), yoga: night.filter(isYoga).length,
        trips: dayTrips, own: i === 7 ? [] : arrivals.filter(g => !g.has_transfer && !refs.has(g.booking_ref)),
      });
    }
    const wk = days.slice(0, 7);
    const guests = live.filter(g => inWeek(g, ws));
    return {
      ws, days, guests, peak: Math.max(0, ...wk.map(x => x.sleep)),
      arrivals: wk.reduce((s, x) => s + x.arrivals.length, 0), departures: wk.reduce((s, x) => s + x.departures.length, 0),
      students: guests.filter(g => course(g)),
    };
  }

  // Rooms: beds (shared) or stays (private) as lanes, nights 0…6 as columns.
  function roomPlan(ws, rows) {
    const st = weekStays(rows, ws);
    const w1 = s => { const x = String(s || '').split(/\s+/)[0].toLowerCase(); return x === 'weligama' ? 'welligama' : x; };
    const rooms = new Map();
    if (IS_MA_ROOMS) CC.rooms.forEach(c => { const r = maRoomInfo(`${c.n} - ${c.name}`); rooms.set(r.key, { key: r.key, label: r.label, shared: r.shared, note: r.note, beds: r.shared ? r.beds : 0, order: r.order, stays: [] }); });
    else CAMP_ROOMS.forEach((c, i) => rooms.set(ROOM_SHORT[c.w].toLowerCase(), { key: c.w, label: ROOM_SHORT[c.w], shared: !!c.beds, note: c.note || '', beds: c.beds || 0, order: i, stays: [] }));
    st.forEach(x => {
      const k = x.r ? x.r.key : '?';
      if (!rooms.has(k)) rooms.set(k, x.r ? { key: k, label: x.r.label, shared: x.r.shared, note: x.r.note, beds: x.r.shared ? (IS_MA_ROOMS ? x.r.beds : (parseInt(x.r.note, 10) || 0)) : 0, order: (IS_MA_ROOMS ? 0 : 50) + x.r.order, stays: [] }
        : { key: '?', label: OUTSIDE, shared: false, none: true, note: '', beds: 0, order: 999, stays: [] });
      rooms.get(k).stays.push({ ...x, a: Math.max(0, daysBetween(ws, x.from)), b: Math.min(7, daysBetween(ws, x.to)), bedN: parseInt(x.bed, 10) || 0,
        cutL: x.before, cutR: stayEnd(x.g) > add(ws, 7) && x.to >= add(ws, 7), moved: x.from > x.g.check_in || x.to < x.g.check_out });
    });
    const free = (lane, s) => lane.items.every(x => x.b <= s.a || x.a >= s.b);
    const out = [...rooms.values()].sort((x, y) => x.order - y.order).map(room => {
      let lanes = [];
      if (room.shared) {
        const cap = Math.max(room.beds, ...room.stays.map(s => s.bedN));
        for (let n = 1; n <= cap; n++) lanes.push({ bed: n, items: [] });
        const place = s => { let lane = s.bedN && free(lanes[s.bedN - 1], s) ? lanes[s.bedN - 1] : lanes.find(l => free(l, s));
          if (!lane) { lane = { bed: 0, extra: true, items: [] }; lanes.push(lane); }
          lane.items.push({ a: s.a, b: s.b, gs: [s.g], cutL: s.cutL, cutR: s.cutR, moved: s.moved }); };
        room.stays.filter(s => s.bedN).forEach(place); room.stays.filter(s => !s.bedN).forEach(place);
      } else {
        const groups = new Map();   // the people of one booking with the same dates share a bar
        room.stays.forEach(s => { const k = (room.none ? s.g.id || s.g.guest_name : s.g.booking_ref || s.g.guest_name) + '|' + s.a + '|' + s.b;
          if (!groups.has(k)) groups.set(k, { a: s.a, b: s.b, gs: [], cutL: s.cutL, cutR: s.cutR, moved: s.moved }); groups.get(k).gs.push(s.g); });
        [...groups.values()].forEach(it => { let lane = lanes.find(l => free(l, it)); if (!lane) { lane = { bed: 0, items: [] }; lanes.push(lane); } lane.items.push(it); });
        if (!lanes.length) lanes.push({ bed: 0, items: [] });
      }
      const used = n => lanes.filter(l => l.items.some(x => x.a <= n && n < x.b)).length;
      const nights = [0, 1, 2, 3, 4, 5, 6].map(n => ({ used: used(n), free: room.shared ? Math.max(0, lanes.filter(l => !l.extra).length - used(n)) : (used(n) ? 0 : 1) }));
      return { ...room, lanes, nights };
    }).filter(r => !r.none || r.stays.length);
    const real = out.filter(r => !r.none);
    return { rooms: out, freeBeds: [0, 1, 2, 3, 4, 5, 6].map(n => real.filter(r => r.shared).reduce((s, r) => s + r.nights[n].free, 0)),
      freeRooms: [0, 1, 2, 3, 4, 5, 6].map(n => real.filter(r => !r.shared).reduce((s, r) => s + r.nights[n].free, 0)) };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Page
  // ════════════════════════════════════════════════════════════════════════
  function renderWeekPage() {
    if (!enabled()) return;
    if (!W.week) W.week = GT.weekStart(cToday());
    if (!W.day) W.day = 'week';
    if (!W.metaLoaded || !W.cache[W.week]) loadAll().then(render);
    render();
  }
  const tabOf = team => (TABS.find(t => t.team === team) || TABS[0]).k;
  const teamOfTab = tab => (TABS.find(t => t.k === tab) || {}).team || '';
  function render() {
    const root = $('weekRoot'); if (!root || !enabled()) return;
    const ws = W.week;
    const head = `<div class="section-head page-head"><div><div class="section-title">Week</div><div class="section-sub">Arrivals, departures, rooms, meals, surf and transfers · messages for the team</div></div>
      <div class="exp-top-actions wk-actions">
        <button class="btn btn-s" onclick="WeekUI.setMode('${W.mode === 'import' ? 'lists' : 'import'}')">${ic(W.mode === 'import' ? 'arrow-left' : 'upload')} ${W.mode === 'import' ? 'Back to the week' : 'Import Guests file'}</button>
        <button class="btn btn-s" onclick="WeekUI.openContacts()">${ic('phone')} Contacts</button></div></div>`;
    if (W.mode === 'import') {
      const tr = $('transportRoot'); if (tr) tr.innerHTML = '';   // one copy of the import inputs in the DOM
      const S = TR();
      let inner = '';
      if (!window.TransportUI || !TransportUI.importHtml) inner = '<div class="status-msg status-warn">Import not available.</div>';
      else if (!S.loaded) inner = S.error ? `<div class="status-msg status-warn">Transport is not set up yet (${h(S.error)}). Ask Miguel to run supabase/camp-trips.sql.</div>` : '<div class="loading">Loading…</div>';
      else inner = TransportUI.importHtml({ title: 'Guests file' });
      const done = S.imp && S.imp.stage === 'done';
      root.innerHTML = head + `<div class="wk-import">${inner}</div>` + (done ? `<div class="wk-after"><button class="btn btn-s" onclick="WeekUI.afterImport()">${ic('list')} See the week</button></div>` : '');
      if (!S.loaded && !S.error && window.TransportUI) TransportUI.load().then(render);
      return;
    }
    if (W.error && !W.cache[ws]) { root.innerHTML = head + `<div class="status-msg status-warn">Week is not set up yet (${h(W.error)}). Ask Miguel to run supabase/camp-trips.sql.</div>`; return; }
    if (!W.cache[ws]) { root.innerHTML = head + '<div class="loading">Loading the week…</div>'; return; }
    const rows = rowsOf(ws);
    const M = weekModel(ws, rows);
    const nGuests = M.guests.length;
    const filters = `<div class="ov-filters wk-filters"><div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous week" onclick="WeekUI.shiftWeek(-7)">${ic('chevron-left')}</button>
        <span class="period-picker-lbl wk-week">${h(weekLabel(ws))}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next week" onclick="WeekUI.shiftWeek(7)">${ic('chevron-right')}</button></div>
      <span class="wk-count">${plural(nGuests, 'guest')}</span>
      <span class="hint wk-file">${W.meta ? `Guests file imported ${h(fileStamp(W.meta.at))}` : 'No Guests file imported yet'}</span></div>`;
    if (!nGuests && !rows.length) {
      root.innerHTML = head + filters + `<div class="empty-state">${ic('users')}<div class="empty-title">No guests this week</div><p>Download the Guests export with the «${h(CC.preset || 'Semana Sri Lanka')}» preset and import it.</p>
        <button class="btn btn-p" onclick="WeekUI.setMode('import')">${ic('upload')} Import Guests file</button></div>`;
      return;
    }
    const checks = toCheck(ws);
    const ch = changes(ws);
    const chHtml = ch.length ? `<div class="health-strip wk-changed"><span class="health-lbl">Changed since sent</span>${ch.map(c => `<button class="health-chip" onclick="WeekUI.go('${c.team}','${c.day}')">${h(changeLabel(c))}</button>`).join('')}</div>` : '';
    const notSaved = (W.cache[ws].msgsMissing) ? `<div class="status-msg status-info wk-soft">Sent messages are not remembered yet — ask Miguel to run supabase/camp-week.sql.</div>` : '';
    const tabs = `<div class="pills wk-tabs" role="tablist">${TABS.map(t => {
      const n = checks.filter(c => c.tab === t.k).length;
      const dot = t.team && ch.some(c => c.team === t.team) ? '<span class="wk-dot" title="Changed since sent"></span>' : '';
      return `<button class="pill${W.tab === t.k ? ' active' : ''}" role="tab" data-tab="${t.k}" onclick="WeekUI.setTab('${t.k}')">${t.label}${n ? `<span class="count wk-n" title="To check">${n}</span>` : ''}${dot}</button>`; }).join('')}</div>`;
    const ctx = { ws, rows, M, checks, ch };
    const view = W.tab === 'rooms' ? roomsTab(ctx) : W.tab === 'kitchen' ? kitchenTab(ctx) : W.tab === 'surf' ? surfTab(ctx)
      : W.tab === 'transfers' ? transfersTab(ctx) : W.tab === 'guests' ? guestsTab(ctx) : overviewTab(ctx);
    root.innerHTML = head + filters + notSaved + tabs + chHtml + `<div class="wk-view wk-view-${W.tab}">${view}</div>`;
    if (W.tab === 'guests' && W.q) filterGuests(W.q);
    const tabsEl = root.querySelector('.wk-tabs'), on = tabsEl && tabsEl.querySelector('.pill.active');   // keep the active tab in sight on a phone
    if (on && tabsEl.scrollWidth > tabsEl.clientWidth) tabsEl.scrollLeft = on.offsetLeft - tabsEl.offsetLeft - (tabsEl.clientWidth - on.offsetWidth) / 2;
    if (W.scrollTo) { const el = $(W.scrollTo); W.scrollTo = ''; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }
  }
  function fileStamp(at) {
    if (!at) return '';
    const s = colomboStamp(new Date(at)); const d = s.slice(0, 10);
    const age = daysBetween(d, cToday());
    return `${fdm(d)} ${s.slice(11, 16)}${age > 0 ? ` · ${plural(age, 'day')} ago` : ''}`;
  }

  // ── Shared pieces ───────────────────────────────────────────────────────
  // To check, for one tab: a compact amber list (always open, no accordion).
  function checkBlock(ctx, tab) {
    const list = ctx.checks.filter(c => c.tab === tab);
    if (!list.length) return '';
    return `<div class="wk-check"><div class="wk-check-hd">${ic('alert')} To check</div><div class="wk-check-list">${list.map(checkItem).join('')}</div></div>`;
  }
  function checkItem(it) {
    if (it.guests) {
      return `<div class="wk-ci"><div class="wk-ci-t">${h(it.text)}</div>${it.guests.map(g => `<div class="wk-ci-g"><span>${h(g.guest_name)} <span class="hint">· ${h(stayText(g, W.week))}</span></span>
        <span class="row">${it.kind === 'carry' ? `<button class="btn btn-s btn-sm" onclick="WeekUI.keep('${g.id}')">Still here</button>` : `<button class="btn btn-s btn-sm" onclick="WeekUI.keep('${g.id}')">Still coming</button>`}
        <button class="btn btn-s btn-sm" onclick="WeekUI.notHere('${g.id}')">Not here</button></span></div>`).join('')}</div>`;
    }
    return `<div class="wk-ci"><div class="wk-ci-t">${h(it.text)}</div><div class="cell-sub">${h(it.who || '')}</div></div>`;
  }
  const toMsgBtn = label => `<button class="btn btn-s btn-sm wk-tomsg" onclick="WeekUI.toMessage()">${ic('send')} ${h(label)}</button>`;
  const cardHead = (title, hint, right) => `<div class="card-hdr"><div><div class="card-title">${title}</div>${hint ? `<div class="card-hint">${hint}</div>` : ''}</div>${right || ''}</div>`;
  const dayHead = d => `<span class="wk-dw">${DAY[GT.weekday(d)]}</span><span class="wk-dn">${Number(d.slice(8))}</span>`;
  const isToday = d => d === cToday();
  // Names grouped by room: «Unawatuna  Lea Brennig, Lorena Marie Glas».
  function byRoom(list, roomFn) {
    const rooms = new Map();
    list.forEach(g => { const r = roomFn(g) || { key: '?', label: OUTSIDE, order: 100 }; if (!rooms.has(r.key)) rooms.set(r.key, { r, gs: [] }); rooms.get(r.key).gs.push(g); });
    return [...rooms.values()].sort((a, b) => a.r.order - b.r.order || a.r.label.localeCompare(b.r.label))
      .map(({ r, gs }) => `<div class="wk-rl"><span class="wk-rm">${h(r.label.replace(/ room$/, ''))}</span><span>${gs.map(g => h(g.guest_name)).join(', ')}</span></div>`).join('');
  }
  // Departures column: by the room they leave, with a short note for a room move or bed change
  // (Miguel, 13 Nov: «tenho 3 pessoas a sair nesse dia» — the cleaning team needs every bed freed).
  function outsByRoom(list) {
    const rooms = new Map();
    list.forEach(o => { const r = o.r || { key: '?', label: OUTSIDE, order: 100 }; if (!rooms.has(r.key)) rooms.set(r.key, { r, os: [] }); rooms.get(r.key).os.push(o); });
    return [...rooms.values()].sort((a, b) => a.r.order - b.r.order || a.r.label.localeCompare(b.r.label))
      .map(({ r, os }) => `<div class="wk-rl"><span class="wk-rm">${h(r.label.replace(/ room$/, ''))}</span><span class="wk-outs">${os.slice().sort((a, b) => bedNum(a.bed) - bedNum(b.bed) || nameSort(a.g, b.g)).map(o => `<span class="wk-out1">${h(o.g.guest_name)}${o.note ? ` <i class="wk-onote">(${h(o.note)})</i>` : ''}</span>`).join('')}</span></div>`).join('');
  }
  // Bars to scale: height in % of the tallest value of the chart.
  const pct = (n, max) => max ? Math.round(n / max * 1000) / 10 : 0;
  function tripBadge(t) {
    if (t.needs_resend && !tripDone(t) && !t.payment_entry_id && t.status !== 'no_show') return ['Time changed', 'badge-amber'];
    if (window.TransportUI && TransportUI.tripState) return TransportUI.tripState(t);
    return t.status === 'no_show' ? ['No-show', 'badge-grey'] : t.status === 'confirmed' ? ['Confirmed', 'badge-green'] : t.status === 'sent' ? ['Sent', 'badge-blue'] : ['Planned', 'badge-grey'];
  }
  const dirBadge = t => t.kind === 'airport_departure' ? '<span class="badge badge-navy">Departure</span>' : '<span class="badge badge-blue">Arrival</span>';

  // The message of a tab's team: day pills, the text, Copy + the one blue Send.
  function messageCard(ctx, team) {
    const { ws, rows, ch } = ctx; const day = W.day;
    const dot = d => ch.some(c => c.team === team && c.day === d) ? '<span class="wk-dot" title="Changed since sent"></span>' : '';
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => add(ws, i));
    const dayPills = `<div class="pills wk-days">${days.map(d => `<button class="pill${day === d ? ' active' : ''}" data-day="${d}" onclick="WeekUI.setDay('${d}')">${fd(d)}${dot(d)}</button>`).join('')}<button class="pill${day === 'week' ? ' active' : ''}" data-day="week" onclick="WeekUI.setDay('week')">Week${dot('week')}</button></div>`;
    const when = day === 'week' ? 'the week' : fdm(day);
    const t = TEAMS.find(x => x.k === team); const c = contactOf(team);
    if (team === 'transfers') {
      const list = tripsFor(day, ws);
      const resend = list.some(x => x.needs_resend);
      const text = list.length ? (resend ? transfersUpdate(list, day, ws) : GT.whatsappDayText(list, GTC)) : '';
      const toTick = list.filter(x => x.status === 'planned' || x.needs_resend).length;
      return `<div class="card wk-card wk-msgcard" id="wkMessage">${cardHead('Message', `Transfers still to do · ${h(when)} · Miguel's format, one block per transfer`)}
        <div class="card-body">${dayPills}${list.length ? `<div class="wk-msg" id="wkMsg">${h(text)}</div>
        <div class="wk-foot"><div class="wk-foot-btns"><button class="btn btn-s" onclick="WeekUI.copy()">${ic('copy')} Copy</button>
          <button class="btn btn-p" id="wkSend" onclick="WeekUI.send()">${ic('send')} ${'Send to ' + h(c ? c.name : 'Transfers')}</button></div>
          <div class="hint wk-state">${toTick ? `${plural(toTick, 'transfer')} not marked sent · <button class="btn-link" onclick="WeekUI.tickTransfers()">Mark sent ✓</button>` : 'All marked sent'}${c && c.phone ? '' : ` · <button class="btn-link" onclick="WeekUI.openContacts()">add phone</button>`}</div></div>`
        : `<div class="hint wk-none">No transfers still to do ${day === 'week' ? 'this week' : 'on this day'}.</div>`}</div></div>`;
    }
    const text = body(team, day, ws, rows);
    const sent = sentOf(team, day, ws);
    const changed = sent && sent.hash !== hash(text);
    const msg = dress(changed ? updateText(sent.text, text, day, ws) : text, cToday());
    return `<div class="card wk-card wk-msgcard" id="wkMessage">${cardHead('Message', `WhatsApp text${c ? ` for ${h(c.name)}` : ''} · ${h(when)}`)}
      <div class="card-body">${dayPills}<div class="wk-msg" id="wkMsg">${waHtml(msg)}</div>${footer(team, day, sent, changed, c, t)}</div></div>`;
  }
  // The preview shows WhatsApp's formatting (*bold*, _notes_); Copy and Send keep the raw text.
  const waHtml = text => h(text).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_(\([^_\n]+\))_/g, '<span class="wk-mnote">$1</span>');
  function footer(team, day, sent, changed, c, t) {
    const who = c ? c.name : t.role;
    const noPhone = !(c && c.phone);
    const undo = W.undo && W.undo.team === team && W.undo.day === day ? ` · <button class="btn-link wk-undo" onclick="WeekUI.undo()">Undo</button>` : '';
    const state = sent ? `Sent ${h(stampOf(sent.sent_at))}${changed ? ' · changed since' : ''}${undo}` : 'Not sent';
    return `<div class="wk-foot"><div class="wk-foot-btns"><button class="btn btn-s" onclick="WeekUI.copy()">${ic('copy')} Copy</button>
        <button class="btn btn-p" id="wkSend" onclick="WeekUI.send()">${ic('send')} ${'Send to ' + h(who)}</button></div>
      <div class="hint wk-state">${state}${noPhone ? ` · <button class="btn-link" onclick="WeekUI.openContacts()">add phone</button>` : ''}</div></div>`;
  }
  function stampOf(at) { const s = colomboStamp(new Date(at)); return `${fd(s.slice(0, 10))} ${s.slice(11, 16)}`; }

  // ── Overview ────────────────────────────────────────────────────────────
  function overviewTab(ctx) {
    const { ws, M, checks } = ctx;
    const last = M.days[7];
    const peakDays = M.days.slice(0, 7).filter(x => x.sleep === M.peak).map(x => DAY[GT.weekday(x.d)]);
    const tiles = `<div class="wk-kpis">
      <div class="kpi"><div class="kpi-label">Guests this week</div><div class="kpi-value num">${M.guests.length}</div><div class="kpi-sub">${plural(M.students.length, 'surf student')}</div></div>
      <div class="kpi"><div class="kpi-label">Arrivals</div><div class="kpi-value num kv-ocean">${M.arrivals}</div><div class="kpi-sub">${M.days[0].arrivals.length ? `${M.days[0].arrivals.length} on ${fd(ws)}` : 'Sat – Fri'}</div></div>
      <div class="kpi"><div class="kpi-label">Departures</div><div class="kpi-value num">${M.departures}</div><div class="kpi-sub">${last.departures.length ? `then ${last.departures.length} on ${fd(last.d)}` : 'Sat – Fri'}</div></div>
      <div class="kpi"><div class="kpi-label">Most in camp</div><div class="kpi-value num">${M.peak}</div><div class="kpi-sub">${M.peak ? h(peakDays.length > 3 ? `${peakDays[0]} – ${peakDays[peakDays.length - 1]}` : peakDays.join(', ')) : 'no one yet'}</div></div></div>`;
    const checkChips = checks.length ? `<div class="health-strip wk-tocheck"><span class="health-lbl">To check</span>${checks.map(c => `<button class="health-chip" onclick="WeekUI.setTab('${c.tab}')">${h(c.short)}</button>`).join('')}</div>` : '';
    const max = Math.max(M.peak, 1);
    const strip = `<div class="card wk-card">${cardHead('Guests in camp each night', 'Arrivals and departures under each day')}
      <div class="card-body"><div class="wk-strip">${M.days.map(x => `<button class="wk-sc${x.closing ? ' closing' : ''}${isToday(x.d) ? ' today' : ''}" onclick="WeekUI.toDay('${x.d}')" title="${h(fdm(x.d))}">
        <span class="wk-sbar">${x.closing ? '' : `<span class="wk-sfill" style="height:${pct(x.sleep, max)}%"><span class="wk-sv num">${x.sleep}</span></span>`}</span>
        <span class="wk-sday">${dayHead(x.d)}</span>
        <span class="wk-sio"><span class="wk-in num">${x.arrivals.length && !x.closing ? '+' + x.arrivals.length : '&nbsp;'}</span><span class="wk-out num">${x.departures.length ? '−' + x.departures.length : '&nbsp;'}</span></span></button>`).join('')}</div>
        <div class="wk-legend"><span><i class="wk-sw sw-ocean"></i>sleeping in camp</span><span><b class="wk-in">+</b> arrivals</span><span><b class="wk-out">−</b> departures</span><span>last column = check-out day ${h(fd(last.d))}</span></div></div></div>`;
    const board = `<div class="card wk-card wk-board"><div class="wk-bhead"><span>Day</span><span>${ic('login')} Arrivals</span><span>${ic('logout')} Departures</span><span>${ic('truck')} Transfers</span><span>Meals</span><span>Surf</span></div>
      ${M.days.map(x => dayRow(x, M)).join('')}</div>`;
    const teams = `<div class="card wk-card">${cardHead('Team messages', 'One WhatsApp text per team, for a day or the whole week')}<div class="wk-teamrows">${TEAMS.filter(t => t.contact).map(t => teamRow(t, ctx)).join('')}</div></div>`;
    // Nobody lost: the count of the file against every list (peopleCheck).
    const pc = peopleCheck(ws, ctx.rows);
    const people = pc.ok ? `<div class="hint wk-people">${ic('check-circle')} People check: ${plural(pc.guests, 'guest')} in the Guests file for this week, all on the lists · every night, meal and room adds up</div>`
      : `<div class="status-msg status-err wk-people bad">The people count does not add up — tell Miguel before sending any list. ${h(pc.problems.join(' · '))}</div>`;
    return tiles + checkChips + people + strip + board + teams;
  }
  function dayRow(x, M) {
    const arr = x.arrivals.length, dep = x.departures.length;
    const blk = (cls, icon, label, n, sign, inner) => `<div class="wk-bc ${cls}${/^<span class="wk-nil">/.test(inner) ? ' empty' : ''}"><div class="wk-bl"><span class="wk-blt">${ic(icon)} ${label}</span>${n ? `<b class="wk-bn num">${sign}${n}</b>` : ''}</div><div class="wk-bi">${inner}</div></div>`;
    const trips = x.trips.map(t => { const [st, cls] = tripBadge(t); return `<div class="wk-tl"><b class="num">${h(t.trip_time || 'time?')}</b> <span class="wk-dir ${t.kind === 'airport_departure' ? 'out' : 'in'}">${t.kind === 'airport_departure' ? 'out' : 'in'}</span> ${h(t.guest_names || 'Guest')} <span class="badge ${cls}">${st}</span></div>`; }).join('');
    const own = x.own.filter(arriveAt);
    const ownHtml = own.length ? `<div class="wk-tl wk-own">On their own: ${own.slice().sort((a, b) => arriveAt(a).localeCompare(arriveAt(b))).map(g => `${h(arriveAt(g))} ${h(g.guest_name)}`).join(', ')}</div>` : '';
    const extra = x.closing ? '' : (x.staying.length ? `<div class="wk-tl wk-own">Staying on (new booking): ${x.staying.map(g => h(g.guest_name)).join(', ')}</div>` : '')
      + x.moves.map(m => `<div class="wk-tl wk-own">Room move: ${h(m.g.guest_name)} → ${h(m.r.label)}</div>`).join('');
    const c = x.courses; const st = x.students.length;
    const surf = x.closing ? '<span class="wk-nil">–</span>' : st ? `<b class="num">${st}</b> ${st === 1 ? 'student' : 'students'}
      <span class="wk-stack" title="Standard ${c.S} · Intensive ${c.I} · Coaching ${c.C}">${[['s', c.S], ['i', c.I], ['c', c.C]].filter(k => k[1]).map(k => `<i class="sk-${k[0]}" style="flex:${k[1]}"></i>`).join('')}</span>
      <span class="cell-sub">${[['Standard', c.S], ['Intensive', c.I], ['Coaching', c.C]].filter(k => k[1]).map(k => `${k[0]} ${k[1]}`).join(' · ')}${x.yoga ? ` · Yoga ${x.yoga}` : ''}</span>` : '<span class="wk-nil">No lessons</span>';
    return `<div class="wk-brow${x.closing ? ' closing' : ''}${isToday(x.d) ? ' today' : ''}" id="wkDay-${x.d}">
      <div class="wk-bday"><div class="wk-bdate">${h(fdm(x.d))}${isToday(x.d) ? ' <span class="badge badge-blue">Today</span>' : ''}</div>
        <div class="wk-bnight">${x.closing ? 'Check-out day' : `<b class="num">${x.sleep}</b> in camp tonight${x.outside ? `<span class="wk-bout">+ ${x.outside} outside, for meals</span>` : ''}`}</div></div>
      ${blk('arr', 'login', 'Arrivals', x.closing ? 0 : arr, '+', x.closing ? (arr ? `<span class="wk-nil">${arr} arriving · next week</span>` : '<span class="wk-nil">–</span>') : (arr ? byRoom(x.arrivals, firstRoom) : '<span class="wk-nil">None</span>') + extra)}
      ${blk('dep', 'logout', 'Departures', x.roomOuts.length, '−', x.roomOuts.length ? outsByRoom(x.roomOuts) : '<span class="wk-nil">None</span>')}
      ${blk('trf', 'truck', 'Transfers', 0, '', trips || ownHtml ? trips + ownHtml : '<span class="wk-nil">None</span>')}
      ${blk('meal', 'coffee', 'Meals', 0, '', `<span class="wk-meal"><b class="num">${x.breakfast}</b> breakfast</span>${x.closing ? '' : `<span class="wk-meal"><b class="num">${x.dinner}</b> dinner</span>`}`)}
      ${blk('srf', 'wave', 'Surf', 0, '', surf)}</div>`;
  }
  function teamRow(t, ctx) {
    const { ws, ch } = ctx; const c = contactOf(t.k);
    let state, cls = 'badge-grey';
    if (t.k === 'transfers') {
      const list = tripsFor('week', ws); const todo = list.filter(x => x.status === 'planned' || x.needs_resend).length;
      state = !list.length ? 'Nothing to send' : todo ? `${todo} to send` : 'All sent'; cls = !list.length ? 'badge-grey' : todo ? 'badge-amber' : 'badge-green';
    } else {
      const sent = latestMsgs(ws).filter(m => m.team === t.k); const changed = ch.filter(x => x.team === t.k).length;
      state = changed ? 'Changed since sent' : sent.length ? `Sent ${stampOf(sent[0].sent_at)}` : 'Not sent'; cls = changed ? 'badge-amber' : sent.length ? 'badge-green' : 'badge-grey';
    }
    return `<button class="wk-team" onclick="WeekUI.go('${t.k}','${W.day}')"><span class="wk-team-n"><b>${h(t.label)}</b><span class="cell-sub">${h(c ? c.name + (c.phone ? '' : ' · no phone yet') : 'No contact yet')}</span></span>
      <span class="badge ${cls}">${h(state)}</span>${ic('chevron-right')}</button>`;
  }

  // ── Rooms ───────────────────────────────────────────────────────────────
  function roomsTab(ctx) {
    const { ws, rows } = ctx;
    const P = roomPlan(ws, rows);
    const we = add(ws, 7);
    const nights = [0, 1, 2, 3, 4, 5, 6];
    // 1 · By room, plain: who is in each room, in and out.
    const person = s => { const g = s.g; const segs = segments(g); const i = segs.findIndex(x => x.from === s.from);
      const from = i > 0 && segs[i - 1].r ? segs[i - 1].r.label : '', to = segs[i + 1] ? (segs[i + 1].r ? segs[i + 1].r.label : OUTSIDE) : '';
      const inTxt = s.before ? '<span class="wk-here">here</span>' : `<span class="wk-in">${h(fd(s.from))}</span>`;
      const outTxt = s.to > we || (s.to === we && stayEnd(g) > we) ? '<span class="wk-here">stays</span>' : `<span class="wk-out">${h(fd(s.to))}</span>`;
      return `<div class="wk-br"><span class="wk-brn">${h(g.guest_name)}${s.bedN && s.r && s.r.shared ? `<span class="wk-bed">bed ${s.bedN}</span>` : ''}${from ? `<span class="cell-sub">from ${h(from)}</span>` : ''}${to ? `<span class="cell-sub">then ${h(to)}</span>` : ''}</span><span>${inTxt}</span><span>${outTxt}</span></div>`; };
    const block = r => `<div class="wk-broom"><div class="wk-brh"><b>${h(r.label)}</b><span class="cell-sub">${r.none ? 'meals only' : r.shared ? `shared${r.note ? ' · ' + h(r.note) : ''}` : 'private'}</span></div>
      ${r.stays.length ? r.stays.slice().sort((a, b) => (a.bedN || 99) - (b.bedN || 99) || a.a - b.a || nameSort(a.g, b.g)).map(person).join('') : '<div class="wk-br"><span class="wk-nil">Empty all week</span></div>'}</div>`;
    const plain = `<div class="card wk-card">${cardHead('By room', `Who is in each room this week · <span class="wk-here">here</span> = already in camp`, toMsgBtn('Cleaning message'))}
      <div class="wk-brhd"><span>Guest</span><span>In</span><span>Out</span></div>
      <div class="wk-byroom">${P.rooms.map(block).join('')}</div></div>`;
    // 2 · The grid: beds × nights.
    const hd = `<div class="wk-gl wk-ghead"><span class="wk-glb"></span>${nights.map(n => `<span class="wk-gh${isToday(add(ws, n)) ? ' today' : ''}">${dayHead(add(ws, n))}</span>`).join('')}</div>`;
    const bar = it => {
      const g0 = it.gs[0];
      const tip = `${it.gs.map(g => g.guest_name).join(' + ')} · ${stayText(g0, ws)}${it.moved ? ' · room move' : ''}`;
      return `<button class="wk-bar${it.cutL ? ' before' : ''}${it.cutR ? ' after' : ''}${g0._st === 'carry' ? ' carry' : ''}" style="grid-column:${it.a + 2} / ${it.b + 2}" title="${h(tip)}" onclick="WeekUI.findGuest(decodeURIComponent('${encodeURIComponent(g0.guest_name)}'))">
        ${it.cutL ? ic('chevron-left') : ''}<span class="wk-bt"><span class="wk-bfull">${it.gs.map(g => h(g.guest_name)).join(' + ')}</span><span class="wk-bshort">${it.gs.map(g => h(first(g.guest_name))).join(' + ')}</span></span>${it.cutR ? ic('chevron-right') : ''}${it.moved ? '<span class="wk-dot" title="Room move"></span>' : ''}</button>`;
    };
    const lane = (l, room, li) => {
      const cells = nights.map(n => l.items.some(x => x.a <= n && n < x.b) ? '' : `<span class="wk-cell${!room.none && (room.shared || li === 0) ? ' free' : ''}" style="grid-column:${n + 2}"></span>`).join('');
      return `<div class="wk-gl${l.extra ? ' extra' : ''}"><span class="wk-glb">${room.shared ? (l.extra ? 'extra' : `<span class="wk-bedw">Bed </span>${l.bed}`) : ''}</span>${cells}${l.items.map(bar).join('')}</div>`;
    };
    const roomHtml = r => `<div class="wk-room"><div class="wk-rhead"><b>${h(r.label)}</b><span class="cell-sub">${r.none ? 'meals only' : r.shared ? `shared${r.note ? ' · ' + h(r.note) : ''}` : 'private'}</span></div>
        ${r.lanes.map((l, i) => lane(l, r, i)).join('')}</div>`;
    const shared = P.rooms.filter(r => r.shared), priv = P.rooms.filter(r => !r.shared && !r.none), none = P.rooms.filter(r => r.none);
    const freeRow = (label, arr) => `<div class="wk-gl wk-gfree"><span class="wk-glb">${label}</span>${arr.map((n, i) => `<span class="wk-fc num${n ? '' : ' zero'}" style="grid-column:${i + 2}">${n}</span>`).join('')}</div>`;
    const grid = `<div class="card wk-card">${cardHead('Beds and nights', 'One bar per stay · a column is a night · dashed = free')}
      <div class="wk-grid">${hd}
        ${shared.length ? `<div class="section-lbl wk-gsec">Shared rooms</div>${shared.map(roomHtml).join('')}` : ''}
        ${priv.length ? `<div class="section-lbl wk-gsec">Private rooms</div>${priv.map(roomHtml).join('')}` : ''}
        ${none.length ? `<div class="section-lbl wk-gsec">${OUTSIDE}</div>${none.map(roomHtml).join('')}` : ''}
        <div class="section-lbl wk-gsec">Free each night</div>
        ${freeRow('<span class="wk-bedw">Shared </span>beds', P.freeBeds)}${freeRow('<span class="wk-bedw">Private </span>rooms', P.freeRooms)}</div>
      <div class="wk-legend wk-glegend"><span><i class="wk-sw sw-bar"></i>stay</span><span>${ic('chevron-left')} here before this week</span><span>${ic('chevron-right')} stays after it</span><span><i class="wk-sw sw-free"></i>free</span><span><span class="wk-dot"></span> room move</span></div></div>`;
    return checkBlock(ctx, 'rooms') + plain + grid + messageCard(ctx, 'cleaning');
  }

  // ── Kitchen ─────────────────────────────────────────────────────────────
  function kitchenTab(ctx) {
    const { ws, M } = ctx;
    const gs = M.guests.slice().sort(nameSort);
    const where = g => { const r = segAt(g, 'week', ws).r; return `${r ? r.label : OUTSIDE} · ${stayText(g, ws)}`; };
    const allergic = gs.filter(g => allergyOf(g));
    const diets = dietGroups(gs);
    const none = gs.filter(g => dietOf(g) === 'none').length, unanswered = gs.filter(g => !dietOf(g)).length;
    const allergyCard = `<div class="card wk-card wk-allergy${allergic.length ? ' has' : ''}">${cardHead(`Allergies and intolerances${allergic.length ? ` <span class="badge badge-red">${allergic.length}</span>` : ''}`, 'From Bookinglayer, filled in by the guests', toMsgBtn('Kitchen message'))}
      <div class="wk-plist">${allergic.length ? allergic.map(g => `<div class="wk-p"><span><b>${h(g.guest_name)}</b><span class="cell-sub">${h(where(g))}</span></span><span class="badge badge-red">${h(allergyOf(g))}</span></div>`).join('')
        : '<div class="wk-p"><span class="hint">None in Bookinglayer for this week.</span></div>'}</div></div>`;
    const dietCard = `<div class="card wk-card">${cardHead('Special diets', `${plural(diets.reduce((s, d) => s + d[1].length, 0), 'guest')} · ${none} with no special diet · ${unanswered} did not answer`)}
      <div class="wk-plist">${diets.length ? diets.map(([diet, list]) => list.map(g => `<div class="wk-p"><span><b>${h(g.guest_name)}</b><span class="cell-sub">${h(where(g))}</span></span><span class="badge badge-green">${h(diet)}</span></div>`).join('')).join('')
        : '<div class="wk-p"><span class="hint">No special diets in Bookinglayer for this week.</span></div>'}</div></div>`;
    const max = Math.max(1, ...M.days.map(x => Math.max(x.breakfast, x.closing ? 0 : x.dinner)));
    const meals = `<div class="card wk-card">${cardHead('Meals per day', 'Guests only, staff not included · breakfast = who slept the night before')}
      <div class="card-body"><div class="wk-chart">${M.days.map(x => `<div class="wk-col${x.closing ? ' closing' : ''}${isToday(x.d) ? ' today' : ''}">
        <div class="wk-bars"><span class="wk-vb sk-b" style="height:${pct(x.breakfast, max)}%"><span class="wk-sv num">${x.breakfast}</span></span>
          ${x.closing ? '<span class="wk-vb none"></span>' : `<span class="wk-vb sk-d" style="height:${pct(x.dinner, max)}%"><span class="wk-sv num">${x.dinner}</span></span>`}</div>
        <div class="wk-sday">${dayHead(x.d)}</div></div>`).join('')}</div>
      <div class="wk-legend"><span><i class="wk-sw sw-navy"></i>breakfast</span><span><i class="wk-sw sw-ocean"></i>dinner</span></div></div></div>`;
    return checkBlock(ctx, 'kitchen') + allergyCard + dietCard + meals + messageCard(ctx, 'kitchen');
  }

  // ── Surf ────────────────────────────────────────────────────────────────
  const COURSE_BADGE = { Standard: 'badge-blue', Intensive: 'badge-navy', Coaching: 'badge-grey' };
  function surfTab(ctx) {
    const { ws, rows, M } = ctx;
    const st = M.students.slice().sort(byStay);
    const wkDays = M.days.slice(0, 7);
    const max = Math.max(1, ...wkDays.map(x => x.students.length));
    const tot = courseCounts(st);
    const chart = `<div class="card wk-card">${cardHead('Morning students per day', `${plural(st.length, 'student')} this week`, toMsgBtn('Surf message'))}
      <div class="card-body"><div class="wk-chart">${wkDays.map(x => { const c = x.courses; const n = x.students.length; return `<div class="wk-col${isToday(x.d) ? ' today' : ''}">
        <div class="wk-bars"><span class="wk-vb wide wk-vstack" style="height:${pct(n, max)}%" title="Standard ${c.S} · Intensive ${c.I} · Coaching ${c.C}"><span class="wk-sv num">${n}</span>${[['c', c.C], ['i', c.I], ['s', c.S]].filter(k => k[1]).map(k => `<i class="sk-${k[0]}" style="flex:${k[1]}"></i>`).join('')}</span></div>
        <div class="wk-sday">${dayHead(x.d)}</div><div class="wk-sub num">${c.S}·${c.I}·${c.C}</div></div>`; }).join('')}</div>
      <div class="wk-legend"><span><i class="wk-sw sw-ocean"></i>Standard ${tot.S}</span><span><i class="wk-sw sw-navy"></i>Intensive ${tot.I}</span><span><i class="wk-sw sw-grey"></i>Coaching ${tot.C}</span><span>under each day: Standard · Intensive · Coaching</span></div>
      <div class="hint wk-yoga">${h(yogaInfo(ws, rows))}</div></div></div>`;
    const person = g => { const c = course(g); const w = partOfWeek(g, ws);
      return `<div class="wk-p"><span><b>${h(g.guest_name)}</b>${w ? `<span class="cell-sub">${h(w)}</span>` : ''}</span><span class="wk-pb">${isYoga(g) ? '<span class="badge badge-green">Yoga</span>' : ''}<span class="badge ${COURSE_BADGE[c] || 'badge-grey'}">${h(c)}</span></span></div>`; };
    const groups = LEVELS.map(lv => [lv, st.filter(g => levelOf(g) === lv)]).filter(([, l]) => l.length);
    const levels = `<div class="card wk-card">${cardHead('Groups by level', 'To split the morning groups')}
      ${groups.map(([lv, l]) => `<div class="wk-lvl"><div class="section-lbl${lv === 'Level not set' ? ' wk-warn' : ''}">${h(lv)} · ${l.length}</div><div class="wk-plist cols">${l.map(person).join('')}</div></div>`).join('') || '<div class="card-body hint">No surf students this week.</div>'}</div>`;
    const inten = st.filter(g => course(g) === 'Intensive');
    const noLessons = M.guests.filter(g => !course(g));
    const yogis = M.guests.filter(isYoga);
    const line = (label, n, text) => `<div class="wk-p wk-note"><span><b>${label}${n ? ` · ${n}` : ''}</b><span class="cell-sub">${text}</span></span></div>`;
    const notes = (inten.length || noLessons.length || yogis.length) ? `<div class="card wk-card">${cardHead('Good to know', 'Bookinglayer only has the start of each course: the head coach picks the days')}<div class="wk-plist">
      ${inten.length ? line('Intensive afternoons', inten.length, `3 afternoons this week, head coach picks: ${h(inten.map(g => g.guest_name).join(', '))}`) : ''}
      ${yogis.length ? line(`Yoga ${YOGA_TIME}`, yogis.length, h(yogis.map(g => g.guest_name).join(', '))) : ''}
      ${noLessons.length ? line('No lessons booked', noLessons.length, h(noLessons.map(g => { const w = partOfWeek(g, ws); return g.guest_name + (w ? ` (${w})` : ''); }).join(', '))) : ''}</div></div>` : '';
    return checkBlock(ctx, 'surf') + chart + levels + notes + messageCard(ctx, 'surf');
  }

  // ── Transfers ───────────────────────────────────────────────────────────
  // «Ask guest for flight & time» — same action as in Transport (TransportUI.ask).
  function askBtn(t) {
    // Flight and time known → «Confirm with guest» and its states, drawn by Transport (TransportUI.guestHtml).
    if (window.TransportUI && TransportUI.guestHtml && TransportUI.needsInfo && !TransportUI.needsInfo(t)) return TransportUI.guestHtml(t);
    const T = window.TransportUI; if (!T || !T.needsInfo || !T.needsInfo(t) || t.payment_entry_id || ['cancelled', 'no_show'].includes(t.status)) return '';
    const what = !t.flight && !t.trip_time ? 'flight & time' : !t.flight ? 'flight' : 'time';
    const on = T.askedOn(t.id);
    return `<span class="wk-ask"><button class="btn btn-s btn-sm" onclick="TransportUI.ask('${t.id}')">Ask guest for ${what}</button>${on ? ` <span class="hint">asked ${h(fdm(on))}</span>` : ''}</span>`;
  }
  function transfersTab(ctx) {
    const { M } = ctx;
    const all = M.days.flatMap(x => x.trips);
    const cost = all.filter(t => t.status !== 'no_show').reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const days = M.days.filter(x => x.trips.length || x.own.length);
    const tripRow = t => { const [st, cls] = tripBadge(t);
      return `<div class="wk-g wk-trip"><span class="wk-time num">${h(t.trip_time || 'time?')}</span><span class="wk-tmain"><span class="wk-g1">${dirBadge(t)} <b>${h(t.guest_names || 'Guest')}</b></span>
        <span class="cell-sub">${h(t.flight || 'flight?')} · ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}${t.vehicle ? ' · ' + h(t.vehicle) : ''}${t.guest_phone ? ' · ' + h(t.guest_phone) : ''}</span>${askBtn(t)}</span><span class="badge ${cls}">${st}</span></div>`; };
    const ownRow = g => `<div class="wk-g wk-trip own"><span class="wk-time num">${h(arriveAt(g))}</span><span class="wk-tmain"><span class="wk-g1"><b>${h(g.guest_name)}</b></span>
      <span class="cell-sub">arrives around this time${flightOf(g) ? ' · ' + h(flightOf(g)) : ''}${g.phone ? ' · ' + h(g.phone) : ''}</span></span><span class="badge badge-grey">Own way</span></div>`;
    const dayHtml = x => {
      const timed = x.own.filter(arriveAt), untimed = x.own.filter(g => !arriveAt(g));
      const rows = [...x.trips.map(t => [t.trip_time || '99', tripRow(t)]), ...timed.map(g => [arriveAt(g), ownRow(g)])].sort((a, b) => a[0].localeCompare(b[0])).map(r => r[1]).join('');
      return `<div class="wk-tday" id="wkTr-${x.d}"><div class="wk-tdh"><b>${h(fdm(x.d))}</b>${isToday(x.d) ? ' <span class="badge badge-blue">Today</span>' : ''}<span class="cell-sub">${[x.trips.length ? plural(x.trips.length, 'transfer') : '', x.own.length ? `${x.own.length} on their own` : ''].filter(Boolean).join(' · ')}</span></div>
        <div class="wk-rows">${rows}${untimed.length ? `<div class="wk-g wk-untimed"><span class="section-lbl">On their own, no arrival time given</span><span class="cell-sub">${untimed.map(g => h(g.guest_name)).join(', ')}</span></div>` : ''}</div></div>`; };
    // Who has an airport transfer booked, arrivals and departures apart (Miguel, 13 Nov:
    // «I need to see good who has the transfers from the airport booked»).
    const byWhen = (a, b) => (a.trip_date + (a.trip_time || '99')).localeCompare(b.trip_date + (b.trip_time || '99'));
    const arrT = all.filter(t => t.kind === 'airport_arrival').sort(byWhen), depT = all.filter(t => t.kind === 'airport_departure').sort(byWhen);
    const people = list => list.filter(t => !['cancelled', 'no_show'].includes(t.status)).reduce((s, t) => s + (Number(t.pax) || 1), 0);
    const bookedRow = t => { const [st, cls] = tripBadge(t);
      return `<div class="wk-g wk-trip wk-booked"><span class="wk-bwhen"><b>${h(fdm(t.trip_date))}</b><span class="num">${h(t.trip_time || 'time?')}</span></span><span class="wk-tmain"><span class="wk-g1"><b>${h(t.guest_names || 'Guest')}</b> <span class="hint">· ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}</span></span>
        <span class="cell-sub">${h(t.flight || 'flight?')}${t.vehicle ? ' · ' + h(t.vehicle) : ''}${t.guest_phone ? ' · ' + h(t.guest_phone) : ''}</span>${askBtn(t)}</span><span class="badge ${cls}">${st}</span></div>`; };
    const sect = (title, sub, list) => `<div class="wk-bsec"><div class="wk-tdh"><b>${title}</b><span class="cell-sub">${list.length ? `${plural(list.length, 'transfer')} · ${plural(people(list), 'person')}` : 'none booked'} · ${sub}</span></div>
      <div class="wk-rows">${list.length ? list.map(bookedRow).join('') : '<div class="wk-g hint">No transfer booked.</div>'}</div></div>`;
    const booked = `<div class="card wk-card wk-bookedcard">${cardHead('Transfers booked', 'Everyone with an airport transfer this week — from the Guests file')}
      ${sect(`${ic('login')} Arrivals`, 'airport → camp', arrT)}${sect(`${ic('logout')} Departures`, 'camp → airport', depT)}</div>`;
    const card = `<div class="card wk-card">${cardHead('Day by day', `${plural(all.length, 'transfer')} this week${cost ? ` · ${h(money(cost))} expected` : ''} · ${IS_SL ? 'tuk-tuks' : 'van runs'} and paying drivers stay in Transport`, toMsgBtn('Transfers message'))}
      ${days.length ? days.map(dayHtml).join('') : '<div class="card-body hint">No airport transfers and no arrivals this week.</div>'}</div>`;
    return checkBlock(ctx, 'transfers') + booked + card + messageCard(ctx, 'transfers');
  }

  // ── Guests ──────────────────────────────────────────────────────────────
  function guestsTab(ctx) {
    const { ws, rows } = ctx; const day = W.day;
    const gs = guestsList(rows, day, ws);
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => add(ws, i));
    const dayPills = `<div class="pills wk-days">${days.map(d => `<button class="pill${day === d ? ' active' : ''}" data-day="${d}" onclick="WeekUI.setDay('${d}')">${fd(d)}</button>`).join('')}<button class="pill${day === 'week' ? ' active' : ''}" data-day="week" onclick="WeekUI.setDay('week')">Week</button></div>`;
    const list = gs.length ? gs.map(g => guestRow(g, ws)).join('') : '';
    const copyBtn = `<span class="row"><button class="btn btn-s btn-sm" onclick="WeekUI.toGroup()">${ic('users')} Week group</button><button class="btn btn-s btn-sm" onclick="WeekUI.copy()">${ic('copy')} Copy list</button></span>`;
    return checkBlock(ctx, 'guests') + `<div class="card wk-card${inviteLinkOk(groupStore(ws).link) ? ' has-invite' : ''}">${cardHead(`Guests · ${day === 'week' ? 'week' : fdm(day)} · <span id="wkGuestN">${gs.length}</span>`, 'For you only — no message to the team.', copyBtn)}
        <div class="wk-gtools"><input class="search wk-search" id="wkSearch" type="search" placeholder="Search name, room, phone, diet…" value="${h(W.q || '')}" oninput="WeekUI.search(this.value)">${dayPills}</div>
        <div class="wk-ghd"><span>Guest</span><span>Stay</span><span>Room</span><span>Surf</span><span>Diet</span><span>Phone</span><span>Arrival</span><span class="wk-ginv">Group</span></div>
        <div class="wk-rows wk-guests">${list}</div><div class="card-body hint wk-noguests"${gs.length ? ' hidden' : ''}>${gs.length ? 'No guest matches the search.' : 'No guests on this day.'}</div></div>` + groupCard(ctx);
  }
  function guestRow(g, ws) {
    const rt = roomText(g, W.day, ws, ' · '); const r = segAt(g, W.day, ws).r; const c = course(g); const d = dietOf(g); const al = allergyOf(g);
    const room = r ? rt.label : OUTSIDE;
    const nights = (g.check_in && g.check_out) ? daysBetween(g.check_in, g.check_out) : 0;
    const pack = String(g.packages || '').trim();
    const arrive = (g.has_transfer ? 'transfer' : 'own way') + (arriveAt(g) ? ' ' + arriveAt(g) : '');
    const q = [g.guest_name, room, g.phone, c, levelOf(g), d, al, g.partner, pack, g.booking_ref].join(' ').toLowerCase();
    return `<div class="wk-g wk-grow" data-q="${h(q)}"><span class="wk-gc name"><span class="wk-g1"><b>${h(g.guest_name)}</b>${g.partner ? ` <span class="badge badge-amber">partner – don't charge</span>` : ''}${g._st === 'carry' ? ' <span class="badge badge-grey">still here?</span>' : ''}${g._prev ? ' <span class="badge badge-blue">stays on</span>' : ''}</span>${pack || g.partner ? `<span class="cell-sub">${h([pack, g.partner && g.partner !== 'partner' ? 'via ' + g.partner : ''].filter(Boolean).join(' · '))}</span>` : ''}</span>
      <span class="wk-gc" data-l="Stay">${h(stayText(g, ws))}${nights ? `<span class="cell-sub">${plural(nights, 'night')}</span>` : ''}</span>
      <span class="wk-gc" data-l="Room">${r ? h(room) : `<span class="badge badge-grey">${OUTSIDE}</span>`}${rt.sub ? `<span class="cell-sub">${h(rt.sub)}</span>` : !r ? '<span class="cell-sub">meals only</span>' : ''}</span>
      <span class="wk-gc" data-l="Surf">${h(c ? c : 'no lessons')}${c ? `<span class="cell-sub">${h(levelOf(g))}${isYoga(g) ? ' · Yoga' : ''}</span>` : isYoga(g) ? '<span class="cell-sub">Yoga</span>' : ''}</span>
      <span class="wk-gc" data-l="Diet">${h(d === 'none' ? 'no special diet' : d || 'diet ?')}${al ? ` <span class="badge badge-red">allergies: ${h(al)}</span>` : ''}</span>
      <span class="wk-gc" data-l="Phone">${(g.phone || phoneOf(g)) ? `<a href="tel:${h(g.phone || phoneOf(g))}">${h(g.phone || phoneOf(g))}</a>` : '<span class="wk-nil">no phone</span>'}</span>
      <span class="wk-gc" data-l="Arrival">${h(arrive)}</span><span class="wk-gc wk-ginv">${inviteCell(g, ws)}</span></div>`;
  }
  // ── Week group (WhatsApp) ───────────────────────────────────────────────
  // WhatsApp has no link or API to create a group, so the app prepares everything around it:
  // the group name, the week's phones as contacts (.vcf) to import on the phone and add in one go,
  // the bare numbers, and — once the group exists — a one-tap invite per guest.
  // The invite link and who was invited are kept in this browser (localStorage, per week):
  // camp_week_messages only takes the three team messages, and a tick per guest is not worth a
  // table change; the invites go out from one phone anyway.
  const campName = () => CAMP_NAME[SLUG] || '';
  const dayMon = iso => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
  const span = (a, b) => a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${dayMon(b)}` : `${dayMon(a)} – ${dayMon(b)}`;   // 14–20 Nov
  // The season's week number: week 1 starts on the Saturday in the settings.
  const weekNo = ws => Math.floor(daysBetween(W.group.season_start || SEASON_WEEK1_DEFAULT, ws) / 7) + 1;
  const weekLabel = ws => { const n = weekNo(ws); return n >= 1 ? `Week ${n} · ${span(ws, add(ws, 6))}` : `${fdm(ws)} – ${fdm(add(ws, 6))}`; };
  const groupName = ws => `Gota Dagua ${campName()} - week ${weekNo(ws)}`;
  const contactName = (g, ws) => `${g.guest_name} - Week ${weekNo(ws)}`;          // as the camp saves them
  const groupDescription = ws => String(W.group.description || '').replace(/\{week\}/g, weekNo(ws)).replace(/\{dates\}/g, span(ws, add(ws, 7)));
  // E.164: spaces, dashes and brackets out, 00 → +, the extra 0 after the country code out. '' when it is not a phone.
  function e164(raw) {
    let p = String(raw || '').replace(/[\s().\-]/g, '');
    if (/^00\d/.test(p)) p = '+' + p.slice(2);
    p = GT.cleanPhone(p, GTC);
    return /^\+[1-9]\d{7,14}$/.test(p) ? p : '';
  }
  // The guest's phone as E.164; a guest on a second booking may only have it on the first one.
  const phoneOf = g => { let p = e164(g.phone); for (let x = g._prev; x && !p; x = x._prev) p = e164(x.phone); return p; };
  // Every guest of the week once (a guest on two bookings back to back is one person), with the phone if there is a valid one.
  function groupPeople(ws, rows, withOutside) {
    const seen = new Map();
    rows.filter(g => counted(g) && inWeek(g, ws)).sort(byStay).forEach(g => {
      const k = personKey(g.guest_name) || g.guest_name;
      const phone = phoneOf(g);
      const outside = !segments(g).some(x => x.r && x.from < add(ws, 7) && x.to > ws);
      if (!seen.has(k)) seen.set(k, { key: k, g, phone, outside });
      else { const x = seen.get(k); if (!x.phone && phone) { x.phone = phone; } x.outside = x.outside && outside; }
    });
    return [...seen.values()].filter(x => withOutside || !x.outside);
  }
  function vcfText(people, ws) {
    return people.filter(x => x.phone).map(x => { const n = contactName(x.g, ws).replace(/([,;\\])/g, '\\$1');
      return ['BEGIN:VCARD', 'VERSION:3.0', `N:;${n};;;`, `FN:${n}`, `TEL;TYPE=CELL:${x.phone}`, 'END:VCARD'].join('\r\n'); }).join('\r\n') + '\r\n';
  }
  const inviteText = (g, link) => `Hi ${first(g.guest_name)}, welcome to Gota Dagua ${campName()}! Join the group for your week: ${link}`;
  function groupStore(ws) { const o = (W.group.weeks || {})[ws] || {}; return { link: o.link || '', invited: { ...(o.invited || {}) } }; }
  // Every write re-reads the row first and changes one thing, so the laptop and the phone do not overwrite each other.
  async function groupEdit(change) { await loadGroup(); change(W.group); render(); return saveGroup(); }
  async function loadGroup() {
    const c = client(); const loc = await ensureHubLocationId().catch(() => '');
    if (!c || !loc) return;
    const { data, error } = await c.from('location_state_store').select('state_json').eq('location_id', loc).eq('state_key', GROUP_KEY).limit(1);
    const j = !error && data && data[0] && data[0].state_json;
    if (j && typeof j === 'object') W.group = { season_start: j.season_start || SEASON_WEEK1_DEFAULT, description: j.description == null ? GROUP_DESC_DEFAULT : j.description, weeks: j.weeks || {} };
  }
  async function saveGroup() {
    const c = client(); const loc = await ensureHubLocationId().catch(() => '');
    if (!c || !loc) return;
    const { error } = await c.from('location_state_store').upsert({ location_id: loc, state_key: GROUP_KEY, state_json: W.group, updated_at: new Date().toISOString() }, { onConflict: 'location_id,state_key' });
    if (error) say("Couldn't save the group settings — " + (error.message || 'error'), 'err');
  }
  const inviteLinkOk = l => /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/.test(String(l || '').trim());
  function groupCard(ctx) {
    const { ws, rows } = ctx;
    const all = groupPeople(ws, rows, true); const list = groupPeople(ws, rows, W.groupOutside);
    const withPhone = list.filter(x => x.phone).length, without = list.length - withPhone, nOut = all.filter(x => x.outside).length;
    const st = groupStore(ws); const invited = list.filter(x => st.invited[x.key]).length;
    return `<div class="card wk-card wk-group" id="wkGroup">${cardHead('Week group', 'WhatsApp cannot create a group from a link: import the contacts on your phone, then add them all to a new group')}
      <div class="card-body wk-gcols"><div>
        <div class="wk-gname"><span><span class="micro">Group name</span><b id="wkGroupName">${h(groupName(ws))}</b></span><button class="btn btn-s btn-sm" onclick="WeekUI.copyGroupName()">${ic('copy')} Copy name</button></div>
        <div class="wk-gstat"><b class="num">${withPhone}</b> ${withPhone === 1 ? 'guest' : 'guests'} with a phone${without ? ` · <span class="wk-warn">${without} without</span>` : ''} · saved as «${h(contactName({ guest_name: 'Name' }, ws))}»${nOut ? `<label class="wk-gtoggle"><input type="checkbox" id="wkGroupOutside" ${W.groupOutside ? 'checked' : ''} onchange="WeekUI.setGroupOutside(this.checked)"> include ${nOut} outside of camp</label>` : ''}</div>
        <div class="wk-gbtns"><button class="btn btn-p" id="wkVcf" onclick="WeekUI.downloadVcf()" ${withPhone ? '' : 'disabled'}>${ic('download')} Download contacts (.vcf)</button>
          <button class="btn btn-s" onclick="WeekUI.copyNumbers()" ${withPhone ? '' : 'disabled'}>${ic('copy')} Copy all numbers</button></div>
        <div class="field wk-glink"><label for="wkInvite">Group invite link (optional)</label><input id="wkInvite" type="url" inputmode="url" placeholder="https://chat.whatsapp.com/…" value="${h(st.link)}" onchange="WeekUI.setInviteLink(this.value)">
          <div class="hint">${inviteLinkOk(st.link) ? `«Send invite» is next to each guest below · ${invited} of ${withPhone} invited` : st.link ? 'This does not look like a WhatsApp group link (https://chat.whatsapp.com/…).' : 'Paste it once the group exists to get a one-tap «Send invite» next to each guest.'}</div></div>
        <div class="field wk-gseason"><label for="wkSeason">Season week 1 starts on (a Saturday)</label><input id="wkSeason" type="date" value="${h(W.group.season_start)}" onchange="WeekUI.setSeasonStart(this.value)">
          <div class="hint">This week is week ${weekNo(ws)}.</div></div>
      </div><div>
        <div class="field wk-gdesc"><label for="wkDesc">Group description</label><textarea id="wkDesc" rows="9" onchange="WeekUI.setGroupDescription(this.value)">${h(W.group.description)}</textarea>
          <div class="hint">Written once, kept for every week. {week} and {dates} become «${weekNo(ws)}» and «${h(span(ws, add(ws, 7)))}» when you copy.</div></div>
        <button class="btn btn-s btn-sm" onclick="WeekUI.copyGroupDescription()">${ic('copy')} Copy description</button>
      </div></div></div>`;
  }
  function inviteCell(g, ws) {
    const st = groupStore(ws); if (!inviteLinkOk(st.link)) return '';
    const k = personKey(g.guest_name) || g.guest_name;
    if (!phoneOf(g)) return '<span class="wk-nil">no phone</span>';
    return st.invited[k] ? `<button class="btn btn-s btn-sm wk-invited" title="Send again" onclick="WeekUI.invite('${g.id}')">${ic('check')} Invited</button>`
      : `<button class="btn btn-s btn-sm" onclick="WeekUI.invite('${g.id}')">${ic('send')} Send invite</button>`;
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function filterGuests(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    document.querySelectorAll('#weekRoot .wk-grow').forEach(el => { const ok = words.every(w => el.dataset.q.includes(w)); el.hidden = !ok; if (ok) n++; });
    const c = $('wkGuestN'); if (c) c.textContent = n;
    const none = document.querySelector('#weekRoot .wk-noguests'); if (none) none.hidden = n > 0;
  }
  function yogaInfo(ws, rows) {
    const n = rows.filter(g => counted(g) && inWeek(g, ws) && isYoga(g)).length;
    const paid = yogaPayments(ws, add(ws, 6)).reduce((s, e) => s + Number(e.amountLocal || 0), 0);
    return `Yoga this week: ${plural(n, 'guest')} · paid ${paid ? money(paid) : '0'}`;
  }
  function yogaPayments(from, to, ledger) {
    const L0 = ledger || (typeof S !== 'undefined' && S.ledger) || [];
    return L0.filter(e => e && e.type === 'expense' && YOGA_PAY_CATEGORIES.includes(e.category) && /yoga/i.test(String(e.description || '')) && String(e.date || '') >= from && String(e.date || '') <= to);
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  function currentText() {
    const ws = W.week; const rows = rowsOf(ws);
    if (W.team === 'guests') return body('guests', W.day, ws, rows);
    if (W.team === 'transfers') { const list = tripsFor(W.day, ws); return list.some(t => t.needs_resend) ? transfersUpdate(list, W.day, ws) : GT.whatsappDayText(list, GTC); }
    const text = body(W.team, W.day, ws, rows); const sent = sentOf(W.team, W.day, ws);
    return { text, out: dress(sent && sent.hash !== hash(text) ? updateText(sent.text, text, W.day, ws) : text, cToday()) };
  }
  async function clip(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
  }
  async function copy() {
    const t = currentText();
    const out = typeof t === 'string' ? t : t.out;
    const ok = await clip(out);
    say(ok ? 'Copied' : "Couldn't copy — select the text and copy it", ok ? 'ok' : 'err');
    if (ok && typeof t !== 'string') await record(t.text);
  }
  function send() {
    const t = currentText();
    const c = contactOf(W.team);
    const out = typeof t === 'string' ? t : t.out;
    window.open(GT.whatsappUrl(c && c.phone || '', out), '_blank', 'noopener');
    if (W.team === 'transfers') { say(`WhatsApp opened for ${c ? c.name : 'the transfers contact'} — mark the transfers sent once it is sent`); return; }
    record(t.text);
  }
  async function record(text) {
    const ws = W.week; const team = W.team, day = W.day;
    const key = 'rec|' + team + '|' + day;
    if (W.busy.has(key)) return; W.busy.add(key);
    try {
      const loc = await ensureHubLocationId();
      const row = { location_id: loc, week_start: ws, team, day, text, hash: hash(text) };
      const { data, error } = await client().from('camp_week_messages').insert(row).select();
      if (error) { if (!missingTable(error)) say("Sent, but couldn't remember it — " + (error.message || 'error'), 'err'); render(); return; }
      const saved = (data && data[0]) || { id: 'tmp' + Date.now(), sent_at: new Date().toISOString(), ...row };
      const entry = W.cache[ws]; if (entry) entry.msgs.unshift(saved);
      W.undo = { id: saved.id, team, day, ws };
      setTimeout(() => { if (W.undo && W.undo.id === saved.id) { W.undo = null; if (activePage === 'week') render(); } }, UNDO_MS);
      render();
    } finally { W.busy.delete(key); }
  }
  async function undo() {
    const u = W.undo; if (!u) return; W.undo = null;
    const { error } = await client().from('camp_week_messages').delete().eq('id', u.id);
    if (error) { say("Couldn't undo — " + (error.message || 'error'), 'err'); return; }
    const entry = W.cache[u.ws]; if (entry) entry.msgs = entry.msgs.filter(m => m.id !== u.id);
    render(); say('Marked as not sent');
  }
  async function tickTransfers() {
    if (!window.TransportUI) return;
    const days = W.day === 'week' ? [...new Set(tripsFor('week', W.week).map(t => t.trip_date))] : [W.day];
    for (const d of days) await TransportUI.tickDay(d);
    render();
  }
  async function patchGuest(id, patch, msg) {
    const { error } = await client().from('camp_week_guests').update(patch).eq('id', id);
    if (error) { say("Couldn't save — " + (error.message || 'error'), 'err'); return; }
    Object.values(W.cache).forEach(e => e.rows.forEach(g => { if (g.id === id) Object.assign(g, patch); }));
    render(); say(msg);
    try { window.dispatchEvent(new CustomEvent('camp-checks-changed')); } catch (_) {}
  }
  // «Still here / still coming» is remembered in raw._kept for the latest import (a re-import rewrites raw,
  // so the question comes back after the next file); import_id is left alone so the file's date range stays true.
  // «Not here» takes the guest out of every list until a later file has them again.
  function keep(id) {
    const g = Object.values(W.cache).flatMap(e => e.rows).find(x => x.id === id); if (!g || !W.meta) return;
    return patchGuest(id, { raw: { ...(g.raw || {}), _kept: W.meta.id } }, 'Kept in the week');
  }
  const notHere = id => patchGuest(id, { booking_status: 'not_here' }, 'Taken out of the week');

  // ── Contacts modal (4 rows: name + phone) ───────────────────────────────
  function openContacts() {
    const rows = TEAMS.filter(t => t.contact).map(t => {
      const c = contactOf(t.k);
      const fixed = t.k === 'transfers';
      return `<div class="wk-contact" data-team="${t.k}"><div class="section-lbl">${h(t.label)}</div>
        <div class="g2"><div class="mfield"><label>Name</label><input data-f="name" value="${h(c ? c.name : '')}" placeholder="${h(t.role)}" ${fixed && c ? 'disabled' : ''}></div>
        <div class="mfield"><label>Phone</label><input data-f="phone" value="${h(c && c.phone || '')}" placeholder="add phone · ${h(CC.phoneExample || '+94771234567')}" inputmode="tel"></div></div>
        ${fixed ? `<div class="hint">Who gets the transfers is set in Transport → Drivers.</div>` : ''}</div>`;
    }).join('');
    let ov = $('wkOv');
    if (!ov) { ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'wkOv'; ov.addEventListener('click', e => { if (e.target === ov) closeModal(); }); document.body.appendChild(ov); }
    ov.innerHTML = `<div class="modal"><div class="mhdr"><div><div class="mhdr-title">Team contacts</div><div class="mhdr-sub">Send opens WhatsApp to this phone; without a phone you pick the contact.</div></div>
      <button class="mclose" onclick="WeekUI.closeModal()" title="Close">${ic('x')}</button></div><div class="mbody">${rows}</div>
      <div class="mfooter"><button class="btn btn-s" onclick="WeekUI.closeModal()">Cancel</button><button class="btn btn-p" id="wkContactsSave" onclick="WeekUI.saveContacts()">Save</button></div></div>`;
    ov.classList.add('open');
  }
  function closeModal() { const ov = $('wkOv'); if (ov) ov.classList.remove('open'); }
  async function saveContacts() {
    if (W.busy.has('contacts')) return; W.busy.add('contacts');
    try {
      const loc = await ensureHubLocationId(); const S0 = TR();
      for (const el of document.querySelectorAll('#wkOv .wk-contact')) {
        const t = TEAMS.find(x => x.k === el.dataset.team); const c = contactOf(t.k);
        const name = el.querySelector('[data-f="name"]').value.trim();
        const phone = el.querySelector('[data-f="phone"]').value.replace(/[\s-]/g, '');
        if (phone && !/^\+[0-9]{8,15}$/.test(phone)) { say(`${t.label}: phone must look like ${CC.phoneExample || '+94771234567'}`, 'err'); return; }
        if (c) {
          const patch = {};
          if ((c.phone || '') !== phone) patch.phone = phone || null;
          if (t.k !== 'transfers' && name && name !== c.name) patch.name = name;
          if (!Object.keys(patch).length) continue;
          const { data, error } = await client().from('camp_drivers').update(patch).eq('id', c.id).select();
          if (error) { say(`${t.label}: ` + (error.message || 'error'), 'err'); return; }
          S0.drivers = S0.drivers.map(x => x.id === c.id ? ((data && data[0]) || { ...x, ...patch }) : x);
        } else if (name || phone) {
          const row = { location_id: loc, name: name || t.role, label: t.label, phone: phone || null, aliases: [], kinds: ['contact'], default_for: [t.contact] };
          const { data, error } = await client().from('camp_drivers').insert(row).select();
          if (error) { say(`${t.label}: ` + (error.message || 'error'), 'err'); return; }
          S0.drivers.push((data && data[0]) || { id: 'tmp' + Date.now(), active: true, ...row });
        }
      }
      closeModal(); render(); say('Contacts saved');
    } finally { W.busy.delete('contacts'); }
  }

  // ── Checks for the shared strip ─────────────────────────────────────────
  // Synchronous; null until loaded and always null in the local view.
  const fileCheck = {
    id: 'week-guests-file-old',
    run(ctx) {
      if (!ctx || ctx.isLocal || !WEEK_ENABLED_LOCATIONS.has(ctx.location) || !W.meta || !W.meta.at) return null;
      const d = colomboStamp(new Date(W.meta.at)).slice(0, 10);
      const age = daysBetween(d, ctx.today || cToday());
      if (age <= FILE_OLD_DAYS) return null;
      return { text: `Guests file is ${age} days old – import again`, level: 'warn', onClick: () => { W.mode = 'import'; showPage('week'); } };
    },
  };
  const yogaCheck = {
    id: 'week-yoga-unpaid',
    run(ctx) {
      if (!ctx || ctx.isLocal || !WEEK_ENABLED_LOCATIONS.has(ctx.location) || !W.metaLoaded) return null;
      const today = ctx.today || cToday(); const ws = GT.weekStart(today); const prev = add(ws, -7);
      const yogaIn = w => W.cache[w] ? rowsOf(w).filter(g => counted(g) && inWeek(g, w) && isYoga(g)).length : 0;
      const out = [];
      const nNow = yogaIn(ws);
      if (nNow && daysBetween(ws, today) >= YOGA_CHECK_FROM_WEEKDAY && !yogaPayments(ws, today, ctx.ledger).length)
        out.push({ text: `Yoga students this week (${nNow}) but no Yoga payment`, level: 'info', onClick: () => { W.week = ws; W.tab = 'surf'; W.team = 'surf'; W.day = 'week'; W.mode = 'lists'; showPage('week'); } });
      const nPrev = yogaIn(prev);
      if (nPrev && !yogaPayments(prev, today, ctx.ledger).length)
        out.push({ text: `Yoga students last week (${nPrev}) but no Yoga payment`, level: 'info', onClick: () => { W.week = prev; W.tab = 'surf'; W.team = 'surf'; W.day = 'week'; W.mode = 'lists'; showPage('week'); } });
      return out.length ? out : null;
    },
  };
  window.CAMP_CHECKS = window.CAMP_CHECKS || [];
  [fileCheck, yogaCheck].forEach(c => { if (!window.CAMP_CHECKS.some(x => x && x.id === c.id)) window.CAMP_CHECKS.push(c); });

  // ── Boot: show the tab for full Sri Lanka users, load once the ledger is in ─
  function boot() {
    if (!enabled()) return;
    document.querySelectorAll('.ntab[data-page="week"], .ntab-m[data-page="week"]').forEach(b => { b.style.display = ''; });
    window.addEventListener('camp-week-imported', () => { loadAll(true); });
    let tries = 0;
    const wait = setInterval(() => {
      tries++;
      let ready = false; try { ready = HUB_LEDGER_HYDRATED === true; } catch (_) {}
      if (ready || tries > 120) { clearInterval(wait); loadAll(); }
    }, 250);
  }

  window.renderWeekPage = renderWeekPage;
  window.WeekUI = {
    render, closeModal, openContacts, saveContacts, copy, send, undo, tickTransfers, keep, notHere,
    setMode(m) { W.mode = m; if (m === 'import' && window.TransportUI && TR().imp && TR().imp.stage === 'done') TR().imp = null; render(); },
    // After an import: Overview of the week Francisco imported for — the first check-in from today on
    // (the file also holds guests already in camp), else the running week.
    afterImport() { const S0 = TR(); const g = S0.imp && S0.imp.groups && S0.imp.groups.guests || []; const today = cToday();
      const next = g.map(x => x.check_in).filter(d => d && d >= today).sort()[0];
      W.mode = 'lists'; W.tab = 'overview'; W.week = GT.weekStart(next || today); W.day = 'week'; S0.imp = null; loadAll(true); },
    setTab(t) { if (!TABS.some(x => x.k === t)) return; W.tab = t; W.team = teamOfTab(t) || W.team; W.undo = null; render(); },
    setTeam(t) { W.team = t; W.tab = tabOf(t); W.undo = null; render(); }, setDay(d) { W.day = d; W.undo = null; render(); },
    go(team, day) { W.team = team; W.tab = tabOf(team); W.day = day; W.scrollTo = 'wkMessage'; render(); },
    toGroup() { const el = $('wkGroup'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    toMessage() { const el = $('wkMessage'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    toDay(d) { const el = $('wkDay-' + d); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    search(q) { W.q = q; filterGuests(q); },
    // Week group
    async copyGroupName() { const ok = await clip(groupName(W.week)); say(ok ? 'Group name copied' : "Couldn't copy", ok ? 'ok' : 'err'); },
    async copyNumbers() { const t = groupPeople(W.week, rowsOf(W.week), W.groupOutside).filter(x => x.phone).map(x => x.phone).join('\n'); const ok = await clip(t); say(ok ? 'Numbers copied' : "Couldn't copy", ok ? 'ok' : 'err'); },
    downloadVcf() { const ws = W.week; download(`gota-dagua-week-${weekNo(ws)}.vcf`, vcfText(groupPeople(ws, rowsOf(ws), W.groupOutside), ws), 'text/vcard;charset=utf-8'); say('Contacts downloaded — open the file on your phone'); },
    setGroupOutside(on) { W.groupOutside = !!on; render(); },
    setSeasonStart(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return; return groupEdit(g => { g.season_start = GT.weekStart(v); }); },
    setGroupDescription(v) { return groupEdit(g => { g.description = String(v || ''); }); },
    async copyGroupDescription() { const el = $('wkDesc'); if (el) W.group.description = el.value; const ok = await clip(groupDescription(W.week)); say(ok ? 'Description copied' : "Couldn't copy", ok ? 'ok' : 'err'); },
    setInviteLink(v) { const ws = W.week; return groupEdit(g => { const o = groupStore(ws); o.link = String(v || '').trim(); g.weeks = { ...(g.weeks || {}), [ws]: o }; }); },
    invite(id) { const ws = W.week; const g = rowsOf(ws).find(x => x.id === id); const st = groupStore(ws); if (!g || !inviteLinkOk(st.link)) return;
      window.open(GT.whatsappUrl(phoneOf(g), inviteText(g, st.link)), '_blank', 'noopener');
      return groupEdit(grp => { const o = groupStore(ws); o.invited[personKey(g.guest_name) || g.guest_name] = new Date().toISOString(); grp.weeks = { ...(grp.weeks || {}), [ws]: o }; }); },
    findGuest(name) { W.q = name; W.tab = 'guests'; W.team = 'guests'; W.day = 'week'; render(); },
    shiftWeek(n) { W.week = add(W.week, n); W.day = 'week'; W.undo = null; render(); loadWeek(W.week).then(render); },
    // for tests
    _state: W, loadAll, classify, body, bodyOf: (team, day) => body(team, day, W.week, rowsOf(W.week)), parts, toText, updateText, lineDiff, hash, toCheck: () => toCheck(W.week), changes: () => changes(W.week),
    checks: { file: fileCheck, yoga: yogaCheck }, roomInfo, course, levelOf, dietOf, dress, dayMoves: d => dayMoves(rowsOf(W.week), d), e164, groupName: () => groupName(W.week), weekNo, weekLabel, groupDescription: () => groupDescription(W.week),
    vcf: () => vcfText(groupPeople(W.week, rowsOf(W.week), W.groupOutside), W.week), groupPeople: () => groupPeople(W.week, rowsOf(W.week), W.groupOutside),
    model: () => weekModel(W.week, rowsOf(W.week)), roomPlan: () => roomPlan(W.week, rowsOf(W.week)),
    people: () => peopleCheck(W.week, rowsOf(W.week)), placement: () => placement(W.week, rowsOf(W.week)), segments,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
