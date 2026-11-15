// Camp Tab · Dipløria in Sri Lanka (15 Nov 2026) — stubbed Supabase, the real Sri Lanka catalog + the 38 Dipløria SKUs.
//
// Miguel: «queria ter uma tab como as drinks para a Dipløria … os modelos todos e tamanhos e os stocks para não
// falhar nada». Consignment stock from the sheet «Stock Dipløria Sri Lanka» (62 units). The camp tab is only
// ever opened inside the camp hub (never camp-tab-inner.html on its own).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');

test.use({ timezoneId: 'Asia/Colombo', viewport: { width: 1280, height: 900 } });

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const LOC_PT = '380ae05e-7f8e-4ee5-b37b-e7d85903a397';
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
const SHOTS = path.join(__dirname, '..', 'test-results', 'sl-diploria-shots');
const STOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sl-diploria-stock.json'), 'utf8'));
const PRICE = () => 55;   // 55 EUR every model, paid by card to the owner (Miguel, 15 Nov) = supabase/sl-diploria-55eur.sql
// The 38 rows of the first sheet; Retro 32 sold out since (row kept at 0 in production): 61 units.
const SKUS = STOCK.models.flatMap((x, mi) => x.qty.map((q, si) => ({ name: `${x.model} ${STOCK.sizes[si]}`, model: x.model, size: STOCK.sizes[si], qty: q, sort: 8000 + mi * 10 + si })).filter(s => s.qty > 0))
  .map(s => s.name === 'Retro 32' ? { ...s, qty: 0 } : s);
