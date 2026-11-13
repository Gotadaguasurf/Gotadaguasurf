// Camp hub · Week (Sri Lanka, 13 Nov 2026)
//
// Francisco's back office for the week (full view only; Nadith's ?view=local
// has no Week tab). The Monday Bookinglayer Guests import lands in
// camp_week_guests (supabase/camp-trips.sql) and becomes one WhatsApp text per
// team and day:
//
//   Cleaning · Kitchen · Surf   message per day or for the whole week, Copy or
//                               «Send to <contact>» (wa.me); each send is stored
//                               in camp_week_messages (supabase/camp-week.sql) so a
//                               re-import shows «Changed since sent → Send update».
//   Transfers                   the trips of Transport (camp_trips), Miguel's fixed
//                               format; sent state stays on the trips.
//   Guests                      one line per guest, «Copy list».
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
  const LEVELS = ['Beginner', 'Experienced beginner', 'Intermediate', 'Advanced', 'Level not set'];

  const SLUG = (typeof __HUB_LOCATION_SLUG !== 'undefined') ? __HUB_LOCATION_SLUG : '';
  const enabled = () => WEEK_ENABLED_LOCATIONS.has(SLUG) && !LOCAL_MANAGER_MODE && !CAMP_TAB_ONLY_MODE;

  const W = {
    week: null, day: null, team: 'cleaning', mode: 'lists', showCheck: false,
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
  const liveTrip = t => (t.kind === 'airport_arrival' || t.kind === 'airport_departure') && !['cancelled', 'no_show', 'merged'].includes(t.status);
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

  // ── To check (one compact list) ─────────────────────────────────────────
  function toCheck(ws) {
    const rows = rowsOf(ws); const wk = rows.filter(g => inWeek(g, ws));
    const live = wk.filter(counted);
    const items = [];
    const names = gs => gs.map(g => g.guest_name).join(', ');
    const noLevel = live.filter(g => course(g) && levelOf(g) === 'Level not set');
    if (noLevel.length) items.push({ text: `${plural(noLevel.length, 'surf student')} without level – ask at check-in`, who: names(noLevel) });
    const noDiet = live.filter(g => !dietOf(g));
    if (noDiet.length) items.push({ text: `${plural(noDiet.length, 'guest')} didn't answer diet – ask at the welcome dinner`, who: names(noDiet) });
    const noRoom = live.filter(g => !roomOf(g));
    if (noRoom.length) items.push({ text: `${plural(noRoom.length, 'guest')} without a room – check Bookinglayer`, who: names(noRoom) });
    const noTime = tripsFor('week', ws).filter(t => !t.trip_time);
    if (noTime.length) items.push({ text: `${plural(noTime.length, 'transfer')} without flight time – ask the guest`, who: noTime.map(t => t.guest_names || 'Guest').join(', ') });
    const carry = wk.filter(g => g._st === 'carry');
    if (carry.length) items.push({ text: `${plural(carry.length, 'guest')} in camp ${carry.length === 1 ? 'is' : 'are'} not in the latest Guests file – still here?`, guests: carry, kind: 'carry' });
    const dropped = wk.filter(g => g._st === 'dropped');
    if (dropped.length) items.push({ text: `${plural(dropped.length, 'guest')} dropped out of the latest Guests file – cancelled? Not counted`, guests: dropped, kind: 'dropped' });
    const zero = live.filter(g => { const raw = String((g.raw || {}).Phone || '').replace(/\s+/g, ''); return raw && g.phone && raw !== g.phone; });
    if (zero.length) items.push({ text: `${plural(zero.length, 'phone')} had a wrong 0 after the country code – fixed, check before sending`, who: zero.map(g => `${g.guest_name} ${g.phone}`).join(', ') });
    const moves = live.filter(g => movedRooms(g));
    if (moves.length) items.push({ text: `${plural(moves.length, 'room move')} without a date – check the Day Planner`, who: names(moves) });
    return items;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Page
  // ════════════════════════════════════════════════════════════════════════
  function renderWeekPage() {
    if (!enabled()) return;
    if (!W.week) W.week = GT.weekStart(cToday());
    if (!W.day) W.day = defaultDay(W.week);
    if (!W.metaLoaded || !W.cache[W.week]) loadAll().then(render);
    render();
  }
  function defaultDay(ws) { const t = cToday(); return t >= ws && t <= add(ws, 6) ? t : ws; }
  function render() {
    const root = $('weekRoot'); if (!root || !enabled()) return;
    const ws = W.week;
    const head = `<div class="section-head page-head"><div><div class="section-title">Week</div><div class="section-sub">Guests, rooms, meals, surf and transfers · messages for the team</div></div>
      <div class="exp-top-actions wk-actions">
        <button class="btn btn-s" onclick="WeekUI.setMode('${W.mode === 'import' ? 'lists' : 'import'}')">${ic(W.mode === 'import' ? 'arrow-left' : 'upload')} ${W.mode === 'import' ? 'Back to the week' : 'Import Guests file'}</button>
        <button class="btn btn-s" onclick="WeekUI.openContacts()">${ic('phone')} Contacts</button></div></div>`;
    if (W.mode === 'import') {
      const tr = $('transportRoot'); if (tr) tr.innerHTML = '';   // one copy of the import inputs in the DOM
      const S = TR();
      let inner = '';
      if (!window.TransportUI || !TransportUI.importHtml) inner = '<div class="status-msg status-warn">Import not available.</div>';
      else if (!S.loaded) inner = S.error ? `<div class="status-msg status-warn">Transport is not set up yet (${h(S.error)}). Ask Miguel to run supabase/camp-trips.sql.</div>` : '<div class="loading">Loading…</div>';
      else inner = TransportUI.importHtml();
      const done = S.imp && S.imp.stage === 'done';
      root.innerHTML = head + `<div class="wk-import">${inner}</div>` + (done ? `<div class="wk-after"><button class="btn btn-s" onclick="WeekUI.afterImport()">${ic('list')} See the week</button></div>` : '');
      if (!S.loaded && !S.error && window.TransportUI) TransportUI.load().then(render);
      return;
    }
    if (W.error && !W.cache[ws]) { root.innerHTML = head + `<div class="status-msg status-warn">Week is not set up yet (${h(W.error)}). Ask Miguel to run supabase/camp-trips.sql.</div>`; return; }
    if (!W.cache[ws]) { root.innerHTML = head + '<div class="loading">Loading the week…</div>'; return; }
    const rows = rowsOf(ws);
    const nGuests = rows.filter(g => counted(g) && inWeek(g, ws)).length;
    const filters = `<div class="ov-filters wk-filters"><div class="period-picker"><button class="btn btn-s btn-sm btn-icon" title="Previous week" onclick="WeekUI.shiftWeek(-7)">${ic('chevron-left')}</button>
        <span class="period-picker-lbl wk-week">${fdm(ws)} – ${fdm(add(ws, 6))}</span>
        <button class="btn btn-s btn-sm btn-icon" title="Next week" onclick="WeekUI.shiftWeek(7)">${ic('chevron-right')}</button></div>
      <span class="wk-count">${plural(nGuests, 'guest')}</span></div>`;
    const file = W.meta ? `<div class="hint wk-file">Guests file imported ${h(fileStamp(W.meta.at))}</div>` : `<div class="hint wk-file">No Guests file imported yet</div>`;
    if (!nGuests && !rows.length) {
      root.innerHTML = head + filters + file + `<div class="empty-state">${ic('users')}<div class="empty-title">No guests this week</div><p>Download the Guests export with the «Semana Sri Lanka» preset and import it.</p>
        <button class="btn btn-p" onclick="WeekUI.setMode('import')">${ic('upload')} Import Guests file</button></div>`;
      return;
    }
    const checks = toCheck(ws);
    const checkHtml = checks.length ? `<div class="wk-check${W.showCheck ? ' open' : ''}"><button class="wk-check-hd" onclick="WeekUI.toggleCheck()">${ic(W.showCheck ? 'chevron-down' : 'chevron-right')} To check (${checks.length})</button>
      ${W.showCheck ? `<div class="wk-check-list">${checks.map(checkItem).join('')}</div>` : ''}</div>` : '';
    const ch = changes(ws);
    const chHtml = ch.length ? `<div class="health-strip wk-changed"><span class="health-lbl">Changed since sent</span>${ch.map(c => `<button class="health-chip" onclick="WeekUI.go('${c.team}','${c.day}')">${h(changeLabel(c))}</button>`).join('')}</div>` : '';
    const notSaved = (W.cache[ws].msgsMissing) ? `<div class="status-msg status-info wk-soft">Sent messages are not remembered yet — ask Miguel to run supabase/camp-week.sql.</div>` : '';
    const dot = (team, day) => ch.some(c => c.team === team && (day == null || c.day === day)) ? '<span class="wk-dot" title="Changed since sent"></span>' : '';
    const teamPills = `<div class="pills wk-teams">${TEAMS.map(t => `<button class="pill${W.team === t.k ? ' active' : ''}" onclick="WeekUI.setTeam('${t.k}')">${t.label}${dot(t.k)}</button>`).join('')}</div>`;
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => add(ws, i));
    const dayPills = `<div class="pills wk-days">${days.map(d => `<button class="pill${W.day === d ? ' active' : ''}" data-day="${d}" onclick="WeekUI.setDay('${d}')">${fd(d)}${dot(W.team, d)}</button>`).join('')}<button class="pill${W.day === 'week' ? ' active' : ''}" data-day="week" onclick="WeekUI.setDay('week')">Week${dot(W.team, 'week')}</button></div>`;
    root.innerHTML = head + filters + file + notSaved + checkHtml + chHtml + teamPills + dayPills + teamView(ws, rows);
  }
  function fileStamp(at) {
    if (!at) return '';
    const s = colomboStamp(new Date(at)); const d = s.slice(0, 10);
    const age = daysBetween(d, cToday());
    return `${fdm(d)} ${s.slice(11, 16)}${age > 0 ? ` · ${plural(age, 'day')} ago` : ''}`;
  }
  function checkItem(it) {
    if (it.guests) {
      return `<div class="wk-ci"><div class="wk-ci-t">${h(it.text)}</div>${it.guests.map(g => `<div class="wk-ci-g"><span>${h(g.guest_name)} <span class="hint">· ${h(stayText(g, W.week))}</span></span>
        <span class="row">${it.kind === 'carry' ? `<button class="btn btn-s btn-sm" onclick="WeekUI.keep('${g.id}')">Still here</button>` : `<button class="btn btn-s btn-sm" onclick="WeekUI.keep('${g.id}')">Still coming</button>`}
        <button class="btn btn-s btn-sm" onclick="WeekUI.notHere('${g.id}')">Not here</button></span></div>`).join('')}</div>`;
    }
    return `<div class="wk-ci"><div class="wk-ci-t">${h(it.text)}</div><div class="cell-sub">${h(it.who || '')}</div></div>`;
  }

  // One team, one day: the list (= the message), the preview, Copy + one blue Send.
  function teamView(ws, rows) {
    const team = W.team, day = W.day;
    const yogaLine = team === 'surf' ? yogaInfo(ws, rows) : '';
    if (team === 'guests') {
      const gs = guestsList(rows, day, ws);
      const list = gs.length ? gs.map(g => guestRow(g, ws)).join('') : '<div class="card-body hint">No guests on this day.</div>';
      return `<div class="card wk-card"><div class="card-hdr"><div><div class="card-title">Guests · ${day === 'week' ? 'week' : fdm(day)} · ${gs.length}</div><div class="card-hint">For you only — no message to the team.</div></div></div><div class="wk-rows">${list}</div></div>
        <div class="wk-foot"><button class="btn btn-p" onclick="WeekUI.copy()">${ic('copy')} Copy list</button></div>`;
    }
    if (team === 'transfers') return transfersView(ws, rows);
    const p = parts(team, day, ws, rows);
    const text = toText(p);
    const sent = sentOf(team, day, ws);
    const changed = sent && sent.hash !== hash(text);
    const c = contactOf(team); const t = TEAMS.find(x => x.k === team);
    const listHtml = p.filter(x => x.t !== 'title' && x.t !== 'gap').map(x => x.t === 'h' ? `<div class="section-lbl wk-h">${h(x.s)}</div>` : `<div class="wk-line">${h(x.s)}</div>`).join('');
    const msg = changed ? updateText(sent.text, text, day, ws) : text;
    return `<div class="card wk-card"><div class="card-hdr"><div><div class="card-title">${h(t.label)} · ${day === 'week' ? 'week' : fdm(day)}</div>${yogaLine ? `<div class="card-hint wk-yoga">${yogaLine}</div>` : ''}</div></div>
        <div class="card-body wk-list">${listHtml}</div></div>
      <div class="card wk-card"><div class="card-hdr"><div><div class="card-title">Message</div><div class="card-hint">WhatsApp text${c ? ` for ${h(c.name)}` : ''}</div></div></div>
        <div class="card-body"><div class="wk-msg" id="wkMsg">${h(msg)}</div></div></div>
      ${footer(team, day, sent, changed, c, t)}`;
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
  function guestRow(g, ws) {
    const r = roomOf(g); const c = course(g); const d = dietOf(g);
    return `<div class="wk-g"><div class="wk-g1"><b>${h(g.guest_name)}</b>${g.partner ? ` <span class="badge badge-amber">partner – don't charge</span>` : ''}${g._st === 'carry' ? ' <span class="badge badge-grey">still here?</span>' : ''}</div>
      <div class="cell-sub">${h(r ? r.label + (r.shared && g.bed_number ? ' bed ' + g.bed_number : '') : 'no room')} · ${h(stayText(g, ws))} · ${h(g.phone || 'no phone')}</div>
      <div class="cell-sub">${h(c ? c + ' · ' + levelOf(g) : 'no lessons')} · ${h(d === 'none' ? 'no special diet' : d || 'diet ?')}${g.allergies ? ' · allergies: ' + h(g.allergies) : ''} · ${g.has_transfer ? 'transfer' : 'own way'}</div></div>`;
  }
  function transfersView(ws, rows) {
    const day = W.day; const list = tripsFor(day, ws);
    const c = contactOf('transfers');
    const resend = list.some(t => t.needs_resend);
    const text = list.length ? (resend ? transfersUpdate(list, day, ws) : GT.whatsappDayText(list)) : '';
    const tripIds = new Set(list.map(t => t.booking_ref).filter(Boolean));
    const arriving = rows.filter(g => counted(g) && (day === 'week' ? g.check_in >= ws && g.check_in <= add(ws, 6) : g.check_in === day));
    const own = arriving.filter(g => !g.has_transfer && !tripIds.has(g.booking_ref));
    const state = t => t.needs_resend ? ['Time changed, resend', 'badge-amber'] : t.status === 'confirmed' ? ['Confirmed', 'badge-green'] : t.status === 'sent' ? ['Sent', 'badge-blue'] : ['Not sent', 'badge-grey'];
    const rowsHtml = list.length ? list.map(t => { const [st, cls] = state(t); const dep = t.kind === 'airport_departure';
      return `<div class="wk-g"><div class="wk-g1"><b class="num">${h(t.trip_time || 'time?')}</b> <span class="badge ${dep ? 'badge-navy' : 'badge-blue'}">${dep ? 'Departure' : 'Arrival'}</span> <b>${h(t.guest_names || 'Guest')}</b> <span class="badge ${cls}">${st}</span></div>
        <div class="cell-sub">${day === 'week' ? h(fd(t.trip_date)) + ' · ' : ''}${h(t.flight || 'flight?')} · ${t.pax} ${t.pax === 1 ? 'person' : 'persons'} · ${h(t.vehicle || '')}</div></div>`; }).join('')
      : `<div class="card-body hint">No transfers ${day === 'week' ? 'this week' : 'on this day'}.</div>`;
    const toTick = list.filter(t => t.status === 'planned' || t.needs_resend).length;
    return `<div class="card wk-card"><div class="card-hdr"><div><div class="card-title">Transfers · ${day === 'week' ? 'week' : fdm(day)} · ${list.length}</div><div class="card-hint">From Transport. Tuk-tuks and paying drivers stay in Transport.</div></div></div>
        <div class="wk-rows">${rowsHtml}</div>
        ${own.length ? `<div class="card-body"><div class="section-lbl">Coming on their own</div><div class="cell-sub">${h(own.map(g => g.guest_name).join(', '))}</div></div>` : ''}</div>
      ${list.length ? `<div class="card wk-card"><div class="card-hdr"><div><div class="card-title">Message</div><div class="card-hint">Miguel's format, one block per transfer</div></div></div><div class="card-body"><div class="wk-msg" id="wkMsg">${h(text)}</div></div></div>
      <div class="wk-foot"><div class="wk-foot-btns"><button class="btn btn-s" onclick="WeekUI.copy()">${ic('copy')} Copy</button>
        <button class="btn btn-p" id="wkSend" onclick="WeekUI.send()">${ic('send')} ${resend ? 'Send update' : 'Send to ' + h(c ? c.name : 'Transfers')}</button></div>
        <div class="hint wk-state">${toTick ? `${plural(toTick, 'transfer')} not marked sent · <button class="btn-link" onclick="WeekUI.tickTransfers()">Mark sent ✓</button>` : 'All marked sent'}${c && c.phone ? '' : ` · <button class="btn-link" onclick="WeekUI.openContacts()">add phone</button>`}</div></div>` : ''}`;
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
  // «Still here / still coming» adopts the row into the latest import (asked again after the next one);
  // «Not here» takes it out of every list until a later file has the guest again.
  const keep = id => patchGuest(id, { import_id: W.meta && W.meta.id }, 'Kept in the week');
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
        out.push({ text: `Yoga students this week (${nNow}) but no Yoga payment`, level: 'info', onClick: () => { W.week = ws; W.team = 'surf'; W.day = 'week'; W.mode = 'lists'; showPage('week'); } });
      const nPrev = yogaIn(prev);
      if (nPrev && !yogaPayments(prev, today, ctx.ledger).length)
        out.push({ text: `Yoga students last week (${nPrev}) but no Yoga payment`, level: 'info', onClick: () => { W.week = prev; W.team = 'surf'; W.day = 'week'; W.mode = 'lists'; showPage('week'); } });
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
    afterImport() { const S0 = TR(); const g = S0.imp && S0.imp.groups && S0.imp.groups.guests || []; const firstIn = g.map(x => x.check_in).filter(Boolean).sort()[0];
      W.mode = 'lists'; if (firstIn) { W.week = GT.weekStart(firstIn); W.day = defaultDay(W.week); } S0.imp = null; loadAll(true); },
    setTeam(t) { W.team = t; W.undo = null; render(); }, setDay(d) { W.day = d; W.undo = null; render(); },
    go(team, day) { W.team = team; W.day = day; render(); },
    shiftWeek(n) { W.week = add(W.week, n); W.day = defaultDay(W.week); W.undo = null; render(); loadWeek(W.week).then(render); },
    toggleCheck() { W.showCheck = !W.showCheck; render(); },
    // for tests
    _state: W, loadAll, classify, body, parts, toText, updateText, lineDiff, hash, toCheck: () => toCheck(W.week), changes: () => changes(W.week),
    checks: { file: fileCheck, yoga: yogaCheck }, roomInfo, course, levelOf, dietOf,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
