// Bookinglayer camp report (booking lines × guests) → guests, rooms, lessons, airport legs. 16 Nov 2026.
//
// The report Miguel built in Bookinglayer (check-out window, statuses Confirmed / Deposit paid / Paid)
// has one row per BOOKING LINE × GUEST OF THE BOOKING (a cross join): a booking with 3 guests and
// 40 lines has 120 rows. What the two real files of 16 Nov 2026 showed (Sri Lanka 2,927 rows /
// 81 bookings, Morocco 5,352 rows / 127 bookings) and what this parser therefore does:
//   · Every line id has exactly as many rows as the booking has guests, in the same guest order
//     (208 of 208 bookings). The guests of a booking = the rows of one line, by position — so
//     guests with no name (Morocco 2026-3404: 7 nameless, 2026-4946: 20 nameless + 1) stay separate.
//   · A line belongs to its «Person» (one Person per line, 3,677 of 3,677 lines). Person is the
//     guest's name in most bookings, but NOT always: in 9 bookings the Person is the booker or the
//     partner's agent (e.g. «Natália Pryaznykova» for Surfer Girls Power, «João Lavado») and the
//     guest list has someone else. Such a line goes to the one guest of the booking who owns no
//     line (always 1:1 in the real files) and the pairing is flagged. «Guest = Person» alone would
//     have lost Duarte Gibellino (2026-3953) and half of 2026-4020.
//   · Each airport transfer leg is its own line with its date (quantity 1, start time always the
//     12:00 default): the legs are FACTS, never guessed (no «round trip assumed», no «only» rule).
//     Leg on the check-in date = arrival, on the check-out date = departure (139 of 140 Morocco and
//     22 of 22 Sri Lanka legs); another date = the nearer one, flagged (Morocco 2026-4541: 4 Oct).
//     One person with two lines on the same day = one seat (Sri Lanka 2026-4070: plain + «with
//     surfboards»; Morocco 2026-4844: Agadir + Marrakesh, flagged).
//   · Rooms are lines with a start and an end date; «Guest: List of bed numbers» lists the beds
//     in the order of the guest's room lines by start date (2026-4541: «5, 4» = Anchor Point bed 5,
//     then Panorama Point bed 4 — not number order).
//   · Day surf lessons are one line per date; weekly courses one line (sometimes with no date).
//   · Company/Channel = the partner. «Booking: Due amount» = what is still owed on the booking
//     (a deposit-paid direct booking owes 35 with no channel; a partner with due 0 exists).
//   · A booking of another camp can be in the file (Sri Lanka file: 2026-4776, Caparica rooms and
//     «Airport Shuttle» lines): the camp is decided per booking from its room / package lines.
//
// Pure functions, no DOM and no Supabase: Week's import and the Node test / dry run share it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlReport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const GT = () => isNode ? require('./guests-trips.js') : self.GuestsTrips;
  const CC = () => isNode ? require('./camp-config.js') : self.CampConfig;

  const COL = {
    ref: 'Booking: Reference', status: 'Booking: Status', ci: 'Booking: Check-in date', co: 'Booking: Check-out date',
    channel: 'Company/Channel', product: 'Product: Product title', start: 'Booking line: Start date', stime: 'Booking line: Start time',
    end: 'Booking line: End date', qty: 'Booking line: Quantity', lid: 'Booking line: Id', person: 'Person: Full name',
    guest: 'Guest: Full name', phone: 'Guest: Phone', arrT: 'Guest: Arrival time', arrF: 'Guest: Arrival flight',
    depT: 'Guest: Departure time', depF: 'Guest: Departure flight', tcomment: 'Guest: Transfer comment', beds: 'Guest: List of bed numbers',
    level: 'Level', allergies: 'Guest: Allergies / Intolerance', bphone: 'Booker: Phone', due: 'Booking: Due amount', diet: 'Guest: Diet',
  };
  const REQUIRED = ['ref', 'status', 'ci', 'co', 'product', 'start', 'end', 'lid', 'person', 'guest'];
  // The booking line's price (17 Nov 2026: «Booking line: Start time» replaced by «Booking line: Final price incl. tax»,
  // EUR, last column). Other spellings Bookinglayer may use are accepted; a file without it reads as before.
  const PRICE_HEADER = /^booking line:?\s*(final\s+)?(price|total|amount|line total|subtotal)\b/i;
  function priceOf(v) {
    let t = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '');
    if (!t) return null;
    if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (t.includes(',')) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
    const n = parseFloat(t); return Number.isFinite(n) ? n : null;
  }
  // The transfer rule with prices (Miguel, 17 Nov 2026). Flag texts are matched by camp-hub/transport.js.
  const TOGETHER_FLAG = 'Different times — coming together? If not, the guest at 0 € has to pay a transfer';
  const paidTwiceFlag = n => `${n} transfers paid, same flight — confirm they come together`;
  // U2 2286 = EZY2286: the flight number without the airline code.
  // The airline code is taken off first (3 letters, or 2 characters of which one may be a digit: U2, W4, 6E), so
  // «U2 286» and «EZY286» are both flight 286, and «U2 2286» / «EZY2286» both 2286.
  const flightNo = f => {
    const x = String(f || '').toUpperCase().replace(/[\s-]+/g, '');
    const m = x.match(/^[A-Z]{3}(\d{1,4})[A-Z]?$/) || x.match(/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4})[A-Z]?$/) || x.match(/^(\d{1,4})$/);
    return m ? String(Number(m[1])) : '';
  };
  const mins = t => { const m = String(t || '').match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const flightsDiffer = (a, b) => !!(flightNo(a) && flightNo(b) && flightNo(a) !== flightNo(b));
  const timesFar = (a, b) => { const x = mins(a), y = mins(b); return x != null && y != null && Math.abs(x - y) > 30; };
  const compatible = (gr, l) => !flightsDiffer(gr.flight, l.flight) && !timesFar(gr.time, l.time);

  function isReportHeader(text) {
    const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/, 1)[0] || '';
    const cells = (GT().parseCsv(first)[0] || []).map(s => s.trim());
    return cells.includes(COL.ref) && cells.includes(COL.lid) && cells.includes(COL.guest);
  }

  // ── What a product line is ────────────────────────────────────────────────
  // Every title of the two real files falls in one of these (unknown = a new product: warned).
  function productKind(title) {
    const t = String(title || '').trim();
    if (/airport\s+(transfer|shuttle)/i.test(t)) return 'transfer';
    if (/yoga/i.test(t)) return 'yoga';
    if (/day\s+group\s+surf\s+lesson|surf\s+coaching\s+lesson/i.test(t)) return 'lesson';
    if (/surf\s+course/i.test(t)) return 'course';
    if (/^\s*\d+\s*-\s*\S/.test(t) || /\b(room|dorm)\b/i.test(t)) return 'room';
    if (/\bpackage\b|\bcustom\s+pack\b|^surf camp ahangama, sri lanka$|\bsri lanka with\b/i.test(t)) return 'package';
    if (/breakfast|dinner|barb[ae]cue|equipment|insurance|welcome|discount|surf\s*shop/i.test(t)) return 'included';
    if (/safari|tour|excursion|valley|souk|dunes|sandboard|massage|hammam|skate|class\b/i.test(t)) return 'activity';
    return 'unknown';
  }
  const lessonType = t => /intensive/i.test(t) ? 'intensive' : /coaching/i.test(t) ? 'coaching' : 'standard';
  const courseLessons = t => { const m = String(t).match(/\(\s*(\d+)\s*surf\s+lessons?/i); return m ? Number(m[1]) : null; };
  // «Airport Transfer Morocco (Agadir)» → AGA; «Airport Transfer Sri Lanka» → the camp's default airport.
  function productPlace(title, cfg) {
    const codes = [...String(title).matchAll(/\(([^)]+)\)/g)].map(m => cfg.places[m[1].trim().toLowerCase()]).filter(Boolean);
    return codes[0] || cfg.airportDefault;
  }
  const pyStrip = s => String(s == null ? '' : s).trim();
  const daysBetween = (a, b) => { const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 86400000); };
  const statusKey = s => pyStrip(s).toLowerCase().replace(/ /g, '_');
  const dueOf = v => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  // «0031641355818» (Sri Lanka 2026-4984) → «+31641355818»: 00 is the international prefix.
  const phoneOf = (s, cfg) => GT().cleanPhone(String(s || '').trim().replace(/^00(?=[1-9])/, '+'), cfg);

  // ── Read the file into bookings ───────────────────────────────────────────
  let memo = { text: null, name: null, cfg: null, out: null };
  function read(text, fileName, cfg) {
    cfg = cfg || CC().SL;
    if (memo.text === text && memo.name === fileName && memo.cfg === cfg) return memo.out;
    const G = GT();
    const all = G.parseCsv(text);
    const H = (all[0] || []).map(h => h.trim());
    const ix = {}; Object.keys(COL).forEach(k => { ix[k] = H.indexOf(COL[k]); });
    ix.price = H.findIndex(h => PRICE_HEADER.test(h));
    const missing = REQUIRED.filter(k => ix[k] < 0).map(k => COL[k]);
    const cell = (r, k) => ix[k] >= 0 && ix[k] < r.length ? pyStrip(r[ix[k]]) : '';
    const byRef = new Map(); let rowsN = 0;
    all.slice(1).forEach((r, n) => {
      if (!r.some(c => String(c).trim())) return;
      rowsN++;
      const ref = cell(r, 'ref');
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push({ r, line: n + 2 });
    });
    const warnings = []; const bookings = [];
    for (const [ref, rs] of byRef) bookings.push(readBooking(ref, rs, cell, cfg, warnings));
    const out = { file: String(fileName || '').split('/').pop(), rows: rowsN, missing, bookings, warnings, priceColumn: ix.price >= 0 ? H[ix.price] : null };
    bookings.forEach(b => { b.hasPrice = ix.price >= 0; });
    memo = { text, name: fileName, cfg, out };
    return out;
  }

  function readBooking(ref, rs, cell, cfg, warnings) {
    const G = GT(); const flags = [];
    const r0 = rs[0].r;
    const b = {
      ref, status: statusKey(cell(r0, 'status')), ci: G.ymd(cell(r0, 'ci')), co: G.ymd(cell(r0, 'co')),
      partner: cell(r0, 'channel'), due: dueOf(cell(r0, 'due')), dueRaw: cell(r0, 'due'), bookerPhone: cell(r0, 'bphone'),
      firstLine: rs[0].line, flags,
    };
    // Lines (one per line id) with their guest rows in file order.
    const lines = new Map();
    rs.forEach(x => {
      const lid = cell(x.r, 'lid') || `row${x.line}`;
      if (!lines.has(lid)) {
        const title = cell(x.r, 'product');
        lines.set(lid, { lid, title, kind: productKind(title), start: G.ymd(cell(x.r, 'start')), end: G.ymd(cell(x.r, 'end')),
          qty: Number(cell(x.r, 'qty')) || 1, person: cell(x.r, 'person').replace(/\s+/g, ' '), rows: [], line: x.line,
          price: priceOf(cell(x.r, 'price')) });
      }
      lines.get(lid).rows.push(x);
    });
    b.lines = [...lines.values()];
    // Guests = the rows of one line, by position (every line repeats them in the same order).
    const first = b.lines[0];
    const order = first.rows.map(x => cell(x.r, 'guest').replace(/\s+/g, ' '));
    const sameOrder = b.lines.every(l => l.rows.length === order.length && l.rows.every((x, i) => cell(x.r, 'guest').replace(/\s+/g, ' ') === order[i]));
    if (!sameOrder) flags.push('the guest rows are not the same on every line — check this booking in Bookinglayer');
    const seen = new Set();
    b.guests = first.rows.map((x, pos) => {
      const r = x.r; let raw = order[pos]; let renamed = false;
      if (!raw) { raw = `Guest without name (booking ${ref || '?'})`; renamed = true; }
      let key = raw.toLowerCase(); let name = raw;
      for (let k = 2; seen.has(key); k++) { renamed = true; name = `${raw} (${k})`; key = name.toLowerCase(); }
      seen.add(key);
      return { pos, fileName: order[pos], name, key, renamed, line: x.line,
        phone: cell(r, 'phone'), arrT: cell(r, 'arrT'), arrF: cell(r, 'arrF'), depT: cell(r, 'depT'), depF: cell(r, 'depF'),
        tcomment: cell(r, 'tcomment'), beds: cell(r, 'beds'), level: cell(r, 'level'), allergies: cell(r, 'allergies'), diet: cell(r, 'diet'),
        lines: [], owner: null };
    });
    // Who owns each line: the guest of the same name; else (1:1 only) the one guest with no line.
    const named = new Map(); b.guests.forEach(g => { if (g.fileName) { const k = g.fileName.toLowerCase(); if (!named.has(k)) named.set(k, []); named.get(k).push(g); } });
    const orphanNames = [...new Set(b.lines.map(l => l.person).filter(p => p && !named.has(p.toLowerCase())))];
    const ownsByName = g => b.lines.some(l => l.person && l.person.toLowerCase() === (g.fileName || '').toLowerCase());
    const unowned = b.guests.filter(g => g.fileName && !ownsByName(g));
    const pairs = new Map();
    if (orphanNames.length === 1 && unowned.length === 1) {
      pairs.set(orphanNames[0].toLowerCase(), unowned[0]);
      unowned[0].owner = orphanNames[0];
      flags.push(`lines in the name of «${orphanNames[0]}» (not on the guest list) given to ${unowned[0].name}, the guest with no line`);
    } else if (orphanNames.length) {
      flags.push(`lines in the name of ${orphanNames.map(n => `«${n}»`).join(', ')}, not on the guest list — not given to a guest (${unowned.length} guest${unowned.length === 1 ? '' : 's'} without lines)`);
    }
    const nameless = b.guests.filter(g => !g.fileName);
    const orphanLines = [];
    b.lines.forEach(l => {
      const p = l.person.toLowerCase();
      let g = null;
      if (p && named.has(p)) { const c = named.get(p); g = c[0]; if (c.length > 1) l.sameName = c.length; }
      else if (p && pairs.has(p)) g = pairs.get(p);
      else if (!p && nameless.length === 1) g = nameless[0];
      if (g) { g.lines.push(l); l.owner = g; } else { l.owner = null; orphanLines.push(l); }
    });
    // Nameless guests sharing nameless lines (groups). The same product on the same dates once per nameless guest
    // (MA 2026-3404: 7 × room, package, each intensive day lesson, transfer) → one each. Otherwise (2026-4946: 20
    // nameless guests in 8 rooms) the lines stay the booking's and are flagged — who has which is not in the report.
    const pool = orphanLines.filter(l => !l.person);
    if (nameless.length > 1 && pool.length) {
      const sig = l => `${l.kind}|${l.title}|${l.start}|${l.end}`;
      const bySig = new Map(); pool.forEach(l => { if (!bySig.has(sig(l))) bySig.set(sig(l), []); bySig.get(sig(l)).push(l); });
      const left = [];
      bySig.forEach(ls => { if (ls.length === nameless.length) ls.forEach((l, i) => { nameless[i].lines.push(l); l.owner = nameless[i]; }); else left.push(...ls); });
      const roomsLeft = left.filter(l => l.kind === 'room');
      if (roomsLeft.length) flags.push(`${nameless.length} guests without a name in ${new Set(roomsLeft.map(l => l.title)).size} different rooms: who sleeps where is not in the report — see the booking in Bookinglayer`);
      const otherLeft = left.filter(l => l.kind !== 'room' && l.kind !== 'included');
      if (otherLeft.length) flags.push(`${otherLeft.length} line${otherLeft.length === 1 ? '' : 's'} of the guests without a name not given to one guest (${[...new Set(otherLeft.map(l => l.title))].join(', ')}) — counted for the booking only`);
      b.namelessPool = { guests: nameless.length, lines: left };
    }
    if (b.guests.some(g => !g.lines.length)) b.guests.filter(g => !g.lines.length && !(b.namelessPool && !g.fileName)).forEach(g => flags.push(`${g.name} is on the guest list but owns no line (no room, no lesson)`));
    if (b.lines.some(l => l.sameName)) flags.push('two guests with the same name: their lines are given to the first');
    // The camp of the booking: its rooms and packages.
    const rooms = b.lines.filter(l => l.kind === 'room').map(l => l.title);
    const pkgs = b.lines.filter(l => l.kind === 'package').map(l => l.title);
    const verdict = cfg.matchRow(pkgs.join(', '), [...new Set(rooms)].join(', '));
    b.camp = verdict === 'yes' || verdict === 'room' || verdict === 'unknown' ? verdict : '';
    b.otherWhy = b.camp ? '' : `rooms «${[...new Set(rooms)].join(', ') || 'none'}», packages «${[...new Set(pkgs)].join(', ') || 'none'}»`;
    b.lines.filter(l => l.kind === 'unknown').forEach(l => warnings.push({ kind: 'product', ref, text: l.title }));
    return b;
  }

  // ── One guest, in the shape the Week page stores (camp_week_guests) ───────
  function guestSegments(g, flags) {
    const segs = g.lines.filter(l => l.kind === 'room' && l.start).sort((a, b) => a.start.localeCompare(b.start) || a.lid.localeCompare(b.lid))
      .map(l => ({ room: l.title, from: l.start, to: l.end || l.start, bed: '' }));
    const beds = String(g.beds || '').split(',').map(s => s.trim()).filter(Boolean);
    if (segs.length) {
      if (beds.length === segs.length) segs.forEach((s, i) => { s.bed = beds[i]; });
      else if (beds.length) { if (beds.length === 1) segs.forEach(s => { s.bed = beds[0]; }); flags.push(`beds «${g.beds}» for ${segs.length} room line${segs.length === 1 ? '' : 's'}`); }
    }
    const merged = [];
    segs.forEach(s => { const p = merged[merged.length - 1]; if (p && p.room === s.room && p.bed === s.bed && p.to === s.from) p.to = s.to; else merged.push({ ...s }); });
    return merged;
  }
  function guestRow(b, g, cfg) {
    const G = GT(); const flags = [];
    const segs = guestSegments(g, flags);
    const own = k => g.lines.filter(l => l.kind === k);
    const lessons = own('lesson').filter(l => l.start).map(l => ({ date: l.start, type: lessonType(l.title) })).sort((a, b) => a.date.localeCompare(b.date));
    const courses = own('course').map(l => ({ title: l.title, type: lessonType(l.title), date: l.start || null, lessons: courseLessons(l.title) }));
    const dayTypes = [...new Set(lessons.map(x => x.type))];
    if (dayTypes.length > 1) flags.push(`day lessons of two kinds: ${dayTypes.join(' + ')}`);
    if (new Set(courses.map(c => c.type)).size > 1) flags.push('two surf courses of different kinds');
    const dupDay = lessons.filter((x, i) => lessons.findIndex(y => y.date === x.date && y.type === x.type) !== i);
    if (dupDay.length) flags.push(`two day lessons on ${[...new Set(dupDay.map(x => x.date))].join(', ')}`);
    const titles = k => [...new Set(own(k).map(l => l.title))];
    // Week reads the guest's course from this text (intensive > coaching > standard): a weekly course wins over the
    // extra day lessons added to it (Sri Lanka 2026-3481 / 4360: Standard course + one «Surf Coaching Lessons»);
    // the day lessons stay in raw.lessons with their dates.
    const activities = [...titles('course'), ...(own('course').length ? [] : titles('lesson')), ...titles('yoga'), ...titles('activity')].join(', ');
    const packages = titles('package').join(', ');
    const ci = segs.length ? segs[0].from : b.ci; const co = segs.length ? segs.reduce((m, s) => s.to > m ? s.to : m, segs[0].to) : b.co;
    if (segs.length && (ci !== b.ci || co !== b.co)) flags.push(`own nights ${ci} → ${co}, booking ${b.ci} → ${b.co}`);
    let phone = phoneOf(g.phone, cfg); let phoneFrom = phone ? 'guest' : '';
    if (!phone && b.bookerPhone) { phone = phoneOf(b.bookerPhone, cfg); phoneFrom = 'booker'; }
    let arrT = G.hhmm(g.arrT); if (arrT === '00:00') arrT = null;
    let depT = G.hhmm(g.depT); if (depT === '00:00') depT = null;
    const allergies = [g.allergies].map(pyStrip).filter(v => v && !G.NO_ALLERGY.has(v.toLowerCase())).join(' / ');
    const transfers = own('transfer').map(l => ({ date: l.start, title: l.title }));
    const nights = ci && co ? daysBetween(ci, co) : null;
    const disp = (G.isUpper(g.name) || G.isLower(g.name)) ? G.pyTitle(g.name) : g.name;
    return {
      csv_line: g.line, booking_ref: b.ref, guest_name: disp, guest_key: g.key, phone,
      week_start: ci ? G.weekStart(ci) : null, check_in: ci || null, check_out: co || null,
      accommodation: [...new Set(segs.map(s => s.room))].join(', '), bed_number: segs.map(s => s.bed).filter(Boolean).join(', '),
      packages, activities, level: g.level, diet: pyStrip(g.diet), allergies, nights,
      arrival_time: arrT, arrival_flight: g.arrF, departure_time: depT, departure_flight: g.depF,
      has_transfer: transfers.length > 0, booking_status: b.status, booking_due: b.due, partner: b.partner || '',
      ...(g.renamed ? { renamed: true } : {}),
      raw: { source: 'bl-report', segments: segs, lessons, courses, transfers, phone_from: phoneFrom, ...(g.owner ? { lines_in_name_of: g.owner } : {}),
        ...(flags.length ? { flags } : {}), transfer_comment: g.tcomment || undefined },
    };
  }

  // ── Airport legs → trips (the shape GuestsTrips.parse gives, so the import saves them unchanged) ──
  function bookingTrips(b, cfg) {
    const G = GT(); const seats = new Map(); const lone = [];
    b.lines.filter(l => l.kind === 'transfer').forEach(l => {
      const date = l.start; if (!date) { b.flags.push(`transfer line ${l.lid} has no date`); return; }
      let dir, flag = '';
      if (date === b.ci) dir = 'arrival'; else if (date === b.co) dir = 'departure';
      else {
        const dA = Math.abs(daysBetween(b.ci, date)), dD = Math.abs(daysBetween(date, b.co));
        dir = dA <= dD ? 'arrival' : 'departure';
        flag = `transfer line dated ${G.strfADB(date)}, not the check-in (${G.strfADB(b.ci)}) or check-out (${G.strfADB(b.co)}) day: taken as the ${dir} — check`;
      }
      const who = l.owner ? `g${l.owner.pos}` : l.person ? `p:${l.person.toLowerCase()}` : `l:${l.lid}`;
      const k = `${who}|${dir}|${date}`;
      const place = productPlace(l.title, cfg); const boards = /surfboard/i.test(l.title);
      if (!seats.has(k)) { seats.set(k, { who, owner: l.owner, person: l.person, dir, date, place, boards, lids: [l.lid], titles: [l.title], flags: flag ? [flag] : [], price: l.price }); return; }
      const s = seats.get(k); s.lids.push(l.lid); s.titles.push(l.title); s.boards = s.boards || boards;
      if (l.price != null) s.price = (s.price || 0) + l.price;
      if (s.place !== place) s.flags.push(`booked twice for this day: ${s.titles.map(t => `«${t}»`).join(' and ')} — ${cfg.airportCity[s.place] || s.place} kept (first line), check`);
      else s.flags.push(`${s.lids.length} transfer lines for one person on this day (${s.titles.map(t => `«${t}»`).join(' + ')}): one seat`);
    });
    const legs = [...seats.values()].map(s => {
      const g = s.owner; const flags = s.flags.slice(); const arr = s.dir === 'arrival';
      let time = null, fl = '', amb = flags.some(f => /booked twice|not the check-in/.test(f));
      if (g) {
        const [f1, t1, pl1, fd1, own1] = G.classifyField(arr ? g.arrF : g.depF, flags, arr ? 'flight' : 'departure flight', cfg);
        if (own1) amb = true;
        let t0 = G.hhmm(arr ? g.arrT : g.depT); if (t0 === '00:00') t0 = null;
        if (t0 && t1 && t0 !== t1) { flags.push(`two times: ${t0} (${arr ? 'arrival' : 'departure'} time) and ${t1} (flight field)`); amb = true; }
        else if (t1 && !t0) flags.push('time taken from the flight field');
        time = t0 || t1; fl = f1;
        if (pl1 && pl1 !== s.place) flags.push(`transfer booked for ${cfg.airportCity[s.place] || s.place} airport, the flight field says ${cfg.airportCity[pl1] || pl1} — check`);
        if (arr && fd1 && (fd1[0] !== parseInt(s.date.slice(8), 10) || fd1[1] !== parseInt(s.date.slice(5, 7), 10))) { flags.push(`flight date ${fd1[0]}/${fd1[1]} differs from the transfer date`); amb = true; }
        if (/\b(don.?t|do not|no) need\b|\bno transfer\b|\bnot needed\b|\bcancel|arrange this transfer myself/i.test(g.tcomment)) { flags.push(`guest says: «${g.tcomment.trim()}» — check if this transfer is still needed`); amb = true; }
      } else flags.push(s.person ? `line in the name of «${s.person}», not on the guest list` : 'guest without a name: no flight or time in the report');
      if (!cfg.airports.includes(s.place)) { flags.push(`airport ${s.place} is not a ${cfg.name} airport`); amb = true; }
      if (!time) flags.push('no time yet: ask the guest');
      else if (!arr && time < '05:00') { flags.push(`night departure: flight ${time} on ${G.strfADB(s.date)} — pick-up at the camp on ${G.strfADB(G.addDaysIso(s.date, -1))} evening`); amb = true; }
      else if (arr && time < '05:00') { flags.push(`night arrival: lands ${time} on ${G.strfADB(s.date)}, driver leaves camp ${G.strfADB(G.addDaysIso(s.date, -1))} evening — confirm the night`); amb = true; }
      const guest = g ? ((G.isUpper(g.name) || G.isLower(g.name)) ? G.pyTitle(g.name) : g.name) : (s.person || `Guest without name (booking ${b.ref})`);
      let phone = g ? phoneOf(g.phone, cfg) : ''; let phoneFrom = phone ? 'guest' : '';
      if (!phone && b.bookerPhone) { phone = phoneOf(b.bookerPhone, cfg); phoneFrom = 'booker'; }
      return { ...s, time, flight: fl, guest, phone, phoneFrom, flags, ambiguous: amb, order: g ? g.pos : 999 };
    });
    // Same booking + direction: one trip per date + airport, split only when a time or a flight contradicts
    // (the rule of GuestsTrips.parse, so the keys stay the ones the app already has).
    const out = []; const byDir = { arrival: [], departure: [] };
    legs.forEach(l => byDir[l.dir].push(l));
    // Without prices (older files): split only when a time or a flight contradicts.
    const oldGroups = ls => {
      const groups = [];
      const fits = (gr, l) => gr.date === l.date && gr.place === l.place && (!gr.time || !l.time || gr.time === l.time) && (!gr.flight || !l.flight || gr.flight === l.flight);
      const filled = l => (l.time ? 1 : 0) + (l.flight ? 1 : 0);
      ls.slice().sort((a, b2) => filled(b2) - filled(a) || a.order - b2.order || a.lids[0].localeCompare(b2.lids[0])).forEach(l => {
        const gr = groups.find(x => fits(x, l));
        if (gr) { gr.legs.push(l); gr.time = gr.time || l.time; gr.flight = gr.flight || l.flight; }
        else groups.push({ date: l.date, place: l.place, time: l.time, flight: l.flight, legs: [l], extra: [] });
      });
      return groups;
    };
    // With prices (Miguel, 17 Nov 2026), per booking × day × direction × airport:
    //   · one paid line, the others at 0 € → ONE trip with everyone; a guest at 0 € whose flight (number, airline code
    //     ignored) or time (> 30 min) differs from the paid one stays in it, with the question «coming together?»;
    //   · two or more paid lines on the same flight / time (or empty) → ONE trip, «N transfers paid, same flight — confirm»;
    //     on different flights / times → one trip per paid line, each 0 € guest with the paid line that matches;
    //   · no paid line (all 0 €, e.g. a partner's transfer) → like one paid line (Miguel, 17 Nov 2026): ONE trip, the guest
    //     with the most flight / time info leads, the question when another guest's flight / time differs.
    const priceGroups = ls => {
      const out2 = []; const byDay = new Map();
      ls.forEach(l => { const k = `${l.date}|${l.place}`; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(l); });
      byDay.forEach(c => {
        let paid = c.filter(l => l.price > 0).sort((a, b2) => a.order - b2.order); let free = c.filter(l => !(l.price > 0)).sort((a, b2) => a.order - b2.order);
        const allZero = !paid.length;
        if (allZero) {
          const filled = l => (l.time ? 1 : 0) + (l.flight ? 1 : 0);
          const lead = free.slice().sort((a, b2) => filled(b2) - filled(a) || a.order - b2.order)[0];
          paid = [lead]; free = free.filter(l => l !== lead);
        }
        const pg = [];
        paid.forEach(l => { const gr = pg.find(x => compatible(x, l)); if (gr) { gr.legs.push(l); gr.paid++; gr.time = gr.time || l.time; gr.flight = gr.flight || l.flight; } else pg.push({ date: l.date, place: l.place, time: l.time, flight: l.flight, legs: [l], paid: 1, ask: [], extra: [], allZero }); });
        // a 0 € guest who fits joins; their flight / time fill what the paid guest left empty (MA 2026-4241 shape)
        free.forEach(l => { const gr = pg.find(x => compatible(x, l)); if (gr) { gr.legs.push(l); gr.time = gr.time || l.time; gr.flight = gr.flight || l.flight; } else { pg[0].legs.push(l); pg[0].ask.push(l); } });
        pg.forEach(gr => {
          if (gr.paid > 1) gr.extra.push(paidTwiceFlag(gr.paid));
          if (gr.ask.length) gr.extra.push(`${TOGETHER_FLAG} (${gr.ask.map(l => [l.guest, l.flight, l.time].filter(Boolean).join(' · ')).join('; ')})`);
        });
        out2.push(...pg);
      });
      return out2;
    };
    for (const dir of ['arrival', 'departure']) {
      const ls = byDir[dir]; if (!ls.length) continue;
      const groups = b.hasPrice ? priceGroups(ls) : oldGroups(ls);
      groups.forEach(gr => gr.legs.sort((a, b2) => a.order - b2.order));
      groups.sort((a, b2) => a.date.localeCompare(b2.date) || a.legs[0].order - b2.legs[0].order);
      const split = groups.length > 1; const used = new Set();
      groups.forEach(gr => {
        let key = `bl:${b.ref}:${dir.slice(0, 3)}` + (split ? `:${slug(gr.legs[0].guest)}` : '');
        for (let n = 2; used.has(key); n++) key = `bl:${b.ref}:${dir.slice(0, 3)}:${slug(gr.legs[0].guest)}${n}`;
        used.add(key);
        let fl = [...new Set(gr.legs.flatMap(l => l.flags))];
        if (gr.time) fl = fl.filter(f => !/^no time yet/.test(f));
        // the together question replaces the «two times» noise of the 0 € guest
        if ((gr.extra || []).length) fl = fl.filter(f => !/^two times|^time taken from/.test(f));
        fl.sort();
        fl.push(...(gr.extra || []));
        if (split) fl.push('guests of this booking travel separately');
        const pax = gr.legs.length; const boards = gr.legs.some(l => l.boards);
        out.push({
          key, kind: `airport_${dir}`, date: gr.date, time: gr.time || null, flight: gr.flight || '', place: gr.place,
          pax, guests: gr.legs.map(l => l.guest), boards, charge: 'bookinglayer', flags: fl,
          ambiguous: gr.legs.some(l => l.ambiguous) || fl.some(f => f.includes('two times') || f.includes('not understood')),
          csv_lines: gr.legs.flatMap(l => l.lids), line_ids: gr.legs.flatMap(l => l.lids),
          booking_ref: b.ref, booking_checkout: b.co || null, phone: (gr.legs.find(l => l.phone) || {}).phone || '',
          phone_from: (gr.legs.find(l => l.phone) || {}).phoneFrom || '',
          vehicle: GT().vehicleFor(pax, boards, cfg), partner: b.partner || null,
          ...(b.hasPrice ? { paid_lines: gr.legs.filter(l => l.price > 0).length, line_prices: gr.legs.map(l => ({ guest: l.guest, price: l.price })), all_zero: !!gr.allZero } : {}),
        });
      });
    }
    // cross-booking suggestion, as GuestsTrips.parse
    return out;
  }

  // ── The model of the whole file for one camp ─────────────────────────────
  function model(text, fileName, cfg) {
    cfg = cfg || CC().SL;
    const R = read(text, fileName, cfg);
    const G = GT();
    const OK = G.OK_STATUS;
    const camp = R.bookings.filter(b => b.camp);
    const other = R.bookings.filter(b => !b.camp);
    const live = camp.filter(b => OK.has(b.status));
    const trips = []; const guests = []; const left = [];
    other.forEach(b => b.guests.forEach(g => left.push({ line: g.line, name: g.name, ref: b.ref, kind: 'other_camp', reason: `other camp (${b.otherWhy})` })));
    camp.forEach(b => {
      if (!OK.has(b.status)) { b.guests.forEach(g => left.push({ line: g.line, name: g.name, ref: b.ref, kind: 'status', reason: `status «${b.status || 'empty'}»` })); return; }
      if (G.TEST_NAME.test(b.guests.map(g => g.fileName).join(' '))) { b.guests.forEach(g => left.push({ line: g.line, name: g.name, ref: b.ref, kind: 'test', reason: 'test booking' })); return; }
      b.guests.forEach(g => {
        const row = guestRow(b, g, cfg);
        if (!row.check_in || !row.check_out) { left.push({ line: g.line, name: g.name, ref: b.ref, kind: 'no_dates', reason: 'no check-in or check-out date: on no list' }); return; }
        guests.push(row);
      });
      bookingTrips(b, cfg).forEach(t => trips.push(t));
    });
    // Same day + same flight across bookings → one van? (suggestion only, as GuestsTrips.parse)
    const share = new Map();
    trips.forEach(t => { if (t.time || t.flight) { const k = [t.kind, t.date, t.flight || t.time].join('\u0000'); if (!share.has(k)) share.set(k, []); share.get(k).push(t.key); } });
    share.forEach(ks => { if (ks.length > 1) ks.forEach(kk => trips.find(t => t.key === kk).flags.push('same flight as ' + ks.filter(x => x !== kk).join(', ') + ': one van?')); });
    trips.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    return { R, camp, other, live, trips, guests, left };
  }

  // ── Adapters: the same shapes as GuestsTrips (parse / guestRows / guestAudit / importWarnings) ──
  function exportDateOf(fileName) { const m = String(fileName || '').split('/').pop().match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
  function parse(text, fileName, exportDate, cfg) {
    const M = model(text, fileName, cfg);
    const counts = {};
    if (M.other.length) counts['other location'] = M.other.reduce((s, b) => s + b.guests.length, 0);
    return {
      file: M.R.file, export_date: exportDate || exportDateOf(fileName), has_transfers_col: true, report: true,
      counts, trips: M.trips, cancel_refs: [], skipped: [], dirty_no_transfer: [],
      other_location_names: M.other.flatMap(b => b.guests.map(g => g.name)),
      refs_active: M.live.map(b => b.ref), is_preset: false, guests_total: M.guests.length,
      bookings: M.live.map(b => ({ ref: b.ref, status: b.status, ci: b.ci, co: b.co, partner: b.partner, due: b.due, flags: b.flags.slice() })),
      other_bookings: M.other.map(b => ({ ref: b.ref, why: b.otherWhy })),
    };
  }
  const guestRows = (text, fileName, cfg) => model(text, fileName, cfg).guests;
  function guestAudit(text, fileName, cfg) {
    const M = model(text, fileName, cfg);
    const total = M.R.bookings.reduce((s, b) => s + b.guests.length, 0);
    return { rows: total, guests: M.guests.length, left: M.left.slice().sort((a, b) => a.line - b.line),
      renamed: M.guests.filter(g => g.renamed).map(g => ({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref })), unit: 'guests', lines: M.R.rows };
  }
  function importWarnings(text, fileName, cfg) {
    cfg = cfg || CC().SL;
    const M = model(text, fileName, cfg); const out = [];
    M.R.missing.forEach(c => out.push({ kind: 'column', text: `Column «${c}» is missing from the report — add it back in Bookinglayer` }));
    const prods = new Map(); M.R.warnings.filter(w => w.kind === 'product').forEach(w => prods.set(w.text, (prods.get(w.text) || 0) + 1));
    prods.forEach((n, t) => out.push({ kind: 'product', text: `Product «${t}» is new to the app (${n} line${n === 1 ? '' : 's'}) — not counted as a room, lesson or transfer` }));
    if (cfg.rooms) {
      const rooms = new Map();
      M.guests.forEach(g => (g.raw.segments || []).forEach(s => { if (!CC().maRoomKnown(s.room)) { const x = rooms.get(s.room) || new Set(); x.add(g.guest_name); rooms.set(s.room, x); } }));
      rooms.forEach((who, r) => out.push({ kind: 'room', text: `Room «${r}» is not in the room list (${who.size} guest${who.size === 1 ? '' : 's'}) — counted, its beds are not checked; ask Miguel to add it` }));
    }
    M.live.forEach(b => b.flags.forEach(f => out.push({ kind: 'booking', text: `${b.ref}: ${f}` })));
    M.other.forEach(b => out.push({ kind: 'other', text: `${b.ref} is another camp's booking (${b.otherWhy}) — left out` }));
    return out;
  }

  // ── Per day: surf lessons and courses (for the week's surf list) ─────────
  function lessonsByDay(guests, from, to) {
    const days = {};
    for (let d = from; d <= to; d = GT().addDaysIso(d, 1)) days[d] = { standard: 0, intensive: 0, coaching: 0, course: { standard: 0, intensive: 0, coaching: 0 }, who: { standard: [], intensive: [], coaching: [] } };
    guests.forEach(g => {
      (g.raw.lessons || []).forEach(x => { if (days[x.date]) { days[x.date][x.type]++; days[x.date].who[x.type].push(g.guest_name); } });
      (g.raw.courses || []).forEach(c => { Object.keys(days).forEach(d => { if (g.check_in <= d && d < g.check_out) days[d].course[c.type]++; }); });
    });
    return days;
  }

  // ── What an import of these trips would do (the rules of camp_trips_import, camp-trips-bl-check.sql) ──
  // Never sent: a leg dated before the camp's today that the app does not already have under its key (the
  // RPC would insert it — e.g. beside Morocco's «hist2026» trips: the same transfer owed twice), and a leg the
  // app already has under another key (same booking, kind and date). Sent: every leg from today on, and past
  // legs whose key exists (the RPC leaves them untouched; sending the key keeps its «regrouped» and «transfer
  // removed» passes away from them).
  const LIVE = ['planned', 'sent', 'confirmed'];
  const HAPPENED = ['planned', 'sent', 'confirmed', 'done', 'no_show'];
  const isAdded = t => !t.last_import_at && !!t.bl_checked_at;   // added from the booking page
  function presetOf(prices, kind, vehicle, place) { return prices ? Number(prices(kind, vehicle, place)) || 0 : null; }
  function planTrips(trips, appTrips, o) {
    o = o || {}; const today = o.today; const now = o.now || `${today}T00:00`;
    // The import is sent with the camp's today when the file is older (Sri Lanka was already on 17 Nov when the 16 Nov
    // file was exported): the RPC's «transfer removed» pass then never marks a trip of an earlier day.
    const exp = [o.exportDate, today].filter(Boolean).sort().pop();
    const app = (appTrips || []).filter(t => t.kind === 'airport_arrival' || t.kind === 'airport_departure');
    const byKey = new Map(app.filter(t => t.import_key).map(t => [t.import_key, t]));
    const plan = { send: [], create: [], update: [], same: [], revive: [], untouched: [], covered: [], past: [], regroupCancel: [], flagRemoved: [], notInReport: [], fills: [], conflicts: [], refsPresent: o.refsPresent || [...new Set(trips.map(t => t.booking_ref))] };
    const doneByTime = t => `${t.trip_date}T${t.trip_time || '23:59'}` < now;
    const withPrice = t => { const price = presetOf(o.prices, t.kind, t.vehicle, t.place); return { ...t, flags: (t.flags || []).slice(), ...(price != null ? { expected_price: price } : {}) }; };
    // ── One transfer kept as two trips (MA 2026-4717, 17 Nov 2026): the report makes it one trip, the app has a live trip
    // per guest under per-guest keys. One trip survives with everyone (the one holding the report's key — brought back
    // when an import had cancelled it — else the paid guest's), the others become «merged» (merged_into the survivor,
    // «merged — same transfer»): never two trips owed for one transfer. A paid trip is never merged; a camp with
    // mergePast: false (Sri Lanka) never merges a trip of an earlier day.
    plan.merge = []; plan.mergeInfo = [];
    const mergedAway = new Set();
    trips.forEach(t0 => {
      const live = app.filter(a => a.booking_ref === t0.booking_ref && a.kind === t0.kind && a.trip_date === t0.date && a.place === t0.place && ['planned', 'sent', 'confirmed', 'done'].includes(a.status));
      if (live.length < 2) return;
      const names = new Set((t0.guests || []).map(nk));
      if (!live.every(a => String(a.guest_names || '').split(/\s*,\s*/).filter(Boolean).every(n => names.has(nk(n))))) return;
      if (live.some(a => a.payment_entry_id)) { plan.mergeInfo.push({ trip: t0, app: live, why: 'one of them is paid — merge by hand' }); return; }
      // «Separate» chosen in Transport (a trip split off by hand, or the trip it was split from): the camp's decision stands.
      if (live.some(a => isAdded(a) || (a.edited_fields || []).includes('together_split'))) { plan.mergeInfo.push({ trip: t0, app: live, why: 'separated by hand in Transport — kept as it is' }); return; }
      if (t0.date < today && o.mergePast === false) { plan.mergeInfo.push({ trip: t0, app: live, why: 'an earlier day: this camp never changes past trips' }); return; }
      const t = withPrice(t0); const keyRow = byKey.get(t.key);
      let survivor = null;
      if (keyRow && live.includes(keyRow)) survivor = keyRow;
      else if (keyRow && keyRow.status === 'cancelled' && ['bookinglayer', 'split'].includes(keyRow.cancel_reason || '') && !keyRow.payment_entry_id) survivor = keyRow;
      else if (!keyRow) survivor = live.find(a => nk(a.guest_names).includes(nk((t.guests || [])[0]))) || live[0];
      if (!survivor) { plan.mergeInfo.push({ trip: t, app: live, why: `the key ${t.key} belongs to a ${keyRow.status} trip` }); return; }
      const ed = new Set(survivor.edited_fields || []);
      const patch = {};
      const put = (f, v) => { if (!ed.has(f) && v != null && v !== '') patch[f] = v; };
      put('guest_names', (t.guests || []).join(', ')); put('pax', t.pax); put('vehicle', t.vehicle); put('trip_time', t.time); put('flight', t.flight);
      if (t.expected_price != null) put('expected_price', t.expected_price);
      if (t.phone) put('guest_phone', t.phone);
      patch.import_flags = t.flags;
      if (survivor.import_key !== t.key) patch.import_key = t.key;
      if (survivor.status === 'cancelled') {
        // Brought back on its key. When a merged-away trip was already sent / confirmed to the driver, the survivor takes
        // that state and «changed, resend» (the driver had two messages for one transfer).
        const told = live.filter(a => a !== survivor && ['sent', 'confirmed'].includes(a.status));
        patch.status = told.some(a => a.status === 'confirmed') ? 'confirmed' : told.length ? 'sent' : 'planned'; patch.cancel_reason = null;
        if (told.length) patch.needs_resend = true;
      }
      const others = live.filter(a => a !== survivor);
      others.forEach(a => mergedAway.add(a.id)); mergedAway.add(survivor.id);   // neither is the import's to regroup or flag
      plan.merge.push({ trip: t, survivor, others, patch });
      byKey.set(t.key, { ...survivor, ...patch, import_key: t.key });
    });
    trips.forEach(t => {
      const tt = withPrice(t);
      const k = byKey.get(t.key);
      if (plan.merge.some(m => m.trip.key === t.key && m.trip.booking_ref === t.booking_ref)) {
        // merged above with the report's values: sent so the import keeps its key (a trip of an earlier day is left alone by the RPC)
        plan.send.push(tt); return;
      }
      const other = app.filter(a => a.import_key !== t.key && a.booking_ref === t.booking_ref && a.kind === t.kind && a.trip_date === t.date && (HAPPENED.includes(a.status) || a.payment_entry_id));
      if (!k) {
        if (other.length) { plan.covered.push({ trip: tt, app: other }); return; }
        if (t.date < today) { plan.past.push({ trip: tt, app: app.filter(a => a.booking_ref === t.booking_ref && a.kind === t.kind) }); return; }
        plan.create.push({ trip: tt }); plan.send.push(tt); return;
      }
      plan.send.push(tt);
      const why = k.payment_entry_id ? 'paid' : ['done', 'no_show', 'merged'].includes(k.status) ? k.status
        : (k.status === 'cancelled' && !['bookinglayer', 'split'].includes(k.cancel_reason || '')) ? `cancelled: ${k.cancel_reason || 'by hand'}`
          : (k.last_export_date && exp && exp < k.last_export_date) ? 'older file' : doneByTime(k) ? 'in the past' : '';   // the RPC tests the time for any status
      const diffs = tripDiffs(tt, k, false);
      if (why) { plan.untouched.push({ trip: tt, app: k, why, diffs }); return; }
      const changes = tripDiffs(tt, k, true);
      // Merge, never blank (Miguel, 17 Nov 2026): an empty report value never blanks (the RPC coalesces); a field typed by
      // hand stays, and a different report value becomes a note on the trip — «Bookinglayer says: time 11:55 — use it?».
      const conflicts = changes.filter(c => c.kept); const fills = changes.filter(c => !c.kept && (c.app === '' || c.app == null));
      conflicts.forEach(c => tt.flags.push(blSays(c.field, c.report)));
      const entry = { trip: tt, app: k, changes: changes.filter(c => !c.kept), fills, conflicts };
      if (fills.length) plan.fills.push(entry);
      if (conflicts.length) plan.conflicts.push(entry);
      if (k.status === 'cancelled') { plan.revive.push(entry); return; }
      (entry.changes.length ? plan.update : plan.same).push(entry);
    });
    const pre = k => String(k || '').split(':').slice(0, 3).join(':');
    const regroupable = (a, ks) => !mergedAway.has(a.id) && a.source === 'bookinglayer' && LIVE.includes(a.status) && !a.payment_entry_id && a.import_key && !ks.has(a.import_key) && !isAdded(a);
    // The RPC's «regrouped» pass cancels every live trip of the same booking + direction that the file does not
    // name, with no date test. A trip of an earlier day must never change: the keys that would cancel it are held back.
    plan.withheld = [];
    for (;;) {
      const ks = new Set(plan.send.map(t => t.key)); const pf = new Set([...ks].map(pre));
      const hit = app.filter(a => regroupable(a, ks) && pf.has(pre(a.import_key)) && a.trip_date < today);
      if (!hit.length) break;
      const bad = new Set(hit.map(a => pre(a.import_key)));
      plan.send.filter(t => bad.has(pre(t.key))).forEach(t => plan.withheld.push({ trip: t, why: `would cancel ${hit.filter(a => pre(a.import_key) === pre(t.key)).map(a => `${a.import_key} (${a.trip_date})`).join(', ')}, a trip of an earlier day` }));
      plan.send = plan.send.filter(t => !bad.has(pre(t.key)));
      ['create', 'update', 'same', 'revive', 'untouched'].forEach(k => { plan[k] = plan[k].filter(x => !bad.has(pre(x.trip.key))); });
    }
    const keys = new Set(plan.send.map(t => t.key));
    const prefixes = new Set([...keys].map(pre));
    app.forEach(a => {
      const liveBl = !mergedAway.has(a.id) && a.source === 'bookinglayer' && LIVE.includes(a.status) && !a.payment_entry_id && a.import_key && !keys.has(a.import_key) && !isAdded(a);
      if (liveBl && prefixes.has(pre(a.import_key))) { plan.regroupCancel.push(a); return; }
      if (liveBl && plan.refsPresent.includes(a.booking_ref) && a.trip_date >= exp && !(a.import_flags || []).includes('transfer removed in Bookinglayer — cancel it?')) plan.flagRemoved.push(a);
    });
    if (o.window) app.filter(a => !plan.refsPresent.includes(a.booking_ref) && a.trip_date >= today && a.status !== 'cancelled' && a.booking_ref
      && (!a.booking_checkout || a.booking_checkout <= o.window.to)).forEach(a => plan.notInReport.push(a));
    return plan;
  }
  const nk = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  // «Bookinglayer says: time 11:55 — use it?» (a field typed by hand in the app, a different value in the report).
  const FIELD_WORD = { trip_time: 'time', flight: 'flight', trip_date: 'date', pax: 'people', place: 'airport', guest_names: 'guests', guest_phone: 'phone', vehicle: 'vehicle', expected_price: 'price' };
  const WORD_FIELD = Object.fromEntries(Object.entries(FIELD_WORD).map(([f, w]) => [w, f]));
  const blSays = (field, value) => `Bookinglayer says: ${FIELD_WORD[field] || field} ${value} — use it?`;
  const BL_SAYS_RE = /^Bookinglayer says: (\w+) (.+) — use it\?$/;
  function blSaysOf(flag) { const m = BL_SAYS_RE.exec(String(flag || '')); return m ? { word: m[1], field: WORD_FIELD[m[1]] || m[1], value: m[2] } : null; }
  // The values the RPC would write (edited fields kept, an empty value never blanks) vs what the app has.
  function tripDiffs(t, a, rpc) {
    const ed = new Set(rpc ? (a.edited_fields || []) : []);
    const pick = (f, nv, av, blankKeeps = true) => ed.has(f) ? av : (blankKeeps ? (nv || av) : nv);
    const n = {
      trip_date: pick('trip_date', t.date, a.trip_date), trip_time: pick('trip_time', t.time, a.trip_time), flight: pick('flight', t.flight, a.flight),
      pax: ed.has('pax') ? a.pax : t.pax, place: pick('place', t.place, a.place),
      guest_names: pick('guest_names', (t.guests || []).join(', '), a.guest_names), guest_phone: pick('guest_phone', t.phone, a.guest_phone),
      vehicle: pick('vehicle', t.vehicle, a.vehicle),
    };
    if (t.expected_price != null) n.expected_price = ed.has('expected_price') ? Number(a.expected_price) : (Number(t.expected_price) || Number(a.expected_price));
    const out = [];
    Object.keys(n).forEach(f => {
      const av = f === 'expected_price' ? Number(a[f]) : f === 'pax' ? Number(a[f]) : (a[f] == null ? '' : String(a[f]));
      const nv = f === 'expected_price' || f === 'pax' ? Number(n[f]) : (n[f] == null ? '' : String(n[f]));
      if (av !== nv) out.push({ field: f, app: a[f] == null ? '' : a[f], report: n[f] == null ? '' : n[f], kept: false });
    });
    // a field typed by hand: the RPC keeps it; a different, non-empty report value is a conflict (shown, never applied)
    const r = { trip_date: t.date, trip_time: t.time, flight: t.flight, pax: t.pax, place: t.place, guest_names: (t.guests || []).join(', '), guest_phone: t.phone, vehicle: t.vehicle, expected_price: t.expected_price };
    // vehicle and price come from /prices, never from Bookinglayer; a trip split by hand («Separate») keeps its people
    const quiet = new Set(['vehicle', 'expected_price', ...(ed.has('together_split') ? ['pax', 'guest_names'] : [])]);
    ed.forEach(f => { if (!(f in r) || quiet.has(f)) return; const rv = r[f]; if (rv == null || rv === '') return;
      const same = f === 'pax' || f === 'expected_price' ? Number(rv) === Number(a[f]) : String(rv) === String(a[f] == null ? '' : a[f]);
      if (!same) out.push({ field: f, app: a[f] == null ? '' : a[f], report: rv, kept: true }); });
    return out;
  }

  // ── What the guests part would change in camp_week_guests ────────────────
  function courseOf(g) {
    const a = `${g.activities || ''} ${g.packages || ''}`;
    if (/intensive/i.test(a)) return 'Intensive'; if (/coaching/i.test(a)) return 'Coaching';
    if (/surf course|surf lesson|standard surf/i.test(a)) return 'Standard';
    return '';
  }
  const yogaOf = g => /yoga/i.test(`${g.activities || ''} ${g.packages || ''}`);
  // camp_week_guests fields an empty report value never blanks. Not here: status, due, partner (booking facts — an
  // empty Company/Channel means a direct booking) and the dates.
  // The guest-form fields only: rooms, packages and activities come from booking lines, so an empty value there means
  // the line was removed (a cancelled course must leave the surf list) — they always take the report's value.
  const MERGE_FIELDS = ['phone', 'level', 'diet', 'allergies', 'bed_number', 'arrival_time', 'arrival_flight', 'departure_time', 'departure_flight'];
  function planGuests(rows, appGuests, o) {
    o = o || {};
    const app = new Map((appGuests || []).map(g => [`${g.booking_ref}\u0000${g.guest_key}`, g]));
    const mine = new Set(rows.map(g => `${g.booking_ref}\u0000${g.guest_key}`));
    const plan = { add: [], change: [], same: [], phoneFilled: [], statusDue: [], appOnly: [], fills: [], conflicts: [], kept: [], rows: [] };
    const norm = v => v == null ? '' : String(v).trim();
    rows = rows.map(g0 => {
      const a = app.get(`${g0.booking_ref}\u0000${g0.guest_key}`);
      if (!a) { plan.rows.push(g0); return g0; }
      // Merge, never blank (Miguel, 17 Nov 2026): an empty report field keeps the stored value; a filled one updates it.
      const g = { ...g0, raw: { ...(g0.raw || {}) } }; const fill = [], kept = [];
      MERGE_FIELDS.forEach(f => {
        const n = norm(g[f]), x = norm(a[f]);
        if (!n && x) { g[f] = a[f]; kept.push({ field: f, app: x }); }
        else if (n && !x) fill.push({ field: f, report: n });
      });
      if (!norm(g.raw.transfer_comment) && a.raw && norm(a.raw.transfer_comment)) { g.raw.transfer_comment = a.raw.transfer_comment; kept.push({ field: 'transfer comment', app: norm(a.raw.transfer_comment) }); }
      // «Not here» set by hand in Week: kept; the report's status is a question.
      if (a.booking_status === 'not_here' && g.booking_status !== 'not_here') { plan.conflicts.push({ g, a, field: 'status', report: g.booking_status, app: 'not_here', note: `Bookinglayer says: ${g.booking_status.replace(/_/g, ' ')} — use it?` }); g.booking_status = 'not_here'; }
      if (fill.length) plan.fills.push({ g, a, fields: fill });
      if (kept.length) plan.kept.push({ g, a, fields: kept });
      plan.rows.push(g);
      return g;
    });
    rows.forEach(g => {
      const a = app.get(`${g.booking_ref}\u0000${g.guest_key}`);
      if (!a) { plan.add.push(g); return; }
      const cmp = [
        ['check_in', g.check_in, a.check_in], ['check_out', g.check_out, a.check_out], ['rooms', g.accommodation, a.accommodation], ['beds', g.bed_number, a.bed_number],
        ['course', courseOf(g), courseOf(a)], ['yoga', yogaOf(g) ? 'yes' : 'no', yogaOf(a) ? 'yes' : 'no'], ['level', g.level, a.level], ['diet', g.diet, a.diet],
        ['allergies', g.allergies, a.allergies], ['status', g.booking_status, a.booking_status], ['due', Number(g.booking_due || 0).toFixed(2), Number(a.booking_due || 0).toFixed(2)],
        ['partner', g.partner, a.partner],
        // the RPC keeps the stored phone when the new one is empty
        ['phone', g.phone || a.phone, a.phone],
      ].filter(([, n, x]) => norm(n) !== norm(x)).map(([field, n, x]) => ({ field, report: norm(n), app: norm(x) }));
      if (!a.phone && g.phone && g.raw.phone_from === 'booker') plan.phoneFilled.push({ g, from: 'booker' });
      if (cmp.some(c => c.field === 'status' || c.field === 'due')) plan.statusDue.push({ g, a, changes: cmp.filter(c => c.field === 'status' || c.field === 'due') });
      (cmp.length ? plan.change : plan.same).push({ g, a, changes: cmp });
    });
    (appGuests || []).forEach(a => { if (!mine.has(`${a.booking_ref}\u0000${a.guest_key}`)) plan.appOnly.push(a); });
    // Week's classify() after this import: a stored guest of an older import whose check-in falls inside the
    // new import's check-in range but who is not in it shows as «cancelled?» («dropped»).
    const cis = rows.map(g => g.check_in).filter(Boolean).sort();
    const min = cis[0], max = cis[cis.length - 1];
    plan.range = { min, max };
    plan.wouldDrop = plan.appOnly.filter(a => a.check_in && min && a.check_in >= min && a.check_in <= max);
    return plan;
  }

  return { blSays, blSaysOf, BL_SAYS_RE, MERGE_FIELDS, TOGETHER_FLAG, paidTwiceFlag, flightNo, priceOf, PRICE_HEADER, COL, isReportHeader, productKind, read, model, parse, guestRows, guestAudit, importWarnings, lessonsByDay, planTrips, planGuests, tripDiffs, courseOf, exportDateOf };
});
