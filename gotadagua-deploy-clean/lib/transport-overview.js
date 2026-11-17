// Transport → Overview. Pure functions, no DOM and no Supabase: the camp hub (camp-hub/transport.js) and the Node
// tests load the same file.
//
// v2 (16 Nov 2026, Miguel: «está muito confuso ainda… estão todos confusos no geral»). The view answers four questions:
// how much did transport cost (and is it up or down), on what kind of transport, who did we pay, what do we owe now.
// Every period — before or after the trip list — is told the same way: one row per KIND (the page's pills: Airport ·
// Surf vans · Tours in Morocco, Airport · Tuk-tuks in Sri Lanka) and one row per driver / supplier.
//
// Where the numbers come from (collect()):
//   · trips (camp_trips, from the camp's go-live): the trip's price is its cost; paid = linked to a payment; owed = the
//     page's «Owed to drivers» rule (o.isOwed); cancelled and merged trips are out, a no-show counts. A van run with no
//     head count (Morocco from 17 Nov 2026) has people = null: its kind's «per person» hides when most of the cost has none.
//   · ledger payments (expense, category Transport): a payment linked to trips is those trips' «Paid» (never counted
//     again). Every other line is classified the way a person would read it (classifyLine):
//       1 linked_item = a route of CampConfig.vanRates → Surf vans / Tours (Morocco's weekly Fathoune lines)
//       2 «tuk tuk» in the item or the text, or the item «Transport Surf Lesson» (Sri Lanka) → Tuk-tuks
//       3 an item that says airport / transfer → Airport
//       4 the supplier named in the text (a camp_drivers name or alias) → that driver's kind (Let Us Tours → Airport,
//         Fathoune → Surf vans, Sampath → Tuk-tuks, Dilan → Airport)
//       5 a route said in words («Transporte SURF») → that route (Morocco)
//       6 anything else → «Fuel & other» (fuel, car rental, repairs, a taxi, a one-off driver), named by what it is.
//     A line is the COST of its kind while that kind has no trip list yet (before the camp's go-live, or before the
//     first trip of that kind — Morocco logs no van runs yet, so its van lines stay the cost); after that it is money
//     paid for earlier trips («Paid» only, never cost twice). «Fuel & other» never has trips: always cost.
//   · people before the trip list: qty when > 1; Morocco's route lines until 30 Sep are N × 110 MAD (legacyPerPerson).
//   · a monthly airport invoice named after the month it covers («April · Let Us Tours», paid 6 May) counts in that
//     month (serviceDate) — else April would have no airport and June two months of it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransportOverview = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const OUT = new Set(['cancelled', 'merged']);
  const LIVE = ['planned', 'sent', 'confirmed'];

  function addDays(iso, n) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }
  function monthEnd(ym) { return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10); }
  const isAirport = t => t.kind === 'airport_arrival' || t.kind === 'airport_departure';
  // Done without anyone pressing Done: the date and time have passed (= transport.js isDone, with «now» given).
  const doneAt = (t, now) => t.status === 'done' || (LIVE.includes(t.status) && `${t.trip_date}T${t.trip_time || '23:59'}` < String(now || ''));
  // Transport's week: Sat–Fri, the closing Saturday's departures in, the opening Saturday's out (= GuestsTrips.tripInWeek).
  const tripInWeek = (t, ws) => { const dep = t.kind === 'airport_departure'; return (t.trip_date >= ws && t.trip_date <= addDays(ws, 6) && !(t.trip_date === ws && dep)) || (t.trip_date === addDays(ws, 7) && dep); };

  // The period a view shows: mode 'week' (anchor = the Saturday), 'month' ('YYYY-MM'), 'year' ('YYYY').
  function period(mode, anchor) {
    if (mode === 'week') return { mode, from: anchor, to: addDays(anchor, 6), anchor };
    if (mode === 'year') return { mode, from: `${anchor}-01-01`, to: `${anchor}-12-31`, anchor: String(anchor) };
    return { mode: 'month', from: `${anchor}-01`, to: monthEnd(anchor), anchor };
  }
  function shift(mode, anchor, n) {
    if (mode === 'week') return addDays(anchor, 7 * n);
    if (mode === 'year') return String(+anchor + n);
    const y = +anchor.slice(0, 4), m = +anchor.slice(5, 7) - 1 + n;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return `${yy}-${String(mm + 1).padStart(2, '0')}`;
  }
  // The same period a year earlier (week: the Saturday 52 weeks back).
  const lastYear = (mode, anchor) => mode === 'week' ? addDays(anchor, -364) : mode === 'year' ? String(+anchor - 1) : `${+anchor.slice(0, 4) - 1}${anchor.slice(4)}`;
  // «April», «14–20 Nov», «2026» — the name of a period in a sentence.
  function periodName(mode, anchor) {
    if (mode === 'year') return String(anchor);
    if (mode === 'month') return `${MONTH_LONG[+anchor.slice(5, 7) - 1]} ${anchor.slice(0, 4)}`;
    const to = addDays(anchor, 6); const d = iso => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}`;
    return anchor.slice(0, 7) === to.slice(0, 7) ? `${+anchor.slice(8)}–${d(to)}` : `${d(anchor)} – ${d(to)}`;
  }

  // The type of a trip: { group, key, label, order } (arr / dep / runs / tours / other).
  function classify(t, cfg) {
    cfg = cfg || {};
    if (isAirport(t)) {
      const dep = t.kind === 'airport_departure'; const place = t.place || cfg.airportDefault || '';
      const order = Math.max(0, (cfg.airports || []).indexOf(place));
      return { group: dep ? 'dep' : 'arr', key: `${dep ? 'dep' : 'arr'}:${place}`, place, label: dep ? 'Departures' : 'Arrivals', order };
    }
    const rates = cfg.vanRates;
    if (rates) {                                      // Morocco: the van runs and tours of CampConfig.vanRates
      const r = rates.find(x => x.route === t.route);
      if (r) return { group: r.purpose === 'tour' ? 'tours' : 'runs', key: 'van:' + r.key, label: r.label, order: rates.indexOf(r) };
    } else if (t.kind !== ((cfg.runs || {}).kind || 'tuktuk')) {
      return { group: 'other', key: 'other', label: 'Other', order: 0 };
    }
    if (t.purpose === 'tour' || t.tour_name) { const n = t.tour_name || t.route || 'Tour'; return { group: 'tours', key: 'tour:' + n.toLowerCase(), label: n, order: 99 }; }
    if (!t.route && !t.purpose) return { group: 'other', key: 'other', label: 'Other', order: 0 };
    const n = t.purpose === 'surf' && !rates ? `Surf · ${t.route || ''}`.trim() : (t.route || t.purpose);
    return { group: 'runs', key: 'run:' + String(n).toLowerCase(), label: n, order: 99 };
  }

  // The kind of transport = the page's pill: airport | vans (Morocco runs) | tuktuk (Sri Lanka runs) | tours | other.
  const KIND_ORDER = ['airport', 'vans', 'tuktuk', 'tours', 'other'];
  function kindOf(group, cfg) { return group === 'arr' || group === 'dep' ? 'airport' : group === 'runs' ? ((cfg && cfg.vanRates) ? 'vans' : 'tuktuk') : group === 'tours' ? 'tours' : 'other'; }
  function kindLabel(kind, cfg) {
    const tab = ((cfg && cfg.transportTabs) || []).find(x => x.key === kind);
    if (tab) return tab.label;
    return { airport: 'Airport', vans: 'Surf vans', tuktuk: 'Tuk-tuks', tours: (cfg && cfg.vanRates) ? 'Tours' : 'Tuk-tuk tours', other: 'Fuel & other' }[kind] || kind;
  }
  const DRIVER_KIND = { airport: 'airport', vans: 'van', tours: 'van', tuktuk: 'tuktuk' };
  const isSupplier = x => x && !((x.kinds || []).length === 1 && x.kinds[0] === 'contact');

  // The driver a ledger line names (name or alias in its description; contacts are not suppliers), or null.
  function driverOf(e, drivers) {
    const text = String(e.description || '').toLowerCase();
    return (drivers || []).find(x => isSupplier(x) && [x.name, ...(x.aliases || [])].some(a => a && text.includes(String(a).toLowerCase()))) || null;
  }
  // Kept for older callers: the supplier's name, else «Other transport».
  function supplierOf(e, drivers) { const d = driverOf(e, drivers); return d ? d.name : 'Other transport'; }
  // The usual supplier of a kind when a line names nobody: the camp's own setting, else the one driver of that kind.
  function usualSupplier(kind, cfg, drivers) {
    if (kind === 'airport' && cfg.airportSupplier) return cfg.airportSupplier;
    if ((kind === 'vans' || kind === 'tours') && cfg.vanSupplier) return cfg.vanSupplier;
    const dk = DRIVER_KIND[kind]; if (!dk) return '';
    const xs = (drivers || []).filter(x => isSupplier(x) && (x.kinds || []).includes(dk));
    return xs.length === 1 ? xs[0].name : '';
  }
  const OTHER_PART = d => /fuel|diesel|petrol|gasoil|essence|afriquia|afrq|shell|total ?energies|gas station|station total/i.test(d) ? 'Fuel'
    : /taxi|uber|careem|pickme|bolt/i.test(d) ? 'Taxis' : /rental|rent a car|location voiture/i.test(d) ? 'Car rental'
    : /repair|fix|service|spare|battery|tyre|tire/i.test(d) ? 'Repairs' : head(d) || 'Other';
  // «Surfana Tours · Excel Marrocos» → «Surfana Tours»: what the line says it is, short.
  const head = d => { const x = String(d || '').split(/\s+[—·(|-]\s*|\s*\(/)[0].trim(); return x.length > 28 ? x.slice(0, 27).trim() + '…' : x; };

  // One ledger line, read like a person would: { kind, part, supplier, route }.
  function classifyLine(e, cfg, drivers) {
    cfg = cfg || {};
    const li = String(e.linkedItem || '').trim(); const lil = li.toLowerCase(); const desc = String(e.description || '');
    const drv = driverOf(e, drivers);
    const sup = kind => drv ? drv.name : (usualSupplier(kind, cfg, drivers) || '');
    const out = (kind, part, route) => ({ kind, part, supplier: kind === 'other' && !drv ? '' : sup(kind), route: !!route });
    const rates = cfg.vanRates;
    if (rates && li) {
      const names = x => [x.route, x.label, x.catalog, x.tour, ...(x.tours || []), ...(x.catalogs || [])].filter(Boolean).map(n => String(n).toLowerCase());
      let r = rates.find(x => names(x).includes(lil));
      // «Paradise Valley» + «+Souk» in the text = the Paradise + Souk run.
      const combo = rates.find(x => { const ws = x.route.split('+').map(w => w.trim().toLowerCase()); return ws.length > 1 && lil.startsWith(ws[0]) && ws.slice(1).every(w => desc.toLowerCase().includes(w)); });
      if (combo) r = combo;
      if (r) return out(r.purpose === 'tour' ? 'tours' : 'vans', r.label, true);
    }
    // Part names of a payment: «Monthly invoice» (an airport invoice named after its month), «Payments to Dilan».
    const airPart = () => serviceDate(e) !== String(e.date || '') || /^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(desc.trim()) ? 'Monthly invoice'
      : drv ? `Payments to ${drv.name}` : usualSupplier('airport', cfg, drivers) ? `Payments to ${usualSupplier('airport', cfg, drivers)}` : 'Other payments';
    if (!rates && (/\btuk\b|tuk.?tuk/i.test(li) || /\btuk\b|tuk.?tuk/i.test(desc) || lil === 'transport surf lesson')) return out('tuktuk', drv ? `Payments to ${drv.name}` : 'Tuk-tuk payments');
    if (/airport|a[ée]roport|transfer/i.test(li)) return out('airport', airPart());
    if (drv) {
      const ks = (drv.kinds || []).filter(k => k !== 'contact');
      const k = ks.includes('airport') ? 'airport' : ks.includes('van') ? 'vans' : ks.includes('tuktuk') ? (rates ? 'vans' : 'tuktuk') : '';
      if (k) return out(k, k === 'airport' ? airPart() : k === 'vans' && rates ? `${drv.name} lump sum` : `Payments to ${drv.name}`);
    }
    if (/airport|a[ée]roport/i.test(desc)) return out('airport', airPart());
    // Morocco's oldest lines say the route in words («St Juste — Transporte SURF»).
    const said = rates && rates.find(x => new RegExp(`\\b${x.route.replace(/[^a-z ]/gi, '').trim().split(/\s+/)[0]}\\b`, 'i').test(desc));
    if (said) { const k = said.purpose === 'tour' ? 'tours' : 'vans'; return { kind: k, part: said.label, supplier: (/ — /.test(desc) && head(desc)) || usualSupplier(k, cfg, drivers), route: false }; }
    return out('other', OTHER_PART(desc));
  }

  // A monthly airport invoice named after the month it covers («April · Let Us Tours», paid 6 May): that month's last day
  // (or the payment day when paid within it). Only a full English month name at the start, at most two months back.
  function serviceDate(e) {
    const d = String(e.date || ''); const m = String(e.description || '').trim().match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    if (!m || d.length < 10) return d;
    const named = MONTH_LONG.findIndex(x => x.toLowerCase() === m[1].toLowerCase()); const paidM = +d.slice(5, 7) - 1;
    const back = (paidM - named + 12) % 12;
    if (back > 2) return d;
    if (back === 0) return d;
    const y = named > paidM ? +d.slice(0, 4) - 1 : +d.slice(0, 4);
    return monthEnd(`${y}-${String(named + 1).padStart(2, '0')}`);
  }

  // People on a ledger line before the trip list: qty when > 1; else Morocco's per-person price on a route line.
  function linePeople(e, c, cfg) {
    const q = Number(e.quantity || e.qty || 1); if (q > 1) return q;
    const L = (cfg || {}).legacyPerPerson; const amt = Math.round(Number(e.amountLocal || 0));
    if (L && c.route && (L.kinds || []).includes(c.kind) && String(e.date || '') < L.until && amt > 0 && amt % L.rate === 0) return amt / L.rate;
    return null;
  }
  const isTransportLine = e => e && e.type === 'expense' && (e.category === 'Transport' || (e.category === 'Tours & activities' && e.businessArea === 'Transport'));

  // Every cost item of the camp, each with its effective date. o = { trips, ledger, drivers, cfg, goLive, now, linked, isOwed }
  //   trip item    { src:'trip', date, trip, kind, part, supplier, driverId, cost, paid, owed, toCome, people, noShow }
  //   payment item { src:'payment', date, paidOn, kind, part, supplier, cost, paid, people|null, earlier }
  //     earlier = money paid in this period for trips of an earlier one (after the trip list): «Paid», never cost.
  function collect(o) {
    const cfg = o.cfg || {}; const goLive = o.goLive || '0000';
    const L = o.linked instanceof Set ? o.linked : new Set(o.linked || []);
    const isOwed = typeof o.isOwed === 'function' ? o.isOwed : (t => !t.payment_entry_id && t.status !== 'no_show' && doneAt(t, o.now));
    const drvName = id => { const d = (o.drivers || []).find(x => x && x.id === id); return d ? d.name : 'No driver'; };
    const trips = (o.trips || []).filter(t => t && t.trip_date && !OUT.has(t.status) && t.trip_date >= goLive);
    // When each trip list starts: the camp's go-live, or its first trip if later; never for a list with no trips. One list
    // per driver kind — vans and tours share Fathoune's (a lump sum is filed under vans), tuk-tuks and tuk-tuk tours Sampath's.
    const listOf = k => k === 'airport' ? 'airport' : k === 'other' ? 'other' : cfg.vanRates ? 'van' : 'tuktuk';
    const start = {};
    const items = trips.map(t => {
      const c = classify(t, cfg); const kind = kindOf(c.group, cfg);
      const lk = listOf(kind); if (!start[lk] || t.trip_date < start[lk]) start[lk] = t.trip_date;
      const price = Number(t.expected_price || 0); const paid = !!t.payment_entry_id; const owed = !paid && isOwed(t);
      return { src: 'trip', date: t.trip_date, trip: t, kind, group: c.group, part: kind === 'airport' ? (c.group === 'dep' ? 'Departures' : 'Arrivals') : c.label, place: c.place,
        supplier: drvName(t.driver_id), driverId: t.driver_id || '', cost: price, paid: paid ? price : 0, owed: owed ? price : 0,
        toCome: !paid && !owed && t.status !== 'no_show' && !doneAt(t, o.now) ? price : 0, people: isAirport(t) || Number(t.pax) > 0 ? (Number(t.pax) || 1) : null, noShow: t.status === 'no_show' ? 1 : 0 };
    });
    Object.keys(start).forEach(k => { if (start[k] < goLive) start[k] = goLive; });
    const kindStart = k => k === 'other' ? '9999' : (start[listOf(k)] || '9999');
    (o.ledger || []).forEach(e => {
      if (!isTransportLine(e) || L.has(e.id)) return;
      const c = classifyLine(e, cfg, o.drivers); const v = Number(e.amountLocal || 0); if (!v) return;
      const paidOn = String(e.date || ''); const ks = kindStart(c.kind);
      const svc = c.kind === 'airport' ? serviceDate(e) : paidOn;
      const date = svc < ks ? svc : paidOn;
      const before = date < ks;
      items.push({ src: 'payment', date, paidOn, id: e.id, kind: c.kind, part: c.part, supplier: c.supplier || (c.kind === 'other' ? kindLabel('other', cfg) : 'Other drivers'), driverId: '',
        cost: before ? v : 0, paid: v, owed: 0, toCome: 0, people: before ? linePeople(e, c, cfg) : null, earlier: before ? 0 : v, noShow: 0 });
    });
    const kinds = cfg.vanRates ? ['airport', 'vans', 'tours'] : ['airport', 'tuktuk', 'tours'];
    return { items, start: Object.fromEntries(kinds.map(k => [k, start[listOf(k)] || null])) };
  }
  const inPeriod = (it, P) => it.src === 'trip' && P.mode === 'week' ? tripInWeek(it.trip, P.from) : it.date >= P.from && it.date <= P.to;

  // One period: { total, kinds[], suppliers[], fromPayments } — every number of the page, once.
  function view(C, P, cfg) {
    const xs = (C.items || C).filter(it => inPeriod(it, P));
    const blank = () => ({ cost: 0, paid: 0, owed: 0, toCome: 0, earlier: 0, trips: 0, people: 0, costP: 0, fromPayments: 0, payments: 0, noShow: 0 });
    const add = (r, it) => {
      r.cost += it.cost; r.paid += it.paid; r.owed += it.owed; r.toCome += it.toCome; r.earlier += it.earlier || 0; r.noShow += it.noShow;
      if (it.src === 'trip') r.trips++; else { r.payments++; if (it.cost) r.fromPayments += it.cost; }
      if (it.people != null && it.cost) { r.people += it.people; r.costP += it.cost; }
    };
    const total = blank(); const K = new Map(); const SUP = new Map();
    xs.forEach(it => {
      add(total, it);
      if (it.cost) {   // the kind table is what transport cost: a payment for earlier trips is no cost of this period
        const k = K.get(it.kind) || { kind: it.kind, label: kindLabel(it.kind, cfg), ...blank(), parts: new Map() }; add(k, it);
        const p = k.parts.get(it.part) || { label: it.part, ...blank() }; add(p, it); k.parts.set(it.part, p); K.set(it.kind, k);
      }
      const s = SUP.get(it.supplier) || { label: it.supplier, driverId: it.driverId, kinds: new Set(), lastPaid: '', ...blank() }; add(s, it);
      if (it.driverId && !s.driverId) s.driverId = it.driverId; if (it.cost) s.kinds.add(it.kind);
      if (it.paidOn && it.paidOn > s.lastPaid) s.lastPaid = it.paidOn;
      SUP.set(it.supplier, s);
    });
    const pp = r => r.people ? Math.round(r.costP / r.people) : null;
    const kinds = [...K.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
      .map(k => ({ ...k, perPerson: pp(k), parts: [...k.parts.values()].sort((a, b) => b.cost - a.cost).map(p => ({ ...p, perPerson: pp(p) })) }));
    const otherLabel = kindLabel('other', cfg);
    const suppliers = [...SUP.values()].map(s => ({ ...s, kinds: [...s.kinds] }))
      .sort((a, b) => (a.label === otherLabel) - (b.label === otherLabel) || (a.label === 'No driver') - (b.label === 'No driver') || (b.cost + b.earlier) - (a.cost + a.earlier));
    total.perPerson = pp(total);
    return { P, total, kinds, suppliers, empty: !xs.length };
  }

  // The year as months × kinds (cost, and people where known) for the chart and the CSV.
  function yearView(C, year, cfg) {
    const y = String(year); const months = MON.map((m, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const K = new Map();
    (C.items || C).forEach(it => {
      if (!it.cost || String(it.date).slice(0, 4) !== y) return;
      const i = +it.date.slice(5, 7) - 1;
      const k = K.get(it.kind) || { kind: it.kind, label: kindLabel(it.kind, cfg), cost: months.map(() => 0), people: months.map(() => 0), known: months.map(() => true) };
      k.cost[i] += it.cost; if (it.people != null) k.people[i] += it.people; else k.known[i] = false;
      K.set(it.kind, k);
    });
    const rows = [...K.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
      .map(k => ({ ...k, people: k.people.map((n, i) => k.known[i] ? n : (n || null)), total: { cost: k.cost.reduce((s, n) => s + n, 0), people: k.people.reduce((s, n) => s + (n || 0), 0) } }));
    const col = key => months.map((m, i) => rows.reduce((s, r) => s + (r[key][i] || 0), 0));
    const totals = { cost: col('cost'), people: col('people') };
    totals.all = { cost: totals.cost.reduce((s, n) => s + n, 0), people: totals.people.reduce((s, n) => s + n, 0) };
    return { year: y, months, rows, totals };
  }

  // Up or down: this period's cost against the one before and the same one a year earlier (null when that one is empty).
  function compare(C, P) {
    const cost = (mode, anchor) => view(C, period(mode, anchor)).total.cost;
    const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
    const now = view(C, P).total.cost;
    const prevA = shift(P.mode, P.anchor, -1); const lyA = lastYear(P.mode, P.anchor);
    const prev = cost(P.mode, prevA); const ly = P.mode === 'year' ? 0 : cost(P.mode, lyA);
    return { prev: prev ? { anchor: prevA, name: periodName(P.mode, prevA), cost: prev, pct: pct(now, prev) } : null,
      lastYear: ly ? { anchor: lyA, name: periodName(P.mode, lyA), cost: ly, pct: pct(now, ly) } : null };
  }

  // What is owed right now (every trip, every period): the page's «Owed to drivers», per driver.
  function owedNow(C) {
    const by = new Map();
    (C.items || C).forEach(it => { if (it.src !== 'trip' || !it.owed) return; const k = it.driverId || ''; const r = by.get(k) || { driverId: k, label: it.supplier, amount: 0, trips: 0 }; r.amount += it.owed; r.trips++; by.set(k, r); });
    const rows = [...by.values()].sort((a, b) => (a.driverId === '') - (b.driverId === '') || b.amount - a.amount);
    return { total: rows.reduce((s, r) => s + r.amount, 0), rows };
  }

  // Euros for the Overview: ONE rate for the period, never a single stored row (16 Nov 2026: the app's exchange-rate
  // table held an LKR rate, 389.63, as Morocco's EUR→MAD on 21 May). The rate is the median of amount_local / amount_eur
  // of the camp's own ledger lines in its currency — first those of the period, else all of them — each line kept only
  // when its rate is sane for the currency; else the app's rate when sane; else the camp's default.
  //   o = { ledger, cur, from, to, fallback, defaultRate } → { rate, source: 'period' | 'ledger' | 'app' | 'default', n, skipped }
  const FX_RANGE = { MAD: [9, 13], LKR: [250, 450] };
  function eurRate(o) {
    const cur = o.cur || 'EUR';
    if (cur === 'EUR') return { rate: 1, source: 'eur', n: 0, skipped: 0 };
    const range = FX_RANGE[cur] || [0, Infinity];
    const sane = r => Number.isFinite(r) && r > 0 && r >= range[0] && r <= range[1];
    const lineRate = e => Number(e.amountLocal) > 0 && Number(e.amount) > 0 ? Number(e.amountLocal) / Number(e.amount) : 0;
    const mine = (o.ledger || []).filter(e => e && (e.currency || cur) === cur && lineRate(e) > 0);
    const median = xs => { const v = xs.slice().sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const pick = lines => { const rs = lines.map(lineRate); const ok = rs.filter(sane); return { ok, skipped: rs.length - ok.length }; };
    const inP = pick(mine.filter(e => String(e.date || '') >= (o.from || '') && String(e.date || '') <= (o.to || '9999')));
    const r2 = x => Math.round(x * 100) / 100;
    if (inP.ok.length) return { rate: r2(median(inP.ok)), source: 'period', n: inP.ok.length, skipped: inP.skipped };
    const all = pick(mine);
    if (all.ok.length) return { rate: r2(median(all.ok)), source: 'ledger', n: all.ok.length, skipped: all.skipped };
    if (sane(Number(o.fallback))) return { rate: r2(Number(o.fallback)), source: 'app', n: 0, skipped: all.skipped };
    return { rate: Number(o.defaultRate) || (cur === 'MAD' ? 10.8 : cur === 'LKR' ? 340 : 1), source: 'default', n: 0, skipped: all.skipped };
  }
  const eur = (v, rate) => rate > 0 ? Math.round(Number(v || 0) / rate) : 0;

  // Surf vans per SURFER-DAY (Miguel, 17 Nov 2026, after «People in the van» was removed): the head count comes from the
  // guests, never from a typed number. Per day, surfers = guests (camp_week_guests, as the camp report importer stores
  // them) with
  //   · a dated surf lesson that day (raw.lessons: Standard / Intensive / Coaching day lessons, one line per date), or
  //   · a surf COURSE (raw.courses) while in camp (check-in ≤ day < check-out), on the camp's lesson weekdays
  //     o.courseDays (CampConfig.surfCourseDays; Mon–Fri when not set: Bookinglayer has only the course start, the head
  //     coach picks the days), from the course's own date when it has one;
  //   · an older Guests-export row (no raw.courses): o.hasCourse(g) (Week's course() rule) counts it like a course.
  // A guest counts once a day. o.ok(g) = the guest is a live booking.  → { byDay: { 'YYYY-MM-DD': n }, total }
  function surferDays(guests, from, to, o) {
    o = o || {}; const days = {};
    for (let d = from; d <= to; d = addDays(d, 1)) days[d] = new Set();
    const wd = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();
    const cd = new Set(o.courseDays && o.courseDays.length ? o.courseDays : [1, 2, 3, 4, 5]);
    (guests || []).forEach(g => {
      if (!g || (o.ok && !o.ok(g))) return;
      const key = `${g.booking_ref || ''}|${g.guest_key || g.guest_name || g.id || ''}`;
      const raw = g.raw || {};
      (raw.lessons || []).forEach(x => { if (x && days[x.date]) days[x.date].add(key); });
      const courses = Array.isArray(raw.courses) ? raw.courses : (o.hasCourse && o.hasCourse(g) ? [{ date: null }] : []);
      courses.forEach(c => Object.keys(days).forEach(d => {
        if (String(g.check_in || '') <= d && d < String(g.check_out || '') && cd.has(wd(d)) && (!c || !c.date || d >= c.date)) days[d].add(key);
      }));
    });
    const byDay = {}; let total = 0;
    Object.keys(days).forEach(d => { byDay[d] = days[d].size; total += days[d].size; });
    return { byDay, total };
  }
  // The surf vans' cost per surfer-day in a period: the van runs' cost (trips of the kind 'vans', by day) on the days the
  // guests list has surfers ÷ the surfer-days of the period. Van cost on a day with no surfer in the list (guests not
  // imported for that day) is left out and returned as `uncovered`; payments with no day (lump sums) are never in it.
  //   → { cost, surferDays, per (local per surfer-day, null when none), uncovered, days }
  function perSurferDay(C, P, sd) {
    const cost = {};
    (C.items || C).forEach(it => { if (it.src === 'trip' && it.kind === 'vans' && it.date >= P.from && it.date <= P.to) cost[it.date] = (cost[it.date] || 0) + it.cost; });
    let c = 0, uncovered = 0, days = 0;
    Object.keys(cost).forEach(d => { if ((sd.byDay[d] || 0) > 0) { c += cost[d]; days++; } else uncovered += cost[d]; });
    const n = Object.keys(sd.byDay).filter(d => d >= P.from && d <= P.to).reduce((s, d) => s + sd.byDay[d], 0);
    return { cost: c, surferDays: n, per: n && c ? Math.round(c / n * 100) / 100 : null, uncovered, days };
  }

  // Airport transfers: what the guests paid (€) against what the drivers cost (€) in a period (17 Nov 2026).
  //   · a trip from the camp report carries guest_eur = the paid lines' «Final price incl. tax» (camp_trips.guest_eur);
  //   · an older trip (no guest_eur) is ESTIMATED from /prices: ceil(people ÷ covers_pax) × the route's guest price —
  //     o.sellFor(t) → { eur, covers } | null; none → «unknown», never a silent €0;
  //   · a free trip (staff, gift…) and a Camp Tab trip (the guest pays at the camp) bring nothing here; their driver cost
  //     still counts. Cancelled / merged trips are out; a no-show was paid by the guest and counts.
  //   o = { rate (local per €), sellFor } → { trips, revenue, cost, costEur, margin, fromReport, estimated, unknown, free }
  function guestMoney(trips, P, o) {
    o = o || {}; const r2 = x => Math.round(x * 100) / 100;
    const air = (trips || []).filter(t => t && isAirport(t) && !OUT.has(t.status) && String(t.trip_date || '') >= P.from && String(t.trip_date || '') <= P.to);
    const out = { trips: air.length, revenue: 0, cost: 0, costEur: 0, margin: 0, fromReport: 0, estimated: 0, unknown: 0, free: 0 };
    air.forEach(t => {
      out.cost += Number(t.expected_price || 0);
      if (t.charge === 'free' || t.free_reason || (t.charge && t.charge !== 'bookinglayer')) { out.free++; return; }
      if (t.guest_eur != null && t.guest_eur !== '' && Number.isFinite(Number(t.guest_eur))) { out.revenue += Number(t.guest_eur); out.fromReport++; return; }
      const s = typeof o.sellFor === 'function' ? o.sellFor(t) : null;
      if (s && s.eur > 0) { out.revenue += Math.ceil((Number(t.pax) || 1) / (s.covers > 0 ? s.covers : 1)) * s.eur; out.estimated++; } else out.unknown++;
    });
    out.revenue = r2(out.revenue); out.costEur = o.rate > 0 ? r2(out.cost / o.rate) : 0; out.margin = r2(out.revenue - out.costEur);
    return out;
  }

  // The view as a table for the CSV: exactly the numbers shown (kinds with their parts, then drivers), the euros last.
  function viewTable(V, cur, rate) {
    const E = rate > 0; const e = (...v) => E ? v.map(x => eur(x, rate)) : [];
    const n = x => x == null ? '' : x;
    const out = [['Kind', 'Detail', 'Trips', 'People', `Cost (${cur})`, `Paid (${cur})`, `Owed (${cur})`, `Cost per person (${cur})`, `From payments (${cur})`, ...(E ? ['Cost (EUR)', 'Paid (EUR)', 'Owed (EUR)'] : [])]];
    V.kinds.forEach(k => {
      out.push([k.label, '', k.trips, k.people || '', k.cost, k.paid, k.owed, n(k.perPerson), k.fromPayments, ...e(k.cost, k.paid, k.owed)]);
      k.parts.forEach(p => out.push([k.label, p.label, p.trips, p.people || '', p.cost, p.paid, p.owed, n(p.perPerson), p.fromPayments, ...e(p.cost, p.paid, p.owed)]));
    });
    const T = V.total;
    out.push(['Total', '', T.trips, T.people || '', T.cost, T.paid - T.earlier, T.owed, n(T.perPerson), T.fromPayments, ...e(T.cost, T.paid - T.earlier, T.owed)]);
    out.push([]);
    out.push(['Driver / supplier', 'Kinds', 'Trips', 'Payments', `Cost (${cur})`, `Paid (${cur})`, `Owed (${cur})`, `Paid for earlier trips (${cur})`, '', ...(E ? ['Cost (EUR)', 'Paid (EUR)', 'Owed (EUR)'] : [])]);
    V.suppliers.forEach(s => out.push([s.label, s.kinds.map(k => V.kinds.find(x => x.kind === k)?.label || k).join(' + '), s.trips, s.payments, s.cost, s.paid - s.earlier, s.owed, s.earlier, '', ...e(s.cost, s.paid - s.earlier, s.owed)]));
    return out;
  }
  function yearTable(Y, measure, cur, rate) {
    const k = measure === 'people' ? 'people' : 'cost';
    const E = rate > 0 && k === 'cost';
    const out = [[k === 'cost' ? `Cost (${cur})` : 'People', ...Y.months.map(x => MON[+x.slice(5, 7) - 1]), 'Total', ...(E ? ['Total (EUR)'] : [])]];
    Y.rows.forEach(r => out.push([r.label, ...r[k].map(v => v == null ? '' : v), r.total[k], ...(E ? [eur(r.total.cost, rate)] : [])]));
    out.push(['Total', ...Y.totals[k], Y.totals.all[k], ...(E ? [eur(Y.totals.all.cost, rate)] : [])]);
    return out;
  }

  return { period, shift, lastYear, periodName, classify, classifyLine, serviceDate, linePeople, supplierOf, driverOf, collect, view, yearView, compare, owedNow,
    viewTable, yearTable, tripInWeek, addDays, MON, KIND_ORDER, kindOf, kindLabel, eurRate, eur, FX_RANGE, guestMoney, surferDays, perSurferDay };
});
