// ════════════════════════════════════════════════════════════════════════════
//  BAR PROFIT — Miguel, 15 Nov 2026: «Meter categoria de bebidas do bar (Water
//  dispenser meter separado) … era para ter o lucro real».
//
//   • «Drinks» = bar stock; the water dispenser goes to «Drinking water»
//     (area Utilities), so it never counts against the bar.
//   • The Overview «Bar» card = bar sales − bar drinks bought, margin %, local
//     currency + EUR, for the period picked.
//   • Grouped Camp Tab checkout rows (qty > 1) still feed Merch cost of goods
//     and the tour counts.
//
//  Hermetic: Supabase is stubbed, nothing is written.
// ════════════════════════════════════════════════════════════════════════════
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');

const LOC = '83cda02b-0000-4000-8000-0000000ba400';
const SHOTS = process.env.BAR_SHOTS || '';
let n = 0;
const row = (o) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  location_id: LOC, week_id: null, qty: 1, currency: 'LKR', fx_rate: 400,
  payment_method: 'Cash', source_kind: 'manual', is_comp: false, zone_id: null,
  linked_item: null, paid_from: null, attributed_location: null,
  created_at: '2026-11-01T10:00:00Z', ...o,
  amount_eur: o.amount_eur ?? Number((o.amount_local / 400).toFixed(2)),
});
// November in Sri Lanka: bar sales 20,000 (one grouped checkout line of 3 drinks
// + one old per-item line), bar drinks bought 8,000, the dispenser 9,000 in its
// own category, food 5,000. October has bar rows too (must not leak into Nov).
const SL_ROWS = [
  row({ type: 'revenue', category: 'Drinks', business_area: 'Bar', amount_local: 4400, qty: 3, entry_date: '2026-11-10', description: 'Camp Tab · Anna · Drinks: Lion Lager ×2, Cocktail', source_kind: 'camp_tab_per_guest' }),
  row({ type: 'revenue', category: 'Drinks', business_area: 'Bar', amount_local: 600, entry_date: '2026-11-11', description: 'Camp Tab · Leo · Lion Lager', source_kind: 'camp_tab_per_item' }),
  row({ type: 'revenue', category: 'Drinks', business_area: 'Bar', amount_local: 15000, entry_date: '2026-11-12', description: 'Bar cash night' }),
  row({ type: 'expense', category: 'Drinks', business_area: 'Bar', amount_local: 8000, entry_date: '2026-11-05', description: 'Bar Drinks · Dassana' }),
  row({ type: 'expense', category: 'Drinking water', business_area: 'Utilities', amount_local: 9000, entry_date: '2026-11-06', description: 'Water Dispenser' }),
  row({ type: 'expense', category: 'Food', business_area: 'Food', amount_local: 5000, entry_date: '2026-11-07', description: 'Market' }),
  row({ type: 'revenue', category: 'Drinks', business_area: 'Bar', amount_local: 50000, entry_date: '2026-10-20', description: 'October bar' }),
  row({ type: 'expense', category: 'Drinks', business_area: 'Bar', amount_local: 70000, entry_date: '2026-10-21', description: 'October stock' }),
  // Merch: 2 T-shirts on ONE grouped line (linked_item + qty 2) → cost of goods 2 × 2,500
  row({ type: 'revenue', category: 'Merchandise', business_area: 'Merch', linked_item: 'T-Shirt L', qty: 2, amount_local: 16000, entry_date: '2026-11-10', description: 'Camp Tab · Anna · T-Shirt L ×2', source_kind: 'camp_tab_per_guest' }),
  // Tours: 2 seats on one grouped line count as 2 paid guests
  row({ type: 'revenue', category: 'Tours', business_area: 'Tours', linked_item: 'River Safari', qty: 2, amount_local: 12000, entry_date: '2026-11-10', description: 'Camp Tab · Anna · River Safari ×2', source_kind: 'camp_tab_per_guest' }),
];
const MA_ROWS = [
  row({ type: 'expense', category: 'Food', business_area: 'Food', currency: 'MAD', fx_rate: 10.8, amount_local: 1000, amount_eur: 92.59, entry_date: '2026-11-07', description: 'Market' }),
];
const CATALOG_MERCH = [{ id: 'm1', name: 'T-Shirt L', sell_price: 8000, cost_per_guest: 2500, notes: '', sort_order: 1, stock_qty: 40, alt_price: null, alt_label: null }];

