// Dipløria /diploria/, audit wave 4 (18 Nov 2026, UXC-09): only a missing table reads
// «not set up yet»; any other load error (a dropped connection) says so, keeps the real
// error in small print and offers Retry. No SQL file names on screen.
// Hermetic: Supabase is stubbed, names are invented.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, OWNER_EMAIL } = require('./helpers');

const LOC = '00000000-0000-4000-8000-0000000000a1';
async function openDiploria(page, { fail }) {
  const state = { fail: { ...fail } };
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: OWNER_EMAIL, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return json({ id: 'u1', email: OWNER_EMAIL, full_name: 'Owner', platform_role: 'owner' });
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (state.fail[t] === 'missing') return json({ message: `relation "public.${t}" does not exist`, code: '42P01' }, 404);
    if (state.fail[t] === 'network') return json({ message: 'upstream connect error or disconnect/reset before headers', code: 'XX000' }, 500);
    if (t === 'locations') return json([{ id: LOC, slug: 'portugal', name: 'Portugal' }]);
    return json([]);
  });
  await page.clock.setFixedTime(new Date('2026-11-18T12:00:00'));
  await fakeOwnerSession(page);
  await page.goto('/diploria/#stock', { waitUntil: 'domcontentloaded' });
  return state;
}

test('a dropped connection is not «not set up yet»: it says so, shows the real error and Retry brings the page back', async ({ page }) => {
  const state = await openDiploria(page, { fail: { diploria_stock_moves: 'network', diploria_expenses: 'network' } });
  const banner = page.locator('#stockBanner .dp-banner');
  await expect(banner).toContainText("Couldn't load the stock moves — check the connection");
  await expect(banner).toContainText('upstream connect error');
  await expect(banner).not.toContainText('not set up');
  await page.evaluate(() => showPage('expenses'));
  await expect(page.locator('#expBanner')).toContainText("Couldn't load the expenses — check the connection");
  await expect(page.locator('#addExpBtn')).toBeDisabled();
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/supabase\/|\.sql\b/i);
  // the connection is back: Retry
  state.fail = {};
  await page.locator('#expBanner button', { hasText: 'Retry' }).click();
  await expect(page.locator('#expBanner')).toBeEmpty();
  await expect(page.locator('#addExpBtn')).toBeEnabled();
  await page.evaluate(() => showPage('stock'));
  await expect(page.locator('#stockBanner .dp-banner')).toHaveCount(0);
});

test('a missing table still reads «not set up yet», without a file name', async ({ page }) => {
  await openDiploria(page, { fail: { diploria_stock_moves: 'missing', diploria_expenses: 'missing' } });
  await expect(page.locator('#stockBanner')).toContainText('Stock moves are not set up yet.');
  await expect(page.locator('#stockBanner')).not.toContainText('Retry');
  await page.evaluate(() => showPage('expenses'));
  await expect(page.locator('#expBanner')).toContainText('The expenses table is not set up yet.');
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/supabase\/|\.sql\b/i);
});
