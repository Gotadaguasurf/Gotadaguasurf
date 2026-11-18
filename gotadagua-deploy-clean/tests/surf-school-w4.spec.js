// Surf School, audit 18 Nov 2026 (W4, UXC-12): on a phone a manager's six tabs all fit on screen (they wrap) instead
// of «Sales» and «Customers» hiding in a sideways strip. Hermetic (tests/surf-school-stub.js).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');
const { quietSurfSchool } = require('./surf-school-stub');
const SHOTS = process.env.W4_SHOTS || '';

for (const width of [390, 1280]) {
  test(`surf school: every tab of a manager is on screen (UXC-12) — ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fakeOwnerSession(page);
    await quietSurfSchool(page);
    await page.goto('/surf-school/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#salesTabBtn')).toBeVisible({ timeout: 10000 });   // the owner sees Sales and Customers
    const off = await page.evaluate(() => [...document.querySelectorAll('.subnav .pill')].filter(b => b.offsetParent).filter(b => b.getBoundingClientRect().right > innerWidth).map(b => b.textContent.trim()));
    expect(off).toEqual([]);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `surf-school-tabs-${width}.png`) });
  });
}
