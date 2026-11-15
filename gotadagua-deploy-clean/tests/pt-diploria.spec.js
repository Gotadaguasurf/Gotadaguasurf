// Portugal Dipløria = held for the brand, not camp revenue (Miguel, 15 Nov 2026: «esse dinheiro em Portugal não
// conta porque vamos dar à marca»). The guest pays the camp 65 €, the camp holds it, then passes it to Dipløria.
//   · a paid line → ledger TRANSFER «Into cash», category «Dipløria» (never revenue): P&L unchanged, cash +65
//   · «Passed to Dipløria» (from /diploria/) → transfer «Out of cash», same category: cash −65, owed 0
//   · Sri Lanka stays pass-through (tests/sl-diploria.spec.js)
// Stubbed Supabase; the Camp Tab is only ever opened inside the camp hub. Guest names are invented.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');
const D = require('../lib/diploria-core.js');

test.use({ timezoneId: 'Europe/Lisbon', viewport: { width: 1280, height: 900 } });

const LOC_PT = '380ae05e-7f8e-4ee5-b37b-e7d85903a397';
const LOC_SL = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
const SHOTS = process.env.PTDIP_SHOTS || path.join(__dirname, '..', 'test-results', 'pt-diploria-shots');
const row = (r, i) => ({ id: `0000c47a-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: LOC_PT, name: r.name, category: r.category, audience: 'general',
  sell_price: r.sell, sell_currency: 'EUR', currency: 'EUR', cost_per_guest: 0, alt_price: null, alt_label: null, stock_qty: r.stock,
  show_in_camp_tab: true, show_in_transport_picker: false, active: true, sort_order: r.sort });
const CATALOG_PT = [
  { name: 'T-Shirt M', category: 'Merch', sell: 30, stock: 20, sort: 100 },
  ...['28', '30', '31', '32', '33', '34'].map((sz, i) => ({ name: `Size ${sz}`, category: 'Diploria', sell: 65, stock: [9, 15, 9, 4, 3, 2][i], sort: 4010 + i * 10 })),
].map(row);

// Small in-memory PostgREST (same shape as tests/sl-diploria.spec.js): GET eq/is/in, POST upsert by id, PATCH, DELETE.
async function stub(page, tables) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, writes: [] };
  const match = (row, url) => [...new URL(url).searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) return true;
    const m = v.match(/^(eq|is|in)\.(.*)$/s); if (!m) return true;
    if (m[1] === 'eq') return String(row[k]) === m[2];
    if (m[1] === 'is') return m[2] === 'null' ? row[k] == null : String(row[k]) === m[2];
    return m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(row[k]));
  });
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/')) return json({});
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]; if (!t) return json([]);
    if (t === 'locations') return json({ id: LOC_PT, name: 'Portugal', slug: 'portugal', currency: 'EUR', default_fx_to_eur: 1, camp_tab_mode: 'per_guest' });
    const rows = T[t] || (T[t] = []);
    if (method !== 'GET') ctl.writes.push([method, t]);
    if (method === 'GET') {
      const out = rows.filter(r => match(r, url));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
      return json(out);
    }
    if (method === 'POST') {
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = rows.findIndex(x => String(x.id) === String(r.id)); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') { T[t] = rows.filter(r => !match(r, url)); return json([]); }
    return json([]);
  });
  return ctl;
}

async function openPortugal(page) {
  const ctl = await stub(page, {
    pricing_catalog: CATALOG_PT, ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: LOC_PT, start_date: '2026-11-14', end_date: '2026-11-20', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [],
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=portugal', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  await frame.waitForFunction(() => { try { return campTabBootstrapped === true && !!S.activeWeek && (MENU.Diploria || []).length === 6; } catch (_) { return false; } }, null, { timeout: 20000 });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(500);
  return { ctl, frame };
}
async function addGuestWith(frame, name, lines) {
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill(name);
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
  for (const [cat, n] of lines) await frame.evaluate(([cat, n]) => { const it = MENU[cat].find(i => i.n === n); AC = cat; addResolvedItem(it); }, [cat, n]);
}
const campRows = ctl => (ctl.T.ledger_entries || []).map(r => [r.type, r.category, r.payment_method, Number(r.amount_local), r.linked_item || '', r.source_kind]).sort((a, b) => a[1].localeCompare(b[1]));
// Every Portugal figure that sums P&L or money, straight from the hub's own functions.
const hubFigures = page => page.evaluate(() => {
  const ws = weekStartSat(today()); const w = wplRowFor(ws); const dr = ledgerDrawerBalances(S.ledger);
  return { revenue: sum(S.ledger.filter(x => x.type === 'income'), x => x.amount), expenses: sum(S.ledger.filter(x => x.type === 'expense'), x => x.amount),
    balance: Math.round((dr.bankEur + dr.cashEur) * 100) / 100, cash: dr.cashEur,
    wpl: { onsite: w.onsite, merch: w.merchSales, other: w.otherSales, result: w.result, cost: w.cost, cash: w.cash, otherMoves: w.otherMoves } };
});

test('portugal dipløria: Pay writes the short as «held for Dipløria» (transfer into cash), the T-shirt as Merchandise revenue; P&L counts 30, cash 95', async ({ page }) => {
  const { ctl, frame } = await openPortugal(page);
  await addGuestWith(frame, 'Ana Test', [['Diploria', 'Size 31'], ['Merch', 'T-Shirt M']]);
  await frame.locator('#payBtn').click();
  await expect.poll(() => campRows(ctl), { timeout: 8000 }).toEqual([
    ['money_sent', 'Dipløria', 'Cash', 65, 'Size 31', 'camp_tab_per_guest'],
    ['revenue', 'Merchandise', 'Cash', 30, 'T-Shirt M', 'camp_tab_per_guest'],
  ]);
  const dip = ctl.T.ledger_entries.find(r => r.category === 'Dipløria');
  expect(dip).toMatchObject({ currency: 'EUR', amount_eur: 65, business_area: 'General', paid_from: 'portugal', attributed_location: 'portugal', description: 'Camp Tab · Ana Test · Dipløria Size 31 · held for Dipløria' });
  expect((ctl.T.ledger_entries || []).filter(r => r.type === 'revenue' && /dipl|size 3/i.test(r.category + r.linked_item))).toEqual([]);
  await page.waitForTimeout(400);
  const f = await hubFigures(page);
  expect(f.revenue).toBe(30);                       // P&L: the short is not revenue
  expect(f.expenses).toBe(0);
  expect(f.balance).toBe(95);                       // but the 65 € is in the drawer
  expect(f.wpl).toMatchObject({ onsite: 30, merch: 30, other: 0, result: 30, cost: 0, cash: 95, otherMoves: 65 });
  // Overview KPIs (Portugal: Money from HQ · On-site revenue · Total Spent · Balance) and the Dipløria card
  await page.evaluate(() => showPage('overview'));
  const kpis = await page.locator('#ovKpis .kpi').evaluateAll(els => els.map(e => [e.querySelector('.kpi-label').textContent.trim(), e.querySelector('.kpi-value').textContent.trim()]));
  expect(kpis).toEqual([['Money from HQ', '€0.00'], ['On-site revenue', '€30.00'], ['Total Spent', '€0.00'], ['Balance', '€95.00']]);
  const card = page.locator('#ovDiploria');
  await expect(card).toContainText('Dipløria');
  await expect(card).toContainText('for Dipløria · not camp revenue');
  await expect(page.locator('#ovDipOwed')).toContainText('Owed to Dipløria now €65 · paid to the camp €65 − passed €0');
  // Operations Ledger: the line reads as a transfer, Guest → Cash; Total Revenue tile 30
  await page.evaluate(() => showPage('expenses'));
  await expect(page.locator('#expKpis')).toContainText('€30.00');
  const typeCell = await page.evaluate(() => ledgerTypeCell(S.ledger.find(isDiploriaMoveRow)));
  expect(typeCell).toContain('Held for Dipløria');
  expect(typeCell).toContain('Guest → Cash');
  expect(await page.evaluate(() => ledgerSign(S.ledger.find(isDiploriaMoveRow)))).toBe('+');
});

test('portugal dipløria: «Passed to Dipløria» (the /diploria/ row) takes the 65 € out of cash, owed 0, P&L untouched; un-paying a short removes its row', async ({ page }) => {
  const { ctl, frame } = await openPortugal(page);
  await addGuestWith(frame, 'Ana Test', [['Diploria', 'Size 31'], ['Merch', 'T-Shirt M']]);
  await frame.locator('#payBtn').click();
  await expect.poll(() => (ctl.T.ledger_entries || []).length, { timeout: 8000 }).toBe(2);
  // The exact row /diploria/ inserts (lib/diploria-core.js passEntry), then the hub re-reads its ledger.
  ctl.T.ledger_entries.push(D.passEntry({ id: '0000aaaa-0000-4000-8000-000000000001', locationId: LOC_PT, slug: 'portugal', date: await page.evaluate(() => today()), amount: 65, from: 'cash' }));
  await page.evaluate(async () => { await hydrateLedgerFromSupabase({ mergeLocal: false }); renderOverview(); });
  const f = await hubFigures(page);
  expect(f.revenue).toBe(30);
  expect(f.expenses).toBe(0);                        // passing the money on is not a camp cost
  expect(f.balance).toBe(30);
  expect(f.wpl).toMatchObject({ onsite: 30, result: 30, cost: 0, cash: 30, otherMoves: 0 });
  const pass = await page.evaluate(() => { const r = S.ledger.find(x => isDiploriaMoveRow(x) && x.paymentMethod === 'Cash Out'); return { kind: transferKindLabel(r), flow: transferFlowLabel(r), sign: ledgerSign(r), via: ledgerPaidViaText(r) }; });
  expect(pass).toEqual({ kind: 'Passed to Dipløria', flow: 'Cash → Dipløria', sign: '−', via: 'Cash' });
  await page.evaluate(() => showPage('overview'));
  await expect(page.locator('#ovDipOwed')).toContainText('Owed to Dipløria now €0 · paid to the camp €65 − passed €65');
  // A same-day 65 € «Out of bank» Dipløria pass is never read as half of a cash withdrawal.
  expect(await page.evaluate(() => transferHasTwin({ id: 'x', type: 'transfer', category: 'Dipløria', paymentMethod: 'Bank Transfer', date: today(), amountLocal: 65 }))).toBe(false);
  // Un-pay the short: its held row goes, the T-shirt stays.
  await frame.evaluate(() => { const g = findConsumer(AG, 'guests'); unpayItem(g.items.findIndex(i => i.n === 'Size 31')); });
  await expect.poll(() => campRows(ctl).filter(r => r[5] === 'camp_tab_per_guest'), { timeout: 8000 }).toEqual([['revenue', 'Merchandise', 'Cash', 30, 'T-Shirt M', 'camp_tab_per_guest']]);
});

test('portugal dipløria: every Camp Tab writer (grouped, per item, closed week — hub and camp tab) makes it a transfer, never revenue; Sri Lanka still writes nothing', async ({ page }) => {
  const { frame } = await openPortugal(page);
  const hub = await page.evaluate(() => {
    const dip = { id: 'd1', c: 'Diploria', n: 'Size 30', p: 65, paidAt: '2026-11-15T10:00:00Z' }, tee = { id: 't1', c: 'Merch', n: 'T-Shirt M', p: 30, paidAt: '2026-11-15T10:00:00Z' };
    const guest = { id: 'g1', name: 'Rui Test', items: [dip, tee] };
    const pick = e => e && [e.type, e.category, e.paymentMethod, e.amountLocal, e.businessArea];
    return {
      category: mapCampTabRevenueCategory(dip),
      perItem: pick(buildPaidItemRevenueEntry(guest, dip, { date: '2026-11-15' })),
      grouped: buildPaidGuestRevenueEntries(guest, { date: '2026-11-15' }).map(pick),
      week: buildClosedWeekRevenueEntries({ id: 'w1', start: '2026-11-14', guests: [{ id: 'g2', name: 'Leo Test', paid: true, items: [{ id: 'd2', c: 'Diploria', n: 'Size 28', p: 65 }, { id: 't2', c: 'Merch', n: 'T-Shirt M', p: 30 }] }], staff: [] }).map(pick),
      pass: isPassThroughItem(dip),
    };
  });
  expect(hub.category).toBe('Dipløria');
  expect(hub.pass).toBe(false);                                                   // Portugal is not pass-through
  expect(hub.perItem).toEqual(['transfer', 'Dipløria', 'Cash', 65, 'General']);
  expect(hub.grouped.sort()).toEqual([['income', 'Merchandise', 'Cash', 30, 'Merch'], ['transfer', 'Dipløria', 'Cash', 65, 'General']]);
  expect(hub.week.sort()).toEqual([['income', 'Merchandise', 'Cash', 30, 'Merch'], ['transfer', 'Dipløria', 'Cash', 65, 'General']]);
  // The camp tab's own weekly close (weekly-mode path) sends the short as a transfer too.
  const sent = await frame.evaluate(() => { const out = []; const orig = window.parent.postMessage.bind(window.parent);
    window.parent.postMessage = (m) => { out.push(m); };
    try { syncClosedWeekToHubLedger({ id: 'w2', start: '2026-11-14', guests: [{ id: 'g3', name: 'Ana Test', paid: true, items: [{ id: 'd3', c: 'Diploria', n: 'Size 33', p: 65 }] }], staff: [] }); } finally { window.parent.postMessage = orig; }
    return out.flatMap(m => (m.entry || []).map(e => [e.type, e.category, e.linkedItem, e.amountLocal])); });
  expect(sent).toEqual([['transfer', 'Dipløria', 'Size 33', 65]]);
});

test('hq overview: a Portugal Dipløria transfer in the rollup is not revenue — Portugal shows bookings + camp sales only', async ({ page }) => {
  const rollup = {
    bookings: [{ month_key: '2026-11', location: 'Surf Camp Portugal', direct: true, total: 1000, net_amount: 1000, commission_amount: 0, pax: 1, n: 1 }],
    invoices: [],
    ledger: [{ month: '2026-11', type: 'revenue', slug: 'portugal', attributed_location: 'portugal', source_kind: 'camp_tab_per_guest', amount_eur: 30 },
             { month: '2026-11', type: 'money_sent', slug: 'portugal', attributed_location: 'portugal', source_kind: 'camp_tab_per_guest', amount_eur: 65 },
             { month: '2026-11', type: 'money_sent', slug: 'portugal', attributed_location: 'portugal', source_kind: 'diploria_pass', amount_eur: 65 }],
    pnl: [{ slug: 'portugal', month: '2026-11', rev_book: 1000, rev_ops: 30, exp_local: 0, exp_hq: 0 }],
  };
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json(rollup);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#ov_period') && document.querySelector('#ov_period').options.length > 1, null, { timeout: 15000 });
  await page.selectOption('#ov_period', '2026-11');
  await page.waitForFunction(() => /1 booking/.test(document.querySelector('#overviewBody')?.textContent || ''), null, { timeout: 15000 });
  const cells = await page.evaluate(() => [...document.querySelectorAll('tr.loc-row-drill')].map(tr => [...tr.children].map(td => td.textContent.trim())).find(c => c[0] === 'Surfcamp PT'));
  // Location · Bookings · Camp sales · Local expenses · HQ invoices · Profit: 1000 + 30, the two 65 € transfers are in no column
  expect(cells.slice(2)).toEqual(['€30.00', '€0.00', '€0.00', '+€1,030.00']);
  expect(errs).toEqual([]);
});

test('diploria core: held() = paid to the camp − passed (all time), unpaid apart; passEntry is a transfer out of cash or bank', async () => {
  const LOCS = [{ id: LOC_PT, slug: 'portugal', name: 'Portugal' }, { id: LOC_SL, slug: 'sri-lanka', name: 'Sri Lanka' }];
  const it = (n, name, paid, loc = LOC_PT, cur = 'EUR', price = 65) => ({ id: 'i' + n, location_id: loc, category: 'Diploria', item_name: name, price_local: price, currency: cur, paid_at: paid });
  const items = [it(1, 'Core Army Green 32', '2026-07-25T09:24:00Z'), it(2, 'Core Burgundy 32', null), it(3, 'Pocket Brown 32', null), it(4, 'Size 31', '2026-10-01T07:38:00Z'),
    it(5, 'Size 30', '2026-11-01T10:00:00Z', LOC_PT, 'EUR', 0), it(6, 'Core Black 30', '2026-11-14T18:00:00Z', LOC_SL, 'EUR', 55), { ...it(7, 'T-Shirt M', '2026-11-01T10:00:00Z'), category: 'Merch' }];
  const ledger = [
    { id: 'l1', location_id: LOC_PT, type: 'money_sent', category: 'Dipløria', payment_method: 'Cash', amount_local: 65, currency: 'EUR', entry_date: '2026-11-15' },      // a held sale row: not a pass
    { id: 'l2', location_id: LOC_PT, type: 'money_sent', category: 'Cash count', payment_method: 'Cash Out', amount_local: 40, currency: 'EUR', entry_date: '2026-11-15' }, // not Dipløria
    D.passEntry({ id: 'l3', locationId: LOC_PT, slug: 'portugal', date: '2026-11-10', amount: 50, from: 'bank', note: 'First part' }),
  ];
  const [pt, ...rest] = D.held(items, ledger, LOCS);
  expect(rest).toEqual([]);                                                       // Sri Lanka is pass-through, not held
  expect(pt).toMatchObject({ slug: 'portugal', paid: 130, paidUnits: 2, passed: 50, owed: 80, unpaid: 130, unpaidUnits: 2 });
  expect(pt.passes).toEqual([{ id: 'l3', date: '2026-11-10', amount: 50, from: 'bank', note: 'First part' }]);
  expect(D.held(items, [], LOCS)[0].owed).toBe(130);                              // 15 Nov 2026: the two paid lines, nothing passed
  expect(D.passEntry({ id: 'x', locationId: LOC_PT, slug: 'portugal', date: '2026-11-15', amount: 130, from: 'cash' })).toMatchObject({
    type: 'money_sent', category: 'Dipløria', payment_method: 'Cash Out', amount_local: 130, amount_eur: 130, currency: 'EUR', fx_rate: 1, source_kind: 'diploria_pass', description: 'Passed to Dipløria', paid_from: 'portugal', attributed_location: 'portugal' });
  expect(D.passEntry({ id: 'x', locationId: LOC_PT, date: '2026-11-15', amount: 0 })).toBeNull();
  expect(D.modeOf('portugal')).toBe('held');
  expect(D.modeOf('sri-lanka')).toBe('pass');
});

// ── /diploria/: Portugal like a pass-through camp — «for Dipløria», owed by the camp, passed ───────────────
const LOCATIONS = [{ id: LOC_SL, slug: 'sri-lanka', name: 'Sri Lanka' }, { id: LOC_PT, slug: 'portugal', name: 'Portugal' }];
const uid = (n) => `0000d1a0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AREA_CATALOG = [
  ...['28', '30', '31', '32', '33', '34'].map((sz, i) => ({ id: uid(200 + i), location_id: LOC_PT, name: `Size ${sz}`, category: 'Diploria', stock_qty: [9, 15, 9, 4, 3, 2][i], sell_price: 65, sell_currency: 'EUR', currency: 'EUR', sort_order: 4010 + i * 10, active: true })),
  { id: uid(210), location_id: LOC_SL, name: 'Core Black 30', category: 'Diploria', stock_qty: 3, sell_price: 55, sell_currency: 'EUR', currency: 'EUR', sort_order: 8000, active: true },
];
const AREA_ITEMS = [
  // Portugal on 15 Nov 2026: two paid (25 Jul, 1 Oct), two not paid (5 Aug)
  { id: uid(700), location_id: LOC_PT, guest_id: uid(602), category: 'Diploria', item_name: 'Core Army Green 32', price_local: 65, currency: 'EUR', added_at: '2026-07-25T10:24:00.000Z', paid_at: '2026-07-25T09:24:47Z', meta: {} },
  { id: uid(701), location_id: LOC_PT, guest_id: uid(603), category: 'Diploria', item_name: 'Core Burgundy 32', price_local: 65, currency: 'EUR', added_at: '2026-08-05T16:46:00.000Z', paid_at: null, meta: {} },
  { id: uid(702), location_id: LOC_PT, guest_id: uid(603), category: 'Diploria', item_name: 'Pocket Brown 32', price_local: 65, currency: 'EUR', added_at: '2026-08-05T16:47:00.000Z', paid_at: null, meta: {} },
  { id: uid(703), location_id: LOC_PT, guest_id: uid(604), category: 'Diploria', item_name: 'Size 31', price_local: 65, currency: 'EUR', added_at: '2026-10-01T08:30:00.000Z', paid_at: '2026-10-01T07:38:35Z', meta: {} },
  { id: uid(704), location_id: LOC_SL, guest_id: uid(600), category: 'Diploria', item_name: 'Core Black 30', price_local: 55, currency: 'EUR', added_at: '2026-11-14T18:10:00.000Z', paid_at: '2026-11-14T18:12:00Z', meta: { payMethod: 'Card → Dipløria' } },
];
const AREA_GUESTS = [{ id: uid(600), name: 'Ana Test', is_staff: false }, { id: uid(602), name: 'Pedro Test', is_staff: false }, { id: uid(603), name: 'Marta Test', is_staff: false }, { id: uid(604), name: 'Rita Test', is_staff: false }];

async function openArea(page, ledger = []) {
  const T = { platform_profiles: [{ id: 'u1', email: 'miguel@gotadaguasurf.com', full_name: 'owner', platform_role: 'super_admin' }], workspace_memberships: [],
    locations: LOCATIONS, pricing_catalog: AREA_CATALOG, camp_tab_items: AREA_ITEMS, camp_guests: AREA_GUESTS, diploria_stock_moves: [], diploria_expenses: [], ledger_entries: ledger.map(r => ({ ...r })) };
  const ctl = { T, writes: [] };
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/')) return json({});
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]; if (!t) return json([]);
    const rows = T[t] || (T[t] = []);
    const q = new URL(url).searchParams;
    if (method === 'GET') {
      const out = rows.filter(r => [...q.entries()].every(([k, v]) => { const m = v.match(/^(eq|is|in)\.(.*)$/s); if (!m || ['select', 'order', 'limit', 'offset'].includes(k)) return true;
        if (m[1] === 'eq') return String(r[k]) === m[2]; if (m[1] === 'is') return m[2] === 'null' ? r[k] == null : String(r[k]) === m[2];
        return m[2].replace(/^\(|\)$/g, '').split(',').includes(String(r[k])); }));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json(null);
      return json(out);
    }
    ctl.writes.push([method, t]);
    if (method === 'POST') { const b = JSON.parse(req.postData() || '[]'); (Array.isArray(b) ? b : [b]).forEach(r => rows.push(r)); return json([], 201); }
    return json([]);
  });
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00'));
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/diploria/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ovCards [data-camp-card]', { timeout: 15000 });
  await page.locator('[data-period]:visible').selectOption('all');
  return ctl;
}

