// /prices v3 (17 Nov 2026) — Miguel: «as páginas dos preços ainda estão com designs antigos». The page on the shared
// shell, inline price editing, season timeline, undo after delete, view-only members, and the «Price list PDF».
// Stubbed Supabase over the production rows (tests/prices-data.js): nothing reaches a real database.
const { test, expect } = require('@playwright/test');
const { openPrices, stubPrices, DATA } = require('./prices-stub');
const { collectFatalErrors } = require('./helpers');
const PriceList = require('../lib/price-list.js');

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const AREAS = ['accommodation', 'surf', 'tours', 'transfers', 'merch', 'extras', 'drinks', 'addons', 'costs'];

for (const vw of [390, 1280]) {
  test(`every area of every camp renders at ${vw}px with no sideways scroll`, async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: vw, height: 900 });
    for (const slug of ['portugal', 'morocco', 'sri-lanka', 'junior-camp', 'surf-school']) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await openPrices(page, slug);
      const areas = await page.evaluate(() => [...document.querySelectorAll('#areaTabs [data-area]')].map(b => b.dataset.area));
      for (const a of areas) {
        await page.locator(`#areaTabs [data-area="${a}"]`).click();
        await expect(page.locator(`#areaTabs [data-area="${a}"]`)).toHaveClass(/active/);
        await expect(page.locator('#tableWrap')).not.toBeEmpty();
        if (a === 'accommodation' && slug !== 'surf-school' && slug !== 'junior-camp') await expect(page.locator('#accomCard')).toBeVisible();
        expect(await noSideScroll(page), `${slug} ${a} @${vw}`).toBe(true);
      }
      if (slug === 'surf-school') expect(areas[0]).toBe('surf');                         // the school lands on its only tab
      if (slug === 'junior-camp') expect(areas).toContain('other');                       // «Transfer» rows are no longer invisible
    }
    expect(errors).toEqual([]);
  });
}

test('shell header: camp switch, Edit / Price list tabs, user chip; the PDF button and one blue button in the page head', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPrices(page, 'morocco');
  await expect(page.locator('.app-nav #pricesLocLabel')).toHaveText('Morocco');
  await expect(page.locator('#pricesLocSwitch a[data-loc="morocco"]')).toHaveClass(/is-current/);
  await expect(page.locator('.app-nav .ntab')).toHaveText(['Edit', 'Price list']);
  await expect(page.locator('#userChip')).toHaveText('miguel@gotadaguasurf.com');
  await page.locator('#areaTabs [data-area="tours"]').click();
  await expect(page.locator('main .btn-p:visible')).toHaveCount(1);
  await expect(page.locator('#pdfBtn')).toBeVisible();
  await page.locator('.app-nav .ntab', { hasText: 'Price list' }).click();
  await expect(page.locator('#newEntryBtn')).toBeHidden();
  await expect(page.locator('#tableWrap')).toContainText('Souk Tour');
  await expect(page.locator('#tableWrap')).not.toContainText('Imported from');           // internal notes stay internal
});

test('accommodation: tap a season price, type, Enter → one PATCH with the new price; the timeline shows each season', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const ctl = await openPrices(page, 'portugal');
  await expect(page.locator('#seasonCard .tl-track')).toHaveCount(2);                     // 2026 + 2027
  await expect(page.locator('#seasonCard .tl-seg.high').first()).toBeVisible();
  const cell = page.locator('#accomcell_pk-5_se-13_rt-25_1');
  await expect(cell).toHaveText('€429');
  await cell.click();
  await page.locator('#accomcell_pk-5_se-13_rt-25_1 input').fill('439');
  await page.keyboard.press('Enter');
  await expect(cell).toHaveText('€439');
  await expect(cell).not.toHaveClass(/saving/);
  await expect.poll(() => ctl.writes.length).toBe(1);
  const w = ctl.writes.filter(x => x.table === 'accommodation_prices');
  expect(w).toHaveLength(1);
  expect(w[0]).toMatchObject({ method: 'PATCH', body: { sell_price: 439 } });
  expect(await page.evaluate(() => accomData.prices.find(p => p.pack_id === 'pk-5' && p.season_id === 'se-13' && p.room_type_id === 'rt-25' && p.occupancy === 1).sell_price)).toBe(439);
});

