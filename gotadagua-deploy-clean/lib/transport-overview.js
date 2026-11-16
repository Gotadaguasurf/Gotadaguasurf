// Transport → Overview (16 Nov 2026, Miguel: «ver o overview por semana e mês e ano para os diferentes tipos de
// transportes para poder analisar»). Pure functions, no DOM and no Supabase: the camp hub (camp-hub/transport.js)
// and the Node tests load the same file.
//
// Rows = transport types, in this order:
//   arr     Airport arrivals   (one row per airport when the trips name more than one: «Arrivals · Agadir»)
//   dep     Airport departures (the same)
//   runs    van / tuk-tuk runs by route (Morocco: the CampConfig vanRates label, «Surf Taghazout»…)
//   tours   tours by tour (Dunes, Paradise Valley, Paradise + Souk, Souk…)
//   other   anything else
// Columns: trips, people (sum of pax), cost (sum of expected_price), paid (payment_entry_id set), owed (done or
// no-show, not paid), cost per person. Cancelled and merged trips are left out; a no-show counts (providers bill it).
//
// Before the trip list existed (trip_date < the camp's go-live) there are no trips to count: those days show the
// ledger's Transport expenses instead, one row per supplier (a camp_drivers name or alias in the description, the
// rest «Other transport»), marked «from payments — no trip list».
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransportOverview = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const GROUPS = ['arr', 'dep', 'runs', 'tours', 'other', 'ledger'];
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

  // The type of a trip: { group, key, label, order }.
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
  // «Arrivals · Agadir» only when the trips shown name more than one airport.
  function airportLabels(rows, cfg) {
    ['arr', 'dep'].forEach(g => {
      const xs = rows.filter(r => r.group === g); const head = g === 'arr' ? 'Arrivals' : 'Departures';
      xs.forEach(r => { r.label = xs.length > 1 ? `${head} · ${((cfg || {}).airportCity || {})[r.place] || r.place || '?'}` : head; });
    });
    return rows;
  }
  const sortRows = rows => rows.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order || String(a.label).localeCompare(String(b.label)));

  // Supplier of a ledger line: a driver's name or alias in its description (contacts only are not suppliers).
  function supplierOf(e, drivers) {
    const text = String(e.description || '').toLowerCase();
    const d = (drivers || []).find(x => x && !((x.kinds || []).length === 1 && x.kinds[0] === 'contact')
      && [x.name, ...(x.aliases || [])].some(a => a && text.includes(String(a).toLowerCase())));
    return d ? d.name : 'Other transport';
  }
  // The ledger's Transport payments that pay no trip of the app, in the month they were paid (QA 16 Nov 2026): before
  // go-live every Transport expense (there is no trip list); after it, a payment to a named driver that is linked to no
  // trip (e.g. Morocco's October transfers for September). A linked payment is already counted as its trips' «Paid».
  //   linked = the entry ids linked to trips (camp_transport_payments + trips' payment_entry_id); drivers name the supplier.
  const ledgerTransport = (ledger, from, to, goLive, linked, drivers) => {
    const L = linked instanceof Set ? linked : new Set(linked || []);
    return (ledger || []).filter(e => e && e.type === 'expense' && e.category === 'Transport' && String(e.date || '') >= from && String(e.date || '') <= to
      && (String(e.date || '') < goLive || (linked && !L.has(e.id) && supplierOf(e, drivers) !== 'Other transport')));
  };
  // Owed = done (date and time passed), not paid, not a no-show — the rule of «Owed to drivers» (transport.js
  // reconcileStatus); the page passes its own function as o.isOwed so both can never disagree.
  const owedDefault = (t, now) => !t.payment_entry_id && t.status !== 'no_show' && doneAt(t, now);
  const owedOf = o => typeof o.isOwed === 'function' ? o.isOwed : (t => owedDefault(t, o.now));

  // Week / Month: one row per type + a total; the ledger rows for the days before go-live.
  //   o = { trips, ledger, drivers, cfg, mode, from, to, goLive, now }
  function summary(o) {
    const goLive = o.goLive || '0000';
    const inP = o.mode === 'week' ? t => tripInWeek(t, o.from) : t => t.trip_date >= o.from && t.trip_date <= o.to;
    const list = (o.trips || []).filter(t => t && t.trip_date && !OUT.has(t.status) && t.trip_date >= goLive && inP(t));
    const isOwed = owedOf(o);
    const by = new Map();
    list.forEach(t => {
      const c = classify(t, o.cfg);
      const r = by.get(c.key) || { ...c, trips: 0, people: 0, cost: 0, paid: 0, owed: 0, noShow: 0 };
      const price = Number(t.expected_price || 0);
      r.trips++; r.people += Number(t.pax) || 1; r.cost += price;
      if (t.payment_entry_id) r.paid += price;
      else if (isOwed(t)) r.owed += price;
      if (t.status === 'no_show') r.noShow++;
      by.set(c.key, r);
    });
    const rows = sortRows(airportLabels([...by.values()], o.cfg)).map(r => ({ ...r, perPerson: r.people ? Math.round(r.cost / r.people) : 0 }));
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
    const total = { trips: sum('trips'), people: sum('people'), cost: sum('cost'), paid: sum('paid'), owed: sum('owed'), noShow: sum('noShow') };
    total.perPerson = total.people ? Math.round(total.cost / total.people) : 0;
    // Before go-live: what was paid, per supplier.
    const lines = ledgerTransport(o.ledger, o.from, o.to, goLive, o.linked, o.drivers);
    const lby = new Map();
    lines.forEach(e => { const s = supplierOf(e, o.drivers); const x = lby.get(s) || { label: s, payments: 0, cost: 0 }; x.payments++; x.cost += Number(e.amountLocal || 0); lby.set(s, x); });
    const ledgerRows = [...lby.values()].sort((a, b) => (a.label === 'Other transport') - (b.label === 'Other transport') || b.cost - a.cost);
    return { rows, total, ledger: { rows: ledgerRows, total: ledgerRows.reduce((s, r) => s + r.cost, 0), payments: lines.length }, beforeGoLive: o.from < goLive };
  }

  // Year: type × month for cost and people (+ row and column totals). Ledger supplier rows for the months before go-live.
  //   o = { trips, ledger, drivers, cfg, year, goLive }
  function yearMatrix(o) {
    const y = String(o.year); const goLive = o.goLive || '0000';
    const months = MON.map((m, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const by = new Map();
    const cell = (key, base) => { if (!by.has(key)) by.set(key, { ...base, cost: months.map(() => 0), people: months.map(() => 0) }); return by.get(key); };
    (o.trips || []).filter(t => t && t.trip_date && t.trip_date.slice(0, 4) === y && !OUT.has(t.status) && t.trip_date >= goLive).forEach(t => {
      const c = classify(t, o.cfg); const r = cell(c.key, { ...c, src: 'trips' }); const i = +t.trip_date.slice(5, 7) - 1;
      r.cost[i] += Number(t.expected_price || 0); r.people[i] += Number(t.pax) || 1;
    });
    ledgerTransport(o.ledger, `${y}-01-01`, `${y}-12-31`, goLive, o.linked, o.drivers).forEach(e => {
      const s = supplierOf(e, o.drivers); const r = cell('ledger:' + s, { group: 'ledger', key: 'ledger:' + s, label: s, order: s === 'Other transport' ? 1 : 0, src: 'ledger' }); const i = +String(e.date).slice(5, 7) - 1;
      r.cost[i] += Number(e.amountLocal || 0); r.people[i] = null;
    });
    const rows = sortRows(airportLabels([...by.values()], o.cfg)).map(r => ({ ...r, people: r.src === 'ledger' ? months.map(() => null) : r.people,
      total: { cost: r.cost.reduce((s, n) => s + n, 0), people: r.src === 'ledger' ? null : r.people.reduce((s, n) => s + n, 0) } }));
    const col = k => months.map((m, i) => rows.reduce((s, r) => s + (r[k][i] || 0), 0));
    const totals = { cost: col('cost'), people: col('people') };
    totals.all = { cost: totals.cost.reduce((s, n) => s + n, 0), people: totals.people.reduce((s, n) => s + n, 0) };
    // A month before go-live (entirely or partly) has no trip list for those days.
    const fromPayments = months.map(m => `${m}-01` < goLive);
    // (after go-live a month may still hold payments that pay no trip: their rows say «(from payments)» in the CSV)
    return { year: y, months, rows, totals, fromPayments };
  }

  const GROUP_LABEL = (cfg, g) => ({ arr: 'Airport', dep: 'Airport', runs: (cfg && cfg.vanRates) ? 'Surf vans' : 'Tuk-tuk runs', tours: 'Tours', other: 'Other', ledger: 'From payments — no trip list' })[g] || g;

  // ── 16 Nov 2026 UX pass (Miguel: «o Overview pode ser melhor e parece confuso ainda»): the period's big numbers,
  // one table by KIND of transport (Airport / Surf vans / Tours / Tuk-tuks — the pills of the page), one by driver,
  // and every amount also in euros so the size is clear.

  // The kind of a summary row = the page's pill: airport | vans (Morocco runs) | tuktuk (Sri Lanka runs) | tours | other.
  const KIND_ORDER = ['airport', 'vans', 'tuktuk', 'tours', 'other', 'ledger'];
  function kindOf(group, cfg) { return group === 'arr' || group === 'dep' ? 'airport' : group === 'runs' ? ((cfg && cfg.vanRates) ? 'vans' : 'tuktuk') : group === 'tours' ? 'tours' : group === 'ledger' ? 'ledger' : 'other'; }
  function kindLabel(kind, cfg) {
    const tab = ((cfg && cfg.transportTabs) || []).find(x => x.key === kind);
    if (tab) return tab.label;
    return { airport: 'Airport', vans: 'Surf vans', tuktuk: 'Tuk-tuks', tours: (cfg && cfg.vanRates) ? 'Tours' : 'Tours (tuk-tuk)', other: 'Other', ledger: 'Payments with no trip list' }[kind] || kind;
  }
  // summary() rows folded into one row per kind; `parts` = the detail under it («Arrivals 11 · Departures 7»).
  function byKind(s, cfg) {
    const by = new Map();
    s.rows.forEach(r => {
      const k = kindOf(r.group, cfg);
      const x = by.get(k) || { kind: k, label: kindLabel(k, cfg), trips: 0, people: 0, cost: 0, paid: 0, owed: 0, noShow: 0, parts: [] };
      x.trips += r.trips; x.people += r.people; x.cost += r.cost; x.paid += r.paid; x.owed += r.owed; x.noShow += r.noShow;
      // Airport: «Arrivals 13 · Departures 13» (the airports are in the CSV); runs and tours: one part per route.
      const pl = k === 'airport' ? (r.group === 'dep' ? 'Departures' : 'Arrivals') : r.label; const p = x.parts.find(q => q.label === pl);
      if (p) p.trips += r.trips; else x.parts.push({ label: pl, trips: r.trips });
      by.set(k, x);
    });
    if (s.ledger && s.ledger.rows.length) by.set('ledger', { kind: 'ledger', label: kindLabel('ledger', cfg), trips: 0, people: 0, cost: s.ledger.total, paid: s.ledger.total, owed: 0, noShow: 0,
      payments: s.ledger.payments, parts: s.ledger.rows.map(r => ({ label: r.label, payments: r.payments })) });
    return [...by.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)).map(x => ({ ...x, perPerson: x.people ? Math.round(x.cost / x.people) : 0 }));
  }
  // The period's big numbers: trips + the payments before the trip list (both are money spent on transport).
  function headline(s) {
    const L = (s.ledger && s.ledger.total) || 0;
    return { cost: s.total.cost + L, paid: s.total.paid + L, owed: s.total.owed, trips: s.total.trips, people: s.total.people, perPerson: s.total.perPerson, fromPayments: L, payments: (s.ledger && s.ledger.payments) || 0 };
  }
  // One row per driver for the period (same trips as summary), the payments before the trip list added to their supplier.
  //   o = summary's o + drivers
  function byDriver(o) {
    const goLive = o.goLive || '0000';
    const inP = o.mode === 'week' ? t => tripInWeek(t, o.from) : t => t.trip_date >= o.from && t.trip_date <= o.to;
    const name = id => { const d = (o.drivers || []).find(x => x && x.id === id); return d ? d.name : 'No driver'; };
    const isOwed = owedOf(o);
    const by = new Map();
    const row = label => { if (!by.has(label)) by.set(label, { label, trips: 0, people: 0, cost: 0, paid: 0, owed: 0, payments: 0 }); return by.get(label); };
    (o.trips || []).filter(t => t && t.trip_date && !OUT.has(t.status) && t.trip_date >= goLive && inP(t)).forEach(t => {
      const r = row(name(t.driver_id)); const price = Number(t.expected_price || 0);
      r.trips++; r.people += Number(t.pax) || 1; r.cost += price;
      if (t.payment_entry_id) r.paid += price; else if (isOwed(t)) r.owed += price;
    });
    ledgerTransport(o.ledger, o.from, o.to, goLive, o.linked, o.drivers).forEach(e => { const r = row(supplierOf(e, o.drivers)); const v = Number(e.amountLocal || 0); r.cost += v; r.paid += v; r.payments++; });
    return [...by.values()].sort((a, b) => (a.label === 'Other transport') - (b.label === 'Other transport') || (a.label === 'No driver') - (b.label === 'No driver') || b.cost - a.cost);
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

  // The view as a table (header + rows), for the CSV: exactly the numbers shown; the euros last (rate given).
  function summaryTable(s, cur, rate) {
    const E = rate > 0;
    const out = [['Type', 'Group', 'Trips', 'People', `Cost (${cur})`, `Paid (${cur})`, `Owed (${cur})`, `Cost per person (${cur})`, 'No-show', ...(E ? ['Cost (EUR)', 'Paid (EUR)', 'Owed (EUR)'] : [])]];
    const e = (...v) => E ? v.map(x => x === '' ? '' : eur(x, rate)) : [];
    s.rows.forEach(r => out.push([r.label, r.group === 'arr' || r.group === 'dep' ? 'Airport' : r.group === 'runs' ? 'Runs' : r.group === 'tours' ? 'Tours' : 'Other', r.trips, r.people, r.cost, r.paid, r.owed, r.perPerson, r.noShow, ...e(r.cost, r.paid, r.owed)]));
    if (s.rows.length) out.push(['Total', '', s.total.trips, s.total.people, s.total.cost, s.total.paid, s.total.owed, s.total.perPerson, s.total.noShow, ...e(s.total.cost, s.total.paid, s.total.owed)]);
    s.ledger.rows.forEach(r => out.push([r.label, 'From payments — no trip list', `${r.payments} payment${r.payments === 1 ? '' : 's'}`, '', r.cost, r.cost, '', '', '', ...e(r.cost, r.cost, '')]));
    return out;
  }
  function yearTable(m, measure, cur, rate) {
    const k = measure === 'people' ? 'people' : 'cost';
    const E = rate > 0 && k === 'cost';
    const out = [['Type', ...m.months.map(x => MON[+x.slice(5, 7) - 1]), 'Total', ...(E ? ['Total (EUR)'] : [])]];
    m.rows.forEach(r => out.push([r.src === 'ledger' ? `${r.label} (from payments)` : r.label, ...r[k].map(v => v == null ? '' : v), r.total[k] == null ? '' : r.total[k], ...(E ? [eur(r.total.cost, rate)] : [])]));
    out.push(['Total', ...m.totals[k], m.totals.all[k], ...(E ? [eur(m.totals.all.cost, rate)] : [])]);
    out[0][0] = k === 'cost' ? `Cost (${cur})` : 'People';
    return out;
  }

  return { period, shift, classify, summary, yearMatrix, supplierOf, summaryTable, yearTable, tripInWeek, addDays, GROUP_LABEL, MON, byKind, kindOf, kindLabel, headline, byDriver, eurRate, eur, FX_RANGE };
});
