// Each person sees only the apps they can open (audit 18 Nov 2026, SA-05 / SA-06):
//   hub (/index.html)      only the cards of the areas they hold; an empty section loses its title; no card → one clear line
//   app switcher (shell)   the same apps as the cards, on every page
// The owner sees everything. Hermetic: every Supabase call is stubbed (tests/hub-stub.js).
const { test, expect } = require('@playwright/test');
const { stubHub, UID, OWNER } = require('./hub-stub');

const SHOTS = process.env.W3_SHOTS || '';   // folder for screenshots (optional)

async function openHub(page) {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('appShell') && getComputedStyle(document.getElementById('appShell')).display !== 'none'
    && (document.querySelector('#page-hub .workspace-card') || getComputedStyle(document.getElementById('hubEmpty')).display !== 'none'), null, { timeout: 15000 });
  return errs;
}
const hubState = (page) => page.evaluate(() => ({
  cards: [...document.querySelectorAll('#page-hub .workspace-card .card-title')].map(e => e.textContent.trim()),
  keys: [...document.querySelectorAll('#page-hub .workspace-link')].map(b => (b.getAttribute('onclick').match(/'([^']+)'/) || [])[1]),
  titles: [...document.querySelectorAll('#page-hub .section')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.querySelector('.section-title').textContent.trim()),
  locks: document.querySelectorAll('#page-hub .workspace-lock, #page-hub .workspace-card.disabled').length,
  empty: getComputedStyle(document.getElementById('hubEmpty')).display !== 'none' ? document.getElementById('hubEmpty').textContent.trim() : '',
  menu: [...document.querySelectorAll('[data-app-menu] a')].map(a => a.querySelector('span').textContent.trim() + ' ' + a.getAttribute('href')),
  menuLabels: [...document.querySelectorAll('[data-app-menu] a span')].map(s => s.textContent.trim()),
  menuGroups: [...document.querySelectorAll('[data-app-menu] .app-switch-group')].map(s => s.textContent.trim()),
  menuEmpty: (document.querySelector('[data-app-menu] .app-switch-empty') || {}).textContent || '',
  saved: JSON.parse(localStorage.getItem('gd_app_access_v1') || 'null'),
  overflow: document.documentElement.scrollWidth - window.innerWidth,
}));

test('hub: a Camp Tab-only bar person sees one card, no locked cards, and a menu with the same apps', async ({ page }) => {
  await stubHub(page, { email: 'bar@example.com', role: 'bar_man', areas: [{ slug: 'portugal', can_edit: false }] });
  const errs = await openHub(page);
  const s = await hubState(page);
  expect(s.cards).toEqual(['Portugal']);
  expect(s.titles).toEqual(['Surf Camps']);                 // Businesses, Prices and Management have no card → no title
  expect(s.locks).toBe(0);
  expect(s.empty).toBe('');
  expect(s.menuLabels).toEqual(['Home', 'Camp hub']);
  expect(s.menu).toEqual(['Home /', 'Camp hub /camp-hub/?location=portugal']);   // their own camp, not the Sri Lanka default
  expect(s.menuGroups).toEqual([]);
  expect(s.saved.uid).toBe(UID);
  expect(s.overflow).toBeLessThanOrEqual(0);
  // one phone screen, not three (was 2,527px with 17 locked cards)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  // the card still opens the camp in Camp Tab-only mode
  await page.click('#campGrid .workspace-link');
  await page.waitForURL(/\/camp-hub\?location=portugal&view=camp-tab-only/, { timeout: 10000 }).catch(() => {});
  expect(page.url()).toContain('location=portugal');
  expect(page.url()).toContain('view=camp-tab-only');
  expect(errs).toEqual([]);
});

test('hub: the owner still sees every card and every app', async ({ page }) => {
  await stubHub(page, { email: OWNER, role: 'super_admin', areas: [{ slug: 'hq' }, { slug: 'portugal' }] });
  await openHub(page);
  const s = await hubState(page);
  expect(s.cards.length).toBe(18);
  expect(s.titles).toEqual(['Surf Camps', 'Businesses', 'Prices', 'Management']);
  expect(s.menuLabels).toEqual(['Home', 'HQ', 'Camp hub', 'Prices', 'Surf School', 'Partners', 'CRM', 'Instructors', 'Wild Wednesday', 'The Suk', 'Dipløria']);
  expect(s.menuGroups).toEqual(['Businesses']);
  expect(s.menu).toContain('Camp hub /camp-hub/');
});

// the same rule in two places: the hub decides the cards (canAccessWorkspace), the shell decides the menu when
// the person never passed by the hub (AppShell.areasFor). They must give the same answer.
for (const who of [
  { name: 'location manager, Morocco + its prices', role: 'location_manager', areas: ['morocco', 'prices-morocco'],
    labels: ['Home', 'Camp hub', 'Prices'], hrefs: ['/', '/camp-hub/?location=morocco', '/prices/?location=morocco'] },
  { name: 'role «owner» with two areas: everything except HQ and Dipløria', role: 'owner', areas: ['sri-lanka', 'prices-sri-lanka'],
    labels: ['Home', 'Camp hub', 'Prices', 'Surf School', 'Partners', 'CRM', 'Instructors', 'Wild Wednesday', 'The Suk'] },
  { name: 'viewer with HQ + Partners', role: 'viewer', areas: ['hq', 'partners'], labels: ['Home', 'HQ', 'Partners'] },
  { name: 'rentals staff, Surf School only', role: 'viewer', areas: ['surf-school'], canEdit: false, labels: ['Home', 'Camp hub', 'Surf School'], hrefs: ['/', '/camp-hub/?location=surf-school', '/surf-school/'] },
]) {
  test(`hub cards and app menu agree — ${who.name}`, async ({ page }) => {
    await stubHub(page, { email: 'person@example.com', role: who.role, areas: who.areas.map(slug => ({ slug, can_edit: who.canEdit !== false })) });
    await openHub(page);
    const s = await hubState(page);
    expect(s.menuLabels).toEqual(who.labels);
    if (who.hrefs) expect(s.menu.map(m => m.split(' ').pop())).toEqual(who.hrefs);
    // what the shell would work out by itself from the same memberships = what the hub's cards say
    const own = await page.evaluate(([role, slugs]) => AppShell.areasFor({ email: 'person@example.com', role, slugs }), [who.role, who.areas]);
    const cardAreas = s.keys.filter(k => k !== 'settings');
    expect([...own].sort()).toEqual([...cardAreas].sort());
    expect(s.saved.areas.filter(k => k !== 'settings').sort()).toEqual([...cardAreas].sort());
    expect(s.locks).toBe(0);
  });
}

test('hub: a person whose only area has no card gets one clear line, not an empty page', async ({ page }) => {
  await stubHub(page, { email: 'new@example.com', role: 'viewer', areas: [{ slug: 'junior-camp' }] });   // the database has this slug, the hub has no card for it
  const errs = await openHub(page);
  const s = await hubState(page);
  expect(s.cards).toEqual([]);
  expect(s.titles).toEqual([]);
  expect(s.empty).toBe('No apps on this account yet. Ask Miguel for access.');
  expect(s.menuLabels).toEqual(['Home']);
  expect(s.menuEmpty).toContain('Ask Miguel for access');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-hub-no-apps-390.png` });
  expect(errs).toEqual([]);
});

test('app switcher on another page: with no saved list it asks once and shows only the apps held (the current page always)', async ({ page }) => {
  const { calls } = await stubHub(page, { email: 'wild@example.com', role: 'viewer', areas: [{ slug: 'wild-wednesday' }, { slug: 'morocco' }] });
  await page.goto('/wild/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-app-menu] a').length === 3, null, { timeout: 15000 });
  const menu = await page.evaluate(() => ({
    items: [...document.querySelectorAll('[data-app-menu] a')].map(a => a.querySelector('span').textContent.trim() + ' ' + a.getAttribute('href')),
    current: (document.querySelector('[data-app-menu] a.is-current span') || {}).textContent,
    groups: [...document.querySelectorAll('[data-app-menu] .app-switch-group')].map(g => g.textContent.trim()),
  }));
  expect(menu.items).toEqual(['Home /', 'Camp hub /camp-hub/?location=morocco', 'Wild Wednesday /wild/']);
  expect(menu.current).toBe('Wild Wednesday');
  expect(menu.groups).toEqual(['Businesses']);
  // one question to the server, with the person's own token, read-only
  const asked = calls.filter(c => c.table === 'workspace_memberships' && c.url.includes('select=workspaces(slug)'));
  expect(asked.length).toBe(1);
  expect(asked[0].method).toBe('GET');
  // a page the person does not hold still lists itself (never a menu without «you are here»)
  await page.goto('/instructors/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-app-menu] a').length > 0, null, { timeout: 15000 });
  expect(await page.evaluate(() => [...document.querySelectorAll('[data-app-menu] a span')].map(s => s.textContent.trim()))).toEqual(['Home', 'Camp hub', 'Instructors', 'Wild Wednesday']);
});

test('app switcher: when the list cannot be read it stays complete, and a saved list of another person is ignored', async ({ page }) => {
  await stubHub(page, { email: 'someone@example.com', role: 'viewer', areas: [{ slug: 'crm' }] },
    { onRequest: ({ url }) => url.includes('/rest/v1/workspace_memberships') && url.includes('select=workspaces(slug)') ? { status: 500, body: { message: 'boom' } } : null });
  await page.addInitScript(() => localStorage.setItem('gd_app_access_v1', JSON.stringify({ uid: 'another-person', areas: ['hq'], at: Date.now() })));
  await page.goto('/instructors/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[data-app-menu] a').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.querySelectorAll('[data-app-menu] a').length)).toBe(11);
});

test('app switcher: Log out forgets the saved list', async ({ page }) => {
  await stubHub(page, { email: 'bar@example.com', role: 'bar_man', areas: [{ slug: 'portugal', can_edit: false }] });
  await openHub(page);
  expect(await page.evaluate(() => !!localStorage.getItem('gd_app_access_v1'))).toBe(true);
  await page.evaluate(() => doSignOut());
  await page.waitForFunction(() => !localStorage.getItem('gd_app_access_v1'), null, { timeout: 10000 });
});

test('hub «View as»: the home page says whose view it is and gives the way back', async ({ page }) => {
  await stubHub(page, { email: OWNER, role: 'super_admin', areas: [{ slug: 'hq' }] });
  await openHub(page);
  await page.evaluate(() => { accessUsers.push({ userId: 'u-x', email: 'bar@example.com', role: 'Bar Man', meta: 'Bar', areas: ['portugal-camp-tab'], workspaceRoles: {} }); setPreviewAccess('bar@example.com'); });
  let s = await hubState(page);
  expect(s.cards).toEqual(['Portugal']);
  expect(await page.textContent('#hubPreviewNote')).toContain('bar@example.com');
  expect(s.menuLabels.length).toBe(11);                      // the menu stays Miguel's own
  await page.click('#hubPreviewNote button');
  s = await hubState(page);
  expect(s.cards.length).toBe(18);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('hubPreviewNote')).display)).toBe('none');
});