test('flexible pack at 3 nights: the cell shows 3 × the night and a typed total is saved per night', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ctl = await openPrices(page, 'portugal');
  await page.locator('.pack-bar .pill', { hasText: 'Flexible' }).click();
  await page.locator('.nights-row .pill', { hasText: /^3$/ }).click();
  const cell = page.locator('#accomcell_pk-6_se-13_rt-25_1');
  await expect(cell).toHaveText('€183.84');                                               // 61.28 × 3
  await cell.click();
  await page.locator('#accomcell_pk-6_se-13_rt-25_1 input').fill('210');
  await page.keyboard.press('Enter');
  await expect.poll(() => ctl.writes.filter(x => x.table === 'accommodation_prices').length).toBe(1);
  expect(ctl.writes.find(x => x.table === 'accommodation_prices').body).toEqual({ sell_price: 70 });
  expect(await noSideScroll(page)).toBe(true);
});

test('phone: change a tour price inline in a few taps; Escape cancels without a write', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ctl = await openPrices(page, 'portugal');
  await page.locator('#areaTabs [data-area="tours"]').click();
  const row = page.locator('tr[data-row-id="pc-328"]');                                   // Paradise Beach €40
  const price = row.locator('.cell-edit[data-field="sell_price"]');
  await expect(price).toHaveText('€40.00');
  await price.click();
  await row.locator('input').fill('99');
  await page.keyboard.press('Escape');
  await expect(price).toHaveText('€40.00');
  expect(ctl.writes).toHaveLength(0);
  await price.click();
  await row.locator('input').fill('45');
  await page.keyboard.press('Enter');
  await expect(page.locator('tr[data-row-id="pc-328"] .cell-edit[data-field="sell_price"]')).toHaveText('€45.00');
  await expect.poll(() => ctl.writes.length).toBe(1);
  expect(ctl.writes).toEqual([expect.objectContaining({ table: 'pricing_catalog', method: 'PATCH', body: { sell_price: 45 } })]);
  expect(await noSideScroll(page)).toBe(true);
});

test('Camp Tab / quick-add switch in the row saves the flag', async ({ page }) => {
  const ctl = await openPrices(page, 'portugal');
  await page.locator('#areaTabs [data-area="tours"]').click();
  const t = page.locator('tr[data-row-id="pc-328"] td[data-label="Camp Tab"] .toggle');
  await expect(t).toHaveText('On');
  await t.click();
  await expect(page.locator('tr[data-row-id="pc-328"] td[data-label="Camp Tab"] .toggle')).toHaveText('Off');
  expect(ctl.writes).toHaveLength(1);
  expect(ctl.writes[0]).toMatchObject({ table: 'pricing_catalog', method: 'PATCH', body: { show_in_camp_tab: false } });
});

test('delete asks first, then «Undo» puts the same row back (same id)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const ctl = await openPrices(page, 'portugal');
  await page.locator('#areaTabs [data-area="tours"]').click();
  await page.locator('tr[data-row-id="pc-328"] .btn-danger').click();
  await expect(page.locator('#confirmOv')).toHaveClass(/open/);
  await page.locator('#confirmCancel').click();
  expect(ctl.writes).toHaveLength(0);
  await page.locator('tr[data-row-id="pc-328"] .btn-danger').click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('tr[data-row-id="pc-328"]')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Deleted «Paradise Beach»');
  await page.locator('#undoBtn').click();
  await expect(page.locator('tr[data-row-id="pc-328"]')).toHaveCount(1);
  expect(ctl.writes.map(w => w.method)).toEqual(['DELETE', 'POST']);
  expect(ctl.writes[1].body).toMatchObject({ id: 'pc-328', name: 'Paradise Beach', sell_price: 40, category: 'Tour' });
});

