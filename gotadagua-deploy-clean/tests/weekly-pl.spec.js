// Camp hub — Weekly P&L (Sri Lanka audit, 12 Nov 2026).
//
// Sri Lanka runs the Camp Tab in per_guest mode, so the hub keeps no weeks of
// its own (S.weeks is empty): every Weekly P&L row comes from the ledger and
// the guests from the Bookinglayer import (bookings table). The page is loaded
// with a stubbed Supabase (nothing reaches production) and one Saturday week
// that holds one row of every money kind.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = 'loc-sl';
const FX = 340;
const WS = '2026-10-17'; // Saturday
let seq = 0;
function row(type, method, amount, extra = {}) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, location_id: LOC, week_id: null, type,
    category: extra.category || (type === 'money_sent' ? 'Cash Float' : type === 'revenue' ? 'Drinks' : 'Food'),
    linked_item: null, description: extra.description || `${type} ${method} ${amount}`, payment_method: method, qty: 1,
    amount_local: amount, currency: 'LKR', entry_date: extra.date || '2026-10-20',
    business_area: extra.area || null, fx_rate: FX, amount_eur: Number((amount / FX).toFixed(2)),
    recurring_source_id: null, recurring_month: null, source_kind: extra.sourceKind || 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-10-20T10:00:00Z',
  };
}
function fixture() {
  seq = 0;
  return [
    row('money_sent', 'HQ Transfer', 1000000, { sourceKind: 'hq_transfer' }),            // bank +
    row('revenue', 'Cash', 4000, { area: 'Bar', sourceKind: 'camp_tab_per_item', description: 'Camp Tab · Ann · Lion Lager' }), // cash +
    row('expense', 'Cash', 12000, { area: 'Food' }),                                     // cash −
    row('expense', 'Bank Transfer', 100000, { category: 'Rent', area: 'General' }),      // bank −
    row('money_sent', 'ATM Withdrawal', 5000),                                           // bank − / cash + (nets 0)
    row('money_sent', 'Bank Transfer', 30000, { category: 'Loan', description: 'Loan to manager' }), // bank −
    row('money_sent', 'Cash', 80000, { description: 'Cash found in the box' }),          // cash +
    row('money_sent', 'Cash Out', 6000, { description: 'Old shop debt' }),               // cash −
    row('expense', 'HQ Paid', 40000, { category: 'Salary', area: 'General' }),           // neither
  ];
}
// One Bookinglayer booking: 2 guests, Sat 17 Oct → Sat 24 Oct = 14 guest-days.
const BOOKINGS = [{ booking_ref: 'B-1', booker: 'Ann', check_in_on: WS, pax: 2, package: 'Surf', nights: '7' }];

async function openHub(page, rows, bookings = BOOKINGS) {
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json([]);
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: FX, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) return json(rows);
    if (url.includes('/rest/v1/bookings')) return json(bookings);
    return json([]);
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true && ovBookings.length > 0; } catch (_) { return false; } }, null, { timeout: 15000 });
}

async function weeklyTable(page) {
  return page.evaluate(() => {
    showPage('weekly');
    const tbl = document.querySelector('#weeklyContent table');
    const head = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const body = [...tbl.querySelectorAll('tbody tr')].map(tr => Object.fromEntries([...tr.children].map((td, i) => [head[i], td.textContent.trim()])));
    const foot = Object.fromEntries([...tbl.querySelectorAll('tfoot td')].map((td, i) => [head[i], td.textContent.trim()]));
    return { head, body, foot };
  });
}
const eur = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);
const lkr = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(n);

