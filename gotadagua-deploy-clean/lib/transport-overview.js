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
  const ledgerTransport = (ledger, from, to, goLive) => (ledger || []).filter(e => e && e.type === 'expense' && e.category === 'Transport'
    && String(e.date || '') >= from && String(e.date || '') <= to && String(e.date || '') < goLive);

  // Week / Month: one row per type + a total; the ledger rows for the days before go-live.
  //   o = { trips, ledger, drivers, cfg, mode, from, to, goLive, now }
  function summary(o) {
    const goLive = o.goLive || '0000';
    const inP = o.mode === 'week' ? t => tripInWeek(t, o.from) : t => t.trip_date >= o.from && t.trip_date <= o.to;
    const list = (o.trips || []).filter(t => t && t.trip_date && !OUT.has(t.status) && t.trip_date >= goLive && inP(t));
    const by = new Map();
    list.forEach(t => {
      const c = classify(t, o.cfg);
      const r = by.get(c.key) || { ...c, trips: 0, people: 0, cost: 0, paid: 0, owed: 0, noShow: 0 };
      const price = Number(t.expected_price || 0);
      r.trips++; r.people += Number(t.pax) || 1; r.cost += price;
      if (t.payment_entry_id) r.paid += price;
      else if (t.status === 'no_show' || doneAt(t, o.now)) r.owed += price;
      if (t.status === 'no_show') r.noShow++;
      by.set(c.key, r);
    });
    const rows = sortRows(airportLabels([...by.values()], o.cfg)).map(r => ({ ...r, perPerson: r.people ? Math.round(r.cost / r.people) : 0 }));
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
    const total = { trips: sum('trips'), people: sum('people'), cost: sum('cost'), paid: sum('paid'), owed: sum('owed'), noShow: sum('noShow') };
    total.perPerson = total.people ? Math.round(total.cost / total.people) : 0;
    // Before go-live: what was paid, per supplier.
    const lines = ledgerTransport(o.ledger, o.from, o.to, goLive);
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
    ledgerTransport(o.ledger, `${y}-01-01`, `${y}-12-31`, goLive).forEach(e => {
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
    return { year: y, months, rows, totals, fromPayments };
  }

  const GROUP_LABEL = (cfg, g) => ({ arr: 'Airport', dep: 'Airport', runs: (cfg && cfg.vanRates) ? 'Van runs' : 'Tuk-tuk runs', tours: 'Tours', other: 'Other', ledger: 'From payments — no trip list' })[g] || g;

  // The view as a table (header + rows), for the CSV: exactly the numbers shown.
  function summaryTable(s, cur) {
    const out = [['Type', 'Group', 'Trips', 'People', `Cost (${cur})`, `Paid (${cur})`, `Owed (${cur})`, `Cost per person (${cur})`, 'No-show']];
    s.rows.forEach(r => out.push([r.label, r.group === 'arr' || r.group === 'dep' ? 'Airport' : r.group === 'runs' ? 'Runs' : r.group === 'tours' ? 'Tours' : 'Other', r.trips, r.people, r.cost, r.paid, r.owed, r.perPerson, r.noShow]));
    if (s.rows.length) out.push(['Total', '', s.total.trips, s.total.people, s.total.cost, s.total.paid, s.total.owed, s.total.perPerson, s.total.noShow]);
    s.ledger.rows.forEach(r => out.push([r.label, 'From payments — no trip list', `${r.payments} payment${r.payments === 1 ? '' : 's'}`, '', r.cost, r.cost, '', '', '']));
    return out;
  }
  function yearTable(m, measure, cur) {
    const k = measure === 'people' ? 'people' : 'cost';
    const out = [['Type', ...m.months.map(x => MON[+x.slice(5, 7) - 1]), 'Total']];
    m.rows.forEach(r => out.push([r.src === 'ledger' ? `${r.label} (from payments)` : r.label, ...r[k].map(v => v == null ? '' : v), r.total[k] == null ? '' : r.total[k]]));
    out.push(['Total', ...m.totals[k], m.totals.all[k]]);
    out[0][0] = k === 'cost' ? `Cost (${cur})` : 'People';
    return out;
  }

  return { period, shift, classify, summary, yearMatrix, supplierOf, summaryTable, yearTable, tripInWeek, addDays, GROUP_LABEL, MON };
});
