// Camp hub · Quick add «Which transfers is this for?» (Sri Lanka, 13 Nov 2026) — stubbed Supabase.
//
// Nadith (?view=local) pays the airport drivers with a Cash Transport · Airport
// expense. The form lists the done, unpaid airport transfers up to the entry
// date; ticking fills the amount; after the save the hub calls
// camp_transport_link_own (supabase/camp-trips-own-link.sql, checked in PGlite
// separately). A failed link never undoes the save.
// «Now» is pinned to Fri 13 Nov 2026 10:00 Colombo (window.TRANSPORT_NOW); go-live moved to 1 Nov.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const NOW = '2026-11-13T10:00';
const D = { dilan: 'dddddddd-0000-4000-8000-000000000001', sampath: 'dddddddd-0000-4000-8000-000000000002', nishantha: 'dddddddd-0000-4000-8000-000000000003', nadith: 'dddddddd-0000-4000-8000-000000000004' };
const DRIVERS = [
  { id: D.dilan, location_id: LOC, name: 'Dilan', label: 'Airport van', phone: null, aliases: ['Dilan'], kinds: ['airport', 'other'], default_for: ['airport'], active: true },
  { id: D.sampath, location_id: LOC, name: 'Sampath', label: 'Tuk-tuk', phone: null, aliases: ['Sampath'], kinds: ['tuktuk'], default_for: ['tuktuk'], active: true },
  { id: D.nishantha, location_id: LOC, name: 'Nishantha', label: 'Alex Transportation', phone: null, aliases: ['Nishantha'], kinds: ['airport'], default_for: [], active: true },
  { id: D.nadith, location_id: LOC, name: 'Nadith', label: 'Camp manager', phone: '+94771234567', aliases: [], kinds: ['contact'], default_for: ['transfers_contact'], active: true },
];
const T = n => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
function trip(o) {
  return { location_id: LOC, kind: 'airport_arrival', trip_date: '2026-11-08', trip_time: '10:00', pickup_time: null, flight: null, place: 'CMB', route: 'Airport → Surfcamp', purpose: 'guests',
    tour_name: null, guest_names: 'Guest', guest_phone: null, booking_ref: null, booking_checkout: null, pax: 1, vehicle: 'Car', driver_id: D.dilan, expected_price: 21000, currency: 'LKR',
    status: 'planned', source: 'bookinglayer', charge: 'bookinglayer', import_key: null, import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null,
    created_at: '2026-11-01T08:00:00Z', ...o };
}
const PAID_BY = 'bbbbbbbb-0000-4000-8000-000000000099';
const TRIPS = () => [
  trip({ id: T(2), guest_names: 'Beliz Kuyumcuoglu', trip_date: '2026-11-09', driver_id: D.nishantha, vehicle: 'Minivan', expected_price: 26500 }),
  trip({ id: T(1), guest_names: 'Lorena Marie Glas', trip_time: '01:55', flight: 'QR658' }),
  trip({ id: T(3), kind: 'airport_departure', guest_names: 'Maximilian Ehrler', trip_date: '2026-11-10', route: 'Surfcamp → Airport', expected_price: 20000 }),
  trip({ id: T(4), guest_names: 'Future Guest', trip_date: '2026-11-14' }),                       // after the entry date
  trip({ id: T(5), guest_names: 'Tonight Guest', trip_date: '2026-11-13', trip_time: '18:00' }),  // not done yet (10:00 now)
  trip({ id: T(6), guest_names: 'Paid Guest', trip_date: '2026-11-07', payment_entry_id: PAID_BY }),
  trip({ id: T(7), guest_names: 'Cancelled Guest', status: 'cancelled' }),
  trip({ id: T(8), guest_names: 'Old Lump Guest', trip_date: '2026-10-28' }),                     // before go-live
  trip({ id: T(9), kind: 'tuktuk', guest_names: null, route: 'Ahangama', purpose: 'surf', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', vehicle: 'Tuk-tuk' }),
];
const ROWS = [
  'Sun 8 Nov · Arrival · Lorena Marie Glas · 21,000',
  'Mon 9 Nov · Arrival · Beliz Kuyumcuoglu · Nishantha · 26,500',
  'Tue 10 Nov · Departure · Maximilian Ehrler · 20,000',
];

async function stub(page, opts = {}) {
  const st = { trips: (opts.trips || TRIPS()).map(t => ({ ...t })), links: (opts.links || []).map(l => ({ ...l })), ledger: (opts.ledger || []).map(r => ({ ...r })), calls: [], posted: [] };
  const slug = opts.slug || 'sri-lanka';
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json(slug === 'sri-lanka'
      ? { id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' }
      : { id: 'loc-ma', name: 'Morocco', slug: 'morocco', currency: 'MAD', default_fx_to_eur: 10.8, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json(st.ledger);
      if (method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(r => { st.posted.push(r); const i = st.ledger.findIndex(x => x.id === r.id); if (i >= 0) st.ledger[i] = { ...st.ledger[i], ...r }; else st.ledger.push({ created_at: new Date().toISOString(), ...r }); }); return json([]); }
      return json([]);
    }
    if (url.includes('/rest/v1/camp_drivers')) { st.calls.push({ t: 'drivers_read' }); return json(DRIVERS); }
    if (url.includes('/rest/v1/camp_trips')) { if (method === 'GET') { st.calls.push({ t: 'trips_read', url }); return json(st.trips); } return json([]); }
    if (url.includes('/rest/v1/camp_transport_payments')) return json(st.links);
    if (url.includes('/rest/v1/rpc/camp_transport_autolink')) return json({});
    if (url.includes('/rest/v1/rpc/camp_transport_link_own')) {
      st.calls.push({ t: 'link_own', body, ledgerHad: st.ledger.some(r => r.id === body.p_entry) });
      if (opts.ownFail) return json({ code: 'P0001', message: 'Some transfers were already paid — refresh' }, 400);
      const e = st.ledger.find(r => r.id === body.p_entry);
      st.trips.forEach(t => { if (body.p_trip_ids.includes(t.id)) t.payment_entry_id = body.p_entry; });
      const sum = st.trips.filter(t => t.payment_entry_id === body.p_entry).reduce((s, t) => s + t.expected_price, 0);
      return json({ state: sum === Number(e.amount_local) ? 'matched' : 'review', trips: body.p_trip_ids.length, trips_amount: sum, amount: e.amount_local });
    }
    return json([]);
  });
  return st;
}
async function call(st, kind, n = 1) {
  await expect.poll(() => st.calls.filter(c => c.t === kind).length, { timeout: 5000 }).toBeGreaterThanOrEqual(n);
  return st.calls.filter(c => c.t === kind)[n - 1];
}
async function open(page, opts = {}) {
  const st = await stub(page, opts);
  page.on('dialog', d => d.accept());
  await page.addInitScript(([now]) => { window.TRANSPORT_NOW = now; window.TRIPS_GO_LIVE_OVERRIDE = '2026-11-01'; }, [NOW]);
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${opts.slug || 'sri-lanka'}${opts.query === undefined ? '&view=local' : opts.query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.CampPayLink);
  return st;
}
// Quick add like Nadith: the Transport shortcut, then the item, then the date.
async function transportAirport(page, date = '2026-11-13') {
  await page.click('.exp-quick-btn[data-cat="Transport"]');
  await page.fill('#qe_date', date);
  await page.selectOption('#qe_linked', 'Airport');
}
const picker = page => page.locator('#qe_paylink_wrap');

test('paylink: the picker shows only for Sri Lanka · Transport · Airport — local view at 390px', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  const st = await open(page);
  expect(page.viewportSize().width).toBe(390);
  await expect(picker(page)).toBeHidden();
  expect(st.calls.filter(c => c.t === 'trips_read').length).toBe(0); // nothing read until he needs it
  await page.click('.exp-quick-btn[data-cat="Transport"]');
  await page.fill('#qe_date', '2026-11-13');
  await expect(picker(page)).toBeHidden();                        // Transport, no item yet
  await page.selectOption('#qe_linked', 'Transport Surf Lesson');
  await expect(picker(page)).toBeHidden();                        // another item
  await page.selectOption('#qe_linked', 'Airport');
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).locator('label').first()).toHaveText('Which transfers is this for?');
  // Done + unpaid airport trips, go-live … entry date, oldest first; the driver only when not the default (Dilan).
  await expect(picker(page).locator('.pl-row')).toHaveCount(3);
  expect((await picker(page).locator('.pl-row').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim())).toEqual(ROWS);
  // Big tap targets, no accordion, nothing wider than the phone.
  const box = await picker(page).locator('.pl-row').first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(picker(page).locator('details')).toHaveCount(0);
  // Moving the date back shortens the list.
  await page.fill('#qe_date', '2026-11-09');
  await expect(picker(page).locator('.pl-row')).toHaveCount(2);
  await page.fill('#qe_date', '2026-11-13');
  // Another category hides it.
  await page.selectOption('#qe_cat', 'Food');
  await expect(picker(page)).toBeHidden();
  expect(errors).toEqual([]);
  // Morocco: never.
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await open(p, { slug: 'morocco' });
  await p.click('.exp-quick-btn[data-cat="Transport"]');
  if (await p.locator('#qe_linked option[value="Airport"]').count()) await p.selectOption('#qe_linked', 'Airport');
  await expect(p.locator('#qe_paylink_wrap')).toHaveCount(0);
  await p.close();
});

