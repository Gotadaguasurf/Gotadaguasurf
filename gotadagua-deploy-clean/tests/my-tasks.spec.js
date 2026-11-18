// HQ «My tasks» (owners only, 18 Nov 2026): one card per source with its status
// and the website one tap away. The facts come from hq_my_tasks()
// (supabase/hq-my-tasks.sql); the status rule is MyTasks.status (hq/my-tasks.js).
// Hermetic: every Supabase call is stubbed.
const { test, expect } = require('@playwright/test');
const path = require('path');
const MyTasks = require('../hq/my-tasks.js');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const OWNER = 'miguel@gotadaguasurf.com';
const STAFF = 'staff@gotadaguasurf.com';
const SHOTS = process.env.MYTASKS_SHOTS || '';   // folder for the 390 / 1280 screenshots (optional)

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function fakeSession(page, email) {
  const id = '00000000-0000-4000-8000-000000000001';
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', exp: 9_999_999_999 })}.test-signature`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'test-refresh',
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' } };
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
// Shape of the real hq_my_tasks() output on 18 Nov 2026 (read-only SELECT of its body)
function fixture() {
  return {
    generated_at: new Date().toISOString(), today: '2026-11-18',
    sources: [
      { key: 'santander', block: 'water-movements', kind: 'bank2', last_date: '2026-11-17', loaded_at: '2026-11-17T16:08:56Z' },
      { key: 'cgd', block: 'water-movements', kind: 'bank2', last_date: '2026-11-16', loaded_at: '2026-11-17T15:00:17Z' },
      { key: 'santander_card', block: 'water-movements', kind: 'monthly', last_date: '2026-11-01', loaded_at: '2026-11-05T11:32:12Z' },
      { key: 'paypal', block: 'water-movements', kind: 'week', last_date: '2026-11-17', loaded_at: '2026-11-18T11:27:55Z' },
      { key: 'bcp', block: 'manjar', kind: 'bank2', last_date: '2026-11-16', loaded_at: '2026-11-17T14:48:50Z' },
      { key: 'sampath', block: 'water-movements', kind: 'bank2', last_date: '2026-11-15', loaded_at: '2026-11-16T07:47:32Z' },
      { key: 'sg_morocco', block: 'water-movements', kind: 'bank2', last_date: '2026-11-15', loaded_at: '2026-11-17T18:50:37Z' },
      { key: 'uber', block: 'water-movements', kind: 'doc', last_date: '2026-11-16', prev_month_docs: 7 },
      { key: 'via_verde', block: 'water-movements', kind: 'doc', last_date: '2026-11-03', prev_month_docs: 4 },
      { key: 'mailchimp', block: 'water-movements', kind: 'doc', last_date: '2026-10-18', prev_month_docs: 1 },
      { key: 'google_ads', block: 'water-movements', kind: 'doc', last_date: '2026-11-03', prev_month_docs: 5 },
      { key: 'meta_ads', block: 'water-movements', kind: 'doc', last_date: '2026-11-17', prev_month_docs: 2 },
      { key: 'mail:accounting@gotadaguasurf.com', block: 'water-movements', kind: 'run', last_run_at: ago(5) },
      { key: 'mail:ricardo.gasurfcamp@gmail.com', block: 'water-movements', kind: 'run', last_run_at: ago(5), error: 'conta: Google recusou o refresh token: invalid_grant' },
      { key: 'bl_reports', block: 'water-movements', kind: 'run', last_run_at: ago(20) },
    ],
  };
}

async function stubHq(page, { email = OWNER, role = 'super_admin', hqMember = true, tasks = 'fixture', todo = {} } = {}) {
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(), url = req.url();
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (obj) => json(single ? obj : (obj ? [obj] : []));
    if (url.includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001', email, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return one({ id: '00000000-0000-4000-8000-000000000001', email, full_name: 'Test', platform_role: role });
    if (url.includes('/rest/v1/workspace_memberships')) return one(hqMember ? { workspace_id: 'w-hq', can_view: true, active: true, workspaces: { slug: 'hq' } } : null);
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/hq_todo')) return json(todo);
    if (url.includes('/rest/v1/rpc/hq_my_tasks')) {
      if (tasks === 'missing') return json({ code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.hq_my_tasks without parameters in the schema cache' }, 404);
      return json(typeof tasks === 'function' ? tasks() : fixture());
    }
    return json([]);
  });
}

async function openHq(page, url = '/hq/') {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#tab-overview') && document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
  return errs;
}

// ── the rule ──────────────────────────────────────────────────────────────
test('my tasks rule: the 2-day rule skips the weekend, future dates never count, monthly / 7-day / automatic rules', () => {
  const st = (row, today, now) => MyTasks.status(row, today, now).code;
  // Monday 23 Nov 2026
  expect(st({ kind: 'bank2', last_date: '2026-11-20' }, '2026-11-23')).toBe('ok');        // Fri → Mon: weekend does not count
  expect(st({ kind: 'bank2', last_date: '2026-11-19' }, '2026-11-23')).toBe('ok');        // Thu → Mon: only Fri uncovered
  expect(st({ kind: 'bank2', last_date: '2026-11-18' }, '2026-11-23')).toBe('due');       // Wed → Mon: Thu + Fri
  expect(st({ kind: 'bank2', last_date: '2026-11-17' }, '2026-11-23')).toBe('overdue');   // Tue → Mon: Wed + Thu + Fri
  expect(MyTasks.weekdaysBetween('2026-11-20', '2026-11-23')).toBe(0);
  expect(MyTasks.daysBetween('2026-11-20', '2026-11-23')).toBe(2);
  // Wednesday 18 Nov: Sunday 15 leaves Mon + Tue uncovered
  expect(st({ kind: 'bank2', last_date: '2026-11-15' }, '2026-11-18')).toBe('due');
  // a future date (the Sri Lanka rent dated 2028) is not «covered»
  expect(st({ kind: 'bank2', last_date: '2028-02-01' }, '2026-11-18')).toBe('overdue');
  expect(st({ kind: 'bank2', last_date: null }, '2026-11-18')).toBe('overdue');
  // PayPal: every 7 days (calendar)
  expect(st({ kind: 'week', last_date: '2026-11-11' }, '2026-11-18')).toBe('ok');
  expect(st({ kind: 'week', last_date: '2026-11-10' }, '2026-11-18')).toBe('due');
  expect(st({ kind: 'week', last_date: '2026-11-09' }, '2026-11-18')).toBe('overdue');
  // card: previous month complete, overdue from the 10th
  expect(st({ kind: 'monthly', last_date: '2026-10-31' }, '2026-11-18')).toBe('ok');
  expect(st({ kind: 'monthly', last_date: '2026-10-15' }, '2026-11-09')).toBe('due');
  expect(st({ kind: 'monthly', last_date: '2026-10-15' }, '2026-11-10')).toBe('overdue');
  // automatic documents: overdue only after the 8th with nothing for last month
  expect(st({ kind: 'doc', last_date: '2026-10-02', prev_month_docs: 0 }, '2026-11-08')).toBe('auto');
  expect(st({ kind: 'doc', last_date: '2026-10-02', prev_month_docs: 0 }, '2026-11-09')).toBe('overdue');
  expect(st({ kind: 'doc', last_date: '2026-10-18', prev_month_docs: 1 }, '2026-11-18')).toBe('auto');
  // automatic imports: 2 h without a run, or an error
  const now = Date.parse('2026-11-18T12:00:00Z');
  expect(st({ kind: 'run', last_run_at: '2026-11-18T10:30:00Z' }, '2026-11-18', now)).toBe('auto');
  expect(st({ kind: 'run', last_run_at: '2026-11-18T09:59:00Z' }, '2026-11-18', now)).toBe('overdue');
  expect(st({ kind: 'run', last_run_at: '2026-11-18T11:55:00Z', error: 'conta: invalid_grant' }, '2026-11-18', now)).toBe('overdue');
  expect(st({ kind: 'run', last_run_at: null }, '2026-11-18', now)).toBe('overdue');
});

// ── owner ─────────────────────────────────────────────────────────────────
test('my tasks: the owner sees the tab, two blocks, overdue first, the header count and the Overview chip', async ({ page }) => {
  await stubHq(page);
  await fakeSession(page, OWNER);
  const errs = await openHq(page);
  // one chip replaces the per-bank statement chips
  const chips = await page.locator('.health-chip').allTextContents();
  expect(chips.some(c => /My tasks: 3/.test(c))).toBe(true);
  expect(chips.some(c => /statement/.test(c))).toBe(false);
  // the tab is in the drawer (390px) and the chip opens it
  await expect(page.locator('#ntabTasksMob')).toHaveCount(1);
  await page.locator('.health-chip', { hasText: 'My tasks' }).click();
  await expect(page.locator('#tab-tasks')).toHaveClass(/active/);
  await expect(page.locator('#mtSummary')).toHaveText('1 overdue · 2 due');
  const blocks = await page.locator('.mt-block-title').allTextContents();
  expect(blocks).toEqual(['Water Movements', 'Manjar']);
  const water = await page.locator('.mt-block[data-block="water-movements"] .mt-row').evaluateAll(rs => rs.map(r => `${r.dataset.key}:${r.dataset.status}`));
  expect(water[0]).toBe('mail:ricardo.gasurfcamp@gmail.com:overdue');
  expect(water.slice(1, 3)).toEqual(['sampath:due', 'sg_morocco:due']);
  expect(water).toContain('santander:ok');
  expect(water).toContain('uber:auto');
  expect(water).toContain('bl_reports:auto');
  await expect(page.locator('.mt-block[data-block="manjar"] .mt-row')).toHaveCount(1);
  const cgd = page.locator('.mt-row[data-key="cgd"]');
  await expect(cgd).toContainText('Covered until Mon 16 Nov');
  await expect(cgd).toContainText('Loaded Tue 17 Nov');
  await expect(cgd.locator('.badge')).toHaveText('OK');
  await expect(page.locator('.mt-row[data-key="sampath"] .badge')).toHaveText('Due');
  await expect(page.locator('.mt-row[data-key="mail:ricardo.gasurfcamp@gmail.com"] .badge')).toHaveText('Overdue');
  await expect(page.locator('.mt-row[data-key="uber"] .badge')).toHaveText('Automatic');
  await expect(page.locator('.mt-row[data-key="uber"]')).toContainText('Last document Mon 16 Nov');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'my-tasks-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#ntabTasks')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'my-tasks-1280.png'), fullPage: true });
  expect(errs).toEqual([]);
});

