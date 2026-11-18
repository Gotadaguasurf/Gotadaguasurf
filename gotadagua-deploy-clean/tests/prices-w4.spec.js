// /prices, audit 18 Nov 2026 (W4, SA-18 / UXC-09): a loading error keeps the real database message and then says
// «tell Miguel» — never a SQL file name, «run … in the SQL Editor» or «open DevTools». Hermetic (tests/prices-stub.js).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { stubPrices } = require('./prices-stub');
const SHOTS = process.env.W4_SHOTS || '';

for (const [label, message] of [['missing table', 'relation "public.pricing_catalog" does not exist'], ['dropped connection', 'TypeError: Failed to fetch']]) {
  test(`prices: a catalog that cannot load shows the real error and who to tell (${label})`, async ({ page }) => {
    await stubPrices(page);
    await page.route(/supabase\.co\/rest\/v1\/pricing_catalog.*/, route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42P01', message }) }));
    await page.goto('/prices/?location=portugal', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(message, { timeout: 15000 });
    const text = await page.locator('body').innerText();
    expect(text).toMatch(/tell Miguel/i);
    expect(text).not.toMatch(/\.sql|SQL Editor|DevTools|Supabase/);
    if (SHOTS && label === 'missing table') for (const w of [390, 1280]) { await page.setViewportSize({ width: w, height: 800 }); await page.screenshot({ path: path.join(SHOTS, `prices-error-${w}.png`) }); }
  });
}
