// Log out on phones (17 Nov 2026) — Miguel: «no mobile não dá para fazer logout».
// ≤820px the header's .nav-actions (user chip + Sign out) are hidden, so every app registers its own
// sign-out with AppShell.setAccount and the shell shows it: an «Account» section at the top of the
// hamburger drawer, or a compact «Log out» in the header on pages without a drawer.
// Each test runs at 390px, opens the page with a fake owner session, finds a visible «Log out»,
// clicks it and checks the page's own handler ran (POST /auth/v1/logout?scope=local, stubbed — nothing reaches
// production; local = this device only, the owner's other computers stay signed in) plus what that handler does
// afterwards (login screen / back to the hub).
const { test, expect } = require('@playwright/test');
const path = require('path');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const USER = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'miguel@gotadaguasurf.com',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' };
const PROFILE = { id: USER.id, email: USER.email, full_name: 'Miguel Test', platform_role: 'super_admin', active: true, password_set_at: '2024-01-01T00:00:00Z' };
const WS_HQ = '00000000-0000-4000-8000-0000000000b1';
const SHOTS = path.join(__dirname, '..', 'test-results', 'mobile-logout-shots');

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const JWT = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER.id, email: USER.email, role: 'authenticated', exp: 9_999_999_999 })}.smoke-test-signature`;

// Plants the session once per tab (sessionStorage flag) so the page after the logout redirect really is signed out.
async function setup(page) {
  const session = { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'smoke-test-refresh', user: USER };
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('__mlPlanted')) { localStorage.setItem(key, value); sessionStorage.setItem('__mlPlanted', '1'); }
  }, [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
  const ctl = { logouts: [] };
  await page.route('**/auth/v1/logout**', (route) => { ctl.logouts.push(route.request().url()); route.fulfill({ status: 204, body: '' }); });
  await page.route('**/auth/v1/user**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) }));
  await page.route('**/auth/v1/token**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' }));
  // PostgREST: the signed-in profile, the page's location row and one HQ membership (the hub needs an area); every other table answers empty (and the realtime socket is left alone).
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request(); const url = req.url();
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const locSlug = (new URL(url).searchParams.get('slug') || '').replace(/^eq\./, '');
    const rows = /\/rest\/v1\/platform_profiles/.test(url) ? [PROFILE]
      : /\/rest\/v1\/locations/.test(url) && locSlug ? [{ id: '00000000-0000-4000-8000-0000000000a1', slug: locSlug, name: locSlug }]
      : /\/rest\/v1\/workspaces\b/.test(url) ? [{ id: WS_HQ, slug: 'hq', name: 'HQ' }]
      : /\/rest\/v1\/workspace_memberships/.test(url) ? [{ workspace_id: WS_HQ, member_role: 'admin', can_view: true, can_edit: true, can_manage_team: true }] : [];
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    if (single) return rows.length ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) })
      : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
  });
  return ctl;
}
// every visible «Log out» / «Sign out» control on screen (header + open drawer) — a phone must see exactly one
const visibleSignOuts = (page) => page.locator('button:visible, a:visible').filter({ hasText: /^\s*(log|sign)\s*out\s*$/i }).count();
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Pages whose header has a hamburger drawer → «Account» section with the name + «Log out».
const DRAWER_PAGES = [
  { name: 'hq', path: '/hq/', after: 'hub' },
  { name: 'camp-hub', path: '/camp-hub/?location=sri-lanka', after: 'hub' },
  { name: 'camp-hub local manager', path: '/camp-hub/?location=sri-lanka&view=local', after: 'hub' },
  { name: 'camp-hub camp tab only', path: '/camp-hub/?location=portugal&view=camp-tab-only', after: 'hub' },
  { name: 'partners', path: '/partners/', after: 'hub' },
  { name: 'crm', path: '/crm/', after: 'crm-login' },
  { name: 'suk', path: '/suk/', after: 'hub' },
  { name: 'wild', path: '/wild/', after: 'hub' },
  { name: 'diploria', path: '/diploria/', after: 'hub' },
  { name: 'instructors', path: '/instructors/', after: 'hub' },
  { name: 'prices', path: '/prices/?location=sri-lanka', after: 'hub' },
];
// Pages without a drawer → compact «Log out» in the header.
const HEADER_PAGES = [
  { name: 'hub', path: '/', after: 'hub-login' },
  { name: 'surf-school', path: '/surf-school/', after: 'hub' },
];

async function expectAfter(page, after) {
  if (after === 'hub' || after === 'hub-login') {
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toBe('/');
    await expect(page.locator('#loginEmail')).toBeVisible({ timeout: 10_000 });
  } else if (after === 'crm-login') {
    await expect(page.locator('#loginScreen')).toBeVisible({ timeout: 10_000 });
  }
}
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-');

for (const p of DRAWER_PAGES) {
  test(`phone log out from the drawer: ${p.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ctl = await setup(page);
    await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    const burger = page.locator('.nav-hamburger:visible').first();
    await expect(burger).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);   // let the boot fill the user chip
    await burger.click();
    const account = page.locator('#mobAccount');
    await expect(account).toBeVisible();
    await expect(account.locator('.nav-mob-lbl')).toHaveText('Account');
    const btn = page.locator('#mobLogoutBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Log out/);
    await expect(btn).toBeInViewport();
    expect(await page.locator('#mobNavDrawer .nav-mob-logout-btn').count()).toBe(1);
    expect(await page.locator('#mobNavDrawer >> text=/^Sign out$/').count()).toBe(0);   // no second sign-out in the drawer
    expect(await visibleSignOuts(page)).toBe(1);
    await page.waitForTimeout(400);   // drawer slide-in, for the screenshot
    await page.screenshot({ path: path.join(SHOTS, `${slug(p.name)}.png`) });
    await btn.click();
    await expect.poll(() => ctl.logouts.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(ctl.logouts.every(u => /[?&]scope=local\b/.test(u)), ctl.logouts.join(' ')).toBe(true);   // this device only
    await expectAfter(page, p.after);
  });
}

