// HQ ↔ Sri Lanka: the HQ screens must show the same Sri Lanka figure as the
// one formula (hq_overview_rollup). Audit 12 Nov 2026.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const CATS = [
  { id: 'c-sal', name: 'Salary', sort_order: 1, is_personal: false, active: true },
  { id: 'c-par', name: 'Partners', sort_order: 2, is_personal: false, active: true },
  { id: 'c-wt',  name: 'Work Trips', sort_order: 3, is_personal: false, active: true },
];

async function stubHq(page, { rollup, ledger = [], invoices = [] }) {
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json(rollup);
    if (url.includes('/rest/v1/hq_invoice_categories')) return json(CATS);
    if (url.includes('/rest/v1/ledger_entries')) return json(ledger);
    if (url.includes('/rest/v1/hq_invoices')) return json(url.includes('select=id') ? [] : invoices);
    return json([]);
  });
}

test('hq drill-down: an HQ-paid Sri Lanka cost is listed once (Paid by HQ), never also as camp spending', async ({ page }) => {
  // The ledger mirror of an HQ invoice (source_kind 'hq_invoice') and a 2026
  // partner commission (already netted in the booking) must not inflate the
  // chips: Camp = camp-paid rows only, HQ = the invoices the Overview counts.
  const rollup = {
    bookings: [{ month_key: '2026-10', location: 'Surf Camp Ahangama', direct: true, total: 1000, net_amount: 1000, commission_amount: 0, pax: 1, n: 1 }],
    invoices: [{ month: '2026-10', location_slug: 'sri-lanka', category_id: 'c-sal', personal: false, amount_eur: 955.27, n: 1 }],
    ledger: [{ month: '2026-10', type: 'expense', slug: 'sri-lanka', attributed_location: 'sri-lanka', source_kind: 'manual', amount_eur: 400 },
             { month: '2026-10', type: 'expense', slug: 'sri-lanka', attributed_location: 'sri-lanka', source_kind: 'hq_invoice', amount_eur: 955.27 }],
  };
  const ledger = [
    { entry_date: '2026-10-30', category: 'Salary', description: 'francisco duarte · pago pelo HQ', amount_local: 955.27, currency: 'EUR', fx_rate: 1, amount_eur: 955.27, payment_method: 'HQ Paid', source_kind: 'hq_invoice', type: 'expense', attributed_location: 'sri-lanka' },
    { entry_date: '2026-10-12', category: 'Food', description: 'Market', amount_local: 148000, currency: 'LKR', fx_rate: 370, amount_eur: 400, payment_method: 'Cash', source_kind: 'manual', type: 'expense', attributed_location: 'sri-lanka' },
  ];
  const invoices = [
    { invoice_date: '2026-10-30', company: 'francisco duarte', description: 'Ordenado', amount_eur: 955.27, currency: 'EUR', amount: 955.27, paying_company: 'water-movements', category_name: 'Salary', category_id: 'c-sal', is_duplicate: false, commission_in_booking: null },
    { invoice_date: '2026-10-19', company: 'stoked adventure group', description: 'INV-156', amount_eur: 112.35, currency: 'EUR', amount: 112.35, paying_company: 'water-movements', category_name: 'Partners', category_id: 'c-par', is_duplicate: false, commission_in_booking: null },
  ];
  await stubHq(page, { rollup, ledger, invoices });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#ov_period') && document.querySelector('#ov_period').options.length > 1, null, { timeout: 15000 });
  await page.selectOption('#ov_period', '2026-10');
  await page.waitForFunction(() => /1 booking/.test(document.querySelector('#overviewBody')?.textContent || ''), null, { timeout: 15000 });
  const row = await page.evaluate(() => [...document.querySelectorAll('tr.loc-row-drill')].map(tr => tr.textContent).find(t => /Sri Lanka/.test(t)));
  // Overview row: 1000 − 400 (camp) − 955.27 (HQ) = −355.27
  expect(row).toContain('€-355.27');
  await page.evaluate(() => openLocDrilldown('sri-lanka', '2026-10', 'Sri Lanka', -355.27));
  await page.waitForFunction(() => /Camp/.test(document.querySelector('#drawerProfitRow')?.textContent || ''), null, { timeout: 15000 });
  const out = await page.evaluate(() => ({
    chips: document.querySelector('#drawerProfitRow').textContent,
    body: document.querySelector('#drawerBody').textContent,
  }));
  expect(out.chips).toContain('Camp €400.00');
  expect(out.chips).toContain('HQ €955.27');
  expect(out.body).toContain('1 entry');
  expect(out.body).not.toContain('stoked');
  expect(errs).toEqual([]);
});

test('hq overview: the monthly trend stops at the current month (prepaid Sri Lanka rent dated 2027–2028 does not push it into the future)', async ({ page }) => {
  const now = new Date();
  const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rollup = {
    bookings: [{ month_key: cur, location: 'Surf Camp Ahangama', direct: true, total: 1000, net_amount: 1000, commission_amount: 0, pax: 1, n: 1 },
               { month_key: '2026-01', location: 'Surf Camp Ahangama', direct: true, total: 500, net_amount: 500, commission_amount: 0, pax: 1, n: 1 }],
    invoices: [],
    ledger: [{ month: '2027-09', type: 'expense', slug: 'sri-lanka', attributed_location: 'sri-lanka', source_kind: 'manual', amount_eur: 3116.88 },
             { month: '2028-02', type: 'expense', slug: 'sri-lanka', attributed_location: 'sri-lanka', source_kind: 'manual', amount_eur: 3116.88 }],
  };
  await stubHq(page, { rollup });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.trend-col').length > 0, null, { timeout: 15000 });
  const months = await page.evaluate(() => [...document.querySelectorAll('.trend-col')].map(c => c.getAttribute('title').slice(0, 7)));
  expect(months).toContain(cur);
  expect(months.every(m => m <= cur)).toBe(true);
  // All-time still counts the prepaid rent (it was paid): 1500 − 2 × 3116.88
  const hero = await page.evaluate(() => document.querySelector('.hero-val')?.textContent.trim());
  expect(hero).toBe('€-4,733.76');
  expect(errs).toEqual([]);
});
