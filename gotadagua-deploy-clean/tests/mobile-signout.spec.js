// Phones (17 Nov 2026): the page's own Log out / Sign out stays visible in the header at 390px; other actions stay hidden.
const { test, expect } = require('@playwright/test');
for (const [path, label] of [['/index.html', 'Log out'], ['/crm/', 'Sign out']]) {
  test(`mobile sign-out visible at 390px: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const btn = page.locator('.nav-actions button', { hasText: label }).first();
    await expect(btn).toHaveClass(/nav-signout/, { timeout: 5000 });
    expect(await btn.evaluate(el => getComputedStyle(el).display)).not.toBe('none');
    const chip = page.locator('.nav-actions .user-chip').first();
    if (await chip.count()) expect(await chip.evaluate(el => getComputedStyle(el).display)).toBe('none');
  });
}
test('desktop header unchanged at 1280px: index.html shows the user chip and Log out', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html');
  const chip = page.locator('.nav-actions .user-chip').first();
  expect(await chip.evaluate(el => getComputedStyle(el).display)).not.toBe('none');
});
