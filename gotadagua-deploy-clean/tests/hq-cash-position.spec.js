// HQ «Cash flow» → «Bank balances» + «Next 30 days» (owners only, 18 Nov 2026).
// The facts come from hq_cash_position() (supabase/hq-cash-position.sql); the rule that
// turns them into dates and a lowest point is CashPosition.plan (hq/cash-position.js).
// Hermetic: every Supabase call is stubbed. All names and amounts are invented.
const { test, expect } = require('@playwright/test');
const path = require('path');
const CashPosition = require('../hq/cash-position.js');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const OWNER = 'miguel@gotadaguasurf.com';
const STAFF = 'staff@gotadaguasurf.com';
const SHOTS = process.env.CASH_SHOTS || '';   // folder for the 390 / 1280 screenshots (optional)

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function fakeSession(page, email) {
  const id = '00000000-0000-4000-8000-000000000001';
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', exp: 9_999_999_999 })}.test-signature`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'test-refresh',
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' } };
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

// Same shape as hq_cash_position() (Wednesday 18 Nov 2026)
function fixture() {
  return {
    generated_at: '2026-11-18T10:00:00Z', today: '2026-11-18',
    accounts: [
      { key: 'santander', currency: 'EUR', balance: 9480.20, as_of: '2026-11-17', loaded_at: '2026-11-17T16:00:00Z' },
      { key: 'cgd', currency: 'EUR', balance: 120300, as_of: '2026-11-16', loaded_at: '2026-11-17T15:00:00Z' },
    ],
    payments: [
      { key: 'leasing', name: null, account: 'santander', amount: 3100.5, day: 1, n: 3, recent: [3100.5, 3100.5, 3100.5], this_month_date: '2026-11-02', this_month_amount: 3100.5, months: null },
      { key: 'rent', name: 'Casa Azul Lda', account: 'santander', amount: 900, day: 1, n: 3, recent: [900, 900, 900], this_month_date: '2026-11-03', this_month_amount: 900, months: null },
      { key: 'social_security', name: null, account: 'santander', amount: 4000, day: 10, n: 3, recent: [4400, 4000, 4000], this_month_date: '2026-11-11', this_month_amount: 4400, months: null },
      { key: 'state_irs', name: null, account: 'santander', amount: 1500, day: 10, n: 3, recent: [1500, 1500, 1500], this_month_date: '2026-11-11', this_month_amount: 1500, months: null },
      { key: 'state_irc', name: null, account: 'santander', amount: 5000, day: 11, n: 2, recent: [5000, 5000], this_month_date: null, this_month_amount: null, months: [7, 9, 12] },
      { key: 'state_iva', name: null, account: 'santander', amount: 6000, day: 17, n: 3, recent: [6000, 6000, 5000], this_month_date: '2026-11-11', this_month_amount: 7000, months: null },
      { key: 'leasing', name: null, account: 'cgd', amount: 2000, day: 20, n: 3, recent: [2000, 2000, 2000], this_month_date: null, this_month_amount: null, months: null },
      { key: 'salaries', name: null, account: 'santander', amount: 8200, day: 28, n: 3, recent: [8200, 8200, 7900], this_month_date: null, this_month_amount: null, months: null },
    ],
  };
}

async function stubHq(page, { email = OWNER, role = 'super_admin', cash = 'fixture', calls = {} } = {}) {
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(), url = req.url();
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (obj) => json(single ? obj : (obj ? [obj] : []));
    if (url.includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001', email, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return one({ id: '00000000-0000-4000-8000-000000000001', email, full_name: 'Test', platform_role: role });
    if (url.includes('/rest/v1/workspace_memberships')) return one({ workspace_id: 'w-hq', can_view: true, active: true, workspaces: { slug: 'hq' } });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/hq_cash_position')) {
      calls.cash = (calls.cash || 0) + 1;
      if (cash === 'missing') return json({ code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.hq_cash_position without parameters in the schema cache' }, 404);
      if (cash === 'empty') return json({});
      if (cash === 'error') return json({ code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' }, 500);
      return json(typeof cash === 'function' ? cash() : fixture());
    }
    if (url.includes('/rest/v1/rpc/')) return json({});
    return json([]);
  });
}

async function openHq(page, url = '/hq/') {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#tab-overview') && document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
  return errs;
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ── the rule ──────────────────────────────────────────────────────────────
test('cash position rule: dates, amounts, what already left this month and the lowest point per account', () => {
  const p = CashPosition.plan(fixture());
  expect(p.until).toBe('2026-12-18');
  // by date; the December ones count even though November's already left
  expect(p.toLeave.map(r => `${r.when} ${r.key}@${r.account} ${r.amount}`)).toEqual([
    '2026-11-20 leasing@cgd 2000',
    '2026-11-28 salaries@santander 8200',
    '2026-12-01 leasing@santander 3100.5',
    '2026-12-01 rent@santander 900',
    '2026-12-10 social_security@santander 4400',   // this month's (4,400) is the newest of the last 3
    '2026-12-10 state_irs@santander 1500',
    '2026-12-11 state_irc@santander 5000',         // fixed calendar Jul · Sep · Dec
    '2026-12-17 state_iva@santander 6000',
  ]);
  expect(p.toLeave.find(r => r.key === 'rent').label).toBe('Rent · Casa Azul Lda');
  expect(p.toLeave.find(r => r.key === 'social_security')).toMatchObject({ left: true, leftDate: '2026-11-11' });
  expect(p.toLeave.find(r => r.key === 'salaries')).toMatchObject({ left: false, late: false });
  expect(p.paid).toEqual([]);
  const [sant, cgd] = p.lows;
  expect(sant).toMatchObject({ key: 'santander', lowest: -19620.3, on: '2026-12-17', belowZeroFrom: '2026-12-01', alert: true });
  expect(cgd).toMatchObject({ key: 'cgd', lowest: 118300, on: '2026-11-20', belowZeroFrom: null, alert: false });
});

test('cash position rule: late, partly paid, paid early, fixed calendar, short months and the year end', () => {
  const one = (today, pay, acc = [{ key: 'santander', balance: 5000, as_of: today }]) => CashPosition.plan({ today, accounts: acc, payments: [pay] });
  const base = { key: 'leasing', account: 'santander', amount: 2000, day: 20, recent: [2000, 2000, 2000], this_month_amount: null, this_month_date: null, months: null };
  // expected on the 20th, today the 22nd, nothing in the statement → still to leave, counted from today
  let p = one('2026-11-22', base);
  expect(p.toLeave[0]).toMatchObject({ late: true, due: '2026-11-20', when: '2026-11-22', amount: 2000 });
  expect(p.lows[0]).toMatchObject({ lowest: 3000, on: '2026-11-22', alert: false });
  // a small part left (under half): the rest is still expected this month
  p = one('2026-11-08', { ...base, this_month_amount: 500, this_month_date: '2026-11-06' });
  expect(p.toLeave[0]).toMatchObject({ left: false, when: '2026-11-20', amount: 1500, leftAmount: 500 });
  // paid early this month and the next one falls after the window → «Paid», out of the lowest point
  p = one('2026-11-12', { ...base, day: 25, this_month_amount: 2100, this_month_date: '2026-11-11' });
  expect(p.toLeave).toEqual([]);
  expect(p.paid[0]).toMatchObject({ key: 'leasing', leftDate: '2026-11-11', leftAmount: 2100 });
  expect(p.lows[0]).toMatchObject({ lowest: 5000, on: null, alert: false });
  // fixed calendar (Jul · Sep · Dec): in October nothing is expected within 30 days
  const irc = { key: 'state_irc', account: 'santander', amount: 5000, day: 11, recent: [5000], months: [7, 9, 12] };
  expect(one('2026-10-05', irc).toLeave).toEqual([]);
  expect(one('2026-11-18', irc).toLeave[0]).toMatchObject({ when: '2026-12-11', amount: 5000 });
  // day 31 in a short month, and December → January
  expect(one('2027-02-10', { ...base, day: 31 }).toLeave[0].when).toBe('2027-02-28');
  p = one('2026-12-20', { ...base, day: 1, this_month_amount: 2000, this_month_date: '2026-12-01' });
  expect(p.toLeave[0].when).toBe('2027-01-01');
  // under the buffer but above zero is an alert too; a payment of another account does not touch this one
  p = one('2026-11-18', { ...base, amount: 3500, recent: [3500] });
  expect(p.lows[0]).toMatchObject({ lowest: 1500, alert: true, belowZeroFrom: null });
  p = one('2026-11-18', { ...base, account: 'cgd' });
  expect(p.lows[0]).toMatchObject({ lowest: 5000, on: null });
  expect(CashPosition.money(-19620.3, 'EUR', 0)).toBe('−€19,620');
  expect(CashPosition.money(9480.2, 'EUR', 2)).toBe('€9,480.20');
});

// ── owner, phone ──────────────────────────────────────────────────────────
test('cash position at 390px: balances with their date, the 30-day list, the lowest point in red, no side scroll', async ({ page }) => {
  const calls = {};
  await stubHq(page, { calls });
  await fakeSession(page, OWNER);
  const errs = await openHq(page);
  // nothing new on the Overview: the numbers are only asked for when Cash flow opens
  expect(calls.cash || 0).toBe(0);
  expect((await page.locator('.health-chip').allTextContents()).some(c => /balance|lowest|santander/i.test(c))).toBe(false);
  await page.evaluate(() => switchTab('cashflow'));
  const cp = page.locator('#cashPosition');
  await expect(cp.locator('.card-title')).toHaveText(['Bank balances', 'Next 30 days']);
  // one row per Water Movements account; Manjar's bank is not here
  const bal = cp.locator('.cp-bal');
  await expect(bal).toHaveCount(2);
  await expect(bal.nth(0)).toContainText('Santander');
  await expect(bal.nth(0)).toContainText('€9,480.20');
  await expect(bal.nth(0)).toContainText('as of Tue 17 Nov');
  await expect(bal.nth(1)).toContainText('CGD');
  await expect(bal.nth(1)).toContainText('€120,300.00');
  await expect(bal.nth(1)).toContainText('as of Mon 16 Nov');
  await expect(cp).not.toContainText(/BCP|Millennium/i);
  await expect(cp).toContainText('PayPal, the Santander card and the camp banks are not here');
  // the list: by date, at most 8 rows, name · day · amount · whether this month's left
  const rows = cp.locator('.cp-row[data-key]');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText('≈ Fri 20 Nov');
  await expect(rows.nth(0)).toContainText('Leasing');
  await expect(rows.nth(0)).toContainText('CGD');
  await expect(rows.nth(1)).toContainText('≈ Sat 28 Nov');
  await expect(rows.nth(1)).toContainText('Salaries');
  await expect(rows.nth(1)).toContainText('≈ €8,200');
  const ss = cp.locator('.cp-row[data-key="social_security"]');
  await expect(ss).toContainText('≈ Thu 10 Dec');
  await expect(ss).toContainText('Santander · November paid');
  await expect(rows.nth(1)).not.toContainText('paid');   // the salaries of November have not left
  await expect(cp.locator('.cp-row[data-key="rent"]')).toContainText('Rent · Casa Azul Lda');
  await expect(cp).toContainText('until Fri 18 Dec');
  // lowest point: Santander red (below zero), CGD not
  const lowS = cp.locator('.cp-low[data-account="santander"]');
  await expect(lowS).toHaveText('Lowest point: Santander ≈ −€19,620 on Thu 17 Dec · below zero from Tue 1 Dec');
  await expect(lowS).toHaveClass(/neg/);
  const lowC = cp.locator('.cp-low[data-account="cgd"]');
  await expect(lowC).toHaveText('Lowest point: CGD ≈ €118,300 on Fri 20 Nov');
  await expect(lowC).not.toHaveClass(/neg/);
  // the existing Cash flow content is still there, below
  await expect(page.locator('#tab-cashflow .card-title', { hasText: 'Cash flow per company' })).toBeVisible();
  await expect(page.locator('#cashflowBody table')).toBeVisible();
  const order = await page.evaluate(() => document.getElementById('cashPosition').compareDocumentPosition(document.getElementById('cashflowBody')) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(order).toBeTruthy();
  // one primary button at most in the view, and nothing wider than the phone
  expect(await page.locator('#tab-cashflow .btn-p:visible').count()).toBeLessThanOrEqual(1);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  const cut = await cp.locator('.cp-row').evaluateAll(rs => rs.filter(r => r.scrollWidth > r.clientWidth + 1).length);
  expect(cut).toBe(0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cash-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cash-1280.png'), fullPage: true });
  expect(calls.cash).toBe(1);
  expect(errs).toEqual([]);
});

test('cash position: a payment expected days ago and not in the statement shows «Due»; one paid early shows «Paid»', async ({ page }) => {
  await stubHq(page, { cash: () => ({ today: '2026-11-22',
    accounts: [{ key: 'santander', currency: 'EUR', balance: 5000, as_of: '2026-11-19' }],
    payments: [
      { key: 'leasing', account: 'santander', amount: 2000, day: 20, recent: [2000, 2000, 2000], this_month_amount: null, this_month_date: null, months: null },
      { key: 'state_iva', account: 'santander', amount: 6000, day: 28, recent: [6000, 6000, 6000], this_month_amount: 6400, this_month_date: '2026-11-12', months: null },
    ] }) });
  await fakeSession(page, OWNER);
  await openHq(page, '/hq/?tab=cashflow');
  const cp = page.locator('#cashPosition');
  const due = cp.locator('.cp-row[data-state="due"]');
  await expect(due).toHaveCount(1);
  await expect(due.locator('.badge')).toHaveText('Due');
  await expect(due).toContainText('expected Fri 20 Nov, not in the statement yet');
  const paid = cp.locator('.cp-row[data-state="paid"]');
  await expect(paid.locator('.badge')).toHaveText('Paid');
  await expect(paid).toContainText('Thu 12 Nov');
  await expect(paid).toContainText('€6,400.00');
  await expect(cp.locator('.cp-low')).toHaveText('Lowest point: Santander ≈ €3,000 on Sun 22 Nov');
  await expect(cp.locator('.cp-low')).not.toHaveClass(/neg/);
});

// ── before the SQL is run / errors ────────────────────────────────────────
for (const cash of ['missing', 'empty']) {
  test(`cash position before the SQL is run (${cash}): the block stays hidden and Cash flow works as before`, async ({ page }) => {
    await stubHq(page, { cash });
    await fakeSession(page, OWNER);
    const errs = await openHq(page, '/hq/?tab=cashflow');
    await expect(page.locator('#tab-cashflow')).toHaveClass(/active/);
    await expect(page.locator('#cashflowBody table')).toBeVisible();
    await expect(page.locator('#cashPosition')).toBeHidden();
    await expect(page.locator('#cashPosition')).toHaveAttribute('data-state', 'missing');
    await expect(page.locator('#tab-cashflow .card-title').first()).toHaveText('Cash flow per company');
    expect(errs).toEqual([]);
  });
}

test('cash position: a real database error is shown as it is, and the rest of the tab still loads', async ({ page }) => {
  await stubHq(page, { cash: 'error' });
  await fakeSession(page, OWNER);
  await openHq(page, '/hq/?tab=cashflow');
  await expect(page.locator('#cashPosition .status-err')).toContainText('Could not load the bank balances: canceling statement due to statement timeout');
  await expect(page.locator('#cashflowBody table')).toBeVisible();
});

test('cash position: no statement with a balance yet → an empty state that says what to do', async ({ page }) => {
  await stubHq(page, { cash: () => ({ today: '2026-11-18', accounts: [], payments: [] }) });
  await fakeSession(page, OWNER);
  await openHq(page, '/hq/?tab=cashflow');
  await expect(page.locator('#cashPosition .empty-title')).toHaveText('No bank balance yet');
  await expect(page.locator('#cashPosition')).toContainText('Import a Santander or CGD statement');
});

// ── non-owner ─────────────────────────────────────────────────────────────
test('cash position: an HQ member who is not an owner gets no block and no call', async ({ page }) => {
  const calls = {};
  await stubHq(page, { email: STAFF, role: 'viewer', calls });
  await fakeSession(page, STAFF);
  const errs = await openHq(page, '/hq/?tab=cashflow');
  await expect(page.locator('#tab-cashflow')).toHaveClass(/active/);
  await expect(page.locator('#cashflowBody table')).toBeVisible();
  await expect(page.locator('#cashPosition')).toHaveCount(0);
  await expect(page.locator('#tab-cashflow')).not.toContainText('Bank balances');
  expect(calls.cash || 0).toBe(0);
  expect(errs).toEqual([]);
});