async function boot(page, { slug = 'sri-lanka', rows = SL_ROWS, viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([]);
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: slug === 'morocco' ? 'Morocco' : 'Sri Lanka', slug, currency: slug === 'morocco' ? 'MAD' : 'LKR' });
    if (url.includes('/rest/v1/ledger_entries')) return json(rows);
    if (url.includes('/rest/v1/pricing_catalog') && url.includes('category=eq.Merch')) return json(CATALOG_MERCH);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof HUB_LEDGER_HYDRATED !== 'undefined' && HUB_LEDGER_HYDRATED === true, null, { timeout: 15000 });
  return { errs };
}
async function overviewFor(page, month) {
  return page.evaluate((m) => {
    showPage('overview');
    const ms = document.getElementById('ovMonthSel'); if (![...ms.options].some(o => o.value === m)) ms.add(new Option(m, m)); ms.value = m;
    document.getElementById('ovWeekSel').value = 'all';
    renderOverview();
    const cards = [...document.querySelectorAll('#ovCatPanels .ov-area-card')];
    const card = (name) => cards.find(c => (c.querySelector('.ov-area-title')?.textContent || '').trim() === name);
    const bar = card('Bar');
    return {
      titles: cards.map(c => (c.querySelector('.ov-area-title')?.textContent || '').trim()).filter(Boolean),
      bar: bar ? bar.innerText.replace(/\s+/g, ' ') : null,
      barPct: bar ? bar.querySelector('[data-margin-pct]').textContent.trim() : null,
      merch: (card('Merch')?.innerText || '').replace(/\s+/g, ' '),
      tours: (document.getElementById('ovTourTotals')?.closest('.card')?.innerText || '').replace(/\s+/g, ' '),
    };
  }, month);
}
const norm = s => String(s || '').replace(/[  ]/g, ' ');

test('bar card (Sri Lanka): bar sales − bar drinks bought, the dispenser stays out; margin % in LKR and EUR, by period', async ({ page }) => {
  const { errs } = await boot(page, { viewport: { width: 1280, height: 900 } });
  const nov = await overviewFor(page, '2026-11');
  expect(nov.titles).toContain('Bar');
  expect(nov.titles).not.toContain('Drinks');
  const bar = norm(nov.bar);
  // revenue 4,400 + 600 + 15,000 = 20,000 · drinks bought 8,000 (not the 9,000 of water) · margin 12,000 = 60 %
  expect(bar).toContain('+LKR 12,000');
  expect(bar).toMatch(/REVENUE LKR 20,000 €50\.00/i);
  expect(bar).toMatch(/DRINKS BOUGHT LKR 8,000 €20\.00/i);
  expect(nov.barPct).toBe('60%');
  expect(bar).toContain('+€30.00');
  expect(bar).toContain('drinking water apart');
  // grouped Merch line: cost of goods = 2 × 2,500
  expect(norm(nov.merch)).toContain('LKR 5,000');
  // grouped tour line counts 2 paid guests
  expect(norm(nov.tours)).toContain('2 paid guests');
  // October on its own: 50,000 − 70,000 → −40 %
  const oct = await overviewFor(page, '2026-10');
  expect(norm(oct.bar)).toContain('-LKR 20,000');
  expect(oct.barPct).toBe('-40%');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.evaluate(() => { const ms = document.getElementById('ovMonthSel'); ms.value = '2026-11'; renderOverview(); document.getElementById('ovBarCard').scrollIntoView({ block: 'center' }); }); await page.screenshot({ path: path.join(SHOTS, 'bar-card-1280.png') }); }
  expect(errs).toEqual([]);
});