test('my tasks: Open links go to each website in a new tab; Upload only where the app has an importer', async ({ page }) => {
  await stubHq(page);
  await fakeSession(page, OWNER);
  await openHq(page, '/hq/?tab=tasks');
  await expect(page.locator('#tab-tasks')).toHaveClass(/active/);
  await page.waitForSelector('.mt-row');
  const links = await page.locator('.mt-row').evaluateAll(rs => Object.fromEntries(rs.map(r => {
    const a = r.querySelector('a[data-act="open"]');
    return [r.dataset.key, a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null];
  })));
  const want = {
    santander: 'https://www.santander.pt/empresas',
    cgd: 'https://www.cgd.pt/Empresas',
    bcp: 'https://empresas.millenniumbcp.pt',
    sampath: 'https://www.sampath.lk',
    sg_morocco: 'https://www.sgmaroc.com',
    paypal: 'https://www.paypal.com/reports/statements/monthly',
    uber: 'https://riders.uber.com/trips',
    via_verde: 'https://www.viaverde.pt/empresas/minha-via-verde/extratos-movimentos',
    mailchimp: 'https://us4.admin.mailchimp.com/account/billing-history/',
    google_ads: 'https://ads.google.com/aw/billing/documents?ocid=214208330',
    meta_ads: 'https://adsmanager.facebook.com/adsmanager/billing_hub/payment_activity/?asset_id=814598912211070&business_id=2279734382295092',
  };
  for (const [k, href] of Object.entries(want)) {
    expect(links[k], k).toEqual({ href, target: '_blank' });
  }
  expect(links['bl_reports']).toBeNull();
  // Upload: Santander (HQ accountant panel) and BCP (/suk/ Bank statement) — nothing else
  const uploads = await page.locator('.mt-row:has([data-act="upload"])').evaluateAll(rs => rs.map(r => r.dataset.key).sort());
  expect(uploads).toEqual(['bcp', 'santander']);
  await expect(page.locator('.mt-row[data-key="bcp"] [data-act="upload"]')).toHaveAttribute('href', '/suk/?import=1#bank');
  // the Open button is easy to tap on a phone
  const box = await page.locator('.mt-row[data-key="cgd"] a[data-act="open"]').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.locator('.mt-row[data-key="santander"] [data-act="upload"]').click();
  await expect(page.locator('#accountantModal')).toHaveJSProperty('open', true);
  await expect(page.locator('#acc_bank_file')).toBeAttached();
});