test('view-only member: no costs, no margins, no editing, no New item', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const ctl = await openPrices(page, 'morocco');
  await page.evaluate(() => { canEdit = false; canViewCosts = false; renderShell(); filterArea = 'transfers'; renderTable(); });
  await expect(page.locator('#newEntryBtn')).toHaveCount(0);
  await expect(page.locator('#tableWrap')).not.toContainText('Driver cost');
  await expect(page.locator('#tableWrap')).not.toContainText('MAD 250');
  await expect(page.locator('[data-tf-margin]')).toHaveCount(0);
  await page.locator('.cell-edit[data-field="sell_price"]').first().click();
  await expect(page.locator('.cell-input')).toHaveCount(0);
  await page.evaluate(() => { filterArea = 'tours'; renderTable(); });
  await expect(page.locator('td[data-label="Cost"], td[data-label="Margin"]')).toHaveCount(0);
  await page.evaluate(() => { onSearch('souk'); });
  await expect(page.locator('td[data-label="Cost"]')).toHaveCount(0);
  expect(ctl.writes).toHaveLength(0);
});

test('search looks across every tab of the camp', async ({ page }) => {
  await openPrices(page, 'morocco');
  await page.locator('#searchInput').fill('dunes');
  await expect(page.locator('#tableWrap .card-title')).toHaveText('Search results');
  const names = await page.locator('#tableWrap .item-name').allTextContents();
  expect(names).toEqual(expect.arrayContaining(['Dunes — Sandboarding', 'Dunes — Car']));   // a tour and a van
  await page.locator('#searchInput').fill('zzz');
  await expect(page.locator('#tableWrap .empty-title')).toContainText('Nothing matches');
});

test('tabs sheet: hiding a built-in tab asks first and writes hidden=true', async ({ page }) => {
  const ctl = await openPrices(page, 'portugal');
  await page.locator('#manageTabsBtn').click();
  await expect(page.locator('#tabsOv')).toHaveClass(/open/);
  await page.locator('[data-tab-row="drinks"] .btn').click();
  await expect(page.locator('#confirmText')).toContainText('every camp');
  await page.locator('#confirmOk').click();
  await expect.poll(() => ctl.writes.length).toBe(1);
  expect(ctl.writes[0]).toMatchObject({ table: 'pricing_areas', method: 'POST', body: { key: 'drinks', hidden: true } });
  await expect(page.locator('#areaTabs [data-area="drinks"]')).toHaveCount(0);
  await expect(page.locator('[data-tab-row="drinks"]')).toContainText('Hidden');
});

test('«Price list PDF» → «Create PDF» opens the print page for this camp with the chosen sections', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPrices(page, 'sri-lanka');
  await page.locator('#pdfBtn').click();
  await expect(page.locator('#pdf_camp')).toHaveValue('sri-lanka');
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#pdfCreate').click()]);
  const u = new URL(popup.url());
  expect(u.pathname).toBe('/prices/pricelist.html');
  expect(Object.fromEntries(u.searchParams)).toEqual({ location: 'sri-lanka', period: 'upcoming', sections: 'accommodation,surf,tours,transfers,addons', print: '1' });
});

// ── the price list itself ────────────────────────────────────────────────────
function campFromData(slug) {
  const L = DATA.locations.find(l => l.slug === slug);
  const of = (t) => DATA[t].filter(r => r.location_id === L.id);
  return { slug, label: L.name, catalog: of('pricing_catalog'),
    accom: { packs: of('accommodation_packs'), seasons: of('accommodation_seasons'), rooms: of('accommodation_room_types'), prices: of('accommodation_prices') } };
}

