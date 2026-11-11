// ════════════════════════════════════════════════════════════════════════════
//  OVERVIEW — the cost cards, Food control, Merch and the stock table
//
//  12 Nov 2026 audit (Sri Lanka 2026), checked against the real ledger:
//   • «Camp-paid / HQ-paid» on Transport, Utilities, Payroll and Laundry was
//     Cash vs 'Bank Transfer' — every Sampath payment showed as HQ-paid and
//     the real HQ payments ('HQ Paid' / HQ invoices) in neither;
//   • Transport and Utilities rows with no line / type picked fell out of
//     their card (Transport showed LKR 390,400 of 5,263,790 and «No transport
//     spend yet» for Feb and Oct 2026);
//   • Food control in a month counted the guest-nights of the weeks STARTING
//     in that month (Oct 2026: 229 g-d) against the calendar month's food
//     spend (calendar: 167 g-d);
//   • Merch «Direct cost» was always 0 (it read the hub's empty weekly guests
//     and the static menu seed, never the Camp Tab sales / catalog cost);
//   • «T-Shirt 2XL» (19 in stock) had no row in the stock table;
//   • the week line always ended «· 0 paid» in per-guest camps;
//   • weeks with ledger rows but no booking were missing from the Week picker.
//
//  Hermetic like the smoke suite: Supabase is stubbed, nothing is written.
// ════════════════════════════════════════════════════════════════════════════

const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const LOC = '83cda02b-0000-4000-8000-00000000f00d';
let n = 0;
const row = (o) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  location_id: LOC, week_id: null, qty: 1, currency: 'LKR', fx_rate: 400,
  payment_method: 'Cash', source_kind: 'manual', is_comp: false, zone_id: null,
  linked_item: null, paid_from: 'sri-lanka', attributed_location: 'sri-lanka',
  created_at: '2026-10-01T10:00:00Z', ...o,
  amount_eur: o.amount_eur ?? Number((o.amount_local / 400).toFixed(2)),
});
const ROWS = [
  // Payroll — one person paid by the camp bank, by camp cash and by HQ
  row({ type: 'expense', category: 'Salary', business_area: 'Salaries', amount_local: 100000, entry_date: '2026-10-02', description: 'Salary Ana', payment_method: 'Bank Transfer' }),
  row({ type: 'expense', category: 'Salary', business_area: 'Salaries', amount_local: 20000, entry_date: '2026-10-03', description: 'Salary Ana', payment_method: 'Cash' }),
  row({ type: 'expense', category: 'Salary', business_area: 'Salaries', amount_local: 400000, amount_eur: 1000, entry_date: '2026-10-04', description: 'Salary Ana', payment_method: 'HQ Paid' }),
  // Laundry paid from the camp bank
  row({ type: 'expense', category: 'Laundry', business_area: 'Laundry', amount_local: 9000, entry_date: '2026-10-05', description: 'Laundry Sept', payment_method: 'Bank Transfer' }),
  // Transport — one linked line, one with no line
  row({ type: 'expense', category: 'Transport', business_area: 'Transport', linked_item: 'Airport', amount_local: 2000, entry_date: '2026-10-06', description: 'Airport pick-up' }),
  row({ type: 'expense', category: 'Transport', business_area: 'Transport', amount_local: 5000, entry_date: '2026-10-07', description: 'Scooter fuel' }),
  // Utilities with no type picked
  row({ type: 'expense', category: 'Utilities', business_area: 'Utilities', amount_local: 3000, entry_date: '2026-10-08', description: 'Gas bottle' }),
  // Food in October
  row({ type: 'expense', category: 'Food', business_area: 'Food', amount_local: 7000, entry_date: '2026-10-09', description: 'Market' }),
  // A T-shirt sold on the Camp Tab
  row({ type: 'revenue', category: 'Merchandise', business_area: 'Merch', amount_local: 8000, entry_date: '2026-10-10', description: 'Camp Tab · Kiki · T-Shirt L', source_kind: 'camp_tab_per_item' }),
];
// Bookings: A = 27 Sep → 4 Oct, 2 pax (3 October nights); B = 31 Oct → 7 Nov, 1 pax (1 October night)
const BOOKINGS = [
  { booking_ref: 'T-1', booker: 'A', check_in_on: '2026-09-27', pax: 2, package: '', nights: '7' },
  { booking_ref: 'T-2', booker: 'B', check_in_on: '2026-10-31', pax: 1, package: '', nights: '7' },
];
const CATALOG_MERCH = [
  { id: 'm1', name: 'T-Shirt L', sell_price: 8000, cost_per_guest: 2500, notes: '', sort_order: 1, stock_qty: 40, alt_price: null, alt_label: null },
  { id: 'm2', name: 'T-Shirt 2XL', sell_price: 8000, cost_per_guest: 2500, notes: '', sort_order: 2, stock_qty: 19, alt_price: null, alt_label: null },
];

