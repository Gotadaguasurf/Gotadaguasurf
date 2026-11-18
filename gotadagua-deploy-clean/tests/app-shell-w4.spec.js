// lib/app-shell.js, audit 18 Nov 2026 (W4, UXC-13): the shared escape helper escapes all five HTML characters, so a
// name with an apostrophe is safe inside a single-quoted attribute; an onclick built with it still runs.
const { test, expect } = require('@playwright/test');

test('AppShell.esc escapes the apostrophe too, and an escaped onclick still works (UXC-13)', async ({ page }) => {
  await page.goto('/prices/pricelist.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AppShell && typeof AppShell.esc === 'function');
  const r = await page.evaluate(() => {
    const out = AppShell.esc(`O'Neill & <b>"Co"</b>`);
    const box = document.createElement('div');
    box.innerHTML = `<span title='${AppShell.esc("it's")}'></span><button onclick="${AppShell.esc("window.__hit='yes'")}"></button>`;
    box.querySelector('button').click();
    return { out, title: box.querySelector('span').title, hit: window.__hit };
  });
  expect(r.out).toBe('O&#39;Neill &amp; &lt;b&gt;&quot;Co&quot;&lt;/b&gt;');
  expect(r.title).toBe("it's");
  expect(r.hit).toBe('yes');
});