test('weekly P&L: «Cash left this week» = what the week did to Bank + Cash (one drawer rule)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openHub(page, fixture());
  const t = await weeklyTable(page);
  expect(t.body.length).toBe(1);
  const r = t.body[0];
  // Bank +1,000,000 −100,000 −5,000 −30,000; Cash +4,000 −12,000 +5,000 +80,000 −6,000.
  const net = 1000000 - 100000 - 30000 + 4000 - 12000 + 80000 - 6000; // 936,000
  const rowEur = [1000000, -100000, -30000, 4000, -12000, 80000, -6000].reduce((s, a) => s + Math.sign(a) * Number((Math.abs(a) / FX).toFixed(2)), 0);
  expect(r['Net this week']).toBe(eur(rowEur));
  // Same local number as the drawers of that week.
  const drawers = await page.evaluate(ws => { const d = ledgerDrawerBalances(ledgerForWeek(ws)); return d.bankLocal + d.cashLocal; }, WS);
  expect(drawers).toBe(net);
  expect(Math.abs(rowEur - net / FX)).toBeLessThan(0.05);
  // The other columns are unchanged.
  expect(r['Drinks sales']).toBe(eur(4000 / FX));
  expect(r['Spent in cash']).toBe(eur(12000 / FX));
  expect(r['Paid by bank']).toBe(eur(100000 / FX));
  expect(r['Money from HQ']).toBe(eur(1000000 / FX));
  expect(t.foot['Net this week']).toBe(eur(rowEur));
  expect(errors).toEqual([]);
});

test('weekly P&L: «Food / guest-day» is in LKR and equals the Overview Food control', async ({ page }) => {
  await openHub(page, fixture());
  const t = await weeklyTable(page);
  // 12,000 LKR of food / 14 guest-days = 857 LKR (was €35.29/14 shown as «LKR 3»).
  expect(t.body[0]['Food / guest-day']).toBe(lkr(Math.round(12000 / 14)));
  expect(t.foot['Food / guest-day']).toBe(lkr(Math.round(12000 / 14)));
  const ov = await page.evaluate(() => {
    const div = document.createElement('div');
    div.innerHTML = buildFoodControlCardHtml([{ start: '2026-10-17' }], ledgerForWeek('2026-10-17'));
    const cells = [...div.querySelectorAll('.ov-area-cell')];
    const cell = cells.find(c => /Per guest-day/.test(c.textContent));
    return cell.querySelector('.ov-area-cell-value').textContent.trim();
  });
  expect(ov).toBe(t.body[0]['Food / guest-day']);
});

test('weekly P&L: guests per week come from Bookinglayer when the hub has no Camp Tab weeks', async ({ page }) => {
  await openHub(page, [...fixture(), row('expense', 'Cash', 1000, { date: '2026-10-26' })]);
  const t = await weeklyTable(page);
  const byWeek = Object.fromEntries(t.body.map(r => [r.Week.split(' → ')[0], r['Guests (paid / total)']]));
  expect(byWeek['17 Oct 2026']).toBe('2');
  expect(byWeek['24 Oct 2026']).toBe('—'); // booking checks out on Saturday 24 Oct
  expect(t.foot['Guests (paid / total)']).toBe('2');
});

test('weekly P&L: clicking a week opens the Overview on that week', async ({ page }) => {
  await openHub(page, fixture());
  await weeklyTable(page);
  await page.locator('#weeklyContent tbody tr').first().click();
  const st = await page.evaluate(() => ({ page: activePage, month: document.getElementById('ovMonthSel').value, week: document.getElementById('ovWeekSel').value }));
  expect(st).toEqual({ page: 'overview', month: '2026-10', week: 'csv:2026-10-17' });
});