test('my tasks over a weekend: on Monday a Friday statement is OK, a Wednesday one is Due', async ({ page }) => {
  await stubHq(page, { tasks: () => ({ today: '2026-11-23', sources: [
    { key: 'santander', block: 'water-movements', kind: 'bank2', last_date: '2026-11-20', loaded_at: '2026-11-20T18:00:00Z' },
    { key: 'cgd', block: 'water-movements', kind: 'bank2', last_date: '2026-11-18', loaded_at: '2026-11-19T09:00:00Z' },
    { key: 'bcp', block: 'manjar', kind: 'bank2', last_date: '2026-11-17', loaded_at: '2026-11-18T09:00:00Z' },
  ] }) });
  await fakeSession(page, OWNER);
  await openHq(page, '/hq/?tab=tasks');
  await page.waitForSelector('.mt-row');
  await expect(page.locator('#mtSummary')).toHaveText('1 overdue · 1 due');
  await expect(page.locator('.mt-row[data-key="santander"]')).toHaveAttribute('data-status', 'ok');
  await expect(page.locator('.mt-row[data-key="santander"]')).toContainText('Covered until Fri 20 Nov');
  await expect(page.locator('.mt-row[data-key="cgd"]')).toHaveAttribute('data-status', 'due');
  await expect(page.locator('.mt-row[data-key="bcp"]')).toHaveAttribute('data-status', 'overdue');
});

