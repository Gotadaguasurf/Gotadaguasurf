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

async function openHub(page, rows, bookings = BOOKINGS, now = null, opts = {}) {
  if (now) await page.clock.setFixedTime(new Date(now));
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json([]);
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: FX, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) return json(rows);
    if (url.includes('/rest/v1/bookings')) return json(bookings);
    if (url.includes('/rest/v1/camp_week_guests')) return json(opts.weekGuests || []);
    // A CSV someone saved for this camp long ago (dates and guests, no amounts).
    if (opts.savedCsv && url.includes('/rest/v1/location_state_store') && url.includes('camphub_ov_bookings_v3')) {
      await new Promise(r => setTimeout(r, opts.csvDelayMs || 0));
      return json({ state_json: opts.savedCsv });
    }
    return json([]);
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka' + (opts.query || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true && ovBookings.length > 0; } catch (_) { return false; } }, null, { timeout: 15000 });
}

async function weeklyTable(page) {
  return page.evaluate(() => {
    showPage('weekly'); wplSetView('cash'); // the cash-control table (the page opens on Profit & loss)
    const tbl = document.querySelector('#wplCashTable');
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

test('weekly P&L: clicking a week opens it at the top of the page; its link opens the Overview on that week', async ({ page }) => {
  await openHub(page, [...fixture(), row('expense', 'Cash', 1000, { date: '2026-10-26' })]);
  await weeklyTable(page);
  await expect(page.locator('#wplWeek .card-title')).toContainText('24 Oct 2026'); // opens on the latest week with data
  await page.locator('#wplCashTable tbody tr', { hasText: '17 Oct 2026' }).click();
  await expect(page.locator('#wplWeek .card-title')).toContainText('17 Oct 2026 → 23 Oct 2026');
  await expect(page.locator('#wplCashTable tbody tr.wpl-sel')).toContainText('17 Oct 2026');
  await page.locator('#wplWeek').getByRole('button', { name: 'Open this week in the Overview' }).click();
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

// ── Profit & loss (13 Nov 2026) ─────────────────────────────────────────────
// Revenue = Bookinglayer bookings (net of commission, spread per night, only
// Paid / Confirmed / Deposit paid — the HQ rule) + on-site sales. Costs = every
// expense of the week, paid by the camp or by HQ. Result = revenue − costs.
const NOW = '2026-10-28T12:00:00'; // a Wednesday: the current week is 24–30 Oct
const MONEY_BOOKINGS = [
  { booking_ref: 'B-1', booker: 'Ann', check_in_on: WS, pax: 2, package: 'Surf', nights: '7', total: 1000, net_amount: 900, status: 'Paid' },
  { booking_ref: 'B-2', booker: 'Bob', check_in_on: '2026-10-10', pax: 1, package: 'Surf', nights: '14', total: 700, net_amount: 700, status: 'Confirmed' }, // half in each week
  { booking_ref: 'B-3', booker: 'Cy', check_in_on: '2026-10-03', pax: 1, package: 'Surf', nights: '7', total: 500, net_amount: 500, status: 'Cancelled' },   // never revenue
];
const whole = n => { const v = Math.round(n); return (v < 0 ? '−' : '') + '€' + Math.abs(v).toLocaleString('en-US'); };
async function plTable(page) {
  return page.evaluate(() => {
    showPage('weekly'); wplSetView('pl');
    const tbl = document.querySelector('#wplPLTable');
    const head = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const obj = tr => Object.fromEntries([...tr.children].map((td, i) => [head[i], td.textContent.trim()]));
    return { head, body: [...tbl.querySelectorAll('tbody tr')].map(obj), foot: obj(tbl.querySelector('tfoot tr')), note: (document.querySelector('.wpl-tbl-note') || {}).textContent || '' };
  });
}
const FIX_EUR = { onsite: 4000 / FX, camp: 12000 / FX + 100000 / FX, hq: 40000 / FX };

test('weekly P&L: revenue = bookings per night + on-site; costs = camp + paid by HQ; result', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const asked = [];
  page.on('request', r => { if (/rest\/v1\/bookings/.test(r.url())) asked.push(decodeURIComponent(r.url())); });
  await openHub(page, fixture(), MONEY_BOOKINGS, NOW);
  expect(asked.some(u => /net_amount/.test(u) && /status/.test(u))).toBe(true); // full view asks for the amounts
  const t = await plTable(page);
  const by = Object.fromEntries(t.body.map(r => [r.Week.replace('in progress', ''), r]));
  const w = by['17–23 Oct 2026'];
  const book = 900 + 700 / 2, cost = FIX_EUR.camp + FIX_EUR.hq, rev = book + FIX_EUR.onsite;
  expect(w.Bookings).toBe(whole(book));
  expect(w['On-site sales']).toBe(whole(FIX_EUR.onsite));
  expect(w.Revenue).toBe(whole(rev));
  expect(w['Camp costs']).toBe(whole(FIX_EUR.camp));
  expect(w['Paid by HQ']).toBe(whole(FIX_EUR.hq));
  expect(w.Costs).toBe(whole(cost));
  expect(w.Result).toBe(whole(rev - cost));
  expect(w['Guest-nights']).toBe('21'); // 2 × 7 + 1 × 7
  expect(w['Cost / guest-night']).toBe(whole(cost / 21));
  // The other half of the 14-night booking; the cancelled booking earns nothing.
  expect(by['10–16 Oct 2026'].Bookings).toBe(whole(350));
  expect(by['3–9 Oct 2026'].Bookings).toBe(whole(0));
  // Every booking euro lands in exactly one week: total = 900 + 700.
  expect(t.foot.Bookings).toBe(whole(1600));
  expect(t.foot.Result).toBe(whole(1600 + FIX_EUR.onsite - cost));
  // The week card opens on the latest week with data and shows the same numbers.
  const card = page.locator('#wplWeek');
  await expect(card.locator('.card-title')).toContainText('17 Oct 2026 → 23 Oct 2026');
  const kpis = await card.locator('.wpl-kpi').evaluateAll(els => Object.fromEntries(els.map(e => [e.querySelector('.kpi-label').textContent.trim(), e.querySelector('.kpi-value').textContent.trim()])));
  expect(kpis).toEqual({ Revenue: whole(rev), Costs: whole(cost), Result: whole(rev - cost), Guests: '3' });
  await expect(card.locator('.wpl-kpi').first()).toContainText(`Bookings ${whole(book)} · on-site ${whole(FIX_EUR.onsite)}`);
  // Cost lines: Rent, Salary, Food — biggest first, bars to one scale.
  const bars = await card.locator('.wpl-bar-row').evaluateAll(els => els.map(e => ({ k: e.querySelector('.wpl-bar-k').textContent.trim(), v: e.querySelector('.wpl-bar-v').textContent.trim(), w: parseFloat(e.querySelector('.wpl-bar-fill').style.width) })));
  expect(bars.map(b => b.k)).toEqual(['Rent', 'Salary', 'Food']);
  expect(bars[0].w).toBeCloseTo(100, 1);
  expect(bars[1].w).toBeCloseTo(100 * 40000 / 100000, 1);
  expect(bars[2].w).toBeCloseTo(100 * 12000 / 100000, 1);
  expect(errors).toEqual([]);
});

test('weekly P&L: without booking amounts the page says so and shows on-site revenue only', async ({ page }) => {
  await openHub(page, fixture(), BOOKINGS, NOW);
  const t = await plTable(page);
  expect(t.body[0].Bookings).toBe('€0');
  expect(t.body[0].Revenue).toBe(whole(FIX_EUR.onsite));
  await expect(page.locator('#wplWeek .wpl-kpi').first()).toContainText('booking amounts not loaded');
});

test('weekly P&L: rows dated after this week are folded into one line and stay out of «to date»', async ({ page }) => {
  const rows = [...fixture(), row('expense', 'Bank Transfer', 1200000, { category: 'Rent', area: 'General', date: '2027-09-01' }), row('expense', 'Bank Transfer', 30000, { category: 'Taxes', area: 'General', date: '2026-12-01' })];
  await openHub(page, rows, MONEY_BOOKINGS, NOW);
  const pl = await plTable(page);
  expect(pl.body.some(r => /2027|Dec 2026/.test(r.Week))).toBe(false);
  expect(pl.foot.Costs).toBe(whole(FIX_EUR.camp + FIX_EUR.hq));
  expect(pl.note).toContain(`${whole(1200000 / FX + 30000 / FX)} of costs dated after this week (2 weeks`);
  const t = await weeklyTable(page);
  expect(t.body[0].Week).toContain('Dated after this week');
  expect(t.body[0]['Paid by bank']).toBe(eur(Number((1200000 / FX).toFixed(2)) + Number((30000 / FX).toFixed(2))));
  expect(t.body.filter(r => /2027/.test(r.Week)).length).toBe(0);
  // The total still holds every row, as before.
  expect(t.foot['Paid by bank']).toBe(eur(Number((1200000 / FX).toFixed(2)) + Number((30000 / FX).toFixed(2)) + Number((100000 / FX).toFixed(2))));
  await page.locator('#wplFutureRow').click();
  const open = await weeklyTable(page);
  expect(open.body.filter(r => /2027|Dec 2026/.test(r.Week)).length).toBe(2);
});

test('weekly P&L: the columns of the cash table add up — «Other sales» and «Other moves»', async ({ page }) => {
  const rows = [...fixture(), row('revenue', 'Cash', 3000, { area: 'General', category: 'Other Revenue', description: 'Camp Tab · Ann · Extra Dinner' })];
  await openHub(page, rows, MONEY_BOOKINGS, NOW);
  const t = await weeklyTable(page);
  const r = t.body.find(x => /17 Oct 2026/.test(x.Week));
  const e = a => Number((a / FX).toFixed(2));
  expect(r['Other sales']).toBe(eur(e(3000)));
  expect(r['Other moves']).toBe(eur(-e(30000) + e(80000) - e(6000))); // loan out of the bank, cash found, old debt paid
  const num = s => Number(s.replace(/[€,]/g, ''));
  const sales = ['Drinks sales', 'Merch sales', 'Tour sales', 'Transport sales', 'Other sales'].reduce((s, k) => s + num(r[k]), 0);
  const net = num(r['Money from HQ']) + sales - num(r['Spent in cash']) - num(r['Spent by card']) - num(r['Paid by bank']) + num(r['Other moves']);
  expect(Math.abs(net - num(r['Net this week']))).toBeLessThan(0.011);
});

test('weekly P&L: the 12-week chart is drawn to scale and the page fits a phone', async ({ page }) => {
  await openHub(page, fixture(), MONEY_BOOKINGS, NOW);
  await plTable(page);
  const c = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.wpl-chart .wpl-col')];
    const col = cols.find(x => /17 Oct 2026/.test(x.title));
    const h = sel => { const el = col.querySelector(sel); return el ? el.getBoundingClientRect().height : 0; };
    const r = wplModel().rows.find(x => x.ws === '2026-10-17');
    return { n: cols.length, last: cols[cols.length - 1].title, book: h('.wpl-b.book'), onsite: h('.wpl-b.onsite'), camp: h('.wpl-b.camp'), hq: h('.wpl-b.hq'), r: { book: r.bookRev, onsite: r.onsite, camp: r.costCamp, hq: r.costHq },
      axisTop: document.querySelector('.wpl-axis span').textContent, plotH: document.querySelector('.wpl-pair').getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, colW: col.getBoundingClientRect().width };
  });
  expect(c.n).toBe(12);
  expect(c.last).toContain('24 Oct 2026'); // ends on the current week
  expect(c.axisTop).toBe('€2,000');        // 1,262 of revenue → a round top of 2,000
  const px = v => v / 2000 * c.plotH;      // zero-based, one scale for revenue and costs
  expect(Math.abs(c.book - px(c.r.book))).toBeLessThan(1);
  expect(Math.abs(c.onsite - px(c.r.onsite))).toBeLessThan(1);
  expect(Math.abs(c.camp - px(c.r.camp))).toBeLessThan(1);
  expect(Math.abs(c.hq - px(c.r.hq))).toBeLessThan(1);
  expect(c.overflow).toBeLessThanOrEqual(0); // 390px: no sideways scroll of the page
  expect(c.colW).toBeGreaterThan(20);
  // Tapping a week of the chart opens it.
  await page.locator('.wpl-chart .wpl-col[title*="10 Oct 2026"]').click();
  await expect(page.locator('#wplWeek .card-title')).toContainText('10 Oct 2026 → 16 Oct 2026');
  // On a phone the result comes right after the week.
  expect((await plTable(page)).head.slice(0, 4)).toEqual(['Week', 'Result', 'Revenue', 'Costs']);
});

test.describe('laptop width', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('weekly P&L at 1280: four figures in a row, full column order, no sideways scroll', async ({ page }) => {
    await openHub(page, fixture(), MONEY_BOOKINGS, NOW);
    const t = await plTable(page);
    expect(t.head).toEqual(['Week', 'Guests', 'Guest-nights', 'Bookings', 'On-site sales', 'Revenue', 'Camp costs', 'Paid by HQ', 'Costs', 'Result', 'Cost / guest-night']);
    const g = await page.evaluate(() => {
      const k = [...document.querySelectorAll('#wplWeek .wpl-kpi')].map(e => Math.round(e.getBoundingClientRect().top));
      const tbl = document.querySelector('#wplPLTable'), wrap = tbl.closest('.tbl-wrap');
      return { sameRow: new Set(k).size === 1, n: k.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, tblOverflow: wrap.scrollWidth - wrap.clientWidth };
    });
    expect(g).toEqual({ sameRow: true, n: 4, overflow: 0, tblOverflow: 0 });
  });
});

test('weekly P&L: a saved CSV never replaces the bookings table (the amounts stay), whichever arrives first', async ({ page }) => {
  const ci = new Date(WS + 'T00:00:00').getTime();
  const savedCsv = [{ ref: 'OLD', name: 'Old CSV', status: 'confirmed', ci, co: ci + 7 * 86400000, pax: 9, accommodation: '' }];
  for (const csvDelayMs of [0, 1200]) {
    await openHub(page, fixture(), MONEY_BOOKINGS, NOW, { savedCsv, csvDelayMs });
    await page.waitForFunction(() => { try { return __ovBookingsFromDb === true; } catch (_) { return false; } });
    await page.waitForTimeout(csvDelayMs + 600);
    const r = await page.evaluate(() => ({ refs: ovBookings.map(b => b.ref).sort(), money: wplHasBookingMoney() }));
    expect(r).toEqual({ refs: ['B-1', 'B-2', 'B-3'], money: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
  // A backup of the hub carries dates and guests, never the amounts.
  const keys = await page.evaluate(() => {
    let out = ''; const orig = downloadTextFile; downloadTextFile = (_name, content) => { out = content; };
    try { exportBackup(); } finally { downloadTextFile = orig; }
    return Object.keys(JSON.parse(out).overviewBookings[0]);
  });
  expect(keys).toContain('pax');
  expect(keys).not.toContain('net');
  expect(keys).not.toContain('realized');
});

test('weekly P&L: a Camp-Tab-only device never asks for the booking amounts', async ({ page }) => {
  const asked = [];
  page.on('request', r => { if (/rest\/v1\/bookings/.test(r.url())) asked.push(decodeURIComponent(r.url())); });
  await openHub(page, fixture(), MONEY_BOOKINGS, NOW, { query: '&view=camp-tab-only' });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.some(u => /net_amount|total|status/.test(u))).toBe(false);
});

test('weekly P&L: the first week of the data has nothing to compare with and says so', async ({ page }) => {
  await openHub(page, fixture(), BOOKINGS, NOW);
  await plTable(page);
  const card = page.locator('#wplWeek');
  await expect(card.locator('.card-hint')).toContainText('nothing to compare with yet');
  await expect(card).not.toContainText('average');
  // One week later the comparison is with the one week that exists.
  await page.evaluate(() => wplSelect('2026-10-24'));
  await expect(card.locator('.card-hint')).toContainText('Compared with the average of the 1 week before');
  await expect(card.locator('.wpl-kpi').nth(1)).toContainText('1-week average');
});

// ── Bookings freshness and the camp's own Guests file (13 Nov 2026) ─────────
// HQ bookings are a manual import: a week that ends after the import was made
// can miss stays, so its revenue / result are marked incomplete, never read as a loss.
test('weekly P&L: a week that ends after the last bookings import is marked incomplete', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const bookings = MONEY_BOOKINGS.map(b => ({ ...b, created_at: '2026-10-20T10:00:00Z' })); // imported on 20 Oct
  await openHub(page, fixture(), bookings, NOW);
  const t = await plTable(page);
  const by = Object.fromEntries(t.body.map(r => [r.Week.replace('in progress', ''), r]));
  expect(by['17–23 Oct 2026'].Result).toContain('incomplete');   // ends 23 Oct, after the import
  expect(by['10–16 Oct 2026'].Result).not.toContain('incomplete'); // ended before it
  expect(t.note).toContain('Bookings imported up to 20 Oct 2026');
  const card = page.locator('#wplWeek');
  await expect(card.locator('.card-title')).toContainText('17 Oct 2026');
  await expect(card.locator('#wplIncomplete')).toContainText('Bookings not imported for this week yet — revenue and guests are incomplete. Import bookings in HQ. Bookings imported up to 20 Oct 2026.');
  await expect(card.locator('.badge', { hasText: 'Bookings incomplete' })).toHaveCount(1);
  const cls = await card.locator('.wpl-kpi .kpi-value').evaluateAll(els => els.map(e => e.className));
  expect(cls[0]).toContain('wpl-dim'); expect(cls[2]).toContain('wpl-dim');     // revenue and result greyed
  expect(cls[2]).not.toMatch(/\b(pos|neg)\b/);                                   // never a red «loss»
  await expect(card.locator('.wpl-kpi').nth(2)).toContainText('Incomplete — bookings missing');
  await expect(page.locator('.wpl-chart .wpl-col.inc')).toHaveCount(2);          // 17 Oct and the current week
  // A complete week has no note and its result keeps its colour.
  await page.evaluate(() => wplSelect('2026-10-10'));
  await expect(card.locator('#wplIncomplete')).toHaveCount(0);
  expect(await card.locator('.wpl-kpi .kpi-value').nth(2).getAttribute('class')).toMatch(/\b(pos|neg)\b/);
  expect(errors).toEqual([]);
});

test('weekly P&L: guests and guest-nights come from the camp\u2019s Guests file when it has the week', async ({ page }) => {
  const g = (name, ci, co, status = 'paid', ref = 'G-' + name) => ({ booking_ref: ref, guest_key: name.toLowerCase(), guest_name: name, check_in: ci, check_out: co, booking_status: status });
  const weekGuests = [
    g('Ann', WS, '2026-10-24'), g('Ben', WS, '2026-10-24'), g('Cleo', WS, '2026-10-24'), g('Dan', WS, '2026-10-24'),
    g('Eve', '2026-10-20', '2026-10-31'),           // 4 nights in this week, 7 in the next
    g('Fay', WS, '2026-10-24', 'cancelled'), g('Gus', WS, '2026-10-24', 'not_here'), // not counted
    g('Ann', WS, '2026-10-24'),                     // the same guest twice in the table counts once
  ];
  const bookings = MONEY_BOOKINGS.map(b => ({ ...b, created_at: '2026-10-20T10:00:00Z' }));
  await openHub(page, fixture(), bookings, NOW, { weekGuests });
  await page.waitForFunction(() => { try { return WPL_CG.state === 'done'; } catch (_) { return false; } });
  const t = await plTable(page);
  const by = Object.fromEntries(t.body.map(r => [r.Week.replace('in progress', ''), r]));
  // 17–23 Oct: the file has 5 guests / 32 nights, the HQ bookings 3 guests / 21 nights → the file.
  expect(by['17–23 Oct 2026'].Guests).toBe('5');
  expect(by['17–23 Oct 2026']['Guest-nights']).toBe(String(4 * 7 + 4));
  // 24–30 Oct: only the file knows this week (Eve, 7 nights).
  expect(by['24–30 Oct 2026'].Guests).toBe('1');
  expect(by['24–30 Oct 2026']['Guest-nights']).toBe('7');
  // 10–16 Oct: the file has nothing → HQ bookings (1 guest, 7 nights).
  expect(by['10–16 Oct 2026'].Guests).toBe('1');
  expect(by['10–16 Oct 2026']['Guest-nights']).toBe('7');
  // Revenue is still the bookings\u2019.
  expect(by['17–23 Oct 2026'].Bookings).toBe(whole(900 + 350));
  await page.evaluate(() => wplSelect('2026-10-17'));
  const card = page.locator('#wplWeek');
  await expect(card.locator('.wpl-kpi').nth(3)).toContainText('32 guest-nights · from the camp\u2019s Guests file');
  await expect(card.locator('#wplIncomplete')).toContainText('The bookings cover 3 of the 5 guests in the camp\u2019s Guests file.');
  // Cash control: same guests, and food per guest-day on the file\u2019s nights.
  const c = await weeklyTable(page);
  const r = c.body.find(x => /17 Oct 2026/.test(x.Week));
  expect(r['Guests (paid / total)']).toBe('5');
  expect(r['Food / guest-day']).toBe(lkr(Math.round(12000 / 32)));
});

test('weekly P&L: a Camp-Tab-only device never reads the Guests file for the P&L', async ({ page }) => {
  const asked = [];
  page.on('request', r => { if (/rest\/v1\/camp_week_guests/.test(r.url())) asked.push(r.url()); });
  await openHub(page, fixture(), MONEY_BOOKINGS, NOW, { query: '&view=camp-tab-only' });
  await page.evaluate(() => { try { renderWeeklyPL(); } catch (_) {} });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => WPL_CG.state)).toBe('idle');
  expect(asked).toEqual([]);
});
