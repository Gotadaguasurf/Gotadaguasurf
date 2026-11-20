// /prices · tours (20 Nov 2026, Miguel: «era fixe se quiser montar um tour Galle poder ter o preço de transporte que vai
// para os drivers e depois o que cobramos, que é o dinheiro de lucro para nós» — and the tour need not be on the Camp
// Tab). The Tours tab says «We charge / person», «Cost / person» and the profit per person in money; a new tour can be
// saved with Camp Tab off (it still shows in Transport → Tours, tests/transport.spec.js «tour profit»).
// Stubbed Supabase over tests/prices-data.js: nothing reaches a real database.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { openPrices } = require('./prices-stub');
const { collectFatalErrors } = require('./helpers');

const SHOTS = process.env.SHEET_SHOTS || path.join(__dirname, '..', 'test-results', 'sheet-shots');
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [name, size] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
  test(`/prices Sri Lanka tours at ${name}: «We charge / person», cost and profit per person; a new tour «Galle» with Camp Tab off`, async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize(size);
    const ctl = await openPrices(page, 'sri-lanka');
    await page.locator('#areaTabs [data-area="tours"]').click();
    await expect(page.locator('#areaTabs [data-area="tours"]')).toHaveClass(/active/);
    if (size.width >= 700) await expect(page.locator('#tableWrap thead th')).toContainText(['We charge / person', 'Cost / person', 'Profit / person']);
    // Cooking Class: 6,000 − 2,400 = 3,600 a person (60 %)
    const cc = page.locator('#tableWrap tr', { hasText: 'Cooking Class' });
    await expect(cc.locator('td[data-label="Margin"] > span').first()).toHaveText('60%');
    await expect(cc.locator('[data-pp-profit]')).toHaveText('LKR 3,600 / person');
    await expect(cc.locator('td[data-label="Guest price"]')).toHaveAttribute('data-short', 'We charge');
    // New tour, from the Tours tab: the sheet speaks per person; Camp Tab off is one tap.
    await page.click('#newEntryBtn');
    await expect(page.locator('#em_category')).toHaveValue('Tour');
    await expect(page.locator('#em_sell_lbl')).toHaveText('We charge (per person)');
    await expect(page.locator('#em_cost_lbl')).toHaveText('Cost per person');
    await expect(page.locator('#em_tour_cost_help')).toContainText("the driver's share");
    await expect(page.locator('#em_show_ct_help')).toHaveText('Off: not sold on the Camp Tab. The tour still shows in Transport → Tours.');
    await page.fill('#em_name', 'Galle');
    await page.fill('#em_sell', '4000');
    await expect(page.locator('#em_pp_profit')).toHaveText('Profit per person: LKR 4,000 · no cost typed');
    await page.fill('#em_cost', '2000');
    await expect(page.locator('#em_pp_profit')).toHaveText('Profit per person: LKR 2,000 · 50%');
    await page.locator('#em_show_ct_row').click();
    await expect(page.locator('#em_show_ct')).not.toBeChecked();
    expect(await noSideScroll(page)).toBe(true);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `prices-tour-sheet-${name}.png`) });
    await page.click('#emSave');
    await expect.poll(() => ctl.writes.filter(w => w.table === 'pricing_catalog' && w.method === 'POST').length).toBe(1);
    const body = ctl.writes.find(w => w.table === 'pricing_catalog' && w.method === 'POST').body;
    expect(body).toMatchObject({ name: 'Galle', category: 'Tour', sell_price: 4000, cost_per_guest: 2000, currency: 'LKR', show_in_camp_tab: false, active: true });
    const galle = page.locator('#tableWrap tr', { hasText: 'Galle' });
    await expect(galle.locator('td[data-label="Camp Tab"] .toggle')).toHaveText('Off');
    await expect(galle.locator('[data-pp-profit]')).toHaveText('LKR 2,000 / person');
    expect(await noSideScroll(page)).toBe(true);
    await galle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `prices-tour-rows-${name}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('/prices: the cost labels stay as they were for every other category (a Transport row keeps «Guest price» / «Cost per guest»)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPrices(page, 'sri-lanka');
  await page.locator('#areaTabs [data-area="tours"]').click();
  await page.click('#newEntryBtn');
  await page.selectOption('#em_category', 'Transport');
  await expect(page.locator('#em_sell_lbl')).toHaveText('Guest price');
  await expect(page.locator('#em_cost_lbl')).toHaveText('Cost per guest');
  await expect(page.locator('#em_tour_cost_help')).toBeHidden();
  await expect(page.locator('#em_pp_profit')).toBeHidden();
  await expect(page.locator('#em_show_ct_help')).toHaveText('Guests can charge this item to their tab.');
});
