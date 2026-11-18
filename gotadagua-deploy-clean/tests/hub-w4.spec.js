// Hub (/index.html), audit 18 Nov 2026 (W4):
//   SA-13   one open loads the person once (it ran three times at once) and never tries to create a «profit» workspace
//   PRT-20  the «Manage bookings» delete texts say the truth: the camp hub reads the same list, and a re-import never
//           brings back a hand-made APP- booking, its notes or a price override
// Hermetic: tests/hub-stub.js answers every Supabase call; the bookings are made up.
const { test, expect } = require('@playwright/test');
const { stubHub, OWNER } = require('./hub-stub');

test('hub: one open loads the person once and writes nothing (SA-13)', async ({ page }) => {
  const { calls } = await stubHub(page, { email: 'staff@example.com', role: 'viewer', areas: [{ slug: 'portugal' }, { slug: 'crm' }] });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.workspace-card').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1500);                                               // let any late auth event land
  const reads = t => calls.filter(c => c.table === t && c.method === 'GET').length;
  expect(calls.filter(c => c.table === 'workspaces' && c.method !== 'GET')).toEqual([]);   // no self-heal upsert
  // one load reads the invitation list twice and their areas once; three loads used to read them 6 and 3 times
  expect(reads('workspace_invitations')).toBe(2);
  expect(reads('invitation_workspace_access')).toBe(1);
  expect(errs).toEqual([]);
});

test('manage bookings: the delete texts say the camp hub loses them too and what a re-import cannot bring back (PRT-20)', async ({ page }) => {
  const bookings = [{ booking_ref: 'T1', booker: 'Guest 1', check_in_on: '2026-11-03', month_key: '2026-11', total: 500, location: 'Surf Camp Portugal', status: 'paid' },
    { booking_ref: 'T2', booker: 'Guest 2', check_in_on: '2026-11-04', month_key: '2026-11', total: 500, location: 'Surf Camp Portugal', status: 'paid' }];
  await stubHub(page, { email: OWNER, role: 'super_admin', areas: [{ slug: 'hq' }] }, { bookings });
  await page.goto('/?openImport=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /bookings? imported/.test(document.getElementById('csvManageStatus')?.textContent || ''), null, { timeout: 20000 });
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.evaluate(() => deleteCsvBucket('2026-11', 'Surf Camp Portugal', 2));
  await expect.poll(() => asked).not.toBe('');
  expect(asked).toContain('The bookings list only (Partners and the camp hub both read it)');
  expect(asked).toContain('never a hand-made APP- booking, its notes or a price override');
  expect(asked).not.toContain('the camp hub keeps them');
  asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.evaluate(() => deleteCsvSingleBooking('T1', 'Guest 1'));
  await expect.poll(() => asked).toContain('It disappears from Partners and from the camp hub');
});
