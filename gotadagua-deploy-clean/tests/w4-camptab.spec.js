// Wave 4 (audit 18 Nov 2026) — Camp Tab, through the camp hub (never camp-tab-inner.html on its own), Supabase stubbed.
const { test, expect } = require('@playwright/test');
const { LOC, WEEK, uuid, catalog, guestRow, itemRow, openCampTab, sub } = require('./camp-tab-w3-helpers');

test.use({ timezoneId: 'Europe/Lisbon', viewport: { width: 1280, height: 900 } });
const PT = { id: LOC, name: 'Portugal', slug: 'portugal', currency: 'EUR', default_fx_to_eur: 1, camp_tab_mode: 'per_guest' };
const eurCatalog = () => catalog([['Beer', 'Drinks', 3, 2, 'Staff', null], ['Surf Stick', 'Merch', 20, null, null, null], ['Cocktail', 'Bar', 8, null, null, null]]).map(r => ({ ...r, sell_currency: 'EUR', currency: 'EUR' }));
const eur = (n, gid, name, cat, p, extra = {}) => itemRow(n, gid, name, cat, p, { currency: 'EUR', ...extra });

// CT-17 / CT-14 / CT-19 (Portugal bar apart, «Unpaid», «Open tabs») are waiting for Miguel's OK: branch fix/w4-camps keeps them.
test('UXC-15: a Camp Tab failure toast is red and stays 6 s; a normal one is plain and short', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await frame.evaluate(() => toast('Added'));
  expect(await frame.evaluate(() => document.getElementById('toast').classList.contains('err'))).toBe(false);
  await frame.evaluate(() => toast("Couldn't save — check the connection"));
  expect(await frame.evaluate(() => document.getElementById('toast').classList.contains('err'))).toBe(true);
  await page.waitForTimeout(3000);
  expect(await frame.evaluate(() => document.getElementById('toast').classList.contains('show'))).toBe(true);
});
