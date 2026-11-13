// Camp hub · Week (Sri Lanka, 13 Nov 2026)
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

  // ── Settings ────────────────────────────────────────────────────────────
  const WEEK_ENABLED_LOCATIONS = new Set(['sri-lanka']);
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
    { w: 'marissa', label: 'Marissa', beds: 4, note: '4 beds' }, { w: 'kabalana', label: 'Kabalana', beds: 4, note: '4 beds' }, { w: 'unawatuna', label: 'Unawatuna', beds: 6, note: 'girls' },
    { w: 'hiriketeya', label: 'Hiriketeya Ensuite' }, { w: 'ahangama', label: 'Ahangama Ensuite' }, { w: 'madiha', label: 'Madiha Ensuite' },
    { w: 'midigama', label: 'Midigama Ensuite' }, { w: 'welligama', label: 'Welligama Sea View Ensuite' },
  ];
  const NO_ALLERGY = /^(none|none known|no|n\/a|na|nothing|nope|-)$/i;   // answers that are not an allergy
  const LEVELS = ['Beginner', 'Experienced beginner', 'Intermediate', 'Advanced', 'Level not set'];

  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const enabled = () => WEEK_ENABLED_LOCATIONS.has(SLUG) && !LOCAL_MANAGER_MODE && !CAMP_TAB_ONLY_MODE;

  const W = {
    week: null, day: null, tab: 'overview', team: 'cleaning', mode: 'lists', q: '', scrollTo: '',
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
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
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
  function roomInfo(name) {
    const n = String(name || '').trim(); if (!n) return null;
    const low = n.toLowerCase(); const w1 = n.split(/\s+/)[0];
    const shared = /shared|dorm/.test(low);
    let label = w1, note = '';
    if (shared) { const m = n.match(/\((\d+)\s*p\)/i); note = /girls/.test(low) ? 'girls' : m ? `${m[1]} beds` : ''; }
    else label = w1 + (/sea view/.test(low) ? ' Sea View' : '') + ' Ensuite';
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
    return '';
  }
  function levelOf(g) {
    const l = String(g.level || '').toLowerCase();
    if (!l.trim()) return 'Level not set';
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
  const isYoga = g => /yoga/i.test(String(g.activities || '') + ' ' + String(g.packages || ''));
  const inCamp = (g, d) => g.check_in && g.check_out && g.check_in <= d && d < g.check_out;
  const inWeek = (g, ws) => g.check_in && g.check_out && g.check_in <= add(ws, 6) && g.check_out > ws;
  const byStay = (a, b) => (a.check_in || '').localeCompare(b.check_in || '') || String(a.booking_ref).localeCompare(String(b.booking_ref)) || String(a.bed_number || '').localeCompare(String(b.bed_number || ''), undefined, { numeric: true }) || a.guest_name.localeCompare(b.guest_name);

  // Who counts, against the latest import (the file holds live guests only, so a
  // cancellation shows up as absence):
  //   in       in the latest file, or outside its check-in range
  //   carry    checked in before the file's range and still here during it → counted, «still here?»
  //   dropped  check-in inside the file's range but not in it → not counted, «cancelled?»
  //   gone     marked «Not here» (booking_status not live) → left out
  function classify(rows, meta) {
    return rows.map(g => {
      let st = 'in';
      if (!GT.OK_STATUS.has(String(g.booking_status || '').toLowerCase())) st = 'gone';
      else if (meta && meta.id && (g.raw || {})._kept === meta.id) st = 'in';    // Francisco answered «Still here» for this import
      else if (meta && meta.id && g.import_id !== meta.id && meta.min) {
        if (g.check_in < meta.min) st = g.check_out > meta.min ? 'carry' : 'in';
        else if (g.check_in <= meta.max) st = 'dropped';
      }
      return { ...g, _st: st };
    });
  }
  const counted = g => g._st === 'in' || g._st === 'carry';

  // ── Message builders (pure): parts = [{t:'title'|'h'|'l'|'gap', s}] ─────
  const T = s => ({ t: 'title', s }), H = s => ({ t: 'h', s }), L = s => ({ t: 'l', s }), G = { t: 'gap', s: '' };
  const toText = parts => parts.map(p => p.s).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Room lines: shared rooms list each guest (with the bed when the file has one) or a comma list;
  // private rooms join the people of one booking with «+».
  function roomLines(list) {
    const rooms = new Map();
    list.slice().sort(byStay).forEach(g => { const r = roomOf(g) || { key: '?', label: 'No room yet', shared: true, order: 100 }; if (!rooms.has(r.key)) rooms.set(r.key, { r, gs: [] }); rooms.get(r.key).gs.push(g); });
    const out = [];
    [...rooms.values()].sort((a, b) => a.r.order - b.r.order || a.r.label.localeCompare(b.r.label)).forEach(({ r, gs }) => {
      if (r.shared && gs.some(g => String(g.bed_number || '').trim())) gs.forEach(g => out.push(`${r.label}${g.bed_number ? ' bed ' + g.bed_number : ''} – ${g.guest_name}`));
      else out.push(`${r.label} – ${r.shared ? gs.map(g => g.guest_name).join(', ') : joinBookings(gs, ' + ', ', ')}`);
    });
    return out;
  }
  function joinBookings(gs, within, between, nameFn) {
    const nm = nameFn || (g => g.guest_name);
    const by = new Map(); gs.forEach(g => { const k = g.booking_ref || g.guest_name; if (!by.has(k)) by.set(k, []); by.get(k).push(nm(g)); });
    return [...by.values()].map(x => x.join(within)).join(between);
  }
  function moveLine(g) { const m = movedRooms(g); return m ? `${g.guest_name}: ${m.join(' → ')} (check day)` : ''; }

  function cleaningDay(rows, d, ws) {
    const gs = rows.filter(counted);
    const outs = gs.filter(g => g.check_out === d), ins = gs.filter(g => g.check_in === d);
    const moves = gs.filter(g => movedRooms(g) && (g.check_in >= ws ? g.check_in : ws) === d && inCamp(g, d)).map(moveLine);
    const p = [T(`Cleaning – ${fdm(d)}`), G];
    if (outs.length) p.push(H('Check-out (clean + new sheets)'), ...roomLines(outs).map(L), G);
    if (ins.length) p.push(H(`Check-in (${ins.length})`), ...roomLines(ins).map(L), G);
    if (!outs.length && !ins.length) p.push(L('No check-in or check-out'), G);
    if (moves.length) p.push(H('Room moves'), ...moves.map(L), G);
    p.push(L(`In camp tonight: ${plural(gs.filter(g => inCamp(g, d)).length, 'guest')}`));
    return p;
  }
  function stayText(g, ws) { return `${g.check_in < ws ? 'here' : fd(g.check_in)} → ${fd(g.check_out)}`; }
  function cleaningWeek(rows, ws) {
    const we = add(ws, 7);
    const gs = rows.filter(g => counted(g) && inWeek(g, ws)).sort(byStay);
    const p = [T(`Cleaning – week ${range(ws, we)} (${plural(gs.length, 'guest')})`), G];
    const rooms = new Map();
    gs.forEach(g => { const r = roomOf(g) || { key: '?', label: 'No room yet', shared: true, order: 100, note: '' }; if (!rooms.has(r.key)) rooms.set(r.key, { r, gs: [] }); rooms.get(r.key).gs.push(g); });
    const sorted = [...rooms.values()].sort((a, b) => a.r.order - b.r.order || a.r.label.localeCompare(b.r.label));
    const shared = sorted.filter(x => x.r.shared && x.r.key !== '?'), priv = sorted.filter(x => !x.r.shared), none = sorted.filter(x => x.r.key === '?');
    if (shared.length) {
      p.push(H('SHARED ROOMS'));
      shared.forEach(({ r, gs: list }) => {
        p.push(L(`${r.label}${r.note ? ` (${r.note})` : ''}`));
        if (list.some(g => String(g.bed_number || '').trim())) list.forEach(g => p.push(L(`- ${g.bed_number ? 'bed ' + g.bed_number + ' ' : ''}${g.guest_name}: ${stayText(g, ws)}`)));
        else {
          const by = new Map(); list.forEach(g => { const k = stayText(g, ws); if (!by.has(k)) by.set(k, []); by.get(k).push(g.guest_name); });
          by.forEach((names, k) => p.push(L(`- ${names.join(', ')}: ${k}`)));
        }
      });
      p.push(G);
    }
    if (priv.length) {
      p.push(H('PRIVATE ROOMS'));
      priv.forEach(({ r, gs: list }) => {
        const groups = new Map(); list.forEach(g => { const k = (g.booking_ref || g.guest_name) + '|' + stayText(g, ws); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); });
        p.push(L(`${r.label} – ${[...groups.values()].map(x => `${x.map(g => g.guest_name).join(' + ')}: ${stayText(x[0], ws)}`).join('; ')}`));
      });
      p.push(G);
    }
    if (none.length) { p.push(H('NO ROOM YET')); none[0].gs.forEach(g => p.push(L(`- ${g.guest_name}: ${stayText(g, ws)}`))); p.push(G); }
    const moves = gs.filter(g => movedRooms(g)).map(moveLine);
    if (moves.length) p.push(H('Room moves'), ...moves.map(L), G);
    const changes = [];
    for (let i = 1; i <= 7; i++) {
      const d = add(ws, i);
      const outs = gs.filter(g => g.check_out === d), ins = i < 7 ? gs.filter(g => g.check_in === d) : [];
      const parts = [];
      if (outs.length) parts.push(i === 7 && outs.length === gs.filter(g => inCamp(g, add(d, -1))).length ? 'everyone out' : `${joinBookings(outs, ' + ', ', ', g => first(g.guest_name))} out`);
      if (ins.length) parts.push(`${joinBookings(ins, ' + ', ', ', g => first(g.guest_name))} in`);
      if (parts.length) changes.push(`${fd(d)}: ${parts.join(', ')}`);
    }
    if (changes.length) p.push(L(changes.join(' · ')));
    return p;
  }

  function dietGroups(gs) {
    const by = new Map(); gs.forEach(g => { const d = dietOf(g); if (d && d !== 'none') { if (!by.has(d)) by.set(d, []); by.get(d).push(g); } });
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }
  const allergyLine = gs => { const a = gs.filter(g => String(g.allergies || '').trim()); return a.length ? `Allergies: ${a.map(g => `${g.guest_name} – ${g.allergies}`).join('; ')}` : 'Allergies: none in Bookinglayer'; };
  const nameSort = (a, b) => a.guest_name.localeCompare(b.guest_name);
  function kitchenDay(rows, d) {
    const gs = rows.filter(g => counted(g) && inCamp(g, d)).sort(nameSort);
    const p = [T(`Kitchen – ${fdm(d)}`), G, L(`Dinner: ${plural(gs.length, 'person', 'people')}`), L(`Breakfast ${fd(add(d, 1))}: ${plural(gs.length, 'person', 'people')}`), G];
    dietGroups(gs).forEach(([diet, list]) => p.push(L(`${diet}: ${list.length} – ${list.map(g => g.guest_name).join(', ')}`)));
    p.push(L(allergyLine(gs)), G, L('Staff not included'));
    return p;
  }
  function kitchenWeek(rows, ws) {
    const we = add(ws, 7);
    const gs = rows.filter(g => counted(g) && inWeek(g, ws)).sort(nameSort);
    const p = [T(`Kitchen – week ${range(ws, we)}`), G, H('Dinner (breakfast next morning = same number)')];
    for (let i = 0; i < 7; i++) { const d = add(ws, i); p.push(L(`${fd(d)}: ${gs.filter(g => inCamp(g, d)).length}`)); }
    const lastNight = gs.filter(g => inCamp(g, add(ws, 6)));
    p.push(L(`${fd(we)}: breakfast ${lastNight.length}${lastNight.every(g => g.check_out <= we) ? ', then everyone leaves' : ''}`), G);
    const allWeek = g => g.check_in <= ws && g.check_out >= we;
    dietGroups(gs).forEach(([diet, list]) => {
      if (list.every(allWeek)) p.push(L(`${diet} (all week): ${list.map(g => g.guest_name).join(', ')}`));
      else p.push(L(`${diet}: ${list.map(g => allWeek(g) ? `${g.guest_name} (all week)` : `${g.guest_name} (${stayText(g, ws)})`).join(', ')}`));
    });
    p.push(L(allergyLine(gs)), G);
    const unanswered = gs.filter(g => !dietOf(g)).length;
    p.push(L(`Staff not included.${unanswered ? ` Ask diets at the welcome dinner ${fd(ws)}.` : ''}`));
    return p;
  }

  function levelGroups(students, note) {
    return LEVELS.map(lv => [lv, students.filter(g => levelOf(g) === lv)]).filter(([, l]) => l.length)
      .map(([lv, l]) => `${lv} (${l.length}): ${l.map(g => g.guest_name + (note ? note(g) : '')).join(', ')}`);
  }
  const courseCounts = gs => ({ S: gs.filter(g => course(g) === 'Standard').length, I: gs.filter(g => course(g) === 'Intensive').length, C: gs.filter(g => course(g) === 'Coaching').length });
  function firstNames(gs) {
    const n = gs.map(g => first(g.guest_name));
    return gs.map((g, i) => n.filter(x => x === n[i]).length > 1 ? g.guest_name : n[i]).join(', ');
  }
  function surfDay(rows, d) {
    const here = rows.filter(g => counted(g) && inCamp(g, d)).sort(byStay);
    const st = here.filter(g => course(g));
    const c = courseCounts(st);
    const p = [T(`Surf – ${fdm(d)}`), G, L(`Morning: ${plural(st.length, 'student')}`)];
    const cc = [['Standard', c.S], ['Intensive', c.I], ['Coaching', c.C]].filter(x => x[1]).map(x => `${x[0]} ${x[1]}`).join(' · ');
    if (cc) p.push(L(cc));
    p.push(G, ...levelGroups(st).map(L), G);
    const inten = st.filter(g => course(g) === 'Intensive');
    if (inten.length) p.push(L(`Intensive afternoon group (3 afternoons, head coach picks): ${inten.map(g => g.guest_name).join(', ')}`));
    const yoga = here.filter(isYoga).length;
    if (yoga) p.push(L(`Yoga ${YOGA_TIME}: ${yoga}`));
    return p;
  }
  function partOfWeek(g, ws) {
    const we = add(ws, 7);
    const from = g.check_in > ws, until = g.check_out < we;
    return from && until ? `${fd(g.check_in)} → ${fd(g.check_out)}` : from ? `from ${fd(g.check_in)}` : until ? `until ${fd(g.check_out)}` : '';
  }
  function surfWeek(rows, ws) {
    const we = add(ws, 7);
    const gs = rows.filter(g => counted(g) && inWeek(g, ws)).sort(byStay);
    const st = gs.filter(g => course(g));
    const p = [T(`Surf – week ${range(ws, we)} (${plural(st.length, 'student')})`), G, H('Morning students per day (Standard / Intensive / Coaching)')];
    for (let i = 0; i < 7; i++) { const d = add(ws, i); const day = st.filter(g => inCamp(g, d)); const c = courseCounts(day); p.push(L(`${fd(d)}: ${day.length} (${c.S} / ${c.I} / ${c.C})`)); }
    p.push(G, H('Groups by level'));
    const note = g => { const bits = []; if (course(g) === 'Intensive') bits.push('I'); if (course(g) === 'Coaching') bits.push('coaching'); const w = partOfWeek(g, ws); if (w) bits.push(w); return bits.length ? ` (${bits.join(', ')})` : ''; };
    p.push(...levelGroups(st, note).map(L), G);
    const inten = st.filter(g => course(g) === 'Intensive');
    if (inten.length) p.push(L(`Intensive afternoons (3 this week, head coach picks): ${firstNames(inten)}`));
    const none = gs.filter(g => !course(g));
    if (none.length) p.push(L(`No lessons: ${none.map(g => { const w = partOfWeek(g, ws); return g.guest_name + (w ? ` (${w})` : ''); }).join(', ')}`));
    const yoga = gs.filter(isYoga).length;
    if (yoga) p.push(L(`Yoga ${YOGA_TIME}: ${plural(yoga, 'guest')}`));
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
  function guestLine(g, ws) {
    const r = roomOf(g); const c = course(g); const d = dietOf(g);
    return [g.guest_name, r ? r.label + (r.shared && g.bed_number ? ' bed ' + g.bed_number : '') : 'no room', stayText(g, ws), g.phone || 'no phone',
      c ? `${c} · ${levelOf(g)}` : 'no lessons', d === 'none' ? 'no special diet' : d || 'diet ?', g.has_transfer ? 'transfer' : 'own way',
      g.partner ? `partner (${g.partner}) – don't charge` : ''].filter(Boolean).join(' · ');
  }

  // body(team, day) for the viewed week — the text compared with what was sent.
  function parts(team, day, ws, rows) {
    if (team === 'cleaning') return day === 'week' ? cleaningWeek(rows, ws) : cleaningDay(rows, day, ws);
    if (team === 'kitchen') return day === 'week' ? kitchenWeek(rows, ws) : kitchenDay(rows, day);
    if (team === 'surf') return day === 'week' ? surfWeek(rows, ws) : surfDay(rows, day);
    if (team === 'transfers') { const list = tripsFor(day, ws); return list.length ? [L(GT.whatsappDayText(list))] : [L('No transfers')]; }
    if (team === 'guests') { const gs = guestsList(rows, day, ws); return [T(`Guests – ${day === 'week' ? 'week ' + range(ws, add(ws, 7)) : fdm(day)} (${gs.length})`), G, ...gs.map(g => L(guestLine(g, ws)))]; }
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
  function updateText(oldText, newText, day, ws) {
    const head = `UPDATE – ${day === 'week' ? 'week ' + range(ws, add(ws, 7)) : fdm(day)}`;
    const diff = lineDiff(oldText, newText);
    return [head, ...diff, '', newText].join('\n');
  }
  function transfersUpdate(list, day, ws) {
    const changed = list.filter(t => t.needs_resend).map(t => {
      const s = t.sent_snapshot || {}; const bits = [];
      if (s.trip_date && s.trip_date !== t.trip_date) bits.push(`date ${GT.dMon(s.trip_date)} → ${GT.dMon(t.trip_date)}`);
      if ((s.trip_time || '') !== (t.trip_time || '')) bits.push(`time ${s.trip_time || 'TBC'} → ${t.trip_time || 'TBC'}`);
      if ((s.flight || '') !== (t.flight || '')) bits.push(`flight ${s.flight || 'TBC'} → ${t.flight || 'TBC'}`);
      if (s.pax && s.pax !== t.pax) bits.push(`${s.pax} → ${t.pax} persons`);
      return `${t.guest_names || 'Guest'}: ${bits.join(', ') || 'changed'}`;
    });
    return [`UPDATE – ${day === 'week' ? 'week ' + range(ws, add(ws, 7)) : fdm(day)}`, ...changed, '', GT.whatsappDayText(list)].join('\n');
  }

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
      await loadMeta();
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
    const noRoom = live.filter(g => !roomOf(g));
    if (noRoom.length) items.push({ tab: 'rooms', short: `${noRoom.length} without a room`, text: `${plural(noRoom.length, 'guest')} without a room – check Bookinglayer`, who: names(noRoom) });
    const noTime = tripsFor('week', ws).filter(t => !t.trip_time);
    if (noTime.length) items.push({ tab: 'transfers', short: `${plural(noTime.length, 'transfer')} without time`, text: `${plural(noTime.length, 'transfer')} without flight time – ask the guest`, who: noTime.map(t => t.guest_names || 'Guest').join(', ') });
    const carry = wk.filter(g => g._st === 'carry');
    if (carry.length) items.push({ tab: 'guests', short: `${carry.length} still here?`, text: `${plural(carry.length, 'guest')} in camp ${carry.length === 1 ? 'is' : 'are'} not in the latest Guests file – still here?`, guests: carry, kind: 'carry' });
    const dropped = wk.filter(g => g._st === 'dropped');
    if (dropped.length) items.push({ tab: 'guests', short: `${dropped.length} cancelled?`, text: `${plural(dropped.length, 'guest')} dropped out of the latest Guests file – cancelled? Not counted`, guests: dropped, kind: 'dropped' });
    const zero = live.filter(g => { const raw = String((g.raw || {}).Phone || '').replace(/\s+/g, ''); return raw && g.phone && raw !== g.phone; });
    if (zero.length) items.push({ tab: 'guests', short: `${plural(zero.length, 'phone')} fixed`, text: `${plural(zero.length, 'phone')} had a wrong 0 after the country code – fixed, check before sending`, who: zero.map(g => `${g.guest_name} ${g.phone}`).join(', ') });
    const moves = live.filter(g => movedRooms(g));
    if (moves.length) items.push({ tab: 'rooms', short: `${plural(moves.length, 'room move')} without date`, text: `${plural(moves.length, 'room move')} without a date – check the Day Planner`, who: moves.map(g => `${g.guest_name} (${movedRooms(g).join(' → ')})`).join(', ') });
    return items;
  }

  // ── Week model (pure): what every tab draws ─────────────────────────────
  // Eight days: Sat…Fri plus the closing Saturday (check-outs and the last breakfast).
  // Arrivals and departures come from every counted row, so the people leaving on the
  // opening Saturday (last week's guests) are there too. Breakfast of a day = who slept
  // the night before; dinner = who sleeps tonight — the numbers of the Kitchen message.
  const airportTrip = t => (t.kind === 'airport_arrival' || t.kind === 'airport_departure') && !['cancelled', 'merged'].includes(t.status);
  function weekModel(ws, rows) {
    const live = rows.filter(counted);
    const trips = (TR().trips || []).filter(airportTrip);
    const days = [];
    for (let i = 0; i <= 7; i++) {
      const d = add(ws, i);
      const night = live.filter(g => inCamp(g, d)).sort(byStay);
      const students = night.filter(g => course(g));
      const dayTrips = trips.filter(t => t.trip_date === d).sort(tripSort);
      const refs = new Set(dayTrips.filter(t => t.kind === 'airport_arrival').map(t => t.booking_ref).filter(Boolean));
      const arrivals = live.filter(g => g.check_in === d).sort(byStay);
      days.push({
        d, i, closing: i === 7, night, arrivals, departures: live.filter(g => g.check_out === d).sort(byStay),
        breakfast: live.filter(g => inCamp(g, add(d, -1))).length, dinner: night.length,
        students, courses: courseCounts(students), yoga: night.filter(isYoga).length,
        trips: dayTrips, own: arrivals.filter(g => !g.has_transfer && !refs.has(g.booking_ref)),
      });
    }
    const wk = days.slice(0, 7);
    const guests = live.filter(g => inWeek(g, ws));
    return {
      ws, days, guests, peak: Math.max(0, ...wk.map(x => x.dinner)),
      arrivals: wk.reduce((s, x) => s + x.arrivals.length, 0), departures: wk.reduce((s, x) => s + x.departures.length, 0),
      students: guests.filter(g => course(g)),
    };
  }

  // Rooms: beds (shared) or stays (private) as lanes, nights 0…6 as columns.
  function roomPlan(ws, rows) {
    const gs = rows.filter(g => counted(g) && inWeek(g, ws)).sort(byStay);
    const w1 = s => { const x = String(s || '').split(/\s+/)[0].toLowerCase(); return x === 'weligama' ? 'welligama' : x; };
    const rooms = new Map();
    CAMP_ROOMS.forEach((c, i) => rooms.set(c.w, { key: c.w, label: c.label, shared: !!c.beds, note: c.note || '', beds: c.beds || 0, order: i, stays: [] }));
    gs.forEach(g => {
      const r = roomOf(g); const k = r ? w1(r.label) : '?';
      if (!rooms.has(k)) rooms.set(k, r ? { key: k, label: r.label, shared: r.shared, note: r.note, beds: r.shared ? (parseInt(r.note, 10) || 0) : 0, order: 50 + r.order, stays: [] }
        : { key: '?', label: 'No room yet', shared: false, none: true, note: '', beds: 0, order: 999, stays: [] });
      const room = rooms.get(k); if (r && !r.shared) room.label = r.label;
      const beds = String(g.bed_number || '').split(',').map(s => parseInt(s, 10)).filter(n => n > 0);
      room.stays.push({ g, a: Math.max(0, daysBetween(ws, g.check_in)), b: Math.min(7, daysBetween(ws, g.check_out)), bed: beds.length ? beds[beds.length - 1] : 0 });
    });
    const free = (lane, s) => lane.items.every(x => x.b <= s.a || x.a >= s.b);
    const out = [...rooms.values()].sort((x, y) => x.order - y.order).map(room => {
      let lanes = [];
      if (room.shared) {
        const cap = Math.max(room.beds, ...room.stays.map(s => s.bed));
        for (let n = 1; n <= cap; n++) lanes.push({ bed: n, items: [] });
        const place = s => { let lane = s.bed && free(lanes[s.bed - 1], s) ? lanes[s.bed - 1] : lanes.find(l => free(l, s));
          if (!lane) { lane = { bed: 0, extra: true, items: [] }; lanes.push(lane); }
          lane.items.push({ a: s.a, b: s.b, gs: [s.g] }); };
        room.stays.filter(s => s.bed).forEach(place); room.stays.filter(s => !s.bed).forEach(place);
      } else {
        const groups = new Map();   // the people of one booking with the same dates share a bar
        room.stays.forEach(s => { const k = (room.none ? s.g.id || s.g.guest_name : s.g.booking_ref || s.g.guest_name) + '|' + s.a + '|' + s.b; if (!groups.has(k)) groups.set(k, { a: s.a, b: s.b, gs: [] }); groups.get(k).gs.push(s.g); });
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
        <span class="period-picker-lbl wk-week">${fdm(ws)} – ${fdm(add(ws, 6))}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next week" onclick="WeekUI.shiftWeek(7)">${ic('chevron-right')}</button></div>
      <span class="wk-count">${plural(nGuests, 'guest')}</span>
      <span class="hint wk-file">${W.meta ? `Guests file imported ${h(fileStamp(W.meta.at))}` : 'No Guests file imported yet'}</span></div>`;
    if (!nGuests && !rows.length) {
      root.innerHTML = head + filters + `<div class="empty-state">${ic('users')}<div class="empty-title">No guests this week</div><p>Download the Guests export with the «Semana Sri Lanka» preset and import it.</p>
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
  function byRoom(list) {
    const rooms = new Map();
    list.forEach(g => { const r = roomOf(g) || { key: '?', label: 'No room yet', order: 100 }; if (!rooms.has(r.key)) rooms.set(r.key, { r, gs: [] }); rooms.get(r.key).gs.push(g); });
    return [...rooms.values()].sort((a, b) => a.r.order - b.r.order || a.r.label.localeCompare(b.r.label))
      .map(({ r, gs }) => `<div class="wk-rl"><span class="wk-rm">${h(r.label)}</span><span>${gs.map(g => h(g.guest_name)).join(', ')}</span></div>`).join('');
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
      const text = list.length ? (resend ? transfersUpdate(list, day, ws) : GT.whatsappDayText(list)) : '';
      const toTick = list.filter(x => x.status === 'planned' || x.needs_resend).length;
      return `<div class="card wk-card wk-msgcard" id="wkMessage">${cardHead('Message', `Transfers still to do · ${h(when)} · Miguel's format, one block per transfer`)}
        <div class="card-body">${dayPills}${list.length ? `<div class="wk-msg" id="wkMsg">${h(text)}</div>
        <div class="wk-foot"><div class="wk-foot-btns"><button class="btn btn-s" onclick="WeekUI.copy()">${ic('copy')} Copy</button>
          <button class="btn btn-p" id="wkSend" onclick="WeekUI.send()">${ic('send')} ${resend ? 'Send update' : 'Send to ' + h(c ? c.name : 'Transfers')}</button></div>
          <div class="hint wk-state">${toTick ? `${plural(toTick, 'transfer')} not marked sent · <button class="btn-link" onclick="WeekUI.tickTransfers()">Mark sent ✓</button>` : 'All marked sent'}${c && c.phone ? '' : ` · <button class="btn-link" onclick="WeekUI.openContacts()">add phone</button>`}</div></div>`
        : `<div class="hint wk-none">No transfers still to do ${day === 'week' ? 'this week' : 'on this day'}.</div>`}</div></div>`;
    }
    const text = body(team, day, ws, rows);
    const sent = sentOf(team, day, ws);
    const changed = sent && sent.hash !== hash(text);
    const msg = changed ? updateText(sent.text, text, day, ws) : text;
    return `<div class="card wk-card wk-msgcard" id="wkMessage">${cardHead('Message', `WhatsApp text${c ? ` for ${h(c.name)}` : ''} · ${h(when)}`)}
      <div class="card-body">${dayPills}<div class="wk-msg" id="wkMsg">${h(msg)}</div>${footer(team, day, sent, changed, c, t)}</div></div>`;
  }
  function footer(team, day, sent, changed, c, t) {
    const who = c ? c.name : t.role;
    const noPhone = !(c && c.phone);
    const undo = W.undo && W.undo.team === team && W.undo.day === day ? ` · <button class="btn-link wk-undo" onclick="WeekUI.undo()">Undo</button>` : '';
    const state = sent ? `Sent ${h(stampOf(sent.sent_at))}${changed ? ' · changed since' : ''}${undo}` : 'Not sent';
    return `<div class="wk-foot"><div class="wk-foot-btns"><button class="btn btn-s" onclick="WeekUI.copy()">${ic('copy')} Copy</button>
        <button class="btn btn-p" id="wkSend" onclick="WeekUI.send()">${ic('send')} ${changed ? 'Send update' : 'Send to ' + h(who)}</button></div>
      <div class="hint wk-state">${state}${noPhone ? ` · <button class="btn-link" onclick="WeekUI.openContacts()">add phone</button>` : ''}</div></div>`;
  }
  function stampOf(at) { const s = colomboStamp(new Date(at)); return `${fd(s.slice(0, 10))} ${s.slice(11, 16)}`; }

  // ── Overview ────────────────────────────────────────────────────────────
  function overviewTab(ctx) {
    const { ws, M, checks } = ctx;
    const last = M.days[7];
    const peakDays = M.days.slice(0, 7).filter(x => x.dinner === M.peak).map(x => DAY[GT.weekday(x.d)]);
    const tiles = `<div class="wk-kpis">
      <div class="kpi"><div class="kpi-label">Guests this week</div><div class="kpi-value num">${M.guests.length}</div><div class="kpi-sub">${plural(M.students.length, 'surf student')}</div></div>
      <div class="kpi"><div class="kpi-label">Arrivals</div><div class="kpi-value num kv-ocean">${M.arrivals}</div><div class="kpi-sub">${M.days[0].arrivals.length ? `${M.days[0].arrivals.length} on ${fd(ws)}` : 'Sat – Fri'}</div></div>
      <div class="kpi"><div class="kpi-label">Departures</div><div class="kpi-value num">${M.departures}</div><div class="kpi-sub">${last.departures.length ? `then ${last.departures.length} on ${fd(last.d)}` : 'Sat – Fri'}</div></div>
      <div class="kpi"><div class="kpi-label">Most in camp</div><div class="kpi-value num">${M.peak}</div><div class="kpi-sub">${M.peak ? h(peakDays.length > 3 ? `${peakDays[0]} – ${peakDays[peakDays.length - 1]}` : peakDays.join(', ')) : 'no one yet'}</div></div></div>`;
    const checkChips = checks.length ? `<div class="health-strip wk-tocheck"><span class="health-lbl">To check</span>${checks.map(c => `<button class="health-chip" onclick="WeekUI.setTab('${c.tab}')">${h(c.short)}</button>`).join('')}</div>` : '';
    const max = Math.max(M.peak, 1);
    const strip = `<div class="card wk-card">${cardHead('Guests in camp each night', 'Arrivals and departures under each day')}
      <div class="card-body"><div class="wk-strip">${M.days.map(x => `<button class="wk-sc${x.closing ? ' closing' : ''}${isToday(x.d) ? ' today' : ''}" onclick="WeekUI.toDay('${x.d}')" title="${h(fdm(x.d))}">
        <span class="wk-sbar">${x.closing ? '' : `<span class="wk-sfill" style="height:${pct(x.dinner, max)}%"><span class="wk-sv num">${x.dinner}</span></span>`}</span>
        <span class="wk-sday">${dayHead(x.d)}</span>
        <span class="wk-sio"><span class="wk-in num">${x.arrivals.length && !x.closing ? '+' + x.arrivals.length : '&nbsp;'}</span><span class="wk-out num">${x.departures.length ? '−' + x.departures.length : '&nbsp;'}</span></span></button>`).join('')}</div>
        <div class="wk-legend"><span><i class="wk-sw sw-ocean"></i>sleeping in camp</span><span><b class="wk-in">+</b> arrivals</span><span><b class="wk-out">−</b> departures</span><span>last column = check-out day ${h(fd(last.d))}</span></div></div></div>`;
    const board = `<div class="card wk-card wk-board"><div class="wk-bhead"><span>Day</span><span>${ic('login')} Arrivals</span><span>${ic('logout')} Departures</span><span>${ic('truck')} Transfers</span><span>Meals</span><span>Surf</span></div>
      ${M.days.map(x => dayRow(x, M)).join('')}</div>`;
    const teams = `<div class="card wk-card">${cardHead('Team messages', 'One WhatsApp text per team, for a day or the whole week')}<div class="wk-teamrows">${TEAMS.filter(t => t.contact).map(t => teamRow(t, ctx)).join('')}</div></div>`;
    return tiles + checkChips + strip + board + teams;
  }
  function dayRow(x, M) {
    const arr = x.arrivals.length, dep = x.departures.length;
    const blk = (cls, icon, label, n, sign, inner) => `<div class="wk-bc ${cls}"><div class="wk-bl"><span class="wk-blt">${ic(icon)} ${label}</span>${n ? `<b class="wk-bn num">${sign}${n}</b>` : ''}</div><div class="wk-bi">${inner}</div></div>`;
    const trips = x.trips.map(t => { const [st, cls] = tripBadge(t); return `<div class="wk-tl"><b class="num">${h(t.trip_time || 'time?')}</b> <span class="wk-dir ${t.kind === 'airport_departure' ? 'out' : 'in'}">${t.kind === 'airport_departure' ? 'out' : 'in'}</span> ${h(t.guest_names || 'Guest')} <span class="badge ${cls}">${st}</span></div>`; }).join('');
    const own = x.own.filter(g => g.arrival_time);
    const ownHtml = own.length ? `<div class="wk-tl wk-own">On their own: ${own.slice().sort((a, b) => a.arrival_time.localeCompare(b.arrival_time)).map(g => `${h(g.arrival_time)} ${h(g.guest_name)}`).join(', ')}</div>` : '';
    const c = x.courses; const st = x.students.length;
    const surf = x.closing ? '<span class="wk-nil">–</span>' : st ? `<b class="num">${st}</b> ${st === 1 ? 'student' : 'students'}
      <span class="wk-stack" title="Standard ${c.S} · Intensive ${c.I} · Coaching ${c.C}">${[['s', c.S], ['i', c.I], ['c', c.C]].filter(k => k[1]).map(k => `<i class="sk-${k[0]}" style="flex:${k[1]}"></i>`).join('')}</span>
      <span class="cell-sub">${[['Standard', c.S], ['Intensive', c.I], ['Coaching', c.C]].filter(k => k[1]).map(k => `${k[0]} ${k[1]}`).join(' · ')}${x.yoga ? ` · Yoga ${x.yoga}` : ''}</span>` : '<span class="wk-nil">No lessons</span>';
    return `<div class="wk-brow${x.closing ? ' closing' : ''}${isToday(x.d) ? ' today' : ''}" id="wkDay-${x.d}">
      <div class="wk-bday"><div class="wk-bdate">${h(fdm(x.d))}${isToday(x.d) ? ' <span class="badge badge-blue">Today</span>' : ''}</div>
        <div class="wk-bnight">${x.closing ? 'Check-out day' : `<b class="num">${x.dinner}</b> in camp tonight`}</div></div>
      ${blk('arr', 'login', 'Arrivals', x.closing ? 0 : arr, '+', x.closing ? (arr ? `<span class="wk-nil">${arr} arriving · next week</span>` : '<span class="wk-nil">–</span>') : arr ? byRoom(x.arrivals) : '<span class="wk-nil">None</span>')}
      ${blk('dep', 'logout', 'Departures', dep, '−', dep ? byRoom(x.departures) : '<span class="wk-nil">None</span>')}
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
    const nights = [0, 1, 2, 3, 4, 5, 6];
    const hd = `<div class="wk-gl wk-ghead"><span class="wk-glb"></span>${nights.map(n => `<span class="wk-gh${isToday(add(ws, n)) ? ' today' : ''}">${dayHead(add(ws, n))}</span>`).join('')}</div>`;
    const bar = (it, room) => {
      const g0 = it.gs[0]; const moved = it.gs.some(g => movedRooms(g));
      const before = g0.check_in < ws, after = g0.check_out > add(ws, 7);
      const tip = `${it.gs.map(g => g.guest_name).join(' + ')} · ${stayText(g0, ws)}${moved ? ' · room move, date not in the file' : ''}`;
      return `<button class="wk-bar${before ? ' before' : ''}${after ? ' after' : ''}${g0._st === 'carry' ? ' carry' : ''}" style="grid-column:${it.a + 2} / ${it.b + 2}" title="${h(tip)}" onclick="WeekUI.findGuest(decodeURIComponent('${encodeURIComponent(g0.guest_name)}'))">
        <span class="wk-bt"><span class="wk-bfull">${it.gs.map(g => h(g.guest_name)).join(' + ')}</span><span class="wk-bshort">${it.gs.map(g => h(first(g.guest_name))).join(' + ')}</span></span>${moved ? '<span class="wk-dot" title="Room move"></span>' : ''}</button>`;
    };
    const lane = (l, room, li) => {
      const cells = nights.map(n => l.items.some(x => x.a <= n && n < x.b) ? '' : `<span class="wk-cell${room.shared || li === 0 ? ' free' : ''}" style="grid-column:${n + 2}"></span>`).join('');
      return `<div class="wk-gl${l.extra ? ' extra' : ''}"><span class="wk-glb">${room.shared ? (l.extra ? 'extra' : `<span class="wk-bedw">Bed </span>${l.bed}`) : ''}</span>${cells}${l.items.map(it => bar(it, room)).join('')}</div>`;
    };
    const roomHtml = r => {
      const inRoom = r.stays.length;
      return `<div class="wk-room"><div class="wk-rhead"><b>${h(r.label)}</b><span class="cell-sub">${r.none ? 'check Bookinglayer' : r.shared ? `shared${r.note ? ' · ' + h(r.note) : ''}` : 'private'} · ${inRoom ? plural(inRoom, 'guest') + ' this week' : 'empty all week'}</span></div>
        ${r.lanes.map((l, i) => lane(l, r, i)).join('')}</div>`;
    };
    const shared = P.rooms.filter(r => r.shared), priv = P.rooms.filter(r => !r.shared && !r.none), none = P.rooms.filter(r => r.none);
    const freeRow = (label, arr) => `<div class="wk-gl wk-gfree"><span class="wk-glb">${label}</span>${arr.map((n, i) => `<span class="wk-fc num${n ? '' : ' zero'}" style="grid-column:${i + 2}">${n}</span>`).join('')}</div>`;
    const grid = `<div class="card wk-card">${cardHead('Rooms and beds', 'One bar per stay · columns are nights · dashed = free', toMsgBtn('Cleaning message'))}
      <div class="wk-grid">${hd}
        ${shared.length ? `<div class="section-lbl wk-gsec">Shared rooms</div>${shared.map(roomHtml).join('')}` : ''}
        ${priv.length ? `<div class="section-lbl wk-gsec">Private rooms</div>${priv.map(roomHtml).join('')}` : ''}
        ${none.length ? `<div class="section-lbl wk-gsec">No room yet</div>${none.map(roomHtml).join('')}` : ''}
        <div class="section-lbl wk-gsec">Free each night</div>
        ${freeRow('<span class="wk-bedw">Shared </span>beds', P.freeBeds)}${freeRow('<span class="wk-bedw">Private </span>rooms', P.freeRooms)}</div>
      <div class="wk-legend wk-glegend"><span><i class="wk-sw sw-bar"></i>stay</span><span><i class="wk-sw sw-cut"></i>here before / stays after this week</span><span><i class="wk-sw sw-free"></i>free</span><span><span class="wk-dot"></span> room move</span></div></div>`;
    return checkBlock(ctx, 'rooms') + grid + messageCard(ctx, 'cleaning');
  }

  // ── Kitchen ─────────────────────────────────────────────────────────────
  const allergyOf = g => String(g.allergies || '').split(' / ').map(s => s.trim()).filter(s => s && !NO_ALLERGY.test(s)).join(' / ');
  function kitchenTab(ctx) {
    const { ws, M } = ctx;
    const gs = M.guests.slice().sort(nameSort);
    const where = g => { const r = roomOf(g); return `${r ? r.label : 'no room'} · ${stayText(g, ws)}`; };
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
  function transfersTab(ctx) {
    const { M } = ctx;
    const all = M.days.flatMap(x => x.trips);
    const cost = all.filter(t => t.status !== 'no_show').reduce((s, t) => s + Number(t.expected_price || 0), 0);
    const days = M.days.filter(x => x.trips.length || x.own.length);
    const tripRow = t => { const [st, cls] = tripBadge(t);
      return `<div class="wk-g wk-trip"><span class="wk-time num">${h(t.trip_time || 'time?')}</span><span class="wk-tmain"><span class="wk-g1">${dirBadge(t)} <b>${h(t.guest_names || 'Guest')}</b></span>
        <span class="cell-sub">${h(t.flight || 'flight?')} · ${t.pax} ${t.pax === 1 ? 'person' : 'persons'}${t.vehicle ? ' · ' + h(t.vehicle) : ''}${t.guest_phone ? ' · ' + h(t.guest_phone) : ''}</span></span><span class="badge ${cls}">${st}</span></div>`; };
    const ownRow = g => `<div class="wk-g wk-trip own"><span class="wk-time num">${h(g.arrival_time || '–')}</span><span class="wk-tmain"><span class="wk-g1"><b>${h(g.guest_name)}</b></span>
      <span class="cell-sub">${g.arrival_time ? 'arrives around this time' : 'no arrival time given'}${g.arrival_flight ? ' · ' + h(g.arrival_flight) : ''}${g.phone ? ' · ' + h(g.phone) : ''}</span></span><span class="badge badge-grey">Own way</span></div>`;
    const dayHtml = x => { const own = x.own.slice().sort((a, b) => (a.arrival_time || '99').localeCompare(b.arrival_time || '99'));
      return `<div class="wk-tday" id="wkTr-${x.d}"><div class="wk-tdh"><b>${h(fdm(x.d))}</b>${isToday(x.d) ? ' <span class="badge badge-blue">Today</span>' : ''}<span class="cell-sub">${[x.trips.length ? plural(x.trips.length, 'transfer') : '', own.length ? `${own.length} on their own` : ''].filter(Boolean).join(' · ')}</span></div>
        <div class="wk-rows">${x.trips.map(tripRow).join('')}${own.map(ownRow).join('')}</div></div>`; };
    const card = `<div class="card wk-card">${cardHead('Airport transfers', `${plural(all.length, 'transfer')} this week${cost ? ` · ${h(money(cost))} expected` : ''} · tuk-tuks and paying drivers stay in Transport`, toMsgBtn('Transfers message'))}
      ${days.length ? days.map(dayHtml).join('') : '<div class="card-body hint">No airport transfers and no arrivals this week.</div>'}</div>`;
    return checkBlock(ctx, 'transfers') + card + messageCard(ctx, 'transfers');
  }

  // ── Guests ──────────────────────────────────────────────────────────────
  function guestsTab(ctx) {
    const { ws, rows } = ctx; const day = W.day;
    const gs = guestsList(rows, day, ws);
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => add(ws, i));
    const dayPills = `<div class="pills wk-days">${days.map(d => `<button class="pill${day === d ? ' active' : ''}" data-day="${d}" onclick="WeekUI.setDay('${d}')">${fd(d)}</button>`).join('')}<button class="pill${day === 'week' ? ' active' : ''}" data-day="week" onclick="WeekUI.setDay('week')">Week</button></div>`;
    const list = gs.length ? gs.map(g => guestRow(g, ws)).join('') : '';
    return checkBlock(ctx, 'guests') + `<div class="card wk-card">${cardHead(`Guests · ${day === 'week' ? 'week' : fdm(day)} · <span id="wkGuestN">${gs.length}</span>`, 'For you only — no message to the team.')}
        <div class="wk-gtools"><input class="search wk-search" id="wkSearch" type="search" placeholder="Search name, room, phone, diet…" value="${h(W.q || '')}" oninput="WeekUI.search(this.value)">${dayPills}</div>
        <div class="wk-ghd"><span>Guest</span><span>Stay</span><span>Room</span><span>Surf</span><span>Diet</span><span>Phone</span><span>Arrival</span></div>
        <div class="wk-rows wk-guests">${list}</div><div class="card-body hint wk-noguests"${gs.length ? ' hidden' : ''}>${gs.length ? 'No guest matches the search.' : 'No guests on this day.'}</div></div>
      <div class="wk-foot"><button class="btn btn-p" onclick="WeekUI.copy()">${ic('copy')} Copy list</button></div>`;
  }
  function guestRow(g, ws) {
    const r = roomOf(g); const c = course(g); const d = dietOf(g); const al = allergyOf(g);
    const room = r ? r.label + (r.shared && g.bed_number ? ' bed ' + g.bed_number : '') : 'no room';
    const nights = (g.check_in && g.check_out) ? daysBetween(g.check_in, g.check_out) : 0;
    const pack = String(g.packages || '').split(/\s*,\s*/).filter(Boolean).slice(-1)[0] || '';
    const arrive = g.has_transfer ? 'transfer' + (g.arrival_time ? ' ' + g.arrival_time : '') : g.arrival_time ? 'own way ' + g.arrival_time : 'own way';
    const q = [g.guest_name, room, g.phone, c, levelOf(g), d, al, g.partner, pack, g.booking_ref].join(' ').toLowerCase();
    return `<div class="wk-g wk-grow" data-q="${h(q)}"><span class="wk-gc name"><span class="wk-g1"><b>${h(g.guest_name)}</b>${g.partner ? ` <span class="badge badge-amber">partner – don't charge</span>` : ''}${g._st === 'carry' ? ' <span class="badge badge-grey">still here?</span>' : ''}</span>${pack || g.partner ? `<span class="cell-sub">${h([pack, g.partner && g.partner !== 'partner' ? 'via ' + g.partner : ''].filter(Boolean).join(' · '))}</span>` : ''}</span>
      <span class="wk-gc" data-l="Stay">${h(stayText(g, ws))}${nights ? `<span class="cell-sub">${plural(nights, 'night')}</span>` : ''}</span>
      <span class="wk-gc" data-l="Room">${h(room)}${movedRooms(g) ? `<span class="cell-sub">moved from ${h(movedRooms(g)[0])}</span>` : ''}</span>
      <span class="wk-gc" data-l="Surf">${h(c ? c : 'no lessons')}${c ? `<span class="cell-sub">${h(levelOf(g))}${isYoga(g) ? ' · Yoga' : ''}</span>` : isYoga(g) ? '<span class="cell-sub">Yoga</span>' : ''}</span>
      <span class="wk-gc" data-l="Diet">${h(d === 'none' ? 'no special diet' : d || 'diet ?')}${al ? ` <span class="badge badge-red">allergies: ${h(al)}</span>` : ''}</span>
      <span class="wk-gc" data-l="Phone">${g.phone ? `<a href="tel:${h(g.phone)}">${h(g.phone)}</a>` : '<span class="wk-nil">no phone</span>'}</span>
      <span class="wk-gc" data-l="Arrival">${h(arrive)}</span></div>`;
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
    if (W.team === 'transfers') { const list = tripsFor(W.day, ws); return list.some(t => t.needs_resend) ? transfersUpdate(list, W.day, ws) : GT.whatsappDayText(list); }
    const text = body(W.team, W.day, ws, rows); const sent = sentOf(W.team, W.day, ws);
    return { text, out: sent && sent.hash !== hash(text) ? updateText(sent.text, text, W.day, ws) : text };
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
        <div class="mfield"><label>Phone</label><input data-f="phone" value="${h(c && c.phone || '')}" placeholder="add phone · +94771234567" inputmode="tel"></div></div>
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
        if (phone && !/^\+[0-9]{8,15}$/.test(phone)) { say(`${t.label}: phone must look like +94771234567`, 'err'); return; }
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
    toMessage() { const el = $('wkMessage'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    toDay(d) { const el = $('wkDay-' + d); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    search(q) { W.q = q; filterGuests(q); },
    findGuest(name) { W.q = name; W.tab = 'guests'; W.team = 'guests'; W.day = 'week'; render(); },
    shiftWeek(n) { W.week = add(W.week, n); W.day = 'week'; W.undo = null; render(); loadWeek(W.week).then(render); },
    // for tests
    _state: W, loadAll, classify, body, parts, toText, updateText, lineDiff, hash, toCheck: () => toCheck(W.week), changes: () => changes(W.week),
    checks: { file: fileCheck, yoga: yogaCheck }, roomInfo, course, levelOf, dietOf,
    model: () => weekModel(W.week, rowsOf(W.week)), roomPlan: () => roomPlan(W.week, rowsOf(W.week)),
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
