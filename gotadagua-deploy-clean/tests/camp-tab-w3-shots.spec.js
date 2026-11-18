// Screenshots of the Camp Tab at 390 px and 1280 px (Charge, This week, History, Activity),
// for a before / after look at any visible change. Skipped unless W3_SHOTS names a folder:
//   W3_SHOTS=/tmp/shots W3_LABEL=before npx playwright test tests/camp-tab-w3-shots.spec.js
// W3_GUESTS = how many open guests (default 40, Sri Lanka's size; Morocco has about 60).
const { test } = require('@playwright/test');
const path = require('path');
const { uuid, guestRow, itemRow, openCampTab, sub } = require('./camp-tab-w3-helpers');

const SHOTS = process.env.W3_SHOTS || '';
const LABEL = process.env.W3_LABEL || 'shot';
const N = Number(process.env.W3_GUESTS || 40);
const NAMES = ['Anna', 'Ben', 'Carla', 'Dino', 'Elsa', 'Finn', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Kaya', 'Liam', 'Mara', 'Nico', 'Olga', 'Pablo', 'Quinn', 'Rosa', 'Sven', 'Tessa'];
const name = (i) => `${NAMES[i % NAMES.length]} ${String.fromCharCode(65 + (i % 26))}.`;

function seed() {
  const guests = []; const items = [];
  for (let i = 1; i <= N; i++) guests.push(guestRow(i, name(i - 1)));
  for (let i = 1; i <= 3; i++) guests.push(guestRow(N + i, `Closed ${NAMES[i]}`, { closed_at: `2026-06-0${i}T10:00:00.000Z`, paid: true, paid_at: `2026-06-0${i}T10:00:00.000Z` }));
  const menu = [['Lion Lager', 'Drinks', 600], ['Cocktail', 'Drinks', 2000], ['Soft Drink', 'Drinks', 400], ['River Safari', 'Tours', 6000]];
  let n = 0;
  for (let k = 0; k < 8; k++) { const m = menu[k % menu.length]; items.push(itemRow(++n, uuid('9e57', 10), m[0], m[1], m[2], { created_by: 'u-host' })); }
  for (let g = 1; g <= 6; g++) { const m = menu[g % menu.length]; items.push(itemRow(++n, uuid('9e57', g), m[0], m[1], m[2], { created_by: 'u-host' })); }
  for (let i = 1; i <= 3; i++) items.push(itemRow(++n, uuid('9e57', N + i), 'Cocktail', 'Drinks', 2000, { paid_at: `2026-06-0${i}T10:00:00.000Z` }));
  // two lines taken off a tab and one guest deleted with its lines (Activity, CT-05)
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const del = (n, min, row, table = 'camp_tab_items') => ({ id: `a-${n}`, at: ago(min), actor_id: 'u-host', table_name: table, action: 'DELETE', row_id: String(row.id), deleted_row: row });
  const audit_log = [
    del(1, 4, itemRow(90, uuid('9e57', 10), 'Cocktail', 'Drinks', 2000)),
    del(2, 50, itemRow(91, uuid('9e57', 2), 'Lion Lager', 'Drinks', 600)),
    del(3, 90, itemRow(92, uuid('9e57', 99), 'Shot', 'Drinks', 1000)), del(4, 90, itemRow(93, uuid('9e57', 99), 'Soft Drink', 'Drinks', 400)),
    del(5, 90, guestRow(99, 'Walk-in guest'), 'camp_guests'),
  ];
  return { camp_guests: guests, camp_tab_items: items, audit_log, platform_profiles: [{ id: 'u-host', full_name: 'Sample Host', email: 'host@example.com' }] };
}

for (const [w, h] of [[390, 844], [1280, 900]]) {
  test(`shots ${w}px: Charge, This week, History, Activity`, async ({ page }) => {
    test.skip(!SHOTS, 'set W3_SHOTS to a folder');
    test.setTimeout(90_000);
    await page.setViewportSize({ width: w, height: h });
    const { frame } = await openCampTab(page, seed());
    const shot = async (what) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, `${LABEL}-${what}-${w}.png`) }); };
    await frame.evaluate((id) => selGuest(id), uuid('9e57', 10));
    await shot('charge');
    await sub(frame, 'week');
    await frame.evaluate((id) => toggleTwExpand(id), uuid('9e57', 10));
    await shot('week');
    await sub(frame, 'history');
    await shot('history');
    await sub(frame, 'activity');
    await frame.locator('#acPeriod').selectOption('all');
    await frame.locator('#acBody .ac-what').first().waitFor();
    await shot('activity');
  });
}
