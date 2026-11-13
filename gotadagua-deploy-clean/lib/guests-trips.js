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
  const FLIGHT_DATE_RE = /\s+(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\s*$/;
  const PLACES = { cmb: 'CMB', colombo: 'CMB', bandaranaike: 'CMB', hri: 'HRI', mattala: 'HRI', agadir: 'AGA', marrakech: 'RAK', lisbon: 'LIS' };
  const TEST_NAME = /\b(test|delete after|qa)\b/i;
  const SL_ROOMS = ['hiriketeya', 'kabalana', 'marissa', 'unawatuna', 'madiha', 'midigama', 'welligama', 'weligama', 'ahangama'];
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

  function isSriLanka(pk, acc) {
    const p = pk.toLowerCase();
    if (p.includes('ahangama') || p.includes('sri lanka')) return 'yes';
    // A room of the camp is enough, whatever the package is called (13 Nov audit: a guest on a package
    // with another name must not drop out of the lists). 'room' = Packages empty (counted in the report).
    if (SL_ROOMS.some(r => acc.toLowerCase().includes(r))) return pk.trim() ? 'yes' : 'room';
    return '';
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
  function cleanPhone(s) {
    let ph = String(s || '').replace(/\s+/g, '');
    const mm = ph.match(/^\+(41|44|33|49|43|61|353|39|31|32|48)0(\d+)$/);
    if (mm) ph = '+' + mm[1] + mm[2];
    return ph;
  }

  function classifyField(raw, flags, label) {
    let v = pyStrip(raw);
    if (JUNK.has(v.toLowerCase())) return ['', null, '', ''];
    const t = hhmm(v);
    if (t) return ['', t, '', ''];
    const place = PLACES[v.toLowerCase()] || '';
    if (place) return ['', null, place, ''];
    let fd = '';
    const m = FLIGHT_DATE_RE.exec(v);
    if (m) { fd = [parseInt(m[1], 10), parseInt(m[2], 10)]; v = v.slice(0, m.index); }
    const u = v.toUpperCase().replace(/\s+/g, ' ').trim();
    const fm = FLIGHT_RE.exec(u);
    if (fm) return [fm[1] + fm[2], null, '', fd];
    flags.push(`${label} «${raw}» not understood`);
    return ['', null, '', fd];
  }

  function vehicleFor(pax, boards) {
    const n = Number(pax) || 1;
    let v = n <= 4 ? 'Car' : n <= 8 ? 'Minivan' : 'Large Van';
    if (boards && v === 'Car') v = 'Minivan';
    return v;
  }

  // ── main ───────────────────────────────────────────────────────────────
  // parse(text, fileName, exportDate?) → same shape as guests_to_trips.py,
  // plus app fields on each trip (phone, booking_ref, booking_checkout,
  // vehicle) and `refs_active`, `is_preset`.
  function parse(text, fileName, exportDate) {
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
    all.slice(1).forEach((r, n) => {
      if (!r.some(c => String(c).trim())) return;
      const line = n + 2;
      const name = get(r, 'Guest').replace(/\s+/g, ' ').trim();
      const ref = get(r, 'Booking', 'Booking #');
      const st = get(r, 'Booking status').toLowerCase().replace(/ /g, '_');
      const pk = get(r, 'Packages'), acc = get(r, 'Accommodations');
      const loc = isSriLanka(pk, acc);
      if (!loc) { bump('other location'); other.push(name); return; }
      if (loc === 'room') bump('Sri Lanka by room name (Packages empty)');
      if (TEST_NAME.test(name)) { bump('test booking'); skipped.push([line, name, 'test']); return; }
      const key = ref + '\u0000' + name.toLowerCase();
      if (people.has(key)) { bump('duplicate row'); return; }
      people.set(key, {
        line, name: (isUpper(name) || isLower(name)) ? pyTitle(name) : name, ref, status: st,
        ci: ymd(get(r, 'Check-in on', 'Arrives on')), co: ymd(get(r, 'Check-out on', 'Departure date', 'Departs on')),
        has: get(r, 'Has transfer').toLowerCase() === 'yes', transfers: get(r, 'Transfers'), tcomment: get(r, 'Transfer comment'),
        arr_time: get(r, 'Arrival time'), arr_flight: get(r, 'Arrival flight'), arr_loc: get(r, 'Arrival location'),
        dep_time: get(r, 'Departure time'), dep_flight: get(r, 'Departure flight'), dep_loc: get(r, 'Departure location'),
        phone: get(r, 'Phone').replace(/ /g, ''),
      });
    });

    const legs = []; const cancels = new Set(); const dirty = []; const refsActive = new Set();
    for (const p of people.values()) {
      if (DEAD_STATUS.has(p.status)) { cancels.add(p.ref); bump('cancelled/expired (cancels planned trips)'); continue; }
      if (!OK_STATUS.has(p.status)) { bump(`status ${p.status} (ignored)`); continue; }
      refsActive.add(p.ref);
      if (!p.has) {
        bump('no transfer');
        const dflags = [];
        const [, t1, , fd1] = classifyField(p.arr_flight, dflags, 'flight');
        let t0 = hhmm(p.arr_time); if (t0 === '00:00') t0 = null;
        if (t1 && t0 && t1 !== t0) dflags.push(`two times ${t0} / ${t1}`);
        else if (t1) dflags.push(`time ${t1} typed in the flight field`);
        if (fd1) dflags.push(`flight field carries a date ${fd1[0]}/${fd1[1]}`);
        const af = p.arr_flight.trim();
        if (JUNK.has(af.toLowerCase()) && af) dflags.push(`flight «${p.arr_flight}» = empty`);
        if (dflags.length) dirty.push([p.line, p.name, p.ref, dflags]);
        continue;
      }
      const nProducts = hasTransfersCol ? (p.transfers.match(/airport transfer/gi) || []).length : null;
      const boards = p.transfers.toLowerCase().includes('surfboard') || p.tcomment.toLowerCase().includes('surfboard');
      const comment = p.tcomment.toLowerCase();
      // One leg only when the comment says so in so many words: «only» next to the direction
      // («departure only», «only the pick-up»), not anywhere in the sentence («we only have two
      // bags, arrival 10:00» is still the round trip). The departure test goes first so
      // «one way, departure only» keeps the departure instead of dropping both legs.
      const depOnly = /\b(only|just)\s+(the\s+)?(return|departure|drop(.?off)?)\b|\b(return|departure|drop(.?off)?)\s+(transfer\s+)?only\b/.test(comment);
      const arrOnly = !depOnly && /\b(only|just)\s+(the\s+)?(arrival|pick.?up)\b|\b(arrival|pick.?up)\s+(transfer\s+)?only\b|\bone.?way\b/.test(comment);
      for (const direction of ['arrival', 'departure']) {
        const flags = []; let date, time, fl, pl, amb;
        if (direction === 'arrival') {
          // Miguel, 13 Nov: «the arrivals and departures need to appear always» — a booked
          // transfer is the round trip, so every guest with a transfer gets both legs.
          if (depOnly) continue;
          if (nProducts === null) flags.push('file has no Transfers column: round trip assumed');
          else if (nProducts === 0) flags.push('Has transfer = Yes but no transfer product listed');
          date = p.ci;
          const [f1, t1, pl1, fd1] = classifyField(p.arr_flight, flags, 'flight');
          let t0 = hhmm(p.arr_time); if (t0 === '00:00') t0 = null;
          if (t0 && t1 && t0 !== t1) { flags.push(`two times: ${t0} (arrival time) and ${t1} (flight field)`); time = t0; amb = true; }
          else { time = t0 || t1; amb = false; }
          if (t1 && !t0) flags.push('time taken from the flight field');
          fl = f1; pl = pl1 || PLACES[p.arr_loc.toLowerCase()] || 'CMB';
          if (fd1 && date && (fd1[0] !== parseInt(date.slice(8), 10) || fd1[1] !== parseInt(date.slice(5, 7), 10))) {
            flags.push(`flight date ${fd1[0]}/${fd1[1]} differs from check-in ${date.slice(8)}/${date.slice(5, 7)}`); amb = true;
          }
        } else {
          if (arrOnly) continue;
          date = p.co;
          const [f1, t1, pl1] = classifyField(p.dep_flight, flags, 'departure flight');
          time = hhmm(p.dep_time) || t1; fl = f1; pl = pl1 || PLACES[p.dep_loc.toLowerCase()] || 'CMB'; amb = false;
        }
        // No check-in / check-out date → no trip (camp_trips.trip_date is NOT NULL: one such leg
        // aborted the whole import). The guest shows under «Left out» with «no … date».
        if (!date) { bump(`transfer without a ${direction === 'arrival' ? 'check-in' : 'check-out'} date (no trip)`); continue; }
        if (pl !== 'CMB' && pl !== 'HRI') { flags.push(`airport ${pl} is not a Sri Lanka airport`); amb = true; }
        // The guest's own words beat our guess (13 Nov: «Don't need airport transfer, I'll arrive a day earlier»).
        if (/\b(don.?t|do not|no) need\b|\bno transfer\b|\bnot needed\b|\bcancel/i.test(p.tcomment)) { flags.push(`guest says: «${p.tcomment.trim()}» — check if this transfer is still needed`); amb = true; }
        if (!time) flags.push('no time yet: ask the guest');
        else if (direction === 'arrival' && time < '05:00') {
          flags.push(`night arrival: lands ${time} on ${strfADB(date)}, driver leaves camp ${strfADB(addDaysIso(date, -1))} evening — confirm the night`); amb = true;
        }
        const charge = (nProducts || 0) >= 1 ? 'bookinglayer' : null;
        legs.push({ charge, ref: p.ref, direction, date, time: time || null, flight: fl, place: pl, guest: p.name, phone: cleanPhone(p.phone), co: p.co,
          boards, flags, ambiguous: amb, line: p.line });
      }
    }

    // group: same booking + direction + same (date, time, flight) → one trip
    const trips = new Map(); const byBd = new Map();
    for (const l of legs) { const k = l.ref + '\u0000' + l.direction; if (!byBd.has(k)) byBd.set(k, []); byBd.get(k).push(l); }
    for (const ls of byBd.values()) {
      const ref = ls[0].ref, d = ls[0].direction;
      const variants = new Map();
      for (const l of ls) { const k = [l.date, l.time, l.flight].join('\u0000'); if (!variants.has(k)) variants.set(k, []); variants.get(k).push(l); }
      const split = variants.size > 1;
      for (const group of variants.values()) {
        const g0 = group[0];
        const gkey = `bl:${ref}:${d.slice(0, 3)}` + (split ? `:${g0.guest.toLowerCase().replace(/[^a-z]/g, '')}` : '');
        const fl = [...new Set(group.flatMap(l => l.flags))].sort();
        if (split) fl.push('guests of this booking travel separately');
        const pax = group.length; const boards = group.some(l => l.boards);
        trips.set(gkey, {
          key: gkey, kind: `airport_${d}`, date: g0.date, time: g0.time, flight: g0.flight, place: g0.place,
          pax, guests: group.map(l => l.guest), boards, charge: g0.charge, flags: fl,
          ambiguous: group.some(l => l.ambiguous) || fl.some(f => f.includes('two times') || f.includes('not understood')),
          csv_lines: group.map(l => l.line),
          // app fields (not in the Python output)
          booking_ref: ref, booking_checkout: g0.co || null, phone: (group.find(l => l.phone) || {}).phone || '',
          vehicle: vehicleFor(pax, boards),
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
    const isPreset = !report['other location'] && !report['test booking'] && !cancels.size && !Object.keys(report).some(k => k.startsWith('status '));
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
  function guestRows(text, fileName) { return scanGuests(text, fileName).out; }
  function guestAudit(text, fileName) {
    const { out, left, total } = scanGuests(text, fileName);
    const live = out.filter(g => OK_STATUS.has(g.booking_status) && g.check_in && g.check_out);
    out.filter(g => !OK_STATUS.has(g.booking_status)).forEach(g => left.push({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref, kind: DEAD_STATUS.has(g.booking_status) ? 'cancelled' : 'status', reason: `status «${g.booking_status.replace(/_/g, ' ') || 'empty'}»` }));
    out.filter(g => OK_STATUS.has(g.booking_status) && !(g.check_in && g.check_out)).forEach(g => left.push({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref, kind: 'no_dates', reason: 'no check-in or check-out date: on no list' }));
    left.sort((a, b) => a.line - b.line);
    return { rows: total, guests: live.length, left, renamed: out.filter(g => g.renamed).map(g => ({ line: g.csv_line, name: g.guest_name, ref: g.booking_ref })) };
  }
  function scanGuests(text, fileName) {
    const left = []; let total = 0;
    const all = parseCsv(text);
    const H = (all[0] || []).map(h => h.trim());
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
      if (!isSriLanka(get(r, 'Packages'), get(r, 'Accommodations'))) { leave('other_camp', `other camp (${get(r, 'Accommodations') || get(r, 'Packages') || 'no room, no package'})`); return; }
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
        guest_key: rawName.toLowerCase(), phone: cleanPhone(get(r, 'Phone')),
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
        ...(renamed ? { renamed: true } : {}), raw,
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

  // ── WhatsApp message (format fixed by Miguel, 13 Nov 2026) ───────────────
  const WA_VEHICLE_LABEL = { 'Car': 'Small Car', 'Minivan': 'Minivan', 'Large Van': 'Large Van' };
  const WA_UNKNOWN = 'TBC';
  function whatsappText(t) {
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
      WA_VEHICLE_LABEL[t.vehicle] || t.vehicle || WA_VEHICLE_LABEL[vehicleFor(pax, false)],
    ].join('\n');
  }
  function whatsappDayText(trips) { return trips.map(whatsappText).join('\n\n'); }
  function whatsappUrl(phone, text) {
    const digits = String(phone || '').replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  return {
    parseCsv, isGuestsExportHeader, parse, guestRows, guestAudit, hhmm, ymd, cleanPhone, vehicleFor, addDaysIso, weekday, weekStart, dMon,
    whatsappText, whatsappDayText, whatsappUrl, OK_STATUS, DEAD_STATUS,
  };
});
