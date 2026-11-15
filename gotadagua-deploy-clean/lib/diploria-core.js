// Dipløria business area — the maths behind /diploria/ (15 Nov 2026). Pure functions, no DOM, no Supabase:
// the page and the Node tests run the same code.
//
//   stock(catalog, items, locations, moves)   per camp, per SKU (catalog name): initial, moves, stock, sold, left
//       stock = Σ moves (supabase/diploria-stock.sql keeps catalog stock_qty equal to it, so the Camp Tab's
//               «N left» = stock_qty − its lines = the same number); before a SKU's first move: stock_qty
//       sold  = the Camp Tab lines with that exact name (one line = one short, like the tab counts)
//   acrossCamps / alerts / transferTargets
//   sales(items, guests, locations)           one row per Diploria Camp Tab line, newest first
//   inPeriod / periodRange / totals / groupBy / byDay / overview / expenseTotals / margin
//
// Camps appear only when they have Diploria catalog rows (today Portugal and Sri Lanka; no empty Morocco).
// How each camp sells (Miguel, 15 Nov 2026):
//   pass  Sri Lanka: the guest pays the Dipløria owner by card, 55 € («Card → Dipløria»), not camp money
//   camp  Portugal: sold by the camp, booked as camp income (65 €, «Size 28…34»); the money sits in the
//         camp's ledger, not the Dipløria account
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiploriaCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CAMP_MODE = { 'sri-lanka': 'pass', portugal: 'camp' };
  const MODE_LABEL = { pass: 'Card → Dipløria', camp: 'sold by the camp' };
  const MODE_LONG = { pass: 'Pass-through: paid by card to Dipløria (EUR)', camp: 'Sold by the camp: camp income, in the camp ledger' };
  const SIZES = ['28', '30', '31', '32', '33', '34'];
  const PASS_METHOD = 'Card → Dipløria';
  const NO_MODEL = 'All models (sizes only)';
  const KIND_LABEL = { initial: 'Opening stock', sent: 'Received', returned: 'Returned to Dipløria', transfer_out: 'Moved out', transfer_in: 'Moved in', correction: 'Correction', sold_outside: 'Sold outside the tab' };
  const EXPENSE_CATS = [['production', 'Production'], ['shipping', 'Shipping to camps'], ['marketing', 'Marketing'], ['samples', 'Samples'], ['fees', 'Fees & bank'], ['other', 'Other']];
  const modeOf = slug => CAMP_MODE[slug] || 'camp';
  const r2 = n => Math.round(Number(n || 0) * 100) / 100;

  // «Core Black 32» → { model: 'Core Black', size: '32' }; Portugal's «Size 30» → { model: '', size: '30' } (sizes only).
  function parseSku(name) {
    const m = String(name || '').trim().match(/^(.*\S)\s+(\d{2})$/);
    if (!m) return { model: String(name || '').trim(), size: '' };
    return { model: /^size$/i.test(m[1]) ? '' : m[1], size: m[2] };
  }
  const norm = s => String(s || '').trim().toLowerCase();
  const key = (loc, name) => `${loc}\u0000${norm(name)}`;
  function meta(i) { if (!i || !i.meta) return {}; if (typeof i.meta === 'object') return i.meta; try { return JSON.parse(i.meta) || {}; } catch (_) { return {}; } }

  function stock(catalog, items, locations, moves) {
    const locs = new Map((locations || []).map(l => [l.id, l]));
    const sold = new Map();
    (items || []).filter(i => i && i.category === 'Diploria').forEach(i => { const k = key(i.location_id, i.item_name); sold.set(k, (sold.get(k) || 0) + 1); });
    const mv = new Map();
    (moves || []).forEach(m => { const k = key(m.location_id, m.sku); if (!mv.has(k)) mv.set(k, []); mv.get(k).push(m); });
    const byCamp = new Map(); const seen = new Set();
    (catalog || []).filter(r => r && r.category === 'Diploria').sort((a, b) => (b.active !== false) - (a.active !== false)).forEach(r => {
      const k = key(r.location_id, r.name); if (seen.has(k)) return; seen.add(k);
      if (r.active === false && !(mv.get(k) || []).length && !sold.get(k)) return;
      const l = locs.get(r.location_id) || { id: r.location_id, slug: '?', name: 'Unknown camp' };
      if (!byCamp.has(l.id)) byCamp.set(l.id, { id: l.id, slug: l.slug, name: l.name, mode: modeOf(l.slug), rows: [] });
      const p = parseSku(r.name); const list = (mv.get(k) || []).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      const catalogQty = r.stock_qty == null ? 0 : Number(r.stock_qty);
      const hasMoves = list.length > 0;
      const initial = hasMoves ? list.filter(m => m.kind === 'initial').reduce((s, m) => s + Number(m.qty || 0), 0) : catalogQty;
      const adjust = hasMoves ? list.filter(m => m.kind !== 'initial').reduce((s, m) => s + Number(m.qty || 0), 0) : 0;
      const onHand = Math.max(0, initial + adjust);
      const s = sold.get(k) || 0;
      byCamp.get(l.id).rows.push({ sku: String(r.name).trim(), model: p.model, size: p.size, initial, moves: adjust, stock: onHand, sold: s, left: Math.max(0, onHand - s),
        catalogQty, drift: hasMoves && catalogQty !== onHand, hasMoves, history: list,
        price: Number(r.sell_price || 0), currency: r.sell_currency || r.currency || '', sort: Number(r.sort_order || 0), catalogId: r.id });
    });
    return [...byCamp.values()].map(c => {
      c.rows.sort((a, b) => a.sort - b.sort || a.sku.localeCompare(b.sku));
      const models = [];
      c.rows.forEach(r => {
        let m = models.find(x => x.model === r.model);
        if (!m) { m = { model: r.model, sizes: {}, initial: 0, moves: 0, stock: 0, sold: 0, left: 0 }; models.push(m); }
        m.sizes[r.size] = r;
        ['initial', 'moves', 'stock', 'sold', 'left'].forEach(f => { m[f] += r[f]; });
      });
      const sum = rows => rows.reduce((t, r) => ({ initial: t.initial + r.initial, moves: t.moves + r.moves, stock: t.stock + r.stock, sold: t.sold + r.sold, left: t.left + r.left }), { initial: 0, moves: 0, stock: 0, sold: 0, left: 0 });
      const bySize = SIZES.map(sz => ({ size: sz, ...sum(c.rows.filter(r => r.size === sz)) }));
      return { ...c, models, total: sum(c.rows), bySize, sizesOnly: c.rows.every(r => !r.model) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function acrossCamps(byCamp) {
    const models = new Map(); const sizes = new Map(SIZES.map(s => [s, { size: s, stock: 0, sold: 0, left: 0 }]));
    (byCamp || []).forEach(c => c.rows.forEach(r => {
      const m = r.model || NO_MODEL;
      const x = models.get(m) || { model: m, stock: 0, sold: 0, left: 0, camps: new Set() };
      x.stock += r.stock; x.sold += r.sold; x.left += r.left; x.camps.add(c.name); models.set(m, x);
      if (sizes.has(r.size)) { const y = sizes.get(r.size); y.stock += r.stock; y.sold += r.sold; y.left += r.left; }
    }));
    const total = [...sizes.values()].reduce((t, s) => ({ stock: t.stock + s.stock, sold: t.sold + s.sold, left: t.left + s.left }), { stock: 0, sold: 0, left: 0 });
    return { models: [...models.values()].map(x => ({ ...x, camps: [...x.camps].sort() })), sizes: [...sizes.values()], total };
  }

  function alerts(byCamp) {
    const out = [];
    (byCamp || []).forEach(c => c.rows.forEach(r => { if (r.left <= 1) out.push({ camp: c.name, slug: c.slug, sku: r.sku, left: r.left }); }));
    return out.sort((a, b) => a.left - b.left || a.camp.localeCompare(b.camp) || a.sku.localeCompare(b.sku));
  }

  // Where a short can be moved: every other camp, landing on the same name if that camp has it, else on its
  // «Size NN» row (sizes-only camp), else on the same model × size (the server creates it). A sizes-only short
  // going to a camp that sells by model has to pick one of that camp's models in the same size.
  function transferTargets(byCamp, fromCampId, row) {
    return (byCamp || []).filter(c => c.id !== fromCampId).map(c => {
      const same = c.rows.find(r => norm(r.sku) === norm(row.sku));
      const sizeRow = c.rows.find(r => !r.model && r.size === row.size);
      let options;
      if (same) options = [same.sku];
      else if (sizeRow) options = [sizeRow.sku];
      else if (row.model) options = [`${row.model} ${row.size}`];
      else options = c.rows.filter(r => r.size === row.size).map(r => r.sku);
      return { campId: c.id, camp: c.name, slug: c.slug, options, isNew: !same && !sizeRow && !!row.model };
    }).filter(t => t.options.length);
  }

  function sales(items, guests, locations) {
    const locs = new Map((locations || []).map(l => [l.id, l])); const names = new Map((guests || []).map(g => [g.id, g]));
    return (items || []).filter(i => i && i.category === 'Diploria').map(i => {
      const l = locs.get(i.location_id) || { slug: '?', name: 'Unknown camp' }; const mode = modeOf(l.slug); const p = parseSku(i.item_name);
      // added_at is the camp's own day and time stored as if UTC (the Camp Tab writes item.d + 'T' + time + 'Z'): slice, never convert.
      const date = String(i.added_at || '').slice(0, 10); const paid = !!i.paid_at; const g = names.get(i.guest_id);
      return { id: i.id, date, month: date.slice(0, 7), time: String(i.added_at || '').slice(11, 16), camp: l.name, campSlug: l.slug, mode,
        guest: g ? g.name : '(guest)', staff: !!(g && g.is_staff),
        sku: String(i.item_name || '').trim(), model: p.model || NO_MODEL, size: p.size, price: Number(i.price_local || 0), currency: String(i.currency || '').toUpperCase() || '?',
        paid, paidAt: paid ? String(i.paid_at).slice(0, 10) : '',
        method: paid ? (mode === 'pass' ? (meta(i).payMethod || PASS_METHOD) : (meta(i).payMethod || MODE_LABEL.camp)) : '',
        bookedAs: mode === 'pass' ? 'Dipløria account' : 'sold by the camp (camp income)' };
    }).sort((a, b) => (b.date + b.time + b.camp + b.guest).localeCompare(a.date + a.time + a.camp + a.guest));
  }

  // Periods: 'week' (Monday–Sunday of today), 'month', 'all', or { from, to } (inclusive ISO dates).
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function periodRange(kind, today, custom) {
    const t = today instanceof Date ? today : new Date(String(today) + 'T12:00:00');
    if (kind === 'week') { const a = new Date(t); a.setDate(t.getDate() - ((t.getDay() + 6) % 7)); const b = new Date(a); b.setDate(a.getDate() + 6); return { from: iso(a), to: iso(b) }; }
    if (kind === 'month') { const a = new Date(t.getFullYear(), t.getMonth(), 1), b = new Date(t.getFullYear(), t.getMonth() + 1, 0); return { from: iso(a), to: iso(b) }; }
    if (kind === 'custom' && custom) return { from: custom.from || '', to: custom.to || '' };
    return { from: '', to: '' };
  }
  const inRange = (d, r) => (!r || ((!r.from || d >= r.from) && (!r.to || d <= r.to)));
  function filterSales(rows, { range, month, camp, day } = {}) {
    return (rows || []).filter(r => inRange(r.date, range) && (!month || month === 'all' || r.month === month) && (!camp || camp === 'all' || r.campSlug === camp) && (!day || r.date === day));
  }

  function totals(rows) {
    const eur = (rows || []).filter(r => r.currency === 'EUR');
    const sum = list => r2(list.reduce((s, r) => s + r.price, 0));
    return { units: (rows || []).length, sold: sum(eur), paid: sum(eur.filter(r => r.paid)), unpaid: sum(eur.filter(r => !r.paid)),
      passSold: sum(eur.filter(r => r.mode === 'pass')), campSold: sum(eur.filter(r => r.mode === 'camp')),
      otherCurrency: (rows || []).filter(r => r.currency !== 'EUR') };
  }
  function groupBy(rows, k) {
    const m = new Map();
    (rows || []).forEach(r => { const g = r[k]; if (!m.has(g)) m.set(g, []); m.get(g).push(r); });
    const out = [...m.entries()].map(([g, list]) => ({ key: g, ...totals(list) }));
    return k === 'month' || k === 'date' ? out.sort((a, b) => String(b.key).localeCompare(String(a.key))) : out.sort((a, b) => b.units - a.units || String(a.key).localeCompare(String(b.key)));
  }
  // Shorts sold per day, oldest → newest, every day of the range filled (so the bars show the quiet days too).
  function byDay(rows, range) {
    const m = new Map();
    (rows || []).forEach(r => { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date).push(r); });
    let days = [...m.keys()].sort();
    const from = (range && range.from) || days[0], to = (range && range.to) || days[days.length - 1];
    if (from && to && from <= to) {
      const span = []; const d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
      for (let i = 0; d <= end && i < 400; i++) { span.push(iso(d)); d.setDate(d.getDate() + 1); }
      if (span.length <= 62) days = span;
    }
    return days.map(date => { const list = m.get(date) || []; const perCamp = {}; list.forEach(r => { perCamp[r.campSlug] = (perCamp[r.campSlug] || 0) + 1; });
      return { date, units: list.length, perCamp, ...totals(list) }; });
  }
  const top = (rows, k, n) => groupBy(rows, k).slice(0, n || 3).map(g => ({ key: g.key, units: g.units }));
  // One card per camp + «All camps»: units and € sold in the period, top models and sizes, unpaid, stock left now.
  function overview(byCamp, saleRows) {
    const camps = (byCamp || []).map(c => { const list = (saleRows || []).filter(r => r.campSlug === c.slug); const t = totals(list);
      return { id: c.id, slug: c.slug, name: c.name, mode: c.mode, ...t, topModels: top(list, 'model'), topSizes: top(list, 'size'), left: c.total.left, stock: c.total.stock }; });
    const t = totals(saleRows || []);
    return { camps, all: { name: 'All camps', ...t, topModels: top(saleRows || [], 'model'), topSizes: top(saleRows || [], 'size'),
      left: camps.reduce((s, c) => s + c.left, 0), stock: camps.reduce((s, c) => s + c.stock, 0) } };
  }

  function expenseRows(expenses, range) { return (expenses || []).filter(e => !e.deleted_at && inRange(String(e.expense_date || ''), range)); }
  function expenseTotals(expenses) {
    const live = (expenses || []).filter(e => !e.deleted_at);
    const eur = live.filter(e => String(e.currency || 'EUR').toUpperCase() === 'EUR');
    const byCat = EXPENSE_CATS.map(([k, label]) => ({ key: k, label, amount: r2(eur.filter(e => (e.category || 'other') === k).reduce((s, e) => s + Number(e.amount || 0), 0)) })).filter(x => x.amount);
    return { count: live.length, eur: r2(eur.reduce((s, e) => s + Number(e.amount || 0), 0)), byCat, otherCurrency: live.filter(e => String(e.currency || 'EUR').toUpperCase() !== 'EUR') };
  }
  // Sales − expenses. Portugal's sales are camp income (they sit in the camp's ledger), so the margin is shown
  // twice and labelled: on the Dipløria account (Sri Lanka pass-through only) and counting the camps' sales too.
  function margin(saleRows, expenses) {
    const t = totals(saleRows), x = expenseTotals(expenses);
    return { accountSales: t.passSold, campSales: t.campSold, sold: t.sold, expenses: x.eur, onAccount: r2(t.passSold - x.eur), withCamps: r2(t.sold - x.eur), byCat: x.byCat, otherCurrency: x.otherCurrency, unpaid: t.unpaid };
  }

  return { CAMP_MODE, MODE_LABEL, MODE_LONG, SIZES, PASS_METHOD, NO_MODEL, KIND_LABEL, EXPENSE_CATS, modeOf, parseSku, stock, acrossCamps, alerts, transferTargets,
    sales, periodRange, filterSales, totals, groupBy, byDay, overview, expenseRows, expenseTotals, margin };
});
