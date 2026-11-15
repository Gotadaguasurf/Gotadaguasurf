// Dipløria business area /diploria/ (15 Nov 2026) — stubbed Supabase, the real catalog shapes:
// Sri Lanka 38 SKUs / 61 units at 55 EUR (pass-through, «Card → Dipløria»), Portugal «Size 28…34» / 42 at 65 EUR
// (paid to the camp and held for Dipløria — not camp income — since 15 Nov 2026). Guest names are invented.
//
// Miguel: «a ideia é ter Dipløria em todos os camps a vender (cada um com o seu stock), mas depois ter uma área como
// temos o HQ mas para a Dipløria» + «uma overview por camp do que se vende … as despesas, quanto stock metemos por
// localização (ajustável desta parte) e ver em que dias os calções foram vendidos».
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');
const D = require('../lib/diploria-core.js');

const LOC_SL = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const LOC_PT = '380ae05e-7f8e-4ee5-b37b-e7d85903a397';
const LOC_MA = 'a1b2c3d4-0000-4000-8000-00000000ma01';
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
const SHOTS = path.join(__dirname, '..', 'test-results', 'diploria-area-shots');
const STOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sl-diploria-stock.json'), 'utf8'));
const LOCATIONS = [{ id: LOC_SL, slug: 'sri-lanka', name: 'Sri Lanka' }, { id: LOC_PT, slug: 'portugal', name: 'Portugal' }, { id: LOC_MA, slug: 'morocco', name: 'Morocco' }];
const uid = (n) => `0000d1a0-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Catalog as in production on 15 Nov (Retro 32 kept at 0).
const SL_SKUS = STOCK.models.flatMap((x, mi) => x.qty.map((q, si) => ({ name: `${x.model} ${STOCK.sizes[si]}`, qty: x.model === 'Retro' && si === 3 ? 0 : q, keep: q > 0, sort: 8000 + mi * 10 + si }))).filter(s => s.keep);
const CATALOG = [
  ...SL_SKUS.map((s, i) => ({ id: uid(100 + i), location_id: LOC_SL, name: s.name, category: 'Diploria', stock_qty: s.qty, sell_price: 55, sell_currency: 'EUR', currency: 'EUR', sort_order: s.sort, active: true })),
  ...['28', '30', '31', '32', '33', '34'].map((sz, i) => ({ id: uid(200 + i), location_id: LOC_PT, name: `Size ${sz}`, category: 'Diploria', stock_qty: [9, 15, 9, 4, 3, 2][i], sell_price: 65, sell_currency: 'EUR', currency: 'EUR', sort_order: 4010 + i * 10, active: true })),
  { id: uid(300), location_id: LOC_MA, name: 'T-Shirt M', category: 'Merch', stock_qty: 10, sell_price: 200, currency: 'MAD', sort_order: 1, active: true },
];
// Opening moves (= diploria-stock.sql's seed) + a few moves made from /diploria/.
const MOVES = [
  ...CATALOG.filter(c => c.category === 'Diploria').map((c, i) => ({ id: uid(400 + i), location_id: c.location_id, sku: c.name, qty: c.stock_qty, kind: 'initial', note: 'Opening stock', transfer_id: null, created_at: '2026-11-15T08:00:00Z' })),
  { id: uid(500), location_id: LOC_SL, sku: 'Core Black 30', qty: 2, kind: 'sent', note: 'Box from Lisbon', transfer_id: null, created_at: '2026-11-15T09:00:00Z' },
  { id: uid(501), location_id: LOC_SL, sku: 'Core Burgundy 31', qty: -1, kind: 'correction', note: 'Recount', transfer_id: null, created_at: '2026-11-15T09:05:00Z' },
  { id: uid(502), location_id: LOC_PT, sku: 'Size 30', qty: 3, kind: 'sent', note: null, transfer_id: null, created_at: '2026-11-15T09:10:00Z' },
];
const onHand = (loc, sku) => MOVES.filter(m => m.location_id === loc && m.sku.toLowerCase() === sku.toLowerCase()).reduce((s, m) => s + m.qty, 0);
const CATALOG_NOW = CATALOG.map(c => c.category === 'Diploria' ? { ...c, stock_qty: onHand(c.location_id, c.name) } : c);   // what the guard trigger keeps in stock_qty
const GUESTS = [
  { id: uid(600), location_id: LOC_SL, week_id: WEEK, name: 'Ana Test', is_staff: false },
  { id: uid(601), location_id: LOC_SL, week_id: WEEK, name: 'Staff Test', is_staff: true },
  { id: uid(602), location_id: LOC_PT, week_id: null, name: 'Pedro Test', is_staff: false },
  { id: uid(603), location_id: LOC_PT, week_id: null, name: 'Marta Test', is_staff: false },
];
const item = (n, loc, g, name, price, at, paid, extra) => ({ id: uid(700 + n), location_id: loc, guest_id: g, week_id: loc === LOC_SL ? WEEK : null, category: 'Diploria', item_name: name, qty: 1,
  price_local: price, currency: 'EUR', added_at: at, paid_at: paid, sort_order: (n + 1) * 10, price_type: null, meta: extra || {} });
const ITEMS = [
  // Portugal: the four real-shape lines (three under the old model names, one «Size 31»)
  item(0, LOC_PT, uid(602), 'Core Army Green 32', 65, '2026-07-25T10:24:00.000Z', '2026-07-25T11:00:00.000Z'),
  item(1, LOC_PT, uid(603), 'Core Burgundy 32', 65, '2026-08-05T16:46:00.000Z', null),
  item(2, LOC_PT, uid(603), 'Pocket Brown 32', 65, '2026-08-05T16:47:00.000Z', null),
  item(3, LOC_PT, uid(602), 'Size 31', 65, '2026-11-12T08:30:00.000Z', '2026-11-12T09:00:00.000Z'),
  // Sri Lanka this week: a guest and a staff member
  item(4, LOC_SL, uid(600), 'Core Black 30', 55, '2026-11-14T18:10:00.000Z', '2026-11-14T18:12:00.000Z', { payMethod: 'Card → Dipløria' }),
  item(5, LOC_SL, uid(601), 'Core Black 30', 55, '2026-11-14T19:00:00.000Z', null),
  item(6, LOC_SL, uid(600), 'Essential Green 33', 55, '2026-11-15T09:30:00.000Z', null),
  item(7, LOC_SL, uid(600), 'Core Burgundy 31', 55, '2026-11-15T10:00:00.000Z', null),
  { ...item(8, LOC_PT, uid(602), 'T-Shirt M', 25, '2026-11-12T08:31:00.000Z', null), category: 'Merch' },
];
const EXPENSES = [
  { id: uid(800), expense_date: '2026-11-03', supplier: 'Factory Test', description: 'Batch 2: 60 shorts', category: 'production', amount: 900, currency: 'EUR', location_id: null, file_url: 'https://drive.google.com/file/d/test', note: null, created_at: '2026-11-03T10:00:00Z', deleted_at: null },
  { id: uid(801), expense_date: '2026-11-10', supplier: 'DHL Test', description: 'Box to Sri Lanka', category: 'shipping', amount: 120, currency: 'EUR', location_id: LOC_SL, file_url: null, note: null, created_at: '2026-11-10T10:00:00Z', deleted_at: null },
  { id: uid(802), expense_date: '2026-10-02', supplier: 'Old', description: 'October ads', category: 'marketing', amount: 50, currency: 'EUR', location_id: null, file_url: null, note: null, created_at: '2026-10-02T10:00:00Z', deleted_at: null },
];

const USERS = {
  owner: { id: '00000000-0000-4000-8000-000000000001', email: 'miguel@gotadaguasurf.com', role: 'super_admin', mem: [] },
  manager: { id: '00000000-0000-4000-8000-000000000002', email: 'manager@example.com', role: 'location_manager', mem: [{ slug: 'sri-lanka', can_view: true, can_edit: true }] },
  viewer: { id: '00000000-0000-4000-8000-000000000003', email: 'viewer@example.com', role: 'viewer', mem: [{ slug: 'diploria', can_view: true, can_edit: false }] },
};

// Small in-memory PostgREST: GET eq/is/in (nested «workspaces.slug» too), POST, PATCH, DELETE, rpc/diploria_stock_move.
async function stub(page, tables, who = 'owner') {
  const U = USERS[who]; const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  T.platform_profiles = [{ id: U.id, email: U.email, full_name: who, platform_role: U.role }];
  T.workspace_memberships = U.mem.map(m => ({ user_id: U.id, active: true, can_view: m.can_view, can_edit: m.can_edit, workspaces: { slug: m.slug } }));
  const ctl = { T, writes: [], rpcs: [] };
  const val = (row, k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), row);
  const match = (row, url) => [...new URL(url).searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) return true;
    const m = v.match(/^(eq|is|in)\.(.*)$/s); if (!m) return true; const x = val(row, k);
    if (m[1] === 'eq') return String(x) === m[2];
    if (m[1] === 'is') return m[2] === 'null' ? x == null : String(x) === m[2];
    return m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
  });
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json({ id: U.id, email: U.email, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/')) return json({});
    if (/\/rest\/v1\/rpc\/diploria_stock_move/.test(url)) {
      const a = JSON.parse(req.postData() || '{}'); ctl.rpcs.push(a);
      if (who !== 'owner') return json({ message: 'Not allowed: Dipløria stock is changed by the owner and the Dipløria team only.', code: '42501' }, 403);
      const moves = T.diploria_stock_moves || (T.diploria_stock_moves = []); const now = new Date().toISOString();
      const left = (loc, sku) => moves.filter(m => m.location_id === loc && m.sku.toLowerCase() === sku.toLowerCase()).reduce((s, m) => s + m.qty, 0)
        - (T.camp_tab_items || []).filter(i => i.location_id === loc && i.category === 'Diploria' && i.item_name.toLowerCase() === sku.toLowerCase()).length;
      const sync = (loc, sku) => (T.pricing_catalog || []).forEach(c => { if (c.location_id === loc && c.category === 'Diploria' && c.name.toLowerCase() === sku.toLowerCase()) c.stock_qty = moves.filter(m => m.location_id === loc && m.sku.toLowerCase() === sku.toLowerCase()).reduce((s, m) => s + m.qty, 0); });
      const delta = a.p_kind === 'sent' ? Math.abs(a.p_qty) : a.p_kind === 'correction' ? a.p_qty : -Math.abs(a.p_qty);
      if (delta < 0 && left(a.p_location_id, a.p_sku) + delta < 0) return json({ message: `«${a.p_sku}» has ${left(a.p_location_id, a.p_sku)} left at that camp: cannot take ${-delta} out.`, code: 'P0001' }, 400);
      if (a.p_kind === 'transfer') {
        const tid = 'tttt0000-0000-4000-8000-000000000001';
        if (!(T.pricing_catalog || []).some(c => c.location_id === a.p_to_location_id && c.name === a.p_to_sku)) { const src = T.pricing_catalog.find(c => c.location_id === a.p_to_location_id && c.category === 'Diploria'); T.pricing_catalog.push({ ...src, id: 'new-' + a.p_to_sku, name: a.p_to_sku, stock_qty: 0 }); moves.push({ id: 'mi-' + a.p_to_sku, location_id: a.p_to_location_id, sku: a.p_to_sku, qty: 0, kind: 'initial', note: 'New SKU', created_at: now }); }
        moves.push({ id: 'mo' + moves.length, location_id: a.p_location_id, sku: a.p_sku, qty: -Math.abs(a.p_qty), kind: 'transfer_out', note: a.p_note, transfer_id: tid, created_at: now });
        moves.push({ id: 'mo' + moves.length, location_id: a.p_to_location_id, sku: a.p_to_sku, qty: Math.abs(a.p_qty), kind: 'transfer_in', note: a.p_note, transfer_id: tid, created_at: now });
        sync(a.p_location_id, a.p_sku); sync(a.p_to_location_id, a.p_to_sku);
        return json({ ok: true, left: left(a.p_location_id, a.p_sku), to_left: left(a.p_to_location_id, a.p_to_sku), transfer_id: tid });
      }
      moves.push({ id: 'mo' + moves.length, location_id: a.p_location_id, sku: a.p_sku, qty: delta, kind: a.p_kind, note: a.p_note, transfer_id: null, created_at: now });
      sync(a.p_location_id, a.p_sku);
      return json({ ok: true, left: left(a.p_location_id, a.p_sku) });
    }
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]; if (!t) return json([]);
    if (t === 'locations' && ctl.campSlug) { const l = LOCATIONS.find(x => x.slug === ctl.campSlug); return json({ ...l, currency: l.slug === 'sri-lanka' ? 'LKR' : 'EUR', default_fx_to_eur: l.slug === 'sri-lanka' ? 340 : 1, camp_tab_mode: 'per_guest' }); }
    if (ctl.missing && ctl.missing.includes(t)) return json({ message: `relation "public.${t}" does not exist`, code: '42P01' }, 404);
    const rows = T[t] || (T[t] = []);
    if (method !== 'GET') ctl.writes.push([method, t]);
    if (method === 'GET') {
      let out = rows.filter(r => match(r, url));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json(null);
      return json(out);
    }
    if (method === 'POST') {
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      const key = (new URL(url).searchParams.get('on_conflict') || 'id').split(',');
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = r.id ? rows.findIndex(x => key.every(c => String(x[c]) === String(r[c]))) : -1; if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ id: 'new' + rows.length, created_at: new Date().toISOString(), deleted_at: null, ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') { T[t] = rows.filter(r => !match(r, url)); return json([]); }
    return json([]);
  });
  return ctl;
}
const DATA = () => ({ locations: LOCATIONS, pricing_catalog: CATALOG_NOW, camp_tab_items: ITEMS, camp_guests: GUESTS, diploria_stock_moves: MOVES, diploria_expenses: EXPENSES });
async function openArea(page, { who = 'owner', data = DATA(), missing = null, hash = '' } = {}) {
  const ctl = await stub(page, data, who); ctl.missing = missing;
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00'));
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/diploria/' + hash, { waitUntil: 'domcontentloaded' });
  return ctl;
}
const ready = page => page.waitForSelector('#ovCards [data-camp-card], .splash', { timeout: 15000 });
async function shot(page, name) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }); }
const tab = (page, id) => page.evaluate(id => showPage(id), id);
const gridLeft = (page, slug) => page.locator(`[data-stock-camp="${slug}"] .dp-cell[data-sku]`).evaluateAll(els => Object.fromEntries(els.map(e => [e.dataset.sku, Number(e.dataset.left)])));

// ── The maths, straight from lib/diploria-core.js ──────────────────────────────────────────────
test('diploria core: stock per camp = opening + moves − Camp Tab lines; Sri Lanka 61 (Retro 4, Retro 32 at 0), Portugal 42; across camps; alerts', async () => {
  const s0 = D.stock(CATALOG, [], LOCATIONS, []);
  expect(s0.map(c => [c.slug, c.total.stock, c.rows.length])).toEqual([['portugal', 42, 6], ['sri-lanka', 61, 38]]);   // Morocco has no Diploria row → not there
  const retro = s0[1].models.find(m => m.model === 'Retro');
  expect([retro.stock, retro.sizes['32'].stock, retro.sizes['32'].left]).toEqual([4, 0, 0]);
  expect(s0[0].sizesOnly).toBe(true);
  const s = D.stock(CATALOG_NOW, ITEMS, LOCATIONS, MOVES);
  const sl = s.find(c => c.slug === 'sri-lanka'), pt = s.find(c => c.slug === 'portugal');
  const cb30 = sl.rows.find(r => r.sku === 'Core Black 30');
  expect([cb30.initial, cb30.moves, cb30.stock, cb30.sold, cb30.left, cb30.drift]).toEqual([3, 2, 5, 2, 3, false]);   // the staff line counts too
  expect(sl.rows.find(r => r.sku === 'Core Burgundy 31')).toMatchObject({ initial: 3, moves: -1, stock: 2, sold: 1, left: 1 });
  expect(sl.total).toMatchObject({ initial: 61, moves: 1, stock: 62, sold: 4, left: 58 });
  // Portugal: only «Size 31» matches its catalog; the three old model names are sales, not stock
  expect(pt.rows.map(r => [r.sku, r.stock, r.sold, r.left])).toEqual([['Size 28', 9, 0, 9], ['Size 30', 18, 0, 18], ['Size 31', 9, 1, 8], ['Size 32', 4, 0, 4], ['Size 33', 3, 0, 3], ['Size 34', 2, 0, 2]]);
  const ac = D.acrossCamps(s);
  expect(ac.total).toEqual({ stock: 107, sold: 5, left: 102 });
  expect(ac.sizes.find(x => x.size === '30')).toEqual({ size: '30', stock: 18 + 22, sold: 2, left: 18 + 20 });   // SL size 30: 20 on the sheet + 2 received
  expect(ac.models.find(m => m.model === D.NO_MODEL)).toMatchObject({ stock: 45, camps: ['Portugal'] });
  const al = D.alerts(s);
  expect(al[0]).toEqual({ camp: 'Sri Lanka', slug: 'sri-lanka', sku: 'Retro 32', left: 0 });
  expect(al.every(a => a.left <= 1)).toBe(true);
  expect(al.some(a => a.sku === 'Core Burgundy 31' && a.left === 1)).toBe(true);
  // a stale catalog figure is flagged, never trusted over the moves
  const stale = D.stock(CATALOG_NOW.map(c => c.name === 'Size 30' ? { ...c, stock_qty: 15 } : c), ITEMS, LOCATIONS, MOVES).find(c => c.slug === 'portugal').rows.find(r => r.sku === 'Size 30');
  expect([stale.stock, stale.drift]).toEqual([18, true]);
  // where a short can move: same name, else the sizes-only row, else created as model × size
  expect(D.transferTargets(s, LOC_SL, cb30)).toEqual([{ campId: LOC_PT, camp: 'Portugal', slug: 'portugal', options: ['Size 30'], isNew: false }]);
  expect(D.transferTargets(s, LOC_PT, pt.rows[1])[0].options).toEqual(sl.rows.filter(r => r.size === '30').map(r => r.sku));   // sizes-only → pick a model
});

test('diploria core: sales list, totals per month / camp / model, € sold · paid · not paid; Sri Lanka pass-through, Portugal held for Dipløria; by day; one margin', async () => {
  const rows = D.sales(ITEMS, GUESTS, LOCATIONS);
  expect(rows.length).toBe(8);   // the Merch line is not Dipløria
  expect(rows[0]).toMatchObject({ date: '2026-11-15', time: '10:00', camp: 'Sri Lanka', mode: 'pass', guest: 'Ana Test', model: 'Core Burgundy', size: '31', price: 55, currency: 'EUR', paid: false, bookedAs: 'Dipløria account' });
  expect(rows.find(r => r.id === uid(704))).toMatchObject({ paid: true, paidAt: '2026-11-14', method: 'Card → Dipløria' });
  expect(rows.find(r => r.id === uid(705))).toMatchObject({ guest: 'Staff Test', staff: true });
  expect(rows.find(r => r.id === uid(700))).toMatchObject({ camp: 'Portugal', mode: 'held', method: 'paid to the camp', bookedAs: 'held by the camp for Dipløria', model: 'Core Army Green', size: '32' });
  expect(rows.find(r => r.id === uid(703))).toMatchObject({ model: D.NO_MODEL, size: '31' });
  const t = D.totals(rows);
  expect(t).toMatchObject({ units: 8, sold: 480, paid: 185, unpaid: 295, passSold: 220, heldSold: 260 });
  expect(D.groupBy(rows, 'month').map(g => [g.key, g.units, g.sold, g.paid, g.unpaid])).toEqual([['2026-11', 5, 285, 120, 165], ['2026-08', 2, 130, 0, 130], ['2026-07', 1, 65, 65, 0]]);
  expect(D.groupBy(rows, 'camp').map(g => [g.key, g.units, g.sold])).toEqual([['Portugal', 4, 260], ['Sri Lanka', 4, 220]]);
  expect(D.groupBy(rows, 'model')[0]).toMatchObject({ key: 'Core Black', units: 2, sold: 110 });
  const week = D.periodRange('week', new Date('2026-11-15T12:00:00'));
  expect(week).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  expect(D.periodRange('month', new Date('2026-11-15T12:00:00'))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  const inWeek = D.filterSales(rows, { range: week });
  expect(inWeek.length).toBe(5);
  const days = D.byDay(inWeek, week);
  expect(days.map(d => [d.date, d.units])).toEqual([['2026-11-09', 0], ['2026-11-10', 0], ['2026-11-11', 0], ['2026-11-12', 1], ['2026-11-13', 0], ['2026-11-14', 2], ['2026-11-15', 2]]);
  expect(days[5].perCamp).toEqual({ 'sri-lanka': 2 });
  const ov = D.overview(D.stock(CATALOG_NOW, ITEMS, LOCATIONS, MOVES), inWeek);
  expect(ov.camps.map(c => [c.slug, c.units, c.sold, c.unpaid, c.left])).toEqual([['portugal', 1, 65, 0, 44], ['sri-lanka', 4, 220, 165, 58]]);
  expect(ov.all).toMatchObject({ units: 5, sold: 285, passSold: 220, heldSold: 65, left: 102 });
  expect(ov.camps[1].topModels[0]).toEqual({ key: 'Core Black', units: 2 });
  const month = D.periodRange('month', new Date('2026-11-15T12:00:00'));
  const mg = D.margin(D.filterSales(rows, { range: month }), D.expenseRows(EXPENSES, month));
  expect(mg).toMatchObject({ accountSales: 220, heldSales: 65, sold: 285, expenses: 1020, margin: -735 });
  expect(mg.byCat.map(c => [c.key, c.amount])).toEqual([['production', 900], ['shipping', 120]]);
});

// ── The page ───────────────────────────────────────────────────────────────────────────────────
test('diploria area: the owner gets in; one card per camp (Portugal and Sri Lanka, no Morocco) + All camps; Portugal labelled «held by the camp» (not camp income)', async ({ page }) => {
  const ctl = await openArea(page);
  await ready(page);
  expect(await page.locator('#ovCards [data-camp-card]').evaluateAll(els => els.map(e => e.dataset.campCard))).toEqual(['portugal', 'sri-lanka', 'all']);
  await expect(page.locator('body')).not.toContainText('Morocco');
  const pt = page.locator('[data-camp-card="portugal"]');
  await expect(pt).toContainText('Held by the camp');
  await expect(pt).toContainText('Paid to the camp, passed on to Dipløria: not camp income');
  await expect(pt.locator('[data-units]')).toHaveText('1');                       // this month: «Size 31» on 12 Nov
  await expect(pt.locator('[data-left]')).toHaveText('44 of 45');
  const sl = page.locator('[data-camp-card="sri-lanka"]');
  await expect(sl).toContainText('Card → Dipløria');
  await expect(sl.locator('[data-units]')).toHaveText('4');
  await expect(sl.locator('[data-eur]')).toHaveText('€220');
  await expect(sl.locator('[data-unpaid]')).toHaveText('€165.00');
  await expect(sl.locator('[data-left]')).toHaveText('58 of 62');
  await expect(page.locator('[data-camp-card="all"] [data-units]')).toHaveText('5');
  await expect(page.locator('#ovAlerts [data-alert="Sri Lanka · Retro 32"]')).toHaveText('Sri Lanka · Retro 32 · none left');
  await expect(page.locator('#ovAlerts [data-ones="Sri Lanka"] summary')).toHaveText(`Sri Lanka: ${D.alerts(D.stock(CATALOG_NOW, ITEMS, LOCATIONS, MOVES)).filter(a => a.left === 1).length} sizes with 1 left`);
  await expect(page.locator('#ovMargin')).toContainText('-€735.00');
  expect(ctl.writes).toEqual([]);                                                   // reading writes nothing
  await shot(page, 'overview-390.png');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'overview-1280.png');
  // All time: Portugal's July/August lines count
  await page.locator('[data-period]:visible').selectOption('all');
  await expect(pt.locator('[data-units]')).toHaveText('4');
  await expect(page.locator('[data-camp-card="all"] [data-eur]')).toHaveText('€480');
});

test('diploria area: a camp manager without the Dipløria pill gets «No access»; a view-only member reads but cannot change stock or add expenses', async ({ page, browser }) => {
  const ctl = await openArea(page, { who: 'manager' });
  await ready(page);
  await expect(page.locator('body')).toContainText('No access');
  await expect(page.locator('body')).toContainText('Dipløria is not in your allowed areas');
  expect(ctl.writes).toEqual([]);
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openArea(p2, { who: 'viewer', hash: '#stock' });
  await p2.waitForSelector('[data-stock-camp="sri-lanka"] .dp-cell[data-sku]');
  await p2.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Black 30"]').click();
  await expect(p2.locator('#mvBody')).toContainText('Read only');
  await expect(p2.locator('#mvBody [data-act]')).toHaveCount(0);
  await p2.locator('#moveOverlay .mclose').click();
  await p2.evaluate(() => showPage('expenses'));
  await expect(p2.locator('#addExpBtn')).toBeDisabled();
  await p2.close();
});

test('diploria area: sales by day (this week), tap a day → its sales with guest, model, size, price, paid; totals per month / camp / model', async ({ page }) => {
  await openArea(page, { hash: '#sales' });
  await page.waitForSelector('#dayBars .dp-bar');
  await page.locator('[data-period]:visible').selectOption('week');
  expect(await page.locator('#dayBars .dp-bar').evaluateAll(els => els.map(e => [e.dataset.day, e.getAttribute('aria-label').split(': ')[1]]))).toEqual(
    [['2026-11-09', '0 sold'], ['2026-11-10', '0 sold'], ['2026-11-11', '0 sold'], ['2026-11-12', '1 sold'], ['2026-11-13', '0 sold'], ['2026-11-14', '2 sold'], ['2026-11-15', '2 sold']]);
  await page.locator('#dayBars .dp-bar[data-day="2026-11-14"]').click();
  await expect(page.locator('#salesListTitle')).toHaveText('Sales on 14/11');
  const rows = await page.locator('#salesRows tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim())));
  expect(rows).toEqual([
    ['14/11 19:00', 'Sri Lanka Card → Dipløria', 'Staff Test staff', 'Core Black · 30', '€55.00', 'not paid'],
    ['14/11 18:10', 'Sri Lanka Card → Dipløria', 'Ana Test', 'Core Black · 30', '€55.00', '14/11 · Card → Dipløria'],
  ]);
  await expect(page.locator('#salesKpis')).toContainText('€110.00');
  await shot(page, 'sales-day-390.png');
  await page.locator('#dayClear button').click();
  await page.locator('#campPills [data-camp="portugal"]').click();
  await page.locator('[data-period]:visible').selectOption('all');
  await expect(page.locator('#salesRows tr')).toHaveCount(4);
  await expect(page.locator('#salesRows')).toContainText('Held by the camp');
  await expect(page.locator('#salesTotals')).toContainText('Aug 2026');
  await page.locator('#campPills [data-camp="all"]').click();
  // the default period (this month, 30 bars) fits the card at 390: bars and dates share the width, nothing scrolls
  await page.locator('[data-period]:visible').selectOption('month');
  expect(await page.locator('#dayBars .dp-bar').count()).toBe(30);
  expect(await page.evaluate(() => { const b = document.getElementById('dayBars'); return b.scrollWidth <= b.clientWidth + 1; })).toBe(true);
  const [b1, a1] = await Promise.all([page.locator('#dayBars .dp-bar').nth(14).boundingBox(), page.locator('#dayAxis span').nth(14).boundingBox()]);
  expect(Math.abs(b1.x - a1.x)).toBeLessThan(2);
  await shot(page, 'sales-month-390.png');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'sales-1280.png');
});

test('diploria area: stock grid per camp = the core; tap a size → + Received → the RPC; − Correction below 0 shows the server message; move to Portugal lands on «Size 30»', async ({ page }) => {
  const ctl = await openArea(page, { hash: '#stock' });
  await page.waitForSelector('[data-stock-camp="sri-lanka"] .dp-cell[data-sku]');
  const core = D.stock(CATALOG_NOW, ITEMS, LOCATIONS, MOVES);
  for (const c of core) expect(await gridLeft(page, c.slug)).toEqual(Object.fromEntries(c.rows.map(r => [r.sku, r.left])));
  await expect(page.locator('[data-stock-camp="sri-lanka"] [data-camp-total]')).toContainText('58 left of 62 · 4 sold on the Camp Tab · +1 moved since the opening count');
  await expect(page.locator('[data-size-total="all"]')).toContainText('107');
  await shot(page, 'stock-390.png');
  // + Received 2 on Core Black 30
  await page.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Black 30"]').click();
  await expect(page.locator('#mvHist li')).toHaveCount(2);                          // opening + «Box from Lisbon»
  await expect(page.locator('#mvHist')).toContainText('Box from Lisbon');
  await shot(page, 'stock-sku-390.png');
  await page.locator('#mvBody [data-act="sent"]').click();
  await page.locator('#mvQty').fill('2');
  await page.locator('#mvNote').fill('Second box');
  await shot(page, 'stock-received-390.png');
  await page.locator('#mvSave').click();
  await expect(page.locator('#moveOverlay')).not.toHaveClass(/open/);
  expect(ctl.rpcs.at(-1)).toEqual({ p_location_id: LOC_SL, p_sku: 'Core Black 30', p_qty: 2, p_kind: 'sent', p_note: 'Second box', p_to_location_id: null, p_to_sku: null });
  await expect(page.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Black 30"]')).toHaveAttribute('data-left', '5');
  // − Correction of 9 on Core Burgundy 31 (1 left) → refused by the server, message shown, nothing changes
  await page.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Burgundy 31"]').click();
  await page.locator('#mvBody [data-act="correction"]').click();
  await page.locator('#mvQty').fill('9');
  await page.locator('#mvSave').click();
  await expect(page.locator('#toast')).toContainText('has 1 left at that camp');
  expect(ctl.rpcs.at(-1)).toMatchObject({ p_qty: -9, p_kind: 'correction' });
  await page.locator('#moveOverlay .mclose').click();
  // Move 2 Core Black 30 to Portugal → «Size 30»
  await page.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Black 30"]').click();
  await page.locator('#mvBody [data-act="transfer"]').click();
  await expect(page.locator('#mvBody')).toContainText('Lands as «Size 30» in Portugal');
  await page.locator('#mvQty').fill('2');
  await page.locator('#mvSave').click();
  await expect(page.locator('#moveOverlay')).not.toHaveClass(/open/);
  expect(ctl.rpcs.at(-1)).toMatchObject({ p_location_id: LOC_SL, p_sku: 'Core Black 30', p_qty: 2, p_kind: 'transfer', p_to_location_id: LOC_PT, p_to_sku: 'Size 30' });
  await expect(page.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Black 30"]')).toHaveAttribute('data-left', '3');
  await expect(page.locator('[data-stock-camp="portugal"] .dp-cell[data-sku="Size 30"]')).toHaveAttribute('data-left', '20');
  // + Received on an empty cell (Retro 31): the server creates it
  await page.locator('[data-stock-camp="sri-lanka"] tr[data-model="Retro"] .dp-cell.none').first().click();
  await expect(page.locator('#mvSub')).toHaveText('Not stocked at this camp yet');
  await expect(page.locator('#mvBody [data-act]')).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#moveOverlay .mclose').click();
  await shot(page, 'stock-1280.png');
});

test('diploria area: before the SQL runs (no moves / expenses tables) the page still shows the catalog stock, changes off, with a clear note', async ({ page }) => {
  await openArea(page, { hash: '#stock', missing: ['diploria_stock_moves', 'diploria_expenses'], data: { ...DATA(), pricing_catalog: CATALOG } });
  await page.waitForSelector('[data-stock-camp="sri-lanka"] .dp-cell[data-sku]');
  await expect(page.locator('#stockBanner')).toContainText('Stock moves are not set up yet');
  expect((await gridLeft(page, 'sri-lanka'))['Core Black 30']).toBe(1);             // 3 in the catalog − 2 lines
  await page.locator('[data-stock-camp="sri-lanka"] .dp-cell[data-sku="Core Black 30"]').click();
  await expect(page.locator('#mvBody [data-act]')).toHaveCount(0);
  await page.locator('#moveOverlay .mclose').click();
  await page.evaluate(() => showPage('expenses'));
  await expect(page.locator('#expBanner')).toContainText('expenses table is not set up yet');
  await expect(page.locator('#addExpBtn')).toBeDisabled();
});

test('diploria area: expenses list for the period, add one (Dipløria table only), summary sales − expenses = margin, archive', async ({ page }) => {
  const ctl = await openArea(page, { hash: '#expenses' });
  await page.waitForSelector('#expRows tr[data-exp]');
  await expect(page.locator('#expRows tr[data-exp]')).toHaveCount(2);              // November only
  await expect(page.locator('#expSummary')).toContainText('€1,020.00');
  await expect(page.locator('#expSummary')).toContainText('-€735.00');
  await expect(page.locator('.btn-p:visible')).toHaveCount(1);                      // one blue button on the view
  await page.locator('#addExpBtn').click();
  await page.locator('#ex_cat').selectOption('marketing');
  await page.locator('#ex_supplier').fill('Meta Test');
  await page.locator('#ex_desc').fill('Ads, Sri Lanka launch');
  await page.locator('#ex_amount').fill('80');
  await page.locator('#ex_file').fill('drive/file');
  await page.locator('#exSave').click();
  await expect(page.locator('#exStatus')).toContainText('https://');
  await page.locator('#ex_file').fill('');
  await shot(page, 'expense-form-390.png');
  await page.locator('#exSave').click();
  await expect(page.locator('#expOverlay')).not.toHaveClass(/open/);
  expect(ctl.writes).toEqual([['POST', 'diploria_expenses']]);
  expect(ctl.T.diploria_expenses.at(-1)).toMatchObject({ supplier: 'Meta Test', category: 'marketing', amount: 80, currency: 'EUR', expense_date: '2026-11-15', location_id: null });
  await expect(page.locator('#expSummary')).toContainText('€1,100.00');
  await expect(page.locator('#expSummary')).toContainText('-€815.00');
  await page.locator(`#expRows tr[data-exp="${uid(802)}"]`).count().then(n => expect(n).toBe(0));
  await page.locator(`#expRows tr[data-exp="${uid(801)}"] button[title="Archive"]`).click();
  await expect(page.locator(`#expRows tr[data-exp="${uid(801)}"]`)).toHaveCount(0);
  expect(ctl.writes.at(-1)).toEqual(['PATCH', 'diploria_expenses']);
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'expenses-1280.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'expenses-390.png');
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noScroll).toBe(true);
});