test('diploria area: Portugal card = «for Dipløria», paid to the camp 130, passed 0, owed 130, not paid yet 130; the margin counts it as Dipløria money', async ({ page }) => {
  const ctl = await openArea(page);
  const pt = page.locator('[data-camp-card="portugal"]');
  await expect(pt).toContainText('Held by the camp');
  await expect(pt).toContainText('for Dipløria');
  await expect(pt.locator('.dp-big')).not.toContainText('camp income');
  await expect(pt.locator('[data-units]')).toHaveText('4');
  await expect(pt.locator('[data-unpaid]')).toHaveText('€130.00');                 // the two August lines
  await expect(pt.locator('[data-held-paid]')).toHaveText('€130.00');              // 25 Jul + 1 Oct (never in the ledger)
  await expect(pt.locator('[data-passed]')).toHaveText('€0.00');
  await expect(pt.locator('[data-owed]')).toHaveText('€130.00');
  await expect(pt.locator('[data-owed]')).toHaveClass(/neg/);
  await expect(page.locator('[data-camp-card="sri-lanka"] [data-held]')).toHaveCount(0);
  await expect(page.locator('.ov-section-sub', { hasText: 'Sales − expenses' })).toHaveCount(0);
  await expect(page.locator('#page-overview')).toContainText('Portugal\'s is held by the camp until it is passed on');
  await expect(page.locator('#page-overview')).not.toContainText('camp income, so the margin is shown both ways');
  await expect(page.locator('#ovMargin')).toContainText('Owed by the camps now');
  expect(ctl.writes).toEqual([]);
});

