// SA-03 / SEC-10 page-side guard (audit 18 Nov 2026) — for Miguel to keep or revert.
// A team manager who is not Miguel cannot, through «Send invite»: invite their own email, give HQ or Settings the
// person does not already hold, or make someone Owner / Admin. Miguel's invites are unchanged.
// Hermetic: every Supabase call is stubbed (tests/hub-stub.js); the addresses are example.com.
const { test, expect } = require('@playwright/test');
const { stubHub, OWNER } = require('./hub-stub');

async function invite(page, { email, role, areas }) {
  return page.evaluate(async ([email, role, areas]) => {
    document.getElementById('accessFullName').value = 'New Person';
    document.getElementById('accessEmail').value = email;
    document.getElementById('accessRole').value = role;
    window.__draftAreas = areas;
    await addAccessUser();
    return document.getElementById('toast').textContent;
  }, [email, role, areas]);
}
async function openAs(page, person) {
  const hub = await stubHub(page, person);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#page-hub .workspace-card') && typeof addAccessUser === 'function' && typeof __accessModel !== 'undefined' && __accessModel === 'workspace-v2', null, { timeout: 15000 });
  return hub;
}
const invites = (calls) => calls.filter(c => c.url.includes('/functions/v1/create-platform-invite'));

test('invite guard: a manager who is not Miguel cannot grant HQ / Settings, Owner / Admin, or change their own access', async ({ page }) => {
  const { calls } = await openAs(page, { email: 'manager@example.com', role: 'owner', manager: true, areas: [{ slug: 'settings' }, { slug: 'portugal' }] });
  expect(await invite(page, { email: 'new@example.com', role: 'Viewer', areas: ['hq', 'portugal'] })).toContain('Only Miguel can give');
  expect(await invite(page, { email: 'new@example.com', role: 'Viewer', areas: ['settings', 'portugal'] })).toContain('Only Miguel can give');
  expect(await invite(page, { email: 'new@example.com', role: 'Owner', areas: ['portugal'] })).toBe('Only Miguel can make someone Owner.');
  expect(await invite(page, { email: 'manager@example.com', role: 'Viewer', areas: ['portugal'] })).toContain("can't change your own access");
  expect(invites(calls)).toHaveLength(0);
  // an ordinary invite still goes out
  await invite(page, { email: 'new@example.com', role: 'Viewer', areas: ['portugal'] });
  expect(invites(calls)).toHaveLength(1);
});

test('invite guard: Miguel can still invite anyone with any area and role', async ({ page }) => {
  const { calls } = await openAs(page, { email: OWNER, role: 'super_admin', areas: [{ slug: 'settings' }, { slug: 'hq' }] });
  await invite(page, { email: 'new@example.com', role: 'Admin', areas: ['hq', 'settings', 'portugal'] });
  expect(invites(calls)).toHaveLength(1);
});