test('diploria area: no sideways page scroll at 390 on any tab', async ({ page }) => {
  await openArea(page);
  await ready(page);
  for (const id of ['overview', 'sales', 'stock', 'expenses']) {
    await tab(page, id);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), id).toBeLessThanOrEqual(1);
  }
});

// ── The Camp Tab and /diploria/ show the same «left», per SKU ─────────────────────────────────
test('same number: the Sri Lanka Camp Tab «N left» = the /diploria/ grid, per SKU, after moves, a staff sale and a line taken off the tab', async ({ page, browser }) => {
  const campCatalog = CATALOG_NOW.filter(c => c.location_id === LOC_SL).map(c => ({ ...c, audience: 'general', cost_per_guest: 0, alt_price: null, alt_label: null, show_in_camp_tab: true, show_in_transport_picker: false }));
  const ctl = await stub(page, {
    pricing_catalog: campCatalog, ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: LOC_SL, start_date: '2026-11-14', end_date: '2026-11-20', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: GUESTS.filter(g => g.location_id === LOC_SL).map((g, i) => ({ ...g, booking_ref: null, paid: false, paid_at: null, closed_at: null, checkin: '2026-11-14', checkout: '2026-11-20', pax: 1, sort_order: (i + 1) * 10, meta: {} })),
    camp_tab_items: ITEMS.filter(i => i.location_id === LOC_SL),
  });
  ctl.campSlug = 'sri-lanka';
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  await frame.waitForFunction(() => { try { return campTabBootstrapped === true && !!S.activeWeek && (MENU.Diploria || []).length === 38 && allConsumers(S.activeWeek).length === 2; } catch (_) { return false; } }, null, { timeout: 20000 });
  // take «Essential Green 33» off Ana's tab and wait for the delete to reach the (stub) database
  await frame.evaluate(() => { const g = allConsumers(S.activeWeek).find(x => x.name === 'Ana Test'); AG = g.id; delItem(g.items.findIndex(i => i.n === 'Essential Green 33')); });
  await expect.poll(() => ctl.T.camp_tab_items.filter(i => i.item_name === 'Essential Green 33').length, { timeout: 15000 }).toBe(0);
  const camp = Object.fromEntries(await frame.evaluate(() => MENU.Diploria.map(i => [i.n, stockLeftForCategory(i, 'Diploria')])));
  expect(camp['Core Black 30']).toBe(3);          // 3 + 2 received − guest − staff
  expect(camp['Core Burgundy 31']).toBe(1);       // 3 − 1 correction − 1 sale
  expect(camp['Essential Green 33']).toBe(2);     // the line taken off gives it back
  // /diploria/ on what the database now holds
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openArea(p2, { hash: '#stock', data: { ...DATA(), camp_tab_items: [...ctl.T.camp_tab_items, ...ITEMS.filter(i => i.location_id !== LOC_SL)] } });
  await p2.waitForSelector('[data-stock-camp="sri-lanka"] .dp-cell[data-sku]');
  const area = await gridLeft(p2, 'sri-lanka');
  expect(Object.keys(area).length).toBe(38);
  expect(area).toEqual(camp);
  await p2.close();
});
