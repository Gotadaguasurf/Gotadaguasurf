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
  await expect(page.locator('#seasonCard .season-now')).toContainText('Now:');
  await expect(page.locator('#seasonCard .tl-band.high').first()).toBeVisible();
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
  await page.locator('#nightsSel').selectOption('3');                                     // «Show the total for 3 nights»
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
  await expect(page.locator('.cell-edit[data-field="cost_per_guest"]')).toHaveCount(0);
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
  expect(Object.fromEntries(u.searchParams)).toEqual({ location: 'sri-lanka', period: 'upcoming', sections: 'accommodation,surf,tours,transfers,addons', lang: 'en', print: '1' });
  await popup.close();
  // «Flexible pack (per night)» can be ticked, but always opens unticked — even after it was used last time
  await page.locator('#pdfBtn').click();
  const flex = page.locator('#pdf_sections input[value="flexible"]');
  await expect(flex).not.toBeChecked();
  await flex.check();
  const [p2] = await Promise.all([context.waitForEvent('page'), page.locator('#pdfCreate').click()]);
  expect(new URL(p2.url()).searchParams.get('sections')).toBe('accommodation,flexible,surf,tours,transfers,addons');
  await p2.close();
  await page.locator('#pdfBtn').click();
  await expect(flex).not.toBeChecked();
  // Language (19 Nov 2026): English by default, Português for this PDF only — the next open is English again
  await expect(page.locator('#pdf_lang')).toHaveValue('en');
  await page.locator('#pdf_lang').selectOption('pt');
  const [p3] = await Promise.all([context.waitForEvent('page'), page.locator('#pdfCreate').click()]);
  expect(new URL(p3.url()).searchParams.get('lang')).toBe('pt');
  await p3.close();
  await page.locator('#pdfBtn').click();
  await expect(page.locator('#pdf_lang')).toHaveValue('en');
  // «Camp shop» is its own choice and starts unticked (things sold at the camp are not part of what partners get)
  await expect(page.locator('#pdf_sections input[value="shop"]')).not.toBeChecked();
});

test('price list sections (19 Nov 2026): yoga is an activity, «Add-ons» = bought with the booking, «Camp shop» only when chosen; EN prints no Portuguese notes', () => {
  const all = ['accommodation', 'surf', 'tours', 'transfers', 'addons', 'shop', 'bar'];
  const m = (slug, sections, lang) => PriceList.buildModel({ camps: [campFromData(slug)], period: 'all', today: '2026-11-17', sections, lang }).camps[0];
  const names = (camp, key) => ((camp.parts.find(p => p.key === key) || { rows: [] }).rows).map(r => r.name);
  const ma = m('morocco', all), sl = m('sri-lanka', all), pt = m('portugal', all);
  for (const c of [ma, sl, pt]) {
    expect(names(c, 'addons').filter(n => /yoga/i.test(n))).toEqual([]);
    expect(names(c, 'surf').filter(n => /yoga/i.test(n))).toEqual([]);
  }
  expect(names(ma, 'tours')).toEqual(expect.arrayContaining(['Yoga Lesson']));
  expect(names(ma, 'addons')).toContain('Free Surf');
  expect(names(sl, 'tours')).toEqual(expect.arrayContaining(['5 Yoga Lessons']));
  expect(names(sl, 'shop')).toEqual(['Extra Dinner']);
  expect(names(pt, 'tours')).toEqual(expect.arrayContaining(['Yoga Class', '5x Yoga Pack']));
  expect(names(pt, 'shop')).toEqual(expect.arrayContaining(['Lost Key/Lock', 'Sunglasses', 'Surf Stick']));
  expect(names(pt, 'addons')).toContain('Equipment Insurance');
  expect(names(pt, 'addons').concat(names(pt, 'shop'))).not.toEqual(expect.arrayContaining(['Yoga Class']));
  // the shop is never printed unless ticked
  const def = m('portugal', ['accommodation', 'surf', 'tours', 'transfers', 'addons']);
  expect(def.parts.map(p => p.key)).not.toContain('shop');
  expect(def.parts.find(p => p.key === 'addons').title).toBe('Add-ons');
  expect(m('portugal', all, 'pt').parts.find(p => p.key === 'shop').title).toBe('Loja do camp');
  // notes: «Por semana.» reads «Per week.» in English and stays Portuguese in the Portuguese PDF; no Portuguese note in English
  const insEn = pt.parts.find(p => p.key === 'addons').rows.find(r => r.name === 'Equipment Insurance');
  const insPt = m('portugal', all, 'pt').parts.find(p => p.key === 'addons').rows.find(r => r.name === 'Equipment Insurance');
  expect([insEn.note, insPt.note]).toEqual(['Per week.', 'Por semana.']);
  const html = PriceList.render(PriceList.buildModel({ camps: ['portugal', 'morocco', 'sri-lanka', 'surf-school'].map(campFromData), period: 'all', today: '2026-11-17', sections: all }), { logo: '' });
  expect(html).not.toMatch(/Por semana|aulas?\b|Só com|prancha|véspera|Festa na praia|Banho de gelo/);
  expect(html).toContain('Weekly Pack only.');
});