for (const p of HEADER_PAGES) {
  test(`phone log out from the header: ${p.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ctl = await setup(page);
    await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#navMobLogout');
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(btn).toHaveText(/Log out/);
    await expect(btn).toBeInViewport({ ratio: 1 });
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await visibleSignOuts(page)).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, `${slug(p.name)}.png`) });
    await btn.click();
    await expect.poll(() => ctl.logouts.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(ctl.logouts.every(u => /[?&]scope=local\b/.test(u)), ctl.logouts.join(' ')).toBe(true);   // this device only
    await expectAfter(page, p.after);
  });
}

test('narrow phone (360px): the header «Log out» is fully on screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  for (const p of HEADER_PAGES) {
    await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    const btn = page.locator('#navMobLogout');
    await expect(btn, p.path).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);   // user chip / HQ shortcut filled in
    await expect(btn, p.path).toBeInViewport({ ratio: 1 });
    expect(await noHorizontalScroll(page), p.path).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, `narrow-${slug(p.name)}.png`), clip: { x: 0, y: 0, width: 360, height: 140 } });
  }
});

test('camp-tab-only: the phone drawer matches the desktop header (Camp Tab only, no actions)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/camp-hub/?location=portugal&view=camp-tab-only', { waitUntil: 'domcontentloaded' });
  const burger = page.locator('.nav-hamburger:visible').first();
  await expect(burger).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);   // boot: HQ shortcut check, week/transport gates
  await burger.click();
  await expect(page.locator('#mobNavDrawer .ntab-m:visible')).toHaveText(['Camp Tab']);
  await expect(page.locator('#mobNavDrawer .nav-mob-lbl:visible')).toHaveText(['Account', 'Sections']);
  await expect(page.locator('#mobLogoutBtn')).toBeVisible();
  // desktop shows the same single tab
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.app-nav .ntab:visible')).toHaveCount(1);
  await expect(page.locator('.app-nav .ntab[data-page="pos"]')).toBeVisible();
});

test('phone header stays inside 390px with the drawer pages too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  for (const p of ['/camp-hub/?location=sri-lanka', '/hq/']) {
    await page.goto(p, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.nav-hamburger:visible').first()).toBeVisible({ timeout: 15_000 });
    expect(await noHorizontalScroll(page), p).toBe(true);
  }
});

test('desktop is unchanged: no phone log out buttons above 820px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setup(page);
  for (const p of ['/', '/surf-school/', '/prices/?location=sri-lanka', '/hq/', '/camp-hub/?location=sri-lanka']) {
    await page.goto(p, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await expect(page.locator('.nav-hamburger:visible')).toHaveCount(0);
    await expect(page.locator('#navMobLogout:visible')).toHaveCount(0);
    await expect(page.locator('#mobLogoutBtn')).not.toBeInViewport();
  }
});
