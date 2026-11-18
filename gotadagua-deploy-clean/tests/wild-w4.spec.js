// Wild Wednesday /wild/, audit wave 4 (18 Nov 2026): saving a closed night writes the
// new rows before removing the old ones and keeps the night's ticket price (SA-09),
// a loss reads «−€40.00» in red (SA-23), a commission line can be deleted (SA-10).
// Hermetic: Supabase is stubbed, amounts are invented.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const W = 'wl-0000';
function ledger() {
  const m = (id, category, type, amount_eur, qty, extra = {}) => ({ id, type, category, entry_date: '2026-08-05', amount_eur, source_kind: 'manual', payment_method: 'Cash', qty, description: `Wild 05/08 — ${category}`, ...extra });
  return [
    m('r1', 'Wild · Pure', 'revenue', 240, 20),          // sold at 12 €
    m('r2', 'Wild · Gota', 'revenue', 120, 10),
    m('r3', 'Wild · Porta', 'expense', 40, null),
    { id: 'c1', type: 'expense', category: 'Wild · Comissões', entry_date: '2026-09-02', amount_eur: 300, source_kind: 'manual', payment_method: 'Cash', qty: null, description: 'Commission Max — 300 €' },
  ];
}
async function openWild(page, { failInsert = false, rows = ledger() } = {}) {
  const calls = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', full_name: 'Miguel', platform_role: 'owner' });
    if (url.includes('/rest/v1/locations')) return json({ id: W, slug: 'wild-wednesday', name: 'Wild Wednesday' });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'POST') { calls.push({ op: 'insert', body: JSON.parse(req.postData() || '[]') }); return failInsert ? json({ message: 'insert refused' }, 400) : json([], 201); }
      if (method === 'DELETE') { calls.push({ op: 'delete', url }); return json([]); }
      return json(rows);
    }
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/wild/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Closed|Not closed yet/.test(document.querySelector('#nightsList')?.textContent || ''), null, { timeout: 15000 });
  return { calls, errs };
}
const openNight = (page, date) => page.evaluate(d => { document.getElementById('n_date').value = d; loadNightIntoForm(); }, date);

test('re-saving a closed night keeps its ticket price, and writes the new rows before deleting the old ones', async ({ page }) => {
  const { calls, errs } = await openWild(page);
  await openNight(page, '2026-08-05');
  expect(await page.inputValue('#n_price')).toBe('12');
  expect(await page.inputValue('#n_pure')).toBe('20');
  await page.evaluate(() => saveNight());
  await expect(page.locator('#toast')).toContainText('saved');
  expect(calls.map(c => c.op)).toEqual(['insert', 'delete']);
  const pure = calls[0].body.find(r => r.category === 'Wild · Pure');
  expect(pure).toMatchObject({ amount_eur: 240, qty: 20 });                       // 20 × 12, not 20 × 10
  expect(calls[1].url).toMatch(/id=in\.\(r1,r2,r3\)/);                          // the commission stays
  // a night with no saved rows starts again at the default price
  await openNight(page, '2026-08-12');
  expect(await page.inputValue('#n_price')).toBe('10');
  expect(errs).toEqual([]);
});

test('a refused insert leaves the closed night untouched (nothing is deleted)', async ({ page }) => {
  const { calls } = await openWild(page, { failInsert: true });
  await openNight(page, '2026-08-05');
  await page.evaluate(() => saveNight());
  await expect(page.locator('#toast.err')).toContainText("Couldn't save the night — insert refused");
  expect(calls.map(c => c.op)).toEqual(['insert']);
});

test('a night that lost money reads −€ in red', async ({ page }) => {
  await openWild(page);
  await openNight(page, '2026-08-12');
  await page.evaluate(() => { document.getElementById('n_door_person').value = 40; recalcNight(); });
  const res = page.locator('#nightTotals .row.big b');
  await expect(res).toHaveText('−€40.00');
  await expect(res).toHaveClass(/neg/);
  expect(await res.evaluate(e => getComputedStyle(e).color)).not.toBe(await page.evaluate(() => getComputedStyle(document.querySelector('#nightTotals .row:not(.big) b')).color));
});

test('a commission line can be deleted (with a confirm), one row by id', async ({ page }) => {
  const { calls } = await openWild(page);
  await page.evaluate(() => showPage('night'));
  const del = page.locator('#commList button[title="Delete this commission line"]');
  await expect(del).toHaveCount(1);
  await del.click();
  await expect(page.locator('#toast')).toContainText('Commission deleted');
  expect(calls).toEqual([{ op: 'delete', url: expect.stringMatching(/ledger_entries\?id=eq\.c1$/) }]);
});