test('paylink: ticking fills the amount with the sum; he can still change it', async ({ page }) => {
  await open(page);
  await transportAirport(page);
  await expect(picker(page).locator('.pl-row')).toHaveCount(3);
  await picker(page).locator('.pl-row').nth(0).click();
  await expect(page.locator('#qe_amount')).toHaveValue('21000');
  await picker(page).locator('.pl-row').nth(1).click();
  await expect(page.locator('#qe_amount')).toHaveValue('47500');
  await expect(picker(page).locator('.pl-sum')).toHaveText('2 ticked · 47,500');
  await picker(page).locator('.pl-row').nth(0).click();
  await expect(page.locator('#qe_amount')).toHaveValue('26500');
  await picker(page).locator('.pl-row').nth(1).click();
  await expect(page.locator('#qe_amount')).toHaveValue('');           // nothing ticked → back to empty
  await picker(page).locator('.pl-row').nth(2).click();
  await page.fill('#qe_amount', '22000');                             // waiting time: he types his own amount
  await expect(page.locator('#qe_amount')).toHaveValue('22000');
  await expect(picker(page).locator('input:checked')).toHaveCount(1);
});

test('paylink: after the save the RPC gets the saved entry id and the ticked trips', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await open(page);
  await transportAirport(page);
  await picker(page).locator('.pl-row').nth(0).click();
  await picker(page).locator('.pl-row').nth(2).click();
  await page.fill('#qe_desc', 'Dilan airport');
  await page.click('[onclick="saveQuickExpense()"]');
  const c = await call(st, 'link_own');
  expect(st.posted.length).toBe(1);
  const row = st.posted[0];
  expect(row).toMatchObject({ type: 'expense', category: 'Transport', linked_item: 'Airport', payment_method: 'Cash', amount_local: 41000, entry_date: '2026-11-13' });
  expect(c.body.p_entry).toBe(row.id);
  expect(c.ledgerHad).toBe(true);                                       // called after the ledger row landed
  expect(c.body.p_trip_ids.sort()).toEqual([T(1), T(3)].sort());
  await expect(page.locator('#toast')).toHaveText('Entry added · 2 transfers linked');
  await expect(picker(page)).toBeHidden();                              // form reset
  expect(await page.evaluate(id => S.ledger.some(e => e.id === id), row.id)).toBe(true);
  // The next payment no longer offers the two trips just paid.
  await transportAirport(page);
  await expect(picker(page).locator('.pl-row')).toHaveCount(1);
  await expect(picker(page).locator('.pl-row')).toContainText('Beliz Kuyumcuoglu');
  expect(errors).toEqual([]);
});