test('closed-week revenue never repeats items already paid one by one (per_guest)', async ({ page }) => {
  await openHub(page, fixture());
  const wk = {
    id: '11111111-1111-4111-8111-111111111111', start: WS, closedAt: '2026-10-24T08:00:00Z',
    guests: [
      { name: 'Ann', paid: true, items: [{ id: 'i1', n: 'Lion Lager', p: 4000, c: 'Drinks', paidAt: '2026-10-20T10:00:00Z' }] },
      { name: 'Bob', paid: true, items: [{ id: 'i2', n: 'Lion Lager', p: 600, c: 'Drinks' }] }, // weekly-mode tab, no per-item pay
    ], staff: [],
  };
  const hub = await page.evaluate(w => (buildClosedWeekRevenueEntries(w) || []).map(e => e.amountLocal), wk);
  expect(hub).toEqual([600]);
  // The Camp Tab's own close-week message builds the same rows.
  await page.evaluate(() => showPage('pos'));
  const frame = await (async () => {
    for (let i = 0; i < 50; i++) { const f = page.frames().find(x => /camp-tab-inner/.test(x.url())); if (f) { try { await f.waitForFunction(() => typeof syncClosedWeekToHubLedger === 'function', null, { timeout: 500 }); return f; } catch (_) {} } await page.waitForTimeout(200); }
    return null;
  })();
  expect(frame).not.toBeNull();
  const inner = await frame.evaluate(w => {
    const sent = []; const orig = window.parent.postMessage.bind(window.parent);
    window.parent.postMessage = (m, o) => { if (m && m.type === 'camp-tab-week-closed') sent.push(m); else orig(m, o); };
    try { syncClosedWeekToHubLedger(w); } finally { window.parent.postMessage = orig; }
    return sent.flatMap(m => [].concat(m.entry || [])).map(e => e.amountLocal);
  }, wk);
  expect(inner).toEqual([600]);
});

// Miguel opens the hub from Lisbon. On 29 Mar 2026 the clocks go forward, so
// «check-in + 7 × 24 h» ends at 01:00 and a week «start + 7 × 24 h» ends at
// 01:00 on the next Saturday: next week's arrivals were counted in this week
// (Overview «booked guests», Weekly P&L guests, «Sync bookings to Camp Tab»).
test.describe('Lisbon clock change', () => {
  test.use({ timezoneId: 'Europe/Lisbon' });
  test('weeks around 29 Mar 2026 keep their own guests', async ({ page }) => {
    const bookings = [
      { booking_ref: 'B-28', booker: 'Ann', check_in_on: '2026-03-28', pax: 2, package: 'Surf', nights: '7' },
      { booking_ref: 'B-04', booker: 'Bob', check_in_on: '2026-04-04', pax: 3, package: 'Surf', nights: '7' },
    ];
    seq = 0;
    const rows = [row('expense', 'Cash', 1000, { date: '2026-03-30', area: 'Food' }), row('expense', 'Cash', 1000, { date: '2026-04-06', area: 'Food' })];
    await openHub(page, rows, bookings);
    const r = await page.evaluate(() => ({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      w28: ovBookingsForWeeks([{ start: '2026-03-28' }]).map(b => b.ref),
      w04: ovBookingsForWeeks([{ start: '2026-04-04' }]).map(b => b.ref),
      starts: ovAllBookingWeekStarts(),
    }));
    expect(r.tz).toBe('Europe/Lisbon');
    expect(r.w28).toEqual(['B-28']);
    expect(r.w04).toEqual(['B-04']);
    expect(r.starts).toEqual(['2026-04-04', '2026-03-28']);
    // What the Overview shows for the week of 28 Mar.
    const info = await page.evaluate(() => {
      showPage('overview');
      document.getElementById('ovMonthSel').value = '2026-03'; renderOverview();
      document.getElementById('ovWeekSel').value = 'csv:2026-03-28'; renderOverview();
      return document.getElementById('ovWeekInfo').textContent;
    });
    expect(info).toContain('2 booked guests');
    const t = await weeklyTable(page);
    const byWeek = Object.fromEntries(t.body.map(x => [x.Week.split(' → ')[0], [x['Guests (paid / total)'], x['Food / guest-day']]]));
    expect(byWeek['28 Mar 2026']).toEqual(['2', lkr(Math.round(1000 / 14))]);
    expect(byWeek['4 Apr 2026']).toEqual(['3', lkr(Math.round(1000 / 21))]);
  });
});
