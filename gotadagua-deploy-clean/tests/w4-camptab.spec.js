// Wave 4 (audit 18 Nov 2026) — Camp Tab, through the camp hub (never camp-tab-inner.html on its own), Supabase stubbed.
const { test, expect } = require('@playwright/test');
const { LOC, WEEK, uuid, catalog, guestRow, itemRow, openCampTab, sub } = require('./camp-tab-w3-helpers');

test.use({ timezoneId: 'Europe/Lisbon', viewport: { width: 1280, height: 900 } });
const PT = { id: LOC, name: 'Portugal', slug: 'portugal', currency: 'EUR', default_fx_to_eur: 1, camp_tab_mode: 'per_guest' };
const eurCatalog = () => catalog([['Beer', 'Drinks', 3, 2, 'Staff', null], ['Surf Stick', 'Merch', 20, null, null, null], ['Cocktail', 'Bar', 8, null, null, null]]).map(r => ({ ...r, sell_currency: 'EUR', currency: 'EUR' }));
const eur = (n, gid, name, cat, p, extra = {}) => itemRow(n, gid, name, cat, p, { currency: 'EUR', ...extra });

test('CT-17 / CT-14 / CT-19: Portugal — The Suk\'s bar is shown apart from «Collected», a closed guest who left owing shows «Unpaid», «Open tabs», «Paid · To pay»', async ({ page }) => {
  const g1 = uuid('9e57', 1), g2 = uuid('9e57', 2), g3 = uuid('9e57', 3);
  const { frame } = await openCampTab(page, {
    pricing_catalog: eurCatalog(),
    camp_guests: [guestRow(1, 'Ana Open'), guestRow(2, 'Ben Left', { closed_at: '2026-06-09T10:00:00.000Z' }), guestRow(3, 'Cy Flagged', { closed_at: '2026-06-09T11:00:00.000Z', paid: true, paid_at: '2026-06-09T11:00:00.000Z' })],
    camp_tab_items: [
      eur(1, g1, 'Surf Stick', 'Merch', 20, { paid_at: '2026-06-08T15:00:00.000Z' }), eur(2, g1, 'Cocktail', 'Bar', 8, { paid_at: '2026-06-08T15:00:00.000Z' }), eur(3, g1, 'Beer', 'Drinks', 3),
      eur(4, g2, 'Surf Stick', 'Merch', 20, { paid_at: '2026-06-09T09:00:00.000Z' }), eur(5, g2, 'Beer', 'Drinks', 3), eur(6, g2, 'Cocktail', 'Bar', 8),
      eur(7, g3, 'Beer', 'Drinks', 3),   // flagged Paid as a whole, line never stamped (the old Mark-paid case): not shown as owing
    ],
  }, PT);
  // «Open tabs» (per guest) — and Collected without the bar, the bar on its own line
  await expect(frame.locator('.snav-btn[data-sub="week"]')).toHaveText('Open tabs');
  await sub(frame, 'week');
  const stats = frame.locator('#twStats');
  await expect(stats.locator('.tw-stat-val').first()).toHaveText('€20.00');
  await expect(stats).toContainText("+ €8.00 bar · The Suk's");
  // History: Lifetime collected = camp money only; Ben left with €3 of camp money unpaid (the bar apart, not counted)
  await sub(frame, 'history');
  await expect(frame.locator('#histStats .tw-stat-val').first()).toHaveText('€20.00');
  const ben = frame.locator('.hist-week', { hasText: 'Ben Left' });
  await expect(ben.locator('.hw-unpaid')).toHaveText('Unpaid €3.00');
  await expect(frame.locator('.hist-week', { hasText: 'Cy Flagged' }).locator('.hw-unpaid')).toHaveCount(0);
  // Charge: Ana's tab — total and «Paid · To pay»
  await sub(frame, 'charge');
  await frame.evaluate(id => { AG = id; renderAllCampTabViews(); }, g1);
  await expect(frame.locator('#tabPaidLine')).toHaveText('Paid €28.00 · To pay €3.00');
});

test('UXC-15: a Camp Tab failure toast is red and stays 6 s; a normal one is plain and short', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await frame.evaluate(() => toast('Added'));
  expect(await frame.evaluate(() => document.getElementById('toast').classList.contains('err'))).toBe(false);
  await frame.evaluate(() => toast("Couldn't save — check the connection"));
  expect(await frame.evaluate(() => document.getElementById('toast').classList.contains('err'))).toBe(true);
  await page.waitForTimeout(3000);
  expect(await frame.evaluate(() => document.getElementById('toast').classList.contains('show'))).toBe(true);
});