test('my tasks before the SQL is run: friendly «needs the SQL update» state, old statement chips stay', async ({ page }) => {
  await stubHq(page, { tasks: 'missing', todo: { bank_last: [
    { bank: 'cgd', company: 'water-movements', last: '2026-11-01', days: 17 },
    { bank: 'paypal', company: 'water-movements', last: '2026-11-01', days: 17 },
  ] } });
  await fakeSession(page, OWNER);
  const errs = await openHq(page);
  const chips = await page.locator('.health-chip').allTextContents();
  expect(chips.some(c => /My tasks/.test(c))).toBe(false);
  expect(chips.some(c => /CGD statement 17d old/.test(c))).toBe(true);
  expect(chips.some(c => /PayPal statement 17d old/.test(c))).toBe(true);   // no longer mislabelled «Santander»
  await page.evaluate(() => switchTab('tasks'));
  await expect(page.locator('#tab-tasks [data-state="missing"]')).toContainText('My tasks needs the SQL update');
  expect(errs).toEqual([]);
});

// ── non-owner ─────────────────────────────────────────────────────────────
test('my tasks: an HQ member who is not an owner sees no tab and cannot open it by URL or hash', async ({ page }) => {
  let called = 0;
  await stubHq(page, { email: STAFF, role: 'viewer', tasks: () => { called++; return fixture(); } });
  await fakeSession(page, STAFF);
  const errs = await openHq(page, '/hq/?tab=tasks');
  await expect(page.locator('#ntabTasks')).toHaveCount(0);
  await expect(page.locator('#ntabTasksMob')).toHaveCount(0);
  await expect(page.locator('#tab-tasks')).toHaveCount(0);
  await expect(page.locator('#tab-overview')).toHaveClass(/active/);
  await page.evaluate(() => switchTab('tasks'));
  await expect(page.locator('#tab-overview')).toHaveClass(/active/);
  const chips = await page.locator('.health-chip').allTextContents();
  expect(chips.some(c => /My tasks/.test(c))).toBe(false);
  await page.goto('/hq/#tasks', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
  await expect(page.locator('#tab-tasks')).toHaveCount(0);
  expect(called).toBe(0);
  expect(errs).toEqual([]);
});
