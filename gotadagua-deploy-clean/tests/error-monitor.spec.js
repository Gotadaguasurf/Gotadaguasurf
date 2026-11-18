// /error-monitor.js reaches Miguel (audit 18 Nov 2026): a page error of a logged-in person is stored in
// client_errors (supabase/audit-w4-infra.sql) — at most 3 per page load, each message once, no query
// strings, nothing when logged out, and a failed report never shows a second banner or reports itself.
// Hermetic: a blank test page on the local server; every call to Supabase is stubbed.
const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const PAGE = '/__error-monitor-test.html?guest=Ana&id=42';
const HTML = '<!doctype html><meta charset="utf-8"><title>t</title><script src="/supabase-config.js"></script><script src="/error-monitor.js"></script><body><p>test</p>';

async function open(page, { loggedIn = true, status = 201 } = {}) {
  const posts = [];
  await page.route('**/__error-monitor-test.html*', r => r.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
  await page.route(`https://${PROJECT_REF}.supabase.co/**`, async r => {
    if (r.request().method() === 'POST') posts.push({ url: r.request().url(), headers: r.request().headers(), body: JSON.parse(r.request().postData() || '{}') });
    if (status === 0) return r.abort();
    return r.fulfill({ status, contentType: 'application/json', body: status >= 400 ? '{"message":"relation \\"client_errors\\" does not exist"}' : '' });
  });
  if (loggedIn) await page.addInitScript(([k]) => localStorage.setItem(k, JSON.stringify({ access_token: 'test-access-token', user: { id: 'u1' } })), [`sb-${PROJECT_REF}-auth-token`]);
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__errorMonitorLoaded === true);
  return posts;
}
const boom = (page, msg) => page.evaluate((m) => { setTimeout(() => { throw new Error(m); }, 0); }, msg);
const reject = (page, msg) => page.evaluate((m) => { Promise.reject(new Error(m)); }, msg);

test('error monitor: a logged-in error reaches client_errors — at most 3, each message once, no query string', async ({ page }) => {
  const posts = await open(page);
  await boom(page, 'Cannot read properties of undefined (reading \'rows\')');
  await expect.poll(() => posts.length).toBe(1);
  const p = posts[0];
  expect(p.url).toBe(`https://${PROJECT_REF}.supabase.co/rest/v1/client_errors`);
  expect(p.headers.authorization).toBe('Bearer test-access-token');
  expect(p.body).toMatchObject({ page: '/__error-monitor-test.html', kind: 'window.error', message: "Uncaught Error: Cannot read properties of undefined (reading 'rows')" });
  expect(JSON.stringify(p.body)).not.toContain('guest=Ana');
  expect(Object.keys(p.body).sort()).toEqual(['kind', 'message', 'page', 'source', 'user_agent']);
  await expect(page.locator('#__errMonBanner')).toBeVisible();          // the banner is unchanged

  await boom(page, 'Cannot read properties of undefined (reading \'rows\')');   // same message: not again
  await reject(page, 'Save failed: 500');
  await reject(page, 'Another one');
  await reject(page, 'A fourth one');                                     // over the cap
  await page.waitForTimeout(300);
  expect(posts.map(x => x.body.message)).toEqual(["Uncaught Error: Cannot read properties of undefined (reading 'rows')", 'Save failed: 500', 'Another one']);
  expect(posts[1].body.kind).toBe('unhandledrejection');
});

test('error monitor: logged out nothing is sent; before the SQL runs a refused report stays quiet', async ({ page, browser }) => {
  const posts = await open(page, { loggedIn: false });
  await boom(page, 'logged out error');
  await page.waitForTimeout(300);
  expect(posts).toHaveLength(0);
  await expect(page.locator('#__errMonBanner')).toBeVisible();

  for (const status of [404, 0]) {
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    const sent = await open(p2, { status });
    await boom(p2, 'first error');
    await expect.poll(() => sent.length).toBe(1);
    await p2.waitForTimeout(300);
    // the failed report did not replace the banner's message or report itself
    await expect(p2.locator('#__errMonBanner')).toContainText('first error');
    expect(sent).toHaveLength(1);
    expect(await p2.evaluate(() => window.__lastError.message)).toContain('first error');
    await ctx.close();
  }
});