test('diploria area: «Record money passed» writes ONE Portugal ledger transfer (Out of cash, «Dipløria»), owed 130 → 0; screenshots 390 / 1280', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const ctl = await openArea(page);
  const pt = page.locator('[data-camp-card="portugal"]');
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `overview ${w}`).toBe(true);
    await pt.screenshot({ path: path.join(SHOTS, `diploria-portugal-card-${w}.png`) });
    await page.screenshot({ path: path.join(SHOTS, `diploria-overview-${w}.png`), fullPage: true });
  }
  await expect(page.locator('#page-overview .btn-p:visible')).toHaveCount(0);       // the card button is secondary
  await pt.locator('[data-pass-btn="portugal"]').click();
  await expect(page.locator('#passOverlay')).toHaveClass(/open/);
  await expect(page.locator('#passOverlay .modal')).toBeVisible();
  await page.waitForTimeout(500);                                                    // let the sheet finish sliding in
  await expect(page.locator('#ps_amount')).toHaveValue('130.00');
  await expect(page.locator('#psSub')).toContainText('Portugal owes €130.00');
  await expect(page.locator('#passOverlay .btn-p:visible')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, 'diploria-pass-modal-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'diploria-pass-modal-1280.png') });
  await page.locator('#psSave').click();
  await expect(page.locator('#passOverlay')).not.toHaveClass(/open/);
  expect(ctl.writes).toEqual([['POST', 'ledger_entries']]);
  const r = ctl.T.ledger_entries.at(-1);
  expect(r).toMatchObject({ location_id: LOC_PT, type: 'money_sent', category: 'Dipløria', payment_method: 'Cash Out', amount_local: 130, amount_eur: 130, currency: 'EUR', fx_rate: 1, entry_date: '2026-11-15', source_kind: 'diploria_pass', business_area: 'General' });
  expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(pt.locator('[data-passed]')).toHaveText('€130.00');
  await expect(pt.locator('[data-owed]')).toHaveText('€0.00');
  await expect(pt.locator('[data-owed]')).not.toHaveClass(/neg/);
  await expect(pt.locator('[data-unpaid]')).toHaveText('€130.00');                 // the August lines are still not paid
  await pt.locator('[data-pass-btn="portugal"]').click();
  await expect(page.locator('#psList li')).toHaveCount(1);
  await expect(page.locator('#psList')).toContainText('from cash');
});