test('paylink: nothing ticked → the form works as today, no RPC', async ({ page }) => {
  const st = await open(page);
  await transportAirport(page);
  await expect(picker(page).locator('.pl-row')).toHaveCount(3);
  await page.fill('#qe_amount', '21000');
  await page.click('[onclick="saveQuickExpense()"]');
  await expect(page.locator('#toast')).toHaveText('Entry added');
  expect(st.posted.length).toBe(1);
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => c.t === 'link_own').length).toBe(0);
});

test('paylink: if the link fails the expense stays saved and he reads a calm message', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await open(page, { ownFail: true });
  await transportAirport(page);
  await picker(page).locator('.pl-row').nth(1).click();
  await page.click('[onclick="saveQuickExpense()"]');
  await call(st, 'link_own');
  const toast = page.locator('#toast');
  await expect(toast).toHaveText("Saved. Couldn't link the transfers — Francisco will see it in Payments to review.");
  await expect(toast).not.toHaveClass(/err/);
  expect(st.posted.length).toBe(1);
  const id = st.posted[0].id;
  expect(await page.evaluate(id => S.ledger.some(e => e.id === id && e.amountLocal === 26500), id)).toBe(true);
  await expect(page.locator('#qe_amount')).toHaveValue('');           // form reset as after any save
  await expect(page.locator('[onclick="saveQuickExpense()"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('paylink: full view still works — Reconcile says who linked each payment and trip', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const E_N = 'bbbbbbbb-0000-4000-8000-000000000001', E_F = 'bbbbbbbb-0000-4000-8000-000000000002';
  const led = (id, desc, amount) => ({ id, location_id: LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: 'Airport', description: desc, payment_method: 'Cash', qty: 1, amount_local: amount, currency: 'LKR',
    entry_date: '2026-11-12', business_area: 'Transport', fx_rate: 340, amount_eur: amount / 340, recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-11-12T09:00:00Z' });
  const trips = TRIPS().map(t => t.id === T(1) || t.id === T(2) ? { ...t, payment_entry_id: E_N } : t.id === T(3) ? { ...t, payment_entry_id: E_F } : t);
  const st = await open(page, {
    query: '', trips,
    ledger: [led(E_N, 'Airport transfers', 47500), led(E_F, 'Dilan departure', 20000)],
    links: [
      { entry_id: E_N, location_id: LOC, driver_id: null, entry_amount: 47500, trips_amount: 47500, trips_count: 2, state: 'matched', reason: null, linked_by: 'manual', reviewed_by: null },
      { entry_id: E_F, location_id: LOC, driver_id: D.dilan, entry_amount: 20000, trips_amount: 20000, trips_count: 1, state: 'matched', reason: null, linked_by: 'manual', reviewed_by: 'u-francisco' },
    ],
  });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => { showPage('transport'); TransportUI.recMode('week'); TransportUI.setRec('payments'); });
  await page.evaluate(() => { TransportUI._state.recAnchor = '2026-11-12'; TransportUI.render(); });
  await expect(page.locator(`tr[data-pay="${E_N}"]`)).toContainText('linked by Nadith');
  await expect(page.locator(`tr[data-pay="${E_F}"]`)).toContainText('linked by hand');
  await page.evaluate(() => { TransportUI._state.recAnchor = '2026-11-08'; TransportUI.setRec('airport'); });
  await expect(page.locator(`tr[data-trip="${T(1)}"] [data-l="Paid"]`)).toContainText('12 Nov · LKR 47,500');   // shown as paid, with the entry
  await expect(page.locator(`tr[data-trip="${T(1)}"] [data-l="Paid"]`)).toContainText('Airport transfers · linked by Nadith');
  await expect(page.locator(`tr[data-trip="${T(1)}"]`)).toContainText('Matched');
  await expect(page.locator(`tr[data-trip="${T(3)}"] [data-l="Paid"]`)).toContainText('linked by hand');
  // Quick add in the full view still saves as before (no ticks → no RPC).
  await page.evaluate(() => showPage('expenses'));
  await page.click('.exp-quick-btn[data-cat="Food"]');
  await page.fill('#qe_amount', '1500');
  await page.click('[onclick="saveQuickExpense()"]');
  await expect(page.locator('#toast')).toHaveText('Entry added');
  expect(st.calls.filter(c => c.t === 'link_own').length).toBe(0);
  expect(errors).toEqual([]);
});
