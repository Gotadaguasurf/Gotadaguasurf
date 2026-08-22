// Regression: buildCampTabSyncRows must be DETERMINISTIC — two consecutive
// builds over untouched state must serialize identically, otherwise every
// row reads as "dirty" and the dirty-filter degenerates back into
// full-roster rewrites (the Sri Lanka add/remove-resets bug class).
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

test('two consecutive row builds serialize identically', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/camp-tab-inner.html?location=sri-lanka&mode=weekly');
  await page.waitForFunction(() => {
    try { return typeof S === 'object' && typeof buildCampTabSyncRows === 'function'; } catch (_) { return false; }
  }, null, { timeout: 20000 });

  const diffs = await page.evaluate(() => {
    window.confirm = () => true; window.alert = () => {};
    // Weekly-mode week with a paid guest missing paidAt (legacy shape),
    // an item with meta-time, and an item WITHOUT d/t (worst case).
    S.activeWeek = {
      id: '11111111-1111-4111-8111-111111111111',
      start: '2026-08-15',
      guests: [
        { id: '22222222-2222-4222-8222-222222222222', name: 'Legacy Paid', paid: true, items: [
          { id: '33333333-3333-4333-8333-333333333333', n: 'Beer', p: 500, c: 'Drinks', d: '2026-08-16', t: '18:00' },
          { id: '44444444-4444-4444-8444-444444444444', n: 'Coke', p: 300, c: 'Drinks' },
        ]},
      ],
      staff: [],
    };
    const build = () => {
      const { weekRows, guestRows, itemRows } = buildCampTabSyncRows('loc-test');
      return { w: weekRows.map(r => JSON.stringify(r)), g: guestRows.map(r => JSON.stringify(r)), i: itemRows.map(r => JSON.stringify(r)) };
    };
    const a = build();
    const b = build();
    const diffs = [];
    ['w','g','i'].forEach(k => a[k].forEach((row, idx) => { if (row !== b[k][idx]) diffs.push(k + '[' + idx + ']: ' + row.slice(0, 120) + '  VS  ' + b[k][idx].slice(0, 120)); }));
    return diffs;
  });
  console.log('\nDIFFS:', JSON.stringify(diffs, null, 1));
  expect(diffs).toEqual([]);
});