test('price list (19 Nov 2026): Camp Tab price variants («Surf Lesson - 30») never reach the PDF', () => {
  const camp = campFromData('portugal');
  const extra = [
    { id: 'v30', category: 'Lesson', name: 'Surf Lesson - 30', sell_price: 30, active: true },
    { id: 'v3367', category: 'Lesson', name: 'Surf Lesson - 33.67', sell_price: 33.67, active: true },
    { id: 'p75', category: 'Lesson', name: 'Private Surf Lesson', sell_price: 75, active: true },
  ];
  const c2 = { ...camp, catalog: (camp.catalog || []).concat(extra) };
  const surf = PriceList.buildModel({ camps: [c2], period: 'all', today: '2026-11-17', sections: ['surf'] }).camps[0].parts.find(p => p.key === 'surf');
  const names = surf.rows.map(r => r.name);
  expect(names.filter(n => /\s-\s\d/.test(n))).toEqual([]);
  expect(names).toContain('Private Surf Lesson');
});

test('price list in Portuguese: every fixed text from the dictionary, pt-PT money and dates; product names as in the tables; English unchanged', () => {
  const sections = ['accommodation', 'flexible', 'surf', 'tours', 'transfers', 'addons', 'shop', 'bar'];
  const camps = ['portugal', 'morocco', 'sri-lanka', 'junior-camp', 'surf-school'].map(campFromData);
  const pt = PriceList.buildModel({ camps, period: 'all', today: '2026-11-17', sections, lang: 'pt' });
  const text = PriceList.render(pt, { logo: '' }).replace(/<[^>]+>/g, '|').replace(/&amp;/g, '&');
  const { en, pt: dict } = PriceList.I18N;
  const sample = (v) => (typeof v === 'function' ? v(3, 3) : v).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  // no English fixed string is left where Portuguese has its own (names from the tables may contain «Room», «Shared»…: whole cells only)
  const leftover = Object.keys(en).filter(k => dict[k] !== undefined && sample(en[k]) !== sample(dict[k]))
    .filter(k => text.split('|').map(t => t.trim()).includes(sample(en[k])) || (sample(en[k]).length > 12 && text.includes(sample(en[k]))));
  expect(leftover).toEqual([]);
  expect(Object.keys(en).filter(k => dict[k] === undefined)).toEqual([]);   // every key translated (camp names are PT-only)
  expect(pt.title).toBe('Todos os camps');
  expect(pt.fileTitle).toMatch(/^Gota Dagua tabela de preços - Todos os camps /);
  expect(pt.generated).toBe('17 nov 2026');
  expect(pt.camps.map(c => c.label)).toEqual(['Portugal', 'Marrocos', 'Sri Lanka', 'Junior Camp', 'Surf School']);
  const ptCamp = pt.camps[0];
  expect(ptCamp.accommodation[0].basis).toBe('Por pessoa, 7 noites');
  expect(ptCamp.accommodation[0].seasons.map(s => s.label)).toEqual(expect.arrayContaining(['Época baixa', 'Época alta']));
  expect(ptCamp.from).toBe('429\u00a0€');
  const flex = ptCamp.accommodation.find(p => p.flex);
  expect(flex.rooms[0].cells.flat().find(x => x.price).price).toMatch(/^\d+,\d{2}\u00a0€$/);   // «61,28 €»
  expect(ptCamp.accommodation[0].rooms.map(r => r.room)).toEqual(PriceList.buildModel({ camps: [campFromData('portugal')], period: 'all', today: '2026-11-17', sections }).camps[0].accommodation[0].rooms.map(r => r.room));
  const sl = pt.camps.find(c => c.slug === 'sri-lanka');
  expect(sl.parts.find(p => p.key === 'tours').rows.find(r => r.name === 'Cooking Class').price).toBe('LKR 6000');
  expect(sl.notes).toContain('Os preços de transfer são por transfer; um transfer leva até 3 pessoas.');
  expect(text).toContain('com pranchas');
  expect(text).toContain('até 3 pessoas');
  expect(text).toMatch(/\d+ (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez) /);
  expect(text).not.toMatch(/Book now|Gota d'Água|Gota d’Água/);
  // English stays as it was (no lang, or an unknown one)
  for (const lang of [undefined, 'xx']) {
    const m = PriceList.buildModel({ camps: [campFromData('portugal')], period: 'all', today: '2026-11-17', sections, lang });
    expect([m.title, m.camps[0].from, m.camps[0].accommodation[0].basis, m.lang]).toEqual(['Portugal', '€429', 'Per person, 7 nights', 'en']);
  }
  // the /prices page keeps calling the shared pieces in English after a Portuguese PDF was built
  expect(PriceList.money(61.28, 'EUR')).toBe('€61.28');
});

test('price list page in Portuguese: lang=pt prints Portuguese, A4 and 390 px with no overflow', async ({ page }) => {
  await stubPrices(page);
  await page.addInitScript(() => { window.print = () => {}; });
  const errors = collectFatalErrors(page);
  await page.goto('/prices/pricelist.html?location=all&period=all&sections=accommodation,flexible,surf,tours,transfers,addons,shop,bar&lang=pt&print=1');
  await page.waitForFunction(() => window.__priceListReady === true, null, { timeout: 15000 });
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt-PT');
  await expect(page).toHaveTitle(/^Gota Dagua tabela de preços - Todos os camps /);
  await expect(page.locator('.pl-cover .pl-reserv')).toHaveText('Reservas e parcerias: info@gotadaguasurf.com · +351 924 689 580');
  await expect(page.locator('.pl-cover-for')).toHaveText('Para agências e parceiros');
  await expect(page.locator('.pl-camp[data-camp="portugal"] .pl-room-h').first()).toHaveText('Quarto');
  await expect(page.locator('.pl-camp[data-camp="morocco"] .pl-camp-name')).toHaveText('Marrocos');
  await expect(page.locator('.pl-camp[data-camp="sri-lanka"] .pl-pack').first().locator('.pl-amt').first()).toHaveText(/^\d+\u00a0€$/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  const over = await page.evaluate(() => {
    const bad = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('page ' + document.documentElement.scrollWidth);
    document.querySelectorAll('.pl-table').forEach((t, i) => { if (t.scrollWidth > t.clientWidth + 1) bad.push('table ' + i); });
    document.querySelectorAll('.pl-table td, .pl-table th, .pl-pill, .pl-camp-from, .pl-cover-for, .pl-kicker').forEach(td => { if (td.scrollWidth > td.clientWidth + 1) bad.push('cell ' + td.textContent.slice(0, 30)); });
    return bad;
  });
  expect(over).toEqual([]);
  expect(errors).toEqual([]);
});

test('price list model: per-night (Flexible) packs only when «flexible» is chosen', () => {
  const packsOf = (sections) => PriceList.buildModel({ camps: [campFromData('portugal')], period: 'all', today: '2026-11-17', sections }).camps[0].accommodation.map(p => p.flex);
  expect(packsOf(['accommodation'])).not.toContain(true);
  expect(packsOf(['accommodation', 'flexible'])).toContain(true);
  expect(packsOf(['accommodation', 'flexible'])).toContain(false);
  expect(packsOf(['flexible']).every(Boolean)).toBe(true);
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
    { route: 'Airport → Surfcamp', vehicle: 'Car', covers: 3, boards: false, price: '€80' },
    { route: 'Airport → Surfcamp', vehicle: 'Minivan', covers: 3, boards: true, price: '€95' },
    { route: 'Surfcamp → Airport', vehicle: 'Car', covers: 3, boards: false, price: '€80' },
    { route: 'Surfcamp → Airport', vehicle: 'Minivan', covers: 3, boards: true, price: '€95' }]);   // stub data: covers 3
  expect(sl.notes.some(n => /surfboard/.test(n))).toBe(true);   // tuk-tuks / camp runs at 0 are left out
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
  await page.goto('/prices/pricelist.html?location=all&period=all&sections=accommodation,flexible,surf,tours,transfers,addons,bar&print=1');
  await page.waitForFunction(() => window.__priceListReady === true, null, { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__printed === true)).toBe(true);
  await expect(page).toHaveTitle('Gota Dagua price list - All camps 2026–2027');
  await expect(page.locator('.pl-camp')).toHaveCount(5);
  await expect(page.locator('.pl-camp[data-camp="portugal"] .pl-matrix thead th').first()).toBeVisible();
  await expect(page.locator('.pl-cover')).toContainText('+351 924 689 580');
  // the website's look: brand fonts loaded, photo cover and camp cards, «Book now» to the booking site, one money format
  // Gaya is deployed outside git (licence): when the file is there it is the title font, else Frastha stands in
  const hasGaya = require('fs').existsSync(require('path').join(__dirname, '..', 'assets', 'fonts', 'Gaya-Regular.woff2'));
  expect(await page.evaluate(() => [document.fonts.check('16px Londrina'), getComputedStyle(document.querySelector('.pl-sec-head h2')).fontFamily])).toEqual([true, 'Gaya, Frastha, Georgia, serif']);
  if (hasGaya) expect(await page.evaluate(() => document.fonts.check('16px Gaya'))).toBe(true);
  await expect(page.locator('.pl-cover .pl-cover-photo')).toHaveCount(3);
  await expect(page.locator('.pl-camp-card')).toHaveCount(5);
  // no Seasons section in the PDF (17 Nov 2026): accommodation comes first and every date sits under its season
  const sl = page.locator('.pl-camp[data-camp="sri-lanka"]');
  await expect(page.locator('.pl-seasons')).toHaveCount(0);
  await expect(sl.locator('[data-part]').first()).toHaveAttribute('data-part', 'accommodation');
  await expect(page.locator('.pl-dates i')).toHaveCount(0);
  await expect(sl.locator('.pl-matrix .pl-occ-in').first()).toHaveText('Single');
  // for agencies and partners only (17 Nov 2026): no «Book now», a reservations line on the cover and the back page
  await expect(page.locator('.pl-book')).toHaveCount(0);
  await expect(page.locator('.pl-cover .pl-reserv')).toHaveText('Reservations & partnerships: info@gotadaguasurf.com · +351 924 689 580');
  await expect(page.locator('.pl-end')).not.toContainText('Questions or group requests?');   // removed 17 Nov 2026
  await expect(page.locator('.pl-end .pl-reserv')).toBeVisible();
  expect(await page.content()).not.toContain('bookings.gotadaguasurf.com');
  await expect(page.locator('.pl-camp[data-camp="sri-lanka"] .pl-pack').nth(1).locator('.pl-amt').first()).toHaveText(/^€\d+\.\d{2}$/);
  await expect(page.locator('.pl-camp[data-camp="sri-lanka"] .pl-pack').first().locator('.pl-amt').first()).toHaveText(/^€\d+$/);
  const imgs = await page.evaluate(async () => { const u = [...new Set([...document.querySelectorAll('[style*="background-image"]')].map(e => /url\(['"]?([^'")]+)/.exec(e.getAttribute('style'))[1]))];
    return Promise.all(u.map(x => fetch(x).then(r => [x, r.status]))); });
  expect(imgs.filter(([, st]) => st !== 200)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
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

test('edit sheet: a transfer saves seats, people one paid transfer covers and the Bookinglayer product', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const ctl = await openPrices(page, 'sri-lanka');
  await page.locator('#areaTabs [data-area="transfers"]').click();
  await page.locator('tr[data-row-id="pc-257"] .row-actions .btn-s').click();
  await expect(page.locator('#editOv')).toHaveClass(/open/);
  await expect(page.locator('#em_capacity')).toHaveValue('3');
  await page.locator('#em_covers').fill('4');
  await page.locator('#em_bl_product').fill('Airport Transfer Sri Lanka');
  await page.locator('#emSave').click();
  await expect(page.locator('#editOv')).not.toHaveClass(/open/);
  const w = ctl.writes.filter(x => x.table === 'pricing_catalog');
  expect(w).toHaveLength(1);
  expect(w[0].method).toBe('PATCH');
  expect(w[0].body).toMatchObject({ name: 'Surfcamp → Airport — Car', category: 'Transport', capacity: 3, covers_pax: 4, bl_product: 'Airport Transfer Sri Lanka', sell_price: 80, sell_currency: 'EUR', currency: 'LKR', picker_tab: 'airport' });
  await expect(page.locator('#toast')).toContainText('Saved');
});

test('drag to reorder: the moved row goes first and every changed sort_order is saved', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const ctl = await openPrices(page, 'portugal');
  await page.locator('#areaTabs [data-area="tours"]').click();
  await expect(page.locator('#tableWrap .item-name')).toHaveText(['Yoga Class', 'Beach Party', 'Ice Bath', 'Surf Skate Lesson', 'Paradise Beach']);
  const target = page.locator('tr[data-row-id="pc-313"]');
  const box = await target.boundingBox();
  await page.locator('tr[data-row-id="pc-328"] .drag-handle').dragTo(target, { targetPosition: { x: 40, y: 4 } });
  await expect(page.locator('#tableWrap .item-name')).toHaveText(['Paradise Beach', 'Yoga Class', 'Beach Party', 'Ice Bath', 'Surf Skate Lesson']);
  const orders = Object.fromEntries(ctl.writes.map(w => [w.filters.find(f => f[0] === 'id')[2], w.body.sort_order]));
  expect(orders).toEqual({ 'pc-328': 100, 'pc-313': 200, 'pc-333': 300, 'pc-312': 400, 'pc-314': 500 });
  expect(box).toBeTruthy();
});

test('a tour linked to another route moves the route link to every vehicle of the new route', async ({ page }) => {
  const ctl = await openPrices(page, 'morocco');
  await page.evaluate(() => openEdit('pc-241'));                                     // Paradise Valley tour
  await expect(page.locator('#em_linked_transport')).toHaveValue('route:Paradise Valley');
  await page.locator('#em_linked_transport').selectOption('route:Souk');
  await page.locator('#emSave').click();
  await expect(page.locator('#editOv')).not.toHaveClass(/open/);
  const link = ctl.writes.find(w => w.body && w.body.linked_camp_tab_id === 'pc-241');
  expect(link.filters).toEqual([['id', 'in', '(pc-303,pc-305,pc-308)']]);
  expect(ctl.writes[0].body).toMatchObject({ linked_transport_preset_id: 'route:Souk' });
});

// The Bookinglayer audit of 17 Nov 2026 (prices_audit/fix.sql, not applied yet): seasons get several periods per year and
// run into 2028, Junior Camp gets its first pack. The calendar and the price list take that shape as it comes.
const AUDIT_SL = {
  low: [{ start: '2026-05-30', end: '2026-06-06' }, { start: '2026-07-11', end: '2026-10-02' }, { start: '2027-05-29', end: '2027-06-04' }, { start: '2027-07-10', end: '2027-10-29' }, { start: '2028-05-20', end: '2028-06-02' }],
  mid: [{ start: '2026-04-25', end: '2026-05-29' }, { start: '2026-10-03', end: '2026-11-06' }, { start: '2026-11-14', end: '2026-12-04' }, { start: '2027-04-24', end: '2027-05-28' }, { start: '2027-10-30', end: '2027-12-03' }, { start: '2028-04-22', end: '2028-05-19' }],
  high: [{ start: '2025-12-13', end: '2026-04-24' }, { start: '2026-12-05', end: '2027-04-23' }, { start: '2027-12-04', end: '2028-04-21' }],
};
const withAudit = (db) => {
  db.accommodation_seasons.filter(s => s.location_id === 'loc-sl').forEach(s => { s.date_ranges = AUDIT_SL[s.season_key]; });
  db.accommodation_packs.push({ id: 'jc-pk', location_id: 'loc-jc', pack_key: 'weekly', label: 'Junior Surf Camp — Summer (7 nights)', description: 'Bookinglayer «Junior Surf Camp - Summer»: 7, 14 or 21 nights on the fixed arrival dates. Price per person per week.', price_basis: 'per_person_per_week', sort_order: 10, active: true });
  db.accommodation_seasons.push({ id: 'jc-lo', location_id: 'loc-jc', season_key: 'low', label: 'LOW SEASON', date_ranges: [{ start: '2027-06-19', end: '2027-07-02' }, { start: '2027-07-31', end: '2027-08-28' }], sort_order: 10, active: true },
    { id: 'jc-hi', location_id: 'loc-jc', season_key: 'high', label: 'HIGH SEASON', date_ranges: [{ start: '2027-07-03', end: '2027-07-30' }], sort_order: 30, active: true });
  db.accommodation_room_types.push({ id: 'jc-r1', location_id: 'loc-jc', label: 'Dorm 8–9 beds', sort_order: 10, active: true }, { id: 'jc-r2', location_id: 'loc-jc', label: 'Single / Double room', sort_order: 40, active: true });
  [['jc-lo', 'jc-r1', 729], ['jc-hi', 'jc-r1', 769], ['jc-lo', 'jc-r2', 829], ['jc-hi', 'jc-r2', 869]].forEach(([se, rt, p], i) =>
    db.accommodation_prices.push({ id: 'jc-p' + i, location_id: 'loc-jc', pack_id: 'jc-pk', season_id: se, room_type_id: rt, occupancy: 1, sell_price: p, currency: 'EUR' }));
};

test('season calendar: several periods per season per year, 2026 → 2028, past years left out; Junior Camp accommodation shows', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00Z'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPrices(page, 'sri-lanka', { mutate: withAudit });
  // plain words first: what applies today, the gap, what comes next
  await expect(page.locator('#seasonNow')).toHaveText('Now: Mid season until 4 Dec 2026 → then High season from 5 Dec 2026 to 23 Apr 2027');
  // a rolling 15 months from this month, month names with the year where it starts / turns, a labelled «Today»
  const months = page.locator('#seasonCard .tl-m');
  await expect(months).toHaveCount(15);
  await expect(months.first()).toHaveText('Nov2026');
  await expect(months.nth(2)).toHaveText('Jan2027');
  await expect(page.locator('#seasonCard .tl-today')).toHaveText('Today');
  // no unexplained stripes: the holes are named
  await expect(page.locator('#seasonCard .tl-band.closed').first()).toHaveAttribute('title', 'Closed · 7 Nov – 13 Nov 2026');
  await page.locator('#seasonCard .tl-band.high').first().click();
  await expect(page.locator('#tlDetail')).toHaveText('High season · 5 Dec 2026 – 23 Apr 2027');
  // the dates as a table: seasons × years, periods stacked
  await expect(page.locator('#seasonCard .season-table thead th')).toHaveText(['', '2026', '2027', '2028']);
  await expect(page.locator('#seasonCard .season-table tbody tr').nth(1).locator('td[data-year="2026"] div')).toHaveText(['14 Nov – 4 Dec']);                                     // past periods are not listed
  await expect(page.locator('#seasonCard .season-table tbody tr').nth(2).locator('td[data-year="2026"] div')).toHaveText(['5 Dec – 23 Apr 2027']);
  await expect(page.locator('#seasonCard .status-msg')).toHaveCount(0);                              // the periods do not overlap
  // the matrix header shows only the period that matters now (current, else next); every period is one click away
  const low = page.locator('#accomCard th.season-col').first();
  // matrix headers carry each season's coming dates (no «Now»: the owner sends this out); 3 lines, then «+N more»
  await expect(low.locator('.col-dates > span')).toHaveText(['29 May – 4 Jun 2027', '10 Jul – 29 Oct 2027', '20 May – 2 Jun 2028']);
  const mid = page.locator('#accomCard th.season-col').nth(1);
  await expect(mid.locator('.col-dates > span')).toHaveText(['14 Nov – 4 Dec 2026', '24 Apr – 28 May 2027', '30 Oct – 3 Dec 2027']);
  await mid.locator('details.dates-more summary').click();
  await expect(mid.locator('.dates-more-body div')).toHaveText(['14 Nov – 4 Dec 2026', '24 Apr – 28 May 2027', '30 Oct – 3 Dec 2027', '22 Apr – 19 May 2028']);
  await expect(page.locator('#accomCard .now-badge, #accomCard .is-now')).toHaveCount(0);
  const heights = await page.locator('#accomCard thead th').evaluateAll(t => t.map(e => Math.round(e.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  // phones: the sentence + the coming periods as a list (no wide strip, no table)
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#seasonCard .tl-wrap')).toBeHidden();
  await expect(page.locator('#seasonCard .season-table')).toBeHidden();
  const items = page.locator('#seasonCard .season-list li');
  await expect(items.first()).toHaveText('Mid14 Nov – 4 Dec 2026Now');
  await expect(items.nth(1)).toHaveText('High5 Dec 2026 – 23 Apr 2027');
  expect(await noSideScroll(page)).toBe(true);
  // Junior Camp: from «no accommodation» to its first pack, nothing else to change
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPrices(page, 'junior-camp', { mutate: withAudit });
  await expect(page.locator('#accomCard .card-title')).toHaveText('Junior Surf Camp — Summer (7 nights)');
  await expect(page.locator('#accomcell_jc-pk_jc-hi_jc-r2_1')).toHaveText('€869');
  await expect(page.locator('#seasonNow')).toHaveText('Now: Closed → then Low season from 19 Jun 2027 to 2 Jul 2027');   // its first periods are summer 2027
  await expect(page.locator('#seasonCard .season-table thead th')).toHaveText(['', '2027']);
});

test('price list with the audit data: 2028 periods by year, Junior Camp in «all camps», no Bookinglayer wording printed', () => {
  const db = JSON.parse(JSON.stringify(DATA)); withAudit(db);
  db.pricing_catalog.push({ id: 'x1', location_id: 'loc-sl', name: 'Yala Park Safari', category: 'Tour', sell_price: 80, currency: 'LKR', sell_currency: 'EUR', notes: 'Bookinglayer «Yala Park Safari» 80 € per person', active: true, sort_order: 110 });
  const camp = (slug) => { const L = db.locations.find(l => l.slug === slug); const of = t => db[t].filter(r => r.location_id === L.id);
    return { slug, label: L.name, catalog: of('pricing_catalog'), accom: { packs: of('accommodation_packs'), seasons: of('accommodation_seasons'), rooms: of('accommodation_room_types'), prices: of('accommodation_prices') } }; };
  const y28 = PriceList.buildModel({ camps: [camp('sri-lanka')], period: '2028', today: '2026-11-17', sections: ['accommodation'] });
  expect(y28.camps[0].accommodation[0].seasons.map(s => [s.label, s.dates])).toEqual([
    ['Low Season', ['20 May – 2 Jun 2028']], ['Mid Season', ['22 Apr – 19 May 2028']], ['High Season', ['4 Dec 2027 – 21 Apr 2028']]]);
  const all = PriceList.buildModel({ camps: ['portugal', 'sri-lanka', 'junior-camp'].map(camp), period: 'upcoming', today: '2026-11-17', sections: ['accommodation', 'tours'] });
  expect(all.camps.map(c => c.slug)).toEqual(['portugal', 'sri-lanka', 'junior-camp']);
  const jc = all.camps[2].accommodation[0];
  expect(jc.desc).toBe('7, 14 or 21 nights on the fixed arrival dates. Price per person per week.');
  expect(jc.seasons.map(s => s.dates)).toEqual([['19 Jun – 2 Jul 2027', '31 Jul – 28 Aug 2027'], ['3 Jul – 30 Jul 2027']]);
  const html = PriceList.render(all, { logo: '' });
  expect(html).toContain('Yala Park Safari');
  expect(html).not.toMatch(/Bookinglayer|Camp Tab/);
});

test('phone header at 360: camp menu opens on screen, ☰ and the switches do not overlap', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openPrices(page, 'junior-camp');
  for (const sel of ['details.app-switch:not(.loc-switch)', 'details.loc-switch']) {
    await page.locator(`${sel} > summary`).click();
    const box = await page.locator(`${sel} .app-switch-menu`).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await page.locator(`${sel} > summary`).click();
  }
  const r = await page.evaluate(() => ['details.loc-switch > summary', '.nav-hamburger'].map(s => document.querySelector(s).getBoundingClientRect()).map(b => [b.left, b.right]));
  expect(r[0][1]).toBeLessThanOrEqual(r[1][0]);
  expect(await noSideScroll(page)).toBe(true);
});

test('accommodation matrix: one table per pack (rooms × seasons), no repeated headers, one money format per pack, sharing only where sold', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00Z'));
  await page.setViewportSize({ width: 1280, height: 900 });
  const ctl = await openPrices(page, 'sri-lanka');
  await expect(page.locator('#accomCard table')).toHaveCount(1);
  await expect(page.locator('#accomCard thead tr')).toHaveCount(1);
  await expect(page.locator('#accomCard th.season-col .season-pill')).toHaveText(['Low', 'Mid', 'High']);
  const rows = page.locator('#accomCard tbody tr');
  await expect(rows.locator('.room-name')).toHaveText(['Shared Room Ensuite', 'Standard Private Ensuite', 'Superior Private Ensuite']);
  await expect(rows.nth(0).locator('td.price-cell').first().locator('.occ-lbl')).toHaveCount(0);  // a dorm bed: just the price
  await expect(rows.nth(1).locator('td.price-cell').first().locator('.occ-lbl')).toHaveText(['Single', 'Shared']);
  await expect(rows.nth(1).locator('td.price-cell').first().locator('.cell-edit')).toHaveText(['€649', '€479']);   // weekly: whole euros
  // flexible: always 2 decimals (no €57 next to €92.71); 3 nights shows totals and saves per night
  await page.locator('.pack-bar .pill', { hasText: 'Flexible' }).click();
  await expect(rows.nth(0).locator('td.price-cell .cell-edit')).toHaveText(['€57.00', '€64.14', '€71.29']);
  await page.locator('#nightsSel').selectOption('3');
  await expect(rows.nth(0).locator('td.price-cell .cell-edit').first()).toHaveText('€171.00');
  await expect(page.locator('#accomCard .accom-note')).toContainText('Per person for 3 nights (saved per night)');
  await rows.nth(0).locator('td.price-cell .cell-edit').first().click();
  await page.locator('.cell-input').fill('180');
  await page.keyboard.press('Enter');
  await expect.poll(() => ctl.writes.length).toBe(1);
  expect(ctl.writes[0]).toMatchObject({ table: 'accommodation_prices', method: 'PATCH', body: { sell_price: 60 } });
  // read-only list view: no «Add», no inputs, sharing never «—» where the room is not shared
  await page.locator('.app-nav .ntab', { hasText: 'Price list' }).click();
  await expect(page.locator('#accomCard')).not.toContainText('Add');
  // phone: one card per room, seasons as rows, no sideways scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.nth(1).locator('td.price-cell .m-season .season-pill').first()).toBeVisible();
  await expect(rows.nth(1).locator('td.price-cell .m-season .col-dates').first()).toBeVisible();     // the season's dates on the phone card
  expect(await noSideScroll(page)).toBe(true);
});

test('matrix (owner\'s pick, 17 Nov 2026): «Single / Shared» beside the prices, one-line footer, ≤ 880px, edits still save', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00Z'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPrices(page, 'sri-lanka', { mutate: withAudit });
  const card = page.locator('#accomCard');
  await expect(card.locator('th.season-col .season-pill')).toHaveText(['Low', 'Mid', 'High']);
  const row = card.locator('tbody tr').nth(1);
  await expect(row.locator('td.price-cell').first().locator('.occ-line')).toHaveText(['Single€649', 'Shared€479']);
  await expect(card.locator('.accom-note > span')).toHaveText('Per person for 7 nights · EUR · tap a price to edit');
  const w = await card.boundingBox(); expect(w.width).toBeLessThanOrEqual(880);
  await row.locator('td.price-cell').first().locator('.cell-edit').first().click();
  await expect(page.locator('.cell-input')).toHaveValue('649');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSideScroll(page)).toBe(true);
});