const NOW = { ...STOCK, models: STOCK.models.map(x => x.model === 'Retro' ? { ...x, qty: [1, 3, 0, 0, 0, 0] } : x) };   // the sheet's real figures
const BASE = [
  ['Soft Drink', 'Drinks', 400, 200, 'Staff', null], ['Lion Lager', 'Drinks', 600, 300, 'Staff', 50],
  ['T-Shirt M', 'Merch', 9000, 3000, 'Staff', 54], ['River Safari', 'Tour', 6000, null, null, null],
].map(([name, category, sell, alt, altLabel, stock], i) => ({ name, category, sell, alt, altLabel, stock, sort: (i + 1) * 100 }));
const row = (loc, r, i) => ({ id: `0000c47a-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: loc, name: r.name, category: r.category, audience: 'general',
  sell_price: r.sell, sell_currency: loc === LOC ? 'LKR' : 'EUR', currency: loc === LOC ? 'LKR' : 'EUR', cost_per_guest: 0, alt_price: r.alt == null ? null : r.alt, alt_label: r.altLabel || null, stock_qty: r.stock,
  show_in_camp_tab: true, show_in_transport_picker: false, active: true, sort_order: r.sort });
const CATALOG_SL = [...BASE, ...SKUS.map(s => ({ name: s.name, category: 'Diploria', sell: PRICE(s.model), stock: s.qty, sort: s.sort }))].map((r, i) => row(LOC, r, i));
const CATALOG_PT = ['28', '30', '31', '32', '33', '34'].map((sz, i) => row(LOC_PT, { name: `Size ${sz}`, category: 'Diploria', sell: 65, stock: [9, 15, 9, 4, 3, 2][i], sort: 4010 + i * 10 }, 100 + i));

// Small in-memory PostgREST: GET filters eq/is/in, POST upserts by id, PATCH, DELETE.
async function stub(page, tables, slug) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, fail: null, writes: [], slug };
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
    if (t === 'locations') return json(ctl.slug === 'portugal' ? { id: LOC_PT, name: 'Portugal', slug: 'portugal', currency: 'EUR', default_fx_to_eur: 1, camp_tab_mode: 'per_guest' } : { id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' });
    if (ctl.fail && ctl.fail(t, method)) return json({ message: 'stub failure', code: '500' }, 500);
    const rows = T[t] || (T[t] = []);
    if (method !== 'GET') ctl.writes.push([method, t]);
    if (method === 'GET') {
      let out = rows.filter(r => match(r, url));
      if (t === 'camp_tab_items' && /camp_guests\(/.test(new URL(url).searchParams.get('select') || '')) out = out.map(r => ({ ...r, camp_guests: (T.camp_guests || []).find(g => g.id === r.guest_id) || null }));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
      return json(out);
    }
    if (method === 'POST') {
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      const key = (new URL(url).searchParams.get('on_conflict') || 'id').split(',');
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = rows.findIndex(x => key.every(c => String(x[c]) === String(r[c]))); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') { T[t] = rows.filter(r => !match(r, url)); return json([]); }
    return json([]);
  });
  return ctl;
}


async function openCampTab(page, slug = 'sri-lanka') {
  const loc = slug === 'portugal' ? LOC_PT : LOC;
  const ctl = await stub(page, {
    pricing_catalog: slug === 'portugal' ? CATALOG_PT : CATALOG_SL, ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: loc, start_date: '2026-11-14', end_date: '2026-11-20', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [],
  }, slug);
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  await frame.waitForFunction(n => { try { return campTabBootstrapped === true && !!S.activeWeek && (MENU.Diploria || []).length === n; } catch (_) { return false; } }, slug === 'portugal' ? 6 : 38, { timeout: 20000 });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(600);
  return { ctl, frame };
}
async function addConsumer(frame, name) {
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill(name);
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
}
const cat = (frame, label) => frame.locator('#catTabs button', { hasText: label }).first().click();
const modelLeft = frame => frame.locator('#dipModels .dip-model').evaluateAll(els => els.map(e => [e.dataset.model, e.querySelector('.ci-desc').textContent.trim()]));
const sizeRow = frame => frame.locator('#dipSizes .dip-size').evaluateAll(els => els.map(e => [e.dataset.size, e.querySelector('.dip-left').textContent.trim(), e.disabled]));

test('sl dipløria: the tab after Merch, 38 SKUs with the sheet stock, one card per model with «N left», 61 in all (Retro 32 sold out, greyed)', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  const tabs = await frame.locator('#catTabs button').allInnerTexts();
  expect(tabs.slice(-2)).toEqual(['Merch', 'Dipløria']);
  const menu = await frame.evaluate(() => MENU.Diploria.map(i => [i.n, i.stk, i.p]));
  expect(menu).toEqual(SKUS.map(s => [s.name, s.qty, PRICE(s.model)]));
  await cat(frame, 'Dipløria');
  await expect(frame.locator('#dipTotal')).toHaveText('61 left of 61');
  expect(await modelLeft(frame)).toEqual(NOW.models.map(x => [x.model, `${x.qty.reduce((a, b) => a + b, 0)} left`]));
  await expect(frame.locator('#dipModels .dip-model').first().locator('.ci-price')).toHaveText('€55');
  // the read-only Stock grid = the sheet, cell by cell (left / initial; – = no such size)
  await frame.locator('#dipStockBtn').click();
  const grid = await frame.locator('#dipStock tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(c => c.textContent.trim())));
  expect(grid).toEqual(NOW.models.map(x => [x.model, ...x.qty.map((q, si) => q ? `${q}/${q}` : (x.model === 'Retro' && si === 3 ? '0/0' : '–')), `${x.qty.reduce((a, b) => a + b, 0)}/${x.qty.reduce((a, b) => a + b, 0)}`, '0']));
  const foot = await frame.locator('#dipStock tfoot td').allInnerTexts();
  expect(foot.map(s => s.replace(/\s/g, ''))).toEqual(['7/7', '20/20', '13/13', '8/8', '4/4', '9/9', '61/61', '0']);
  // Retro: 4 left, size 32 greyed
  await frame.locator('#dipStockBtn').click();
  await frame.locator('#dipModels .dip-model[data-model="Retro"]').click();
  expect(await sizeRow(frame)).toEqual([['28', '1 left', false], ['30', '3 left', false], ['31', 'none', true], ['32', 'none', true], ['33', 'none', true], ['34', 'none', true]]);
});

test('sl dipløria: model → size (0 greyed), a tap adds «Core Black 28» at its price and goes back; the last one sold → disabled; removed from the tab → back', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Dipløria');
  await frame.locator('#dipModels .dip-model[data-model="Core Black"]').click();
  expect(await sizeRow(frame)).toEqual([['28', '1 left', false], ['30', '3 left', false], ['31', '2 left', false], ['32', 'none', true], ['33', 'none', true], ['34', '2 left', false]]);
  await frame.locator('#dipSizes .dip-size[data-size="28"]').click();
  await expect(frame.locator('#dipModels')).toBeVisible();                                   // back to the models
  await expect(frame.locator('#dipModels .dip-model[data-model="Core Black"] .ci-desc')).toHaveText('7 left');
  await expect(frame.locator('#dipTotal')).toHaveText('60 left of 61 · 1 sold');
  const line = await frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => [i.n, i.p, i.c]));
  expect(line).toEqual([['Core Black 28', 55, 'Diploria']]);
  await frame.locator('#dipModels .dip-model[data-model="Core Black"]').click();
  expect((await sizeRow(frame))[0]).toEqual(['28', 'none', true]);                          // the last one: disabled
  expect(await frame.evaluate(() => stockLeftForCategory(MENU.Diploria.find(i => i.n === 'Core Black 28'), 'Diploria'))).toBe(0);
  // Taken off the tab → back on the shelf
  await frame.evaluate(() => { const g = findConsumer(AG, 'guests'); delItem(g.items.findIndex(i => i.n === 'Core Black 28')); });
  await frame.evaluate(() => { DIP_MODEL = 'Core Black'; renderItemGrid(); });
  expect((await sizeRow(frame))[0]).toEqual(['28', '1 left', false]);
  await frame.locator('#dipBack').click();
  await expect(frame.locator('#dipTotal')).toHaveText('61 left of 61');
});

test('sl dipløria: two quick taps on the last unit add one; no path adds past the stock', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Leo');
  await cat(frame, 'Dipløria');
  const r = await frame.evaluate(() => {
    DIP_MODEL = 'Euphoria Blue'; renderItemGrid();
    const b = document.querySelector('#dipSizes .dip-size[data-size="30"]');
    dipAddSize('30', b); DIP_MODEL = 'Euphoria Blue'; dipAddSize('30', b);               // the second tap lands on the same, now empty, size
    addItemByName('Euphoria Blue 30');                                                     // any other path refuses too
    const n = findConsumer(AG, 'guests').items.filter(i => i.n === 'Euphoria Blue 30').length;
    dipBack();
    return n;
  });
  expect(r).toBe(1);
  await expect(frame.locator('#dipModels .dip-model[data-model="Euphoria Blue"] .ci-desc')).toHaveText('2 left');
});

test('sl dipløria: the other Sri Lanka tabs are unchanged (Drinks, Tours, Merch; Extras hidden without rows); the Staff roster has no Dipløria price', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  expect(await frame.locator('#catTabs button').allInnerTexts()).toEqual(['Drinks', 'Tours/Activities', 'Merch', 'Dipløria']);
  await cat(frame, 'Drinks');
  await expect(frame.locator('#itemGrid .ci-name', { hasText: 'Lion Lager' })).toBeVisible();
  await cat(frame, 'Merch');
  await expect(frame.locator('#itemGrid .ci-name', { hasText: 'T-Shirt M' })).toBeVisible();
  expect(await frame.evaluate(() => JSON.stringify(LOCATION_TAB_CONFIG.portugal))).toBe(JSON.stringify(['Tours', 'Extras', 'Merch', 'Diploria', 'Bar Tab']));
});

test('portugal diploria unchanged: «Diploria» tab with its «Size 28…34» cards and «N left», no model picker', async ({ page }) => {
  const { frame } = await openCampTab(page, 'portugal');
  await addConsumer(frame, 'Ana');
  expect(await frame.locator('#catTabs button').allInnerTexts()).toContain('Diploria');
  await cat(frame, 'Diploria');
  await expect(frame.locator('#dipModels')).toHaveCount(0);
  const cards = await frame.locator('#itemGrid .c-item').evaluateAll(els => els.map(e => [e.querySelector('.ci-name').textContent.trim(), (e.querySelector('.ci-desc') || {}).textContent.trim()]));
  expect(cards).toEqual([['Size 28', '9 left'], ['Size 30', '15 left'], ['Size 31', '9 left'], ['Size 32', '4 left'], ['Size 33', '3 left'], ['Size 34', '2 left']]);
});

test('sl dipløria: screenshots at 390 and 1280 — models, sizes, stock grid — no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Dipløria');
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const v of ['models', 'sizes', 'stock']) {
      await frame.evaluate(v => { DIP_STOCK_VIEW = v === 'stock'; DIP_MODEL = v === 'sizes' ? 'Core Burgundy' : null; renderItemGrid(); }, v);
      await page.waitForTimeout(150);
      const over = await frame.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(over, `${v} at ${w}`).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await frame.locator('#itemGrid').screenshot({ path: path.join(SHOTS, `diploria-${v}-${w}.png`) });
    }
  }
});

// ── 55 EUR, pass-through: paid on its own by card to Dipløria, never camp money (Miguel, 15 Nov) ──────────
const addLines = async (frame, guest, ...names) => {
  await addConsumer(frame, guest);
  for (const n of names) {
    if (/ \d\d$/.test(n)) await frame.evaluate(n => { const it = MENU.Diploria.find(i => i.n === n); AC = 'Diploria'; addResolvedItem(it); }, n);
    else await frame.evaluate(n => { const it = MENU.Drinks.find(i => i.n === n); AC = 'Drinks'; addResolvedItem(it); }, n);
  }
};
const perItemRows = ctl => (ctl.T.ledger_entries || []).filter(r => /^camp_tab/.test(String(r.source_kind || '')));

test('sl dipløria €: its own block with a € subtotal, never in the LKR total; Pay counts the camp lines only; stored as EUR', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addLines(frame, 'Marie', 'Core Black 28', 'Lion Lager', 'Pocket Navy 30');
  await expect(frame.locator('#tabTotal')).toHaveText('LKR 600');
  await expect(frame.locator('#passBlock')).toContainText('Dipløria · paid by card to Dipløria, not camp money');
  await expect(frame.locator('#passTotal')).toHaveText('€110');
  await expect(frame.locator('#passBlock .ctr-price')).toHaveText(['€55', '€55']);
  await expect(frame.locator('#passPayBtn')).toHaveText('Pay Dipløria · €110');
  await expect(frame.locator('#payBtn')).toHaveText('Pay');                       // one camp line (Lion Lager)
  await expect(frame.locator('#tabList .c-tab-row:not([data-pass])')).toHaveCount(1);
  await expect.poll(() => (ctl.T.camp_tab_items || []).filter(r => r.category === 'Diploria').map(r => [r.item_name, Number(r.price_local), r.currency]).sort(), { timeout: 8000 })
    .toEqual([['Core Black 28', 55, 'EUR'], ['Pocket Navy 30', 55, 'EUR']]);
  expect((ctl.T.camp_tab_items || []).find(r => r.item_name === 'Lion Lager').currency).toBe('LKR');
  // The Bill (camp part) has no Dipløria line, only the short note under it.
  await frame.locator('.c-btn-bill').click();
  await expect(frame.locator('#billBody')).not.toContainText('Core Black 28');
  await expect(frame.locator('#billBody')).toContainText('Lion Lager');
  await expect(frame.locator('#billPass')).toHaveText('Dipløria (paid by card to Dipløria, not on this bill): 2 shorts · €110 to pay');
});

test('sl dipløria €: «Pay Dipløria» pays only those lines (Card → Dipløria) with NO ledger row; the camp Pay leaves Dipløria unpaid', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addLines(frame, 'Marie', 'Core Black 28', 'Lion Lager');
  await frame.locator('#passPayBtn').click();                                     // confirm accepted
  await expect(frame.locator('#passBlock .pass-done')).toHaveText('Dipløria paid · Card → Dipløria');
  let st = await frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => [i.n, !!i.paidAt, i.payMethod || '']));
  expect(st).toEqual([['Core Black 28', true, 'Card → Dipløria'], ['Lion Lager', false, '']]);
  await page.waitForTimeout(1200);
  expect(perItemRows(ctl)).toEqual([]);                                          // nothing in the ledger
  await expect.poll(() => (ctl.T.camp_tab_items || []).find(r => r.item_name === 'Core Black 28')?.paid_at || null).not.toBeNull();
  expect(JSON.parse(JSON.stringify((ctl.T.camp_tab_items || []).find(r => r.item_name === 'Core Black 28').meta)).payMethod).toBe('Card → Dipløria');
  await frame.locator('#payBtn').click();
  await expect.poll(() => perItemRows(ctl).map(r => [r.description, Number(r.amount_local)])).toEqual([['Camp Tab · Marie · Lion Lager', 600]]);
  // The other way round: camp first, Dipløria still to pay.
  await addLines(frame, 'Jules', 'Lion Lager', 'Retro 28');
  await frame.locator('#payBtn').click();
  await expect.poll(() => perItemRows(ctl).length).toBe(2);
  st = await frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => [i.n, !!i.paidAt]));
  expect(st).toEqual([['Lion Lager', true], ['Retro 28', false]]);
  await expect(frame.locator('#passPayBtn')).toHaveText('Pay Dipløria · €55');
  expect(perItemRows(ctl).map(r => r.description).sort()).toEqual(['Camp Tab · Jules · Lion Lager', 'Camp Tab · Marie · Lion Lager']);
});

test('sl dipløria €: no ledger row on any path — per item, per guest, closed week (hub and camp tab), and no Merch revenue', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  const hub = await page.evaluate(() => {
    const dip = { id: 'd1', c: 'Diploria', n: 'Core Black 28', p: 55, paidAt: '2026-11-15T10:00:00Z' }, beer = { id: 'b1', c: 'Drinks', n: 'Lion Lager', p: 600 };
    const guest = { id: 'g1', name: 'Marie', paid: true, items: [dip, { ...beer, paidAt: '2026-11-15T10:00:00Z' }] };
    return {
      perItem: buildPaidItemRevenueEntry(guest, dip, { date: '2026-11-15' }),
      perGuest: buildPaidGuestRevenueEntries(guest, { date: '2026-11-15' }).map(e => e.category),
      week: buildClosedWeekRevenueEntries({ id: 'w1', start: '2026-11-14', guests: [{ id: 'g2', name: 'Leo', paid: true, items: [{ id: 'd2', c: 'Diploria', n: 'Retro 30', p: 55 }, { id: 'b2', c: 'Drinks', n: 'Lion Lager', p: 600 }] }], staff: [] }).map(e => [e.category, e.amountLocal]),
      category: mapCampTabRevenueCategory(dip),
    };
  });
  expect(hub.perItem).toBeNull();
  expect(hub.perGuest).toEqual(['Drinks']);
  expect(hub.week).toEqual([['Drinks', 600]]);
  // A stray item-paid message for a Dipløria line writes nothing either.
  await page.evaluate(() => window.postMessage({ type: 'camp-tab-item-paid', guest: { id: 'gx', name: 'Stray' }, item: { id: 'dx', c: 'Diploria', n: 'Core Black 30', p: 55 }, date: '2026-11-15' }, '*'));
  // The camp tab's own week close (weekly mode path) leaves it out too.
  const weekly = await frame.evaluate(() => { const sent = []; const orig = window.parent.postMessage.bind(window.parent);
    window.parent.postMessage = (m, o) => { sent.push(m && m.type); };
    try { syncClosedWeekToHubLedger({ id: 'w2', start: '2026-11-14', guests: [{ id: 'g3', name: 'Ana', paid: true, items: [{ id: 'd3', c: 'Diploria', n: 'Retro 30', p: 55 }] }], staff: [] }); } finally { window.parent.postMessage = orig; }
    return sent; });
  expect(weekly).toEqual([]);
  await page.waitForTimeout(800);
  expect(perItemRows(ctl)).toEqual([]);
  expect((ctl.T.ledger_entries || []).filter(r => r.category === 'Merchandise')).toEqual([]);
});

test('sl dipløria €: Close guest is refused while Dipløria is unpaid («Dipløria not paid»); after «Pay Dipløria» it closes', async ({ page }) => {
  const { frame } = await openCampTab(page);
  const dialogs = []; page.removeAllListeners('dialog'); page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await addLines(frame, 'Marie', 'Core Black 28');
  await frame.locator('#closeGuestBtn').click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('Dipløria not paid — Marie has 1 Dipløria short (€55).');
  expect(await frame.evaluate(() => !!findConsumer(AG, 'guests') && !findConsumer(AG, 'guests').closedAt)).toBe(true);
  await frame.locator('#passPayBtn').click();
  await frame.locator('#closeGuestBtn').click();
  await expect.poll(() => frame.evaluate(() => AG)).toBeNull();
  const closed = await frame.evaluate(() => S.activeWeek.guests.find(g => g.name === 'Marie').closedAt);
  expect(closed).toBeTruthy();
});

test('sl dipløria €: the sales list (date, guest, short, €55, paid · method / not paid) and totals; the Leaving chips ignore Dipløria', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addLines(frame, 'Marie', 'Core Black 28');
  await frame.locator('#passPayBtn').click();
  await addLines(frame, 'Leo', 'Essential Grey 33');
  await frame.evaluate(() => { AC = 'Diploria'; DIP_STOCK_VIEW = true; renderItemGrid(); });
  await expect(frame.locator('#dipSalesTot')).toHaveText('2 sold · €110 · paid €55 · not paid €55');
  const rows = await frame.locator('#dipSales tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].slice(1).map(c => c.textContent.trim())));
  expect(rows.map(r => r.slice(0, 3))).toEqual(expect.arrayContaining([['Marie', 'Core Black 28', '€55'], ['Leo', 'Essential Grey 33', '€55']]));
  expect(rows.find(r => r[0] === 'Marie')[3]).toMatch(/^\d{4}-\d{2}-\d{2} · Card → Dipløria$/);
  expect(rows.find(r => r[0] === 'Leo')[3]).toBe('not paid');
  const chips = await page.evaluate(() => { const today = CampExtras.colomboToday(); const ms = new Date(today + 'T00:00:00').getTime();
    return CampExtras.leavingGroups({ activeWeek: { guests: [{ name: 'Only Dip', bookingCo: ms, items: [{ c: 'Diploria', n: 'Core Black 28', p: 55 }] }, { name: 'Beer', bookingCo: ms, items: [{ c: 'Drinks', n: 'Lion Lager', p: 600 }] }] } }, today); });
  expect(chips.today.map(x => [x.name, x.amount])).toEqual([['Beer', 600]]);
});

test('sl dipløria €: screenshots of the guest tab with the Dipløria block at 390 and 1280, no overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { frame } = await openCampTab(page);
  await addLines(frame, 'Marie', 'Core Black 28', 'Lion Lager', 'Pocket Navy 30');
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await frame.locator('#passBlock').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `diploria-tab-${w}.png`) });
  }
});

test('sl dipløria €: the Overview card shows € sold and units, «paid to Dipløria · not camp revenue»', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addLines(frame, 'Marie', 'Core Black 28');
  await frame.locator('#passPayBtn').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => showPage('overview'));
  const card = page.locator('.ov-area-card', { hasText: 'Dipløria' });
  await expect(card).toContainText('€55');
  await expect(card).toContainText('paid to Dipløria · not camp revenue');
  await expect(card).not.toContainText('LKR');
});