test('price list model: prices from the tables in their own currency, «up to N persons» from covers_pax, no internal notes, dates by period', () => {
  const m = PriceList.buildModel({ camps: [campFromData('sri-lanka')], period: 'all', today: '2026-11-17', sections: ['accommodation', 'surf', 'tours', 'transfers', 'addons'] });
  const sl = m.camps[0];
  const transfers = sl.parts.find(p => p.key === 'transfers').rows;
  expect(transfers).toEqual([
    { route: 'Airport → Surfcamp', vehicle: 'Car', covers: 3, price: '€80' },
    { route: 'Airport → Surfcamp', vehicle: 'Minivan', covers: 3, price: '€95' },
    { route: 'Surfcamp → Airport', vehicle: 'Car', covers: 3, price: '€80' },
    { route: 'Surfcamp → Airport', vehicle: 'Minivan', covers: 3, price: '€95' }]);   // tuk-tuks / camp runs at 0 are left out
  const tours = sl.parts.find(p => p.key === 'tours').rows;
  expect(tours.find(r => r.name === 'Cooking Class')).toEqual({ name: 'Cooking Class', note: '', price: 'LKR 6,000', group: false });
  expect(JSON.stringify(m)).not.toMatch(/Imported from|cost_per_guest|20,500|20500/);
  expect(sl.notes).toContain('Transfer prices are per transfer; one transfer covers up to 3 persons.');
  expect(m.title).toBe('Sri Lanka');
  // upcoming: a season whose dates are all past is dropped; ranges are not clipped
  const pt = PriceList.buildModel({ camps: [campFromData('portugal')], period: 'upcoming', today: '2026-11-17', sections: ['accommodation'] }).camps[0];
  expect(pt.accommodation[0].seasons.map(s => [s.label, s.dates])).toEqual([['Low Season', ['7 Nov – 18 Dec 2026']], ['High Season', ['19 Dec 2026 – 2 Jan 2027']]]);
  const y27 = PriceList.buildModel({ camps: [campFromData('portugal')], period: '2027', today: '2026-11-17', sections: ['accommodation'] });
  expect(y27.camps[0].accommodation[0].seasons.map(s => s.label)).toEqual(['High Season']);
  expect(y27.period).toBe('2026 – 2027');
});

test('price list page: A4 print with no overflow (long names, 5 sharing columns), prints by itself, file name in the title', async ({ page }) => {
  await stubPrices(page, { mutate: (db) => {
    db.pricing_catalog.push({ id: 'long-1', location_id: 'loc-pt', name: 'Sunset Yoga, Breathwork and Cold Plunge Experience on the Beach with a Local Teacher', category: 'Tour', sell_price: 1234.5, sell_currency: 'EUR', active: true, notes: 'A very long description '.repeat(12) });
    ['se-13', 'se-14', 'se-15'].forEach((s, i) => db.accommodation_prices.push({ id: 'occ5-' + i, location_id: 'loc-pt', pack_id: 'pk-5', season_id: s, room_type_id: 'rt-30', occupancy: 5, sell_price: 10999, currency: 'EUR' }));
  } });
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  const errors = collectFatalErrors(page);
  await page.goto('/prices/pricelist.html?location=all&period=all&sections=accommodation,surf,tours,transfers,addons,bar&print=1');
  await page.waitForFunction(() => window.__priceListReady === true, null, { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__printed === true)).toBe(true);
  await expect(page).toHaveTitle('Gota Dagua price list - All camps 2026–2027');
  await expect(page.locator('.pl-camp')).toHaveCount(5);
  await expect(page.locator('.pl-camp[data-camp="portugal"] .pl-season thead tr:nth-child(2) th').first()).toBeVisible();
  await expect(page.locator('.pl-cover')).toContainText('+351 924 689 580');
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });                                  // A4 at 96 dpi
  const over = await page.evaluate(() => {
    const bad = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('page ' + document.documentElement.scrollWidth);
    document.querySelectorAll('.pl-table').forEach((t, i) => { if (t.scrollWidth > t.clientWidth + 1) bad.push('table ' + i); });
    document.querySelectorAll('.pl-table td').forEach(td => { if (td.scrollWidth > td.clientWidth + 1) bad.push('cell ' + td.textContent.slice(0, 30)); });
    return bad;
  });
  expect(over).toEqual([]);
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  expect(pdf.length).toBeGreaterThan(20000);
  expect(errors).toEqual([]);
});