test('portugal hub: screenshots of the Dipløria card and the ledger lines at 390 and 1280, no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { ctl, frame } = await openPortugal(page);
  await addGuestWith(frame, 'Ana Test', [['Diploria', 'Size 31'], ['Merch', 'T-Shirt M']]);
  await frame.locator('#payBtn').click();
  await expect.poll(() => (ctl.T.ledger_entries || []).length, { timeout: 8000 }).toBe(2);
  ctl.T.ledger_entries.push(D.passEntry({ id: '0000aaaa-0000-4000-8000-000000000002', locationId: LOC_PT, slug: 'portugal', date: await page.evaluate(() => today()), amount: 40, from: 'cash' }));
  await page.evaluate(async () => { await hydrateLedgerFromSupabase({ mergeLocal: false }); });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => showPage('overview'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `overview ${w}`).toBe(true);
    await page.locator('#ovDiploria').scrollIntoViewIfNeeded();
    await page.locator('#ovDiploria').screenshot({ path: path.join(SHOTS, `hub-portugal-diploria-card-${w}.png`) });
    await page.evaluate(() => showPage('expenses'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `ledger ${w}`).toBe(true);
    const tbl = page.locator('#expTableWrap, .exp-table-wrap, #expTable').first();
    if (await tbl.count()) { await tbl.scrollIntoViewIfNeeded(); await tbl.screenshot({ path: path.join(SHOTS, `hub-portugal-ledger-${w}.png`) }); }
    else await page.screenshot({ path: path.join(SHOTS, `hub-portugal-ledger-${w}.png`), fullPage: true });
  }
});