async function boot(page) {
  const writes = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      if (url.includes('/rest/v1/ledger_entries')) writes.push(req.method() + ' ' + url);
      return json([]);
    }
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka' });
    if (url.includes('/rest/v1/ledger_entries')) return json(ROWS);
    if (url.includes('/rest/v1/bookings')) return json(BOOKINGS);
    if (url.includes('/rest/v1/pricing_catalog') && url.includes('category=eq.Merch')) return json(CATALOG_MERCH);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof HUB_LEDGER_HYDRATED !== 'undefined' && HUB_LEDGER_HYDRATED === true
    && typeof ovBookings !== 'undefined' && ovBookings.length === 2
    && (currentCampTabMenu()?.Merch || []).some(m => m.n === 'T-Shirt 2XL'), null, { timeout: 15000 });
  return { writes, errs };
}

const norm = s => String(s || '').replace(/[  ]/g, ' ');

test('overview cost cards: camp vs HQ split, unlinked transport / utilities, food per guest-day, merch', async ({ page }) => {
  const { writes, errs } = await boot(page);
  const out = await page.evaluate(() => {
    const ms = document.getElementById('ovMonthSel'); ms.value = '2026-10';
    document.getElementById('ovWeekSel').value = 'all';
    renderOverview();
    const card = (title) => [...document.querySelectorAll('#ovCatCard .card')].find(c => c.querySelector('.ov-cat-title')?.textContent.trim() === title)?.innerText || '';
    // textContent: the per-staff chips sit in a closed <details>
    const chip = (title, label) => {
      const c = [...document.querySelectorAll('#ovCatCard .card')].find(x => x.querySelector('.ov-cat-title')?.textContent.trim() === title);
      const ch = c && [...c.querySelectorAll('.ov-chip')].find(x => x.firstElementChild?.textContent.trim().toLowerCase() === label.toLowerCase());
      return ch ? ch.textContent.replace(/\s+/g, ' ') : '';
    };
    const food = [...document.querySelectorAll('#ovCatPanels .ov-area-card')].find(c => c.innerText.includes('Food control'))?.innerText || '';
    const merch = [...document.querySelectorAll('#ovCatPanels .ov-area-card')].find(c => /\bMerch\b/.test(c.querySelector('.ov-area-title')?.textContent || ''))?.innerText || '';
    return {
      info: document.getElementById('ovWeekInfo').textContent,
      weekOptions: [...document.getElementById('ovWeekSel').options].map(x => x.value).join(','),
      payrollAna: chip('Payroll', 'Salary Ana'),
      laundryCamp: chip('Laundry', 'Paid by camp'), laundryHq: chip('Laundry', 'Paid by HQ'),
      transport: card('Transport'), transportUnlinked: chip('Transport', 'Not linked to a line'),
      utilities: card('Utilities control'), utilitiesUnsplit: chip('Utilities control', 'Not split by type'),
      food, merch, stock: card('T-Shirt stock'),
    };
  });
  const o = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, norm(v)]));
  // Payroll: bank + cash = camp-paid (120,000), the HQ Paid row = HQ-paid (400,000)
  expect(o.payrollAna).toContain('Camp: LKR 120,000');
  expect(o.payrollAna).toContain('Paid by HQ: LKR 400,000');
  // Laundry paid by the camp bank is camp money, not HQ
  expect(o.laundryCamp).toContain('LKR 9,000');
  expect(o.laundryHq).not.toContain('LKR 9,000');
  // Transport: the unlinked row has its own line and the header adds up to every Transport row
  expect(o.transport).toContain('LKR 7,000');
  expect(o.transportUnlinked).toContain('LKR 5,000');
  expect(o.transport).not.toContain('No transport spend yet');
  // Utilities with no type picked are shown, not «No utility entries yet»
  expect(o.utilitiesUnsplit).toContain('LKR 3,000');
  expect(o.utilities).not.toContain('No utility entries yet');
  // Food control, October: 3×2 + 1 = 7 guest-nights inside October → 7,000 / 7 = 1,000
  expect(o.food).toContain('7 g-d');
  expect(o.food).toContain('LKR 1,000');
  expect(o.food).toContain('2 bookings');
  // Merch: one T-Shirt L sold at 8,000, catalog cost 2,500 → direct cost 2,500, margin 69%
  expect(o.merch).toContain('LKR 8,000');
  expect(o.merch).toContain('LKR 2,500');
  expect(o.merch).toContain('69%');
  // Stock table lists the 2XL size
  expect(o.stock).toContain('Size 2XL');
  // No meaningless «· 0 paid» in a per-guest camp
  expect(o.info).not.toContain('paid');
  // The week of 10 Oct has ledger rows but no booking — it must still be pickable
  expect(o.weekOptions).toContain('csv:2026-10-10');
  expect(o.weekOptions).toContain('csv:2026-10-03');
  expect(writes).toEqual([]);
  expect(errs).toEqual([]);
});
