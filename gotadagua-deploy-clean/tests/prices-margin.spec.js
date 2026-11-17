// /prices — margins in one currency (17 Nov 2026): a MAD / LKR driver or supplier cost is converted to € with the camp's
// one rate (TransportOverview.eurRate, the Transport Overview's rule) before it is subtracted from a € guest price.
// Before: «€25 − MAD 150» read as −500 %. Stubbed Supabase, nothing reaches a real database.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = '45aba3b6-de7f-4f94-ae31-43880e23b1b7';
const ROWS = [
  { id: 't1', location_id: LOC, name: 'Souk Tour', category: 'Tour', sell_price: 25, sell_currency: 'EUR', cost_per_guest: 150, currency: 'MAD', active: true, sort_order: 1, show_in_camp_tab: true },
  { id: 'a1', location_id: LOC, name: 'Agadir Airport — Car', category: 'Transport', sell_price: 30, sell_currency: 'EUR', cost_per_guest: 250, currency: 'MAD', capacity: 3, covers_pax: 3, active: true, sort_order: 2, show_in_transport_picker: true, picker_tab: 'airport' },
  { id: 'a2', location_id: LOC, name: 'Agadir Airport — Minivan', category: 'Transport', sell_price: 40, sell_currency: 'EUR', cost_per_guest: 300, currency: 'MAD', capacity: 8, covers_pax: 3, active: true, sort_order: 3, show_in_transport_picker: true, picker_tab: 'airport' },
];

async function openPrices(page) {
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const url = decodeURIComponent(route.request().url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, slug: 'morocco', name: 'Morocco', default_fx_to_eur: 10.8 });
    if (url.includes('/rest/v1/pricing_catalog')) return json(ROWS);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/prices/?location=morocco', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return catalog.length > 0 && eurFx.rate > 0; } catch (_) { return false; } }, null, { timeout: 15000 });
}

test('/prices: the margin converts the MAD cost to € first (Souk Tour €25 vs MAD 150 at 10.8 → 44 %, not −500 %); transfers show their margin too', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openPrices(page);
  expect(await page.evaluate(() => [eurFx.rate, eurFx.source])).toEqual([10.8, 'app']);
  await page.evaluate(() => { filterArea = 'tours'; renderTable(); });
  await expect(page.locator('td[data-label="Margin"]').first()).toHaveText('44%');
  await page.evaluate(() => { filterArea = 'transfers'; renderTable(); });
  await expect(page.locator('[data-tf-margin]')).toHaveText(['margin 23%', 'margin 31%']);   // (30 − 250/10.8) / 30, (40 − 300/10.8) / 40
  // the modal shows the two transport numbers that must never be mixed: seats and people one paid transfer covers
  await page.evaluate(() => openEdit('a1'));
  await expect(page.locator('#em_capacity')).toHaveValue('3');
  await expect(page.locator('#em_covers')).toHaveValue('3');
  await expect(page.locator('#em_bl_product')).toHaveValue('');
  expect(errors).toEqual([]);
});
