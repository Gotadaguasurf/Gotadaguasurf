// Bookinglayer «Guests» export → airport trips (Sri Lanka). 13 Nov 2026.
//
// Pure functions, no DOM and no Supabase: the camp hub (Transport → Next week)
// and the Node test (tests/guests-trips.spec.js) run the same code. It is a
// one-to-one port of the reference parser sl_design/trips/guests_to_trips.py
// (trips.md §1.3) and must give the same output on the same file.
//
// Dates are strings ('YYYY-MM-DD') built from the text of the file and are
// never passed through new Date(str) or UTC: a 01:55 landing on the check-in
// day must stay on that day (the Camp Tab once shifted days this way).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GuestsTrips = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const OK_STATUS = new Set(['paid', 'confirmed', 'deposit_paid', 'deposit paid']);
  const DEAD_STATUS = new Set(['cancelled', 'canceled', 'expired']);
  const JUNK = new Set(['', 'n/a', 'na', '-', '--', 'none', 'no', 'no transfer', 'tbc', 'tbd', '?', 'unknown']);
  const TIME_RE = /^\s*(\d{1,2})\s*[:h.]\s*(\d{2})\s*(am|pm)?\s*$/i;
  const FLIGHT_RE = /^([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s?-?\s?(\d{1,4})[A-Z]?$/;
  const ICAO_RE = /^([A-Z]{3})\s?-?\s?(\d{1,4})[A-Z]?$/;   // EZY2621, EJU5371 (camps with icaoFlights)
  const FLIGHT_DATE_RE = /\s+(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\s*$/;
  const TEST_NAME = /\b(test|delete after|qa)\b/i;
  // The camp's settings (lib/camp-config.js). Every function takes an optional `cfg`; without it
  // the parser is the Sri Lanka parser of 13 Nov, unchanged.
  function slConfig() {
    if (typeof module === 'object' && module.exports) { try { return require('./camp-config.js').SL; } catch (_) { /* below */ } }
    if (typeof self !== 'undefined' && self.CampConfig) return self.CampConfig.SL;
    throw new Error('lib/camp-config.js must be loaded before lib/guests-trips.js');
  }
  const conf = cfg => cfg || slConfig();
  // A Guests export has these headers; the bookings export never does (HQ import guard).
  const GUESTS_HEADER_MARKERS = ['has transfer', 'arrival flight'];

  // ── CSV (quote-aware, newlines inside quotes, blank lines kept as [] so
  //    line numbers match Python's csv.reader) ────────────────────────────
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const rows = []; let row = []; let cur = ''; let inQ = false; let any = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') { inQ = true; any = true; }
      else if (ch === ',') { row.push(cur); cur = ''; any = true; }
      else if (ch === '\n') { if (any || cur) row.push(cur); rows.push(row); row = []; cur = ''; any = false; }
      else { cur += ch; any = true; }
    }
    if (any || cur) { row.push(cur); rows.push(row); }
    return rows;
  }

  function isGuestsExportHeader(text) {
    const first = String(text || '').replace(/^﻿/, '').split(/\r?\n/, 1)[0] || '';
    const cells = (parseCsv(first)[0] || []).map(s => s.trim().toLowerCase());
    return GUESTS_HEADER_MARKERS.some(m => cells.includes(m));
  }

  // ── small helpers (Python semantics) ───────────────────────────────────
  const pyStrip = s => String(s == null ? '' : s).trim();
  const hasCased = s => s.toLowerCase() !== s.toUpperCase();
  const isUpper = s => hasCased(s) && s === s.toUpperCase();
  const isLower = s => hasCased(s) && s === s.toLowerCase();
  const pyTitle = s => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const pad2 = n => String(n).padStart(2, '0');

  // A room of the camp is enough, whatever the package is called (13 Nov audit: a guest on a package
  // with another name must not drop out of the lists). 'room' = Packages empty (counted in the report).
  // 'unknown' (Morocco): a «N - Name» room not in the camp's list and not another camp's — counted
  // only when most rows of the file are this camp's (the file is the camp's preset), and flagged.
  function campRows(all, H, cfg) {
    const idx = H.indexOf('Packages'), ia = H.indexOf('Accommodations');
    const il = cfg.locationColumn ? H.indexOf('Booking location') : -1;   // Morocco: the export may carry the location itself
    const cell = (r, i) => i >= 0 && i < r.length ? pyStrip(r[i]) : '';
    const one = r => { const loc = cell(r, il); if (il >= 0 && loc) return cfg.locationColumn.test(loc) ? (cfg.matchRow(cell(r, idx), cell(r, ia)) === 'room' ? 'room' : 'yes') : ''; return cfg.matchRow(cell(r, idx), cell(r, ia)); };
    const v = all.slice(1).map(r => r.some(c => String(c).trim()) ? one(r) : null);
    const mine = v.filter(x => x === 'yes' || x === 'room').length, other = v.filter(x => x === '').length;
    const takeUnknown = mine > 0 && mine >= other;
    return v.map(x => x === 'unknown' ? (takeUnknown ? 'unknown' : '') : x);
  }

  function ymd(s) {
    const m = String(s || '').match(/^\s*(?:[A-Za-z]{3,}\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (!m) return '';
    const mo = MONTHS[m[2].toLowerCase()]; if (!mo) return '';
    return `${m[3]}-${pad2(mo)}-${pad2(parseInt(m[1], 10))}`;
  }

  function hhmm(s) {
    const m = TIME_RE.exec(String(s || ''));
    if (!m) return null;
    let h = parseInt(m[1], 10); const mi = parseInt(m[2], 10); const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return `${pad2(h)}:${pad2(mi)}`;
  }

  // Weekday / day arithmetic on the date string only (UTC math on y-m-d parts,
  // no time of day involved, so no zone can shift it).
  function dateParts(iso) { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; }
  function addDaysIso(iso, n) {
    const { y, m, d } = dateParts(iso);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  }
  function weekday(iso) { const { y, m, d } = dateParts(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  // Python strftime('%a %d %b') → 'Sat 14 Nov'
  function strfADB(iso) { const { m, d } = dateParts(iso); return `${DAY_ABBR[weekday(iso)]} ${pad2(d)} ${MONTH_ABBR[m - 1]}`; }
  // 'D Mon' for the WhatsApp message → '25 Feb'
  function dMon(iso) { if (!iso) return ''; const { m, d } = dateParts(iso); return `${d} ${MONTH_ABBR[m - 1]}`; }
  // Saturday that starts the Sat–Fri week holding iso.
  function weekStart(iso) { return addDaysIso(iso, -((weekday(iso) + 1) % 7)); }

  // Guest phone: no spaces; drop the extra 0 after the country code (gen_from_guests.py).
  function cleanPhone(s, cfg) {
    let ph = String(s || '').replace(/\s+/g, '');
    const extra = cfg && cfg.phoneZeroCodes && cfg.phoneZeroCodes.length ? '|' + cfg.phoneZeroCodes.join('|') : '';
    const mm = ph.match(new RegExp(`^\\+(41|44|33|49|43|61|353|39|31|32|48${extra})0(\\d+)$`));
    if (mm) ph = '+' + mm[1] + mm[2];
    return ph;
  }

  function classifyField(raw, flags, label, cfg) {
    cfg = conf(cfg);
    let v = pyStrip(raw);
    if (JUNK.has(v.toLowerCase())) return ['', null, '', ''];
    const t = hhmm(v);
    if (t) return ['', t, '', ''];
    const place = cfg.places[v.toLowerCase()] || '';
    if (place) return ['', null, place, ''];
    // «bus», «taxi»: the guest says how they come — not a flight (Morocco lists, 14 Nov).
    if (cfg.ownWayWords && cfg.ownWayWords.test(v)) { flags.push(`${label} field says «${v}» — coming on their own? check the transfer`); return ['', null, '', '']; }
    let fd = '';
    const m = FLIGHT_DATE_RE.exec(v);
    if (m) { fd = [parseInt(m[1], 10), parseInt(m[2], 10)]; v = v.slice(0, m.index); }
    const u = v.toUpperCase().replace(/\s+/g, ' ').trim();
    const fm = FLIGHT_RE.exec(u) || (cfg.icaoFlights ? ICAO_RE.exec(u) : null);
    if (fm) return [fm[1] + fm[2], null, '', fd];
    flags.push(`${label} «${raw}» not understood`);
    return ['', null, '', fd];
  }

  function vehicleFor(pax, boards, cfg) {
    const c = conf(cfg); const n = Number(pax) || 1;
    let v = n <= c.vehicleCaps[0] ? c.vehicles[0] : n <= c.vehicleCaps[1] ? c.vehicles[1] : c.vehicles[2];
    if (boards && v === c.vehicles[0]) v = c.vehicles[1];
    return v;
  }

  // ── main ───────────────────────────────────────────────────────────────
  // parse(text, fileName, exportDate?) → same shape as guests_to_trips.py,
  // plus app fields on each trip (phone, booking_ref, booking_checkout,
  // vehicle) and `refs_active`, `is_preset`.
  // Packages that include things the Guests file does not tick (Miguel, 13 Nov: the «Sri Lanka with
  // João Kopke» week includes the airport transfer both ways, 5 surf lessons and 5 yoga lessons).
  // Add a package here and the import, Transport and Week follow.
  // The list lives in lib/camp-config.js (`packages`); PACKAGE_INCLUDES is Sri Lanka's.
  const PACKAGE_INCLUDES = slConfig().packages;
  function packageIncludes(pkg, cfg) { const s = String(pkg || ''); return conf(cfg).packages.find(x => x.re.test(s)) || null; }

  // Morocco: the transfer product names the airport — «Airport Transfer Morocco (Agadir)» / «(Marrakesh)».
  // Returns the airport code of the guest's product ('' when none or no such setting); with `seen`
  // (the airport the flight or the location gave) a different product airport is flagged.
  function productAirport(transfers, cfg) {
    if (!cfg.productAirport) return '';
    const codes = [...String(transfers || '').matchAll(/\(([^)]+)\)/g)].map(m => cfg.places[m[1].trim().toLowerCase()]).filter(Boolean);
    return [...new Set(codes)].length === 1 ? codes[0] : '';
  }

  function parse(text, fileName, exportDate, cfg) {
    cfg = conf(cfg);
    const prodPlace = (p, flags, seen) => {
      const ap = productAirport(p.transfers, cfg);
      if (ap && seen && seen !== ap) { flags.push(`transfer booked for ${cfg.airportCity[ap] || ap} airport, the flight / location says ${cfg.airportCity[seen] || seen} — check`); return ''; }
      return ap;
    };
    const all = parseCsv(text);
    const H = (all[0] || []).map(h => h.trim());
    const idx = name => H.indexOf(name);
    const get = (r, ...names) => {
      for (const n of names) { const i = idx(n); if (i >= 0) return i < r.length ? pyStrip(r[i]) : ''; }
      return '';
    };
    const hasTransfersCol = H.includes('Transfers');
    const base = String(fileName || '').split('/').pop();
    const fm = base.match(/(\d{4}-\d{2}-\d{2})/);
    exportDate = exportDate || (fm ? fm[1] : null);

    const report = {}; const bump = k => { report[k] = (report[k] || 0) + 1; };
    const people = new Map(); const skipped = []; const other = [];
    const verdict = campRows(all, H, cfg); const dupRows = new Set();
    all.slice(1).forEach((r, n) => {
      if (!r.some(c => String(c).trim())) return;
      const line = n + 2;
      const ref = get(r, 'Booking', 'Booking #');
      // Morocco (cfg.plusOneNames): a +1 with no name travels as «Guest without name (booking …)», the name
      // the weekly lists give him; Sri Lanka keeps the 13 Nov behaviour (nameless = '').
      let name = get(r, 'Guest').replace(/\s+/g, ' ').trim() || (cfg.plusOneNames ? `Guest without name (booking ${ref || '?'})` : '');
      const st = get(r, 'Booking status').toLowerCase().replace(/ /g, '_');
      const loc = verdict[n];
      if (!loc) { bump('other location'); other.push(name); return; }
      if (loc === 'room') bump(`${cfg.name} by room name (Packages empty)`);
      if (loc === 'unknown') bump(`${cfg.name} room not in the room list (kept: the file is ${cfg.name}'s)`);
      if (TEST_NAME.test(name)) { bump('test booking'); skipped.push([line, name, 'test']); return; }
      let key = ref + '\u0000' + name.toLowerCase();
      if (cfg.plusOneNames) {
        // Same rule as the weekly lists (scanGuests): only a row that repeats name, dates, room and bed is a
        // duplicate; a second guest with the same (or no) name is another person, «Name (2)» — never merged.
        const same = key + '\u0000' + [get(r, 'Check-in on', 'Arrives on'), get(r, 'Check-out on', 'Departure date', 'Departs on'), get(r, 'Accommodations'), get(r, 'Bed number')].join('|');
        if (dupRows.has(same)) { bump('duplicate row'); return; }
        dupRows.add(same);
        const base = name;
        for (let k = 2; people.has(key); k++) { name = `${base} (${k})`; key = ref + '\u0000' + name.toLowerCase(); }
      } else if (people.has(key)) { bump('duplicate row'); return; }
      people.set(key, {
        line, name: (isUpper(name) || isLower(name)) ? pyTitle(name) : name, ref, status: st,
        ci: ymd(get(r, 'Check-in on', 'Arrives on')), co: ymd(get(r, 'Check-out on', 'Departure date', 'Departs on')),
        has: get(r, 'Has transfer').toLowerCase() === 'yes', transfers: get(r, 'Transfers'), tcomment: get(r, 'Transfer comment'),
        arr_time: get(r, 'Arrival time'), arr_flight: get(r, 'Arrival flight'), arr_loc: get(r, 'Arrival location'),
        dep_time: get(r, 'Departure time'), dep_flight: get(r, 'Departure flight'), dep_loc: get(r, 'Departure location'),
        phone: get(r, 'Phone').replace(/ /g, ''), pkg: get(r, 'Packages', 'Package'),
      });
    });

    const legs = []; const cancels = new Set(); const dirty = []; const refsActive = new Set();
    // A guest who stays on with a second booking (same name, one ends the day the other starts) has
    // no departure at the end of the first and no arrival at the start of the second (13 Nov: Yanneck Kumli).
    const nkey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const liveP = [...people.values()].filter(x => OK_STATUS.has(x.status));
    const staysOn = x => liveP.some(y => y !== x && nkey(y.name) === nkey(x.name) && y.ci && y.ci === x.co);
    const cameBefore = x => liveP.some(y => y !== x && nkey(y.name) === nkey(x.name) && y.co && y.co === x.ci);
    for (const p of people.values()) {
      if (DEAD_STATUS.has(p.status)) { cancels.add(p.ref); bump('cancelled/expired (cancels planned trips)'); continue; }
      if (!OK_STATUS.has(p.status)) { bump(`status ${p.status} (ignored)`); continue; }
      refsActive.add(p.ref);
      const incl = packageIncludes(p.pkg, cfg);
      if (!p.has && !(incl && incl.transfer)) {
        bump('no transfer');
        const dflags = [];
        const [, t1, , fd1] = classifyField(p.arr_flight, dflags, 'flight', cfg);
        let t0 = hhmm(p.arr_time); if (t0 === '00:00') t0 = null;
        if (t1 && t0 && t1 !== t0) dflags.push(`two times ${t0} / ${t1}`);
        else if (t1) dflags.push(`time ${t1} typed in the flight field`);
        if (fd1) dflags.push(`flight field carries a date ${fd1[0]}/${fd1[1]}`);
        const af = p.arr_flight.trim();
        if (JUNK.has(af.toLowerCase()) && af) dflags.push(`flight «${p.arr_flight}» = empty`);
        if (dflags.length) dirty.push([p.line, p.name, p.ref, dflags]);
        continue;
      }
      // A package that includes the airport transfer both ways counts as one booked transfer each way.
      const nProducts = incl && incl.transfer ? Math.max(1, (p.transfers.match(cfg.transferRe) || []).length)
        : hasTransfersCol ? (p.transfers.match(cfg.transferRe) || []).length : null;
      const boards = p.transfers.toLowerCase().includes('surfboard') || p.tcomment.toLowerCase().includes('surfboard');
      const comment = p.tcomment.toLowerCase();
      // One leg only when the comment says so: «only» (or «just need») and the direction in the
      // same clause («departure only», «I only need a pick up»), not anywhere in the comment
      // («we only have two bags, arrival 10:00» is still the round trip). The departure test goes
      // first so «one way, departure only» keeps the departure instead of dropping both legs.
      const sameClause = (a, b) => new RegExp(`\\b(${a})\\b[^,.;:!?\\n]*\\b(${b})\\b|\\b(${b})\\b[^,.;:!?\\n]*\\b(${a})\\b`).test(comment);
      const depOnly = sameClause('only|just need', 'return|departure|drop(.?off)?');
      const arrOnly = !depOnly && (sameClause('only|just need', 'arrival|pick.?up') || /\bone.?way\b/.test(comment));
      for (const direction of ['arrival', 'departure']) {
        if (direction === 'departure' && staysOn(p)) { bump('stays on with a new booking: no departure'); continue; }
        if (direction === 'arrival' && cameBefore(p)) { bump('continues from an earlier booking: no arrival'); continue; }
        const flags = []; let date, time, fl, pl, amb;
        if (direction === 'arrival') {
          // Miguel, 13 Nov: «the arrivals and departures need to appear always» — a booked
          // transfer is the round trip, so every guest with a transfer gets both legs.
          if (depOnly) continue;
          if (nProducts === null) flags.push('file has no Transfers column: round trip assumed');
          else if (nProducts === 0) flags.push('Has transfer = Yes but no transfer product listed');
          if (incl && incl.transfer && !p.has) flags.push(`transfer included in the package «${incl.label}»`);
          date = p.ci;
          const [f1, t1, pl1, fd1] = classifyField(p.arr_flight, flags, 'flight', cfg);
          let t0 = hhmm(p.arr_time); if (t0 === '00:00') t0 = null;
          if (t0 && t1 && t0 !== t1) { flags.push(`two times: ${t0} (arrival time) and ${t1} (flight field)`); time = t0; amb = true; }
          else { time = t0 || t1; amb = false; }
          if (t1 && !t0) flags.push('time taken from the flight field');
          const seenA = pl1 || cfg.places[p.arr_loc.toLowerCase()] || '';
          fl = f1; pl = seenA || prodPlace(p, flags, '') || cfg.airportDefault;
          if (seenA) prodPlace(p, flags, seenA);            // product airport ≠ flight / location → flagged
          if (fd1 && date && (fd1[0] !== parseInt(date.slice(8), 10) || fd1[1] !== parseInt(date.slice(5, 7), 10))) {
            flags.push(`flight date ${fd1[0]}/${fd1[1]} differs from check-in ${date.slice(8)}/${date.slice(5, 7)}`); amb = true;
          }
        } else {
          if (arrOnly) continue;
          date = p.co;
          const [f1, t1, pl1] = classifyField(p.dep_flight, flags, 'departure flight', cfg);
          const seenD = pl1 || cfg.places[p.dep_loc.toLowerCase()] || '';
          time = hhmm(p.dep_time) || t1; fl = f1; pl = seenD || prodPlace(p, flags, '') || ''; amb = false;
          if (seenD) prodPlace(p, flags, seenD);
          // The export has no departure airport column: a guest who landed elsewhere than the default
          // airport (Marrakech) most likely flies out from there too — said on the trip (Morocco only).
          if (!pl && cfg.depFromArrival) {
            const ap = classifyField(p.arr_flight, [], 'flight', cfg)[2] || cfg.places[p.arr_loc.toLowerCase()] || '';
            if (ap && ap !== cfg.airportDefault) { pl = ap; flags.push(`departure airport not in the file: ${ap}, like the arrival — check`); }
          }
          pl = pl || cfg.airportDefault;
        }
        // No check-in / check-out date → no trip (camp_trips.trip_date is NOT NULL: one such leg
        // aborted the whole import). The guest shows under «Left out» with «no … date».
        if (!date) { bump(`transfer without a ${direction === 'arrival' ? 'check-in' : 'check-out'} date (no trip)`); continue; }
        if (direction === 'departure' && incl && incl.transfer && !p.has) flags.push(`transfer included in the package «${incl.label}»`);
        if (!cfg.airports.includes(pl)) { flags.push(`airport ${pl} is not a ${cfg.name} airport`); amb = true; }
        // The guest's own words beat our guess (13 Nov: «Don't need airport transfer, I'll arrive a day earlier»).
        if (/\b(don.?t|do not|no) need\b|\bno transfer\b|\bnot needed\b|\bcancel/i.test(p.tcomment)) { flags.push(`guest says: «${p.tcomment.trim()}» — check if this transfer is still needed`); amb = true; }
        if (!time) flags.push('no time yet: ask the guest');
        else if (direction === 'departure' && time < '05:00') {
          flags.push(`night departure: flight ${time} on ${strfADB(date)} — pick-up at the camp on ${strfADB(addDaysIso(date, -1))} evening`); amb = true;
        }
        else if (direction === 'arrival' && time < '05:00') {
          flags.push(`night arrival: lands ${time} on ${strfADB(date)}, driver leaves camp ${strfADB(addDaysIso(date, -1))} evening — confirm the night`); amb = true;
        }
        const charge = (nProducts || 0) >= 1 ? 'bookinglayer' : null;
        legs.push({ charge, ref: p.ref, direction, date, time: time || null, flight: fl, place: pl, guest: p.name, phone: cleanPhone(p.phone, cfg), co: p.co,
          boards, flags, ambiguous: amb, line: p.line });
      }
    }

    // group: same booking + direction + same (date, time, flight) → one trip
    const trips = new Map(); const byBd = new Map();
    for (const l of legs) { const k = l.ref + '\u0000' + l.direction; if (!byBd.has(k)) byBd.set(k, []); byBd.get(k).push(l); }
    for (const ls of byBd.values()) {
      const ref = ls[0].ref, d = ls[0].direction;
      // Guests of one booking travel together unless the file says otherwise: two legs are one
      // trip when the date is the same and neither the time nor the flight contradicts — an EMPTY
      // time or flight never splits a booking (a couple where only one filled the flight used to
      // become two trips, and three after the other filled it). The trip takes the values that are
      // filled in. Legs that carry a flight or time are placed first so an empty one joins them.
      const groups = [];
      const fits = (g, l) => g.date === l.date && (!g.time || !l.time || g.time === l.time) && (!g.flight || !l.flight || g.flight === l.flight);
      const filled = l => (l.time ? 1 : 0) + (l.flight ? 1 : 0);
      for (const l of ls.slice().sort((a, b) => filled(b) - filled(a) || a.line - b.line)) {
        const g = groups.find(x => fits(x, l));
        if (g) { g.legs.push(l); g.time = g.time || l.time; g.flight = g.flight || l.flight; }
        else groups.push({ date: l.date, time: l.time, flight: l.flight, legs: [l] });
      }
      groups.forEach(g => g.legs.sort((a, b) => a.line - b.line));
      groups.sort((a, b) => a.legs[0].line - b.legs[0].line);
      const split = groups.length > 1;
      for (const grp of groups) {
        const group = grp.legs;
        const lead = group.find(l => l.time === grp.time && l.flight === grp.flight) || group[0];
        const g0 = { ...group[0], time: grp.time, flight: grp.flight, place: lead.place };
        const gkey = `bl:${ref}:${d.slice(0, 3)}` + (split ? `:${g0.guest.toLowerCase().replace(/[^a-z]/g, '')}` : '');
        let fl = [...new Set(group.flatMap(l => l.flags))];
        if (grp.time) fl = fl.filter(f => !/^no time yet/.test(f));   // one guest of the trip gave the time
        fl.sort();
        if (split) fl.push('guests of this booking travel separately');
        // Morocco: guests of one trip whose rows name different airports (one location says Essaouira, the +1 has none).
        if (cfg.productAirport) { const aps = [...new Set(group.map(l => l.place))]; if (aps.length > 1) fl.push(`guests of this booking: different airports in the file (${aps.join(' / ')}) — ${g0.place} kept, check`); }
        const pax = group.length; const boards = group.some(l => l.boards);
        trips.set(gkey, {
          key: gkey, kind: `airport_${d}`, date: g0.date, time: g0.time, flight: g0.flight, place: g0.place,
          pax, guests: group.map(l => l.guest), boards, charge: g0.charge, flags: fl,
          ambiguous: group.some(l => l.ambiguous) || fl.some(f => f.includes('two times') || f.includes('not understood')),
          csv_lines: group.map(l => l.line),
          // app fields (not in the Python output)
          booking_ref: ref, booking_checkout: g0.co || null, phone: (group.find(l => l.phone) || {}).phone || '',
          vehicle: vehicleFor(pax, boards, cfg),
        });
      }
    }
    // cross-booking: same date + same flight (or same time when no flight) → suggestion only
    const share = new Map();
    for (const t of trips.values()) {
      if (t.time || t.flight) { const k = [t.kind, t.date, t.flight || t.time].join('\u0000'); if (!share.has(k)) share.set(k, []); share.get(k).push(t.key); }
    }
    for (const ks of share.values()) {
      if (ks.length > 1) for (const kk of ks) trips.get(kk).flags.push('same flight as ' + ks.filter(x => x !== kk).join(', ') + ': one van?');
    }
    // A «preset» file = Sri Lanka only, active bookings only (the saved «Semana Sri Lanka» view):
    // only then can a trip that is absent from the file be flagged «missing».
    // Decided by the Sri Lanka rows only: the real «Semana Sri Lanka» export of 13 Nov carried one row
    // of another camp, which switched this off and with it the «not in the latest file» flag.
    const isPreset = !report['test booking'] && !cancels.size && !Object.keys(report).some(k => k.startsWith('status '));
    return {
      file: base, export_date: exportDate, has_transfers_col: hasTransfersCol,
      counts: report, trips: [...trips.values()], cancel_refs: [...cancels].sort(), skipped, dirty_no_transfer: dirty, other_location_names: other,
      refs_active: [...refsActive], is_preset: isPreset, guests_total: people.size,
    };
  }

  // ── Every guest row, normalised (13 Nov 2026) ──────────────────────────
  // The weekly staff lists (rooms and beds, kitchen diets, surf by level) are
  // built from the same Monday import, so the hub stores one row per guest in
  // camp_week_guests. Same location / test / duplicate rules as the trips;
  // the hub then keeps only the bookings that are live in HQ bookings.
  // week_start = the Saturday of the Sat–Fri week of the check-in; a list for a
  // week must still select by overlap (check_in < week end and check_out > week start).
  const NO_ALLERGY = new Set(['', 'no', 'none', '-', 'n/a', 'na', 'nope', 'nothing']);
  // guestRows = the rows to store. guestAudit = the same pass with every row of the file accounted
  // for: rows in the file = guests to import + rows left out, each with its reason (nobody lost
  // without a line on the import screen).
  function guestRows(text, fileName, cfg) { return scanGuests(text, fileName, cfg).out; }
  function guestAudit(text, fileName, cfg) {
    const { out, left, total } = scanGuests(text, fileName, cfg);
    const live = out.filter(g => OK_STATUS.has(g.booking_status) && g.check_in && g.check_out);
    out.filter(g => !OK_STATUS.has(g.booking_status)).forEach(g => left.push({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref, kind: DEAD_STATUS.has(g.booking_status) ? 'cancelled' : 'status', reason: `status «${g.booking_status.replace(/_/g, ' ') || 'empty'}»` }));
    out.filter(g => OK_STATUS.has(g.booking_status) && !(g.check_in && g.check_out)).forEach(g => left.push({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref, kind: 'no_dates', reason: 'no check-in or check-out date: on no list' }));
    left.sort((a, b) => a.line - b.line);
    return { rows: total, guests: live.length, left, renamed: out.filter(g => g.renamed).map(g => ({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref })) };
  }
  function scanGuests(text, fileName, cfg) {
    cfg = conf(cfg);
    const left = []; let total = 0;
    const all = parseCsv(text);
    const H = (all[0] || []).map(h => h.trim());
    const verdict = campRows(all, H, cfg);
    const nth = (name, k) => { let c = -1; for (let i = 0; i < H.length; i++) if (H[i] === name && ++c === k) return i; return -1; };
    const val = (r, name, k = 0) => { const i = nth(name, k); return i >= 0 && i < r.length ? pyStrip(r[i]) : ''; };
    const get = (r, ...names) => { for (const n of names) if (H.includes(n)) return val(r, n); return ''; };
    const out = []; const seen = new Set(); const seenRow = new Set();
    all.slice(1).forEach((r, n) => {
      if (!r.some(c => String(c).trim())) return;
      total++;
      let rawName = get(r, 'Guest').replace(/\s+/g, ' ').trim();
      const ref = get(r, 'Booking', 'Booking #');
      const leave = (kind, reason) => left.push({ line: n + 2, name: rawName || '(no name)', ref, kind, reason });
      if (!verdict[n]) { leave('other_camp', `other camp (${get(r, 'Accommodations') || get(r, 'Packages') || 'no room, no package'})`); return; }
      if (TEST_NAME.test(rawName)) { leave('test', 'test booking'); return; }
      // The +1 of a booking can come with no name, or with the same name as the booker. Only a row
      // that repeats name, dates, room and bed is a duplicate; any other one is another person.
      let renamed = false;
      const same = ref + '\u0000' + rawName.toLowerCase() + '\u0000' + [get(r, 'Check-in on', 'Arrives on'), get(r, 'Check-out on', 'Departure date', 'Departs on'), get(r, 'Accommodations'), get(r, 'Bed number')].join('|');
      if (rawName && seenRow.has(same)) { leave('duplicate', 'same guest, dates, room and bed twice in the file'); return; }
      seenRow.add(same);
      if (!rawName) { rawName = `Guest without name (booking ${ref || '?'})`; renamed = true; }
      let key = ref + '\u0000' + rawName.toLowerCase();
      for (let k = 2; seen.has(key); k++) { if (k === 2) renamed = true; key = ref + '\u0000' + `${rawName} (${k})`.toLowerCase(); if (!seen.has(key)) rawName = `${rawName} (${k})`; }
      seen.add(key);
      const raw = {}; const count = {};
      H.forEach((h, i) => { count[h] = (count[h] || 0) + 1; raw[count[h] > 1 ? `${h} (${count[h]})` : h] = i < r.length ? r[i] : ''; });
      const join = (vals, skip) => [...new Set(vals.map(pyStrip).filter(v => v && !(skip && skip.has(v.toLowerCase()))))].join(' / ');
      let arrT = hhmm(get(r, 'Arrival time')); if (arrT === '00:00') arrT = null;
      let depT = hhmm(get(r, 'Departure time')); if (depT === '00:00') depT = null;
      const ci = ymd(get(r, 'Check-in on', 'Arrives on')); const co = ymd(get(r, 'Check-out on', 'Departure date', 'Departs on'));
      const nights = parseInt(get(r, 'Nights'), 10);
      out.push({
        csv_line: n + 2, booking_ref: ref, guest_name: (isUpper(rawName) || isLower(rawName)) ? pyTitle(rawName) : rawName,
        guest_key: rawName.toLowerCase(), phone: cleanPhone(get(r, 'Phone'), cfg),
        week_start: ci ? weekStart(ci) : null, check_in: ci || null, check_out: co || null,
        accommodation: get(r, 'Accommodations'), bed_number: get(r, 'Bed number'), packages: get(r, 'Packages'),
        activities: get(r, 'Activities'), level: get(r, 'Level'),
        diet: join([val(r, 'Diet', 0), val(r, 'Diet', 1)]),
        allergies: join([get(r, 'Allergies / Intolerance'), get(r, 'Allergies'), get(r, 'Allergies indications')], NO_ALLERGY),
        nights: Number.isFinite(nights) ? nights : null,
        arrival_time: arrT, arrival_flight: get(r, 'Arrival flight'), departure_time: depT, departure_flight: get(r, 'Departure flight'),
        has_transfer: get(r, 'Has transfer').toLowerCase() === 'yes',
        booking_status: get(r, 'Booking status').toLowerCase().replace(/ /g, '_'),
        booking_due: dueOf(get(r, 'Booking due')), email: get(r, 'Email'),
        ...(renamed ? { renamed: true } : {}), ...(verdict[n] === 'unknown' ? { room_unlisted: true } : {}), raw,
      });
    });
    // Partner («don't charge»): Booking due > 0 means a partner collects (gen_from_guests.py);
    // the name comes from the email domain and is carried to every guest of the booking.
    const byRef = {};
    out.forEach(g => { const p = partnerOf(g); if (p && p !== 'partner') byRef[g.booking_ref] = p; });
    out.forEach(g => { const p = partnerOf(g); g.partner = p ? (byRef[g.booking_ref] || p) : (byRef[g.booking_ref] || ''); delete g.email; });
    return { out, left, total };
  }
  const PARTNER_DOMAINS = { 'oceanadventure.surf': 'Ocean Adventure', 'aashalanka.com': 'AASHA' };
  function dueOf(v) { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; }
  function partnerOf(g) {
    if (!(g.booking_due > 0)) return '';
    const dom = g.email && g.email.includes('@') ? g.email.split('@').pop().toLowerCase() : '';
    return PARTNER_DOMAINS[dom] || 'partner';
  }

  // ── Import warnings (Morocco, 14 Nov 2026) ─────────────────────────────
  // What changed on the Bookinglayer side, said on the import result instead of a silent fallback:
  //   column   a column the lists need is missing from the file
  //   room     a room that is not in the camp's room list
  //   product  a transfer product with a new name, or an airport the camp does not know
  //   package  a package name not seen before
  // Only camps with these settings (Morocco); Sri Lanka: [] — its import is unchanged.
  function importWarnings(text, fileName, cfg) {
    if (!cfg || !cfg.requiredColumns) return [];
    const out = [];
    const H = ((parseCsv(String(text || '').split(/\r?\n/, 1)[0])[0]) || []).map(h => h.trim());
    cfg.requiredColumns.forEach(group => { if (!group.some(n => H.includes(n))) out.push({ kind: 'column', text: `Column «${group[0]}» is missing from the file — add it back in the «${cfg.preset}» tab of Bookinglayer` }); });
    const rows = scanGuests(text, fileName, cfg).out.filter(g => OK_STATUS.has(g.booking_status));
    const count = (m, k, name) => { const x = m.get(k) || { n: 0, names: [], seen: new Set() }; if (x.seen.has(name)) return; x.seen.add(name); x.n++; if (x.names.length < 4) x.names.push(name); m.set(k, x); };
    const rooms = new Map(), prods = new Map(), pkgs = new Map();
    rows.forEach(g => {
      if (g.room_unlisted) count(rooms, g.accommodation, g.guest_name);
      String((g.raw || {}).Transfers || '').split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean).forEach(pr => {
        const m = cfg.productRe ? pr.match(cfg.productRe) : null;
        if (!m) { count(prods, `Transfer product «${pr}» is new — the app cannot tell the airport, Agadir assumed`, g.guest_name); return; }
        const ap = cfg.places[m[1].trim().toLowerCase()];
        if (!ap || !cfg.airports.includes(ap)) count(prods, `Transfer product «${pr}»: airport «${m[1].trim()}» is not one the camp knows`, g.guest_name);
      });
      String(g.packages || '').split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean).forEach(pk => {
        if (!(cfg.knownPackages || []).some(k => k.toLowerCase() === pk.toLowerCase())) count(pkgs, pk, g.guest_name);
      });
    });
    const who = x => `${x.names.join(', ')}${x.n > x.names.length ? ` +${x.n - x.names.length}` : ''}`;
    rooms.forEach((x, k) => out.push({ kind: 'room', text: `Room «${k}» is not in the room list (${x.n} ${x.n === 1 ? 'guest' : 'guests'}: ${who(x)}) — counted, its beds are not checked; ask Miguel to add it` }));
    prods.forEach((x, k) => out.push({ kind: 'product', text: `${k} (${who(x)})` }));
    pkgs.forEach((x, k) => out.push({ kind: 'package', text: `Package «${k}» was never seen before (${x.n} ${x.n === 1 ? 'guest' : 'guests'}: ${who(x)}) — check what it includes (transfer, lessons, yoga)` }));
    return out;
  }

  // ── WhatsApp message (format fixed by Miguel, 13 Nov 2026) ───────────────
  const WA_VEHICLE_LABEL = { 'Car': 'Small Car', 'Minivan': 'Minivan', 'Large Van': 'Large Van' };
  const WA_UNKNOWN = 'TBC';
  function whatsappText(t, cfg) {
    const c = conf(cfg); const lbl = cfg ? c.waVehicle : WA_VEHICLE_LABEL;
    const dep = t.kind === 'airport_departure';
    const pax = Number(t.pax) || 1;
    const time = (dep && t.pickup_time) ? t.pickup_time : t.trip_time;
    return [
      dep ? 'Camp to Airport' : 'Airport to Camp',
      t.guest_names || WA_UNKNOWN,
      t.guest_phone || WA_UNKNOWN,
      `${pax} ${pax === 1 ? 'person' : 'persons'}`,
      `Flight Number: ${t.flight || WA_UNKNOWN}`,
      `Time: ${time || WA_UNKNOWN}`,
      `Date: ${dMon(t.trip_date)}`,
      lbl[t.vehicle] || t.vehicle || lbl[vehicleFor(pax, false, cfg)],
    ].join('\n');
  }
  function whatsappDayText(trips, cfg) { return trips.map(t => whatsappText(t, cfg)).join('\n\n'); }
  function whatsappUrl(phone, text) {
    const digits = String(phone || '').replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  return {
    parseCsv, isGuestsExportHeader, parse, guestRows, guestAudit, importWarnings, hhmm, ymd, cleanPhone, vehicleFor, addDaysIso, weekday, weekStart, dMon,
    whatsappText, whatsappDayText, whatsappUrl, OK_STATUS, DEAD_STATUS, PACKAGE_INCLUDES, packageIncludes,
  };
});