test('bar card at phone width: nothing pokes out, one column', async ({ page }) => {
  const { errs } = await boot(page, { viewport: { width: 390, height: 844 } });
  await overviewFor(page, '2026-11');
  const out = await page.evaluate(() => {
    const c = document.getElementById('ovBarCard'); c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { inside: r.left >= 0 && r.right <= innerWidth + 0.5, overflow: [...c.querySelectorAll('*')].filter(d => d.clientWidth > 0 && d.scrollWidth > d.clientWidth + 1).length, docScroll: document.documentElement.scrollWidth <= innerWidth + 1 };
  });
  expect(out).toEqual({ inside: true, overflow: 0, docScroll: true });
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator('#ovCatPanels').screenshot({ path: path.join(SHOTS, 'bar-card-390.png') }); }
  expect(errs).toEqual([]);
});

test('bar card (Morocco): hidden while the camp has no bar row; shown in MAD as soon as it has one', async ({ page }) => {
  const { errs } = await boot(page, { slug: 'morocco', rows: MA_ROWS });
  let o = await overviewFor(page, '2026-11');
  expect(o.titles).not.toContain('Bar');
  expect(o.titles).toContain('Merch');
  // a bar sale and a bar purchase land in Morocco
  await page.evaluate(() => {
    S.ledger.push(normalizeLedgerEntry({ id: 'ma-bar-rev', date: '2026-11-08', type: 'income', category: 'Drinks', businessArea: 'Bar', currency: 'MAD', fxRate: 10, amountLocal: 500, paymentMethod: 'Cash' }));
    S.ledger.push(normalizeLedgerEntry({ id: 'ma-bar-exp', date: '2026-11-08', type: 'expense', category: 'Drinks', businessArea: 'Bar', currency: 'MAD', fxRate: 10, amountLocal: 200, paymentMethod: 'Cash' }));
    S.ledger.push(normalizeLedgerEntry({ id: 'ma-water', date: '2026-11-08', type: 'expense', category: 'Drinking water', currency: 'MAD', fxRate: 10, amountLocal: 100, paymentMethod: 'Cash' }));
  });
  o = await overviewFor(page, '2026-11');
  expect(o.titles).toContain('Bar');
  expect(norm(o.bar)).toContain('MAD');
  expect(norm(o.bar)).toMatch(/REVENUE MAD 500/i);
  expect(norm(o.bar)).toMatch(/DRINKS BOUGHT MAD 200/i);
  expect(o.barPct).toBe('60%');
  expect(errs).toEqual([]);
});

test('«Drinking water»: its own category in the list, area Utilities; «Bar drinks» / «Drinking water» quick buttons', async ({ page }) => {
  const { errs } = await boot(page);
  const out = await page.evaluate(() => ({
    inList: EXP_CATS.includes('Drinking water') && EXP_CATS.indexOf('Drinking water') === EXP_CATS.indexOf('Drinks') + 1,
    area: inferArea('expense', 'Drinking water'),
    drinksArea: inferArea('expense', 'Drinks'),
    utilities: AREA_CONFIG.Utilities.expenseCats.includes('Drinking water'),
    bar: AREA_CONFIG.Bar.expenseCats,
    buttons: [...document.querySelectorAll('#expQuickBar .exp-quick-btn')].map(b => [b.dataset.cat, b.textContent.trim()]).filter(([c]) => /Drink/.test(c)),
  }));
  expect(out).toEqual({
    inList: true, area: 'Utilities', drinksArea: 'Bar', utilities: true, bar: ['Drinks'],
    buttons: [['Drinks', 'Bar drinks'], ['Drinking water', 'Drinking water']],
  });
  // the quick button opens a Drinking water expense
  await page.evaluate(() => showPage('expenses'));
  await page.locator('#expQuickBar .exp-quick-btn[data-cat="Drinking water"]').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('qe_cat').value)).toBe('Drinking water');
  expect(errs).toEqual([]);
});
