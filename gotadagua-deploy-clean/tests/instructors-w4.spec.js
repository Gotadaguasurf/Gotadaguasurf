// Instructors, audit 18 Nov 2026 (W4, UXC-11): the period filters say «everything» once — no «All time» pill next to
// «All years», the quick pill that matches the view is lit, and the summary line does not repeat the period on its own.
// Hermetic: every Supabase call answered locally (tests/surf-school-stub.js gives an owner and empty lists).
const { test, expect } = require('@playwright/test');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');
const { quietSurfSchool } = require('./surf-school-stub');
const SHOTS = process.env.W4_SHOTS || '';

for (const width of [390, 1280]) {
  test(`instructors: one way to say «all», the matching quick pill is lit (UXC-11) — ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fakeOwnerSession(page);
    await quietSurfSchool(page);
    await page.goto('/instructors/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.periodo === 'function' && typeof window.render === 'function');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-05`;
      entries = [{ id: 'a', instructorId: 'x', date: iso, instructorName: 'Instructor A', lessonCategory: 'Surf School', numberOfLessons: 2, paymentType: 'Cash', priceUnit: 25, total: 50, paid: false, notes: '' }];
      loadInstructorData = async () => {};
      selectedYear = 'all'; selectedMonth = 'all'; render();
    });
    await expect(page.locator('[data-periodo="tudo"]')).toHaveCount(0);
    await expect(page.locator('#filterSummary')).toHaveText('');
    await page.locator('[data-periodo="mes"]').click();
    await expect(page.locator('[data-periodo="mes"]')).toHaveClass(/active/);
    await expect(page.locator('[data-periodo="ano"]')).not.toHaveClass(/active/);
    await page.evaluate(() => { selectedCategory = 'Surf School'; render(); });
    await expect(page.locator('#filterSummary')).toContainText('Surf School');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(sw).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `instructors-filters-${width}.png`) });
  });
}
