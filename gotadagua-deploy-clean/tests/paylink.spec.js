// Camp hub · Quick add → «Paying X? Pay in Drivers» (16 Nov 2026) — stubbed Supabase.
//
// Driver payments have one door: «Pay a driver» (Nadith: the «Drivers» tab). The old
// checklist in Quick add («Which transfers is this for?», «+ Not in the list») is gone.
// When a Quick add expense is Transport and its description names a driver, one line
// says «Paying Dilan? Pay in Drivers → [Pay Dilan]». It only warns: saving still works,
// and nothing is linked from Quick add any more (no camp_transport_link_own call).
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
  trip({ id: T(4), guest_names: 'Future Guest', trip_date: '2026-11-14' }),                       // after the entry date: listed, «(not yet)»
  trip({ id: T(10), guest_names: 'Far Guest', trip_date: '2026-11-28' }),                         // more than 14 days after the entry date
  trip({ id: T(5), guest_names: 'Tonight Guest', trip_date: '2026-11-13', trip_time: '18:00' }),  // not done yet (10:00 now)
  trip({ id: T(6), guest_names: 'Paid Guest', trip_date: '2026-11-07', payment_entry_id: PAID_BY }),
  trip({ id: T(7), guest_names: 'Cancelled Guest', status: 'cancelled' }),
  trip({ id: T(8), guest_names: 'Old Lump Guest', trip_date: '2026-10-28' }),                     // before go-live
  trip({ id: T(9), kind: 'tuktuk', guest_names: null, route: 'Ahangama', purpose: 'surf', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', vehicle: 'Tuk-tuk' }),
];
const ROWS = [
  'Sun 8 Nov 01:55 · Arrival · Lorena Marie Glas · 21,000',
  'Mon 9 Nov 10:00 · Arrival · Beliz Kuyumcuoglu · Nishantha · 26,500',
  'Tue 10 Nov 10:00 · Departure · Maximilian Ehrler · 20,000',
  'Fri 13 Nov 18:00 · Arrival · Tonight Guest (not yet) · 21,000',   // not done yet: Nadith may pay ahead (13 Nov)
  'Sat 14 Nov 10:00 · Arrival · Future Guest (not yet) · 21,000',    // after the entry date, within 14 days
];
const CATALOG = [['Airport → Surfcamp — Car', 21000], ['Surfcamp → Airport — Car', 20000]]
  .map(([name, cost], i) => ({ id: `cat-${i}`, name, cost_per_guest: cost, currency: 'LKR', notes: '', linked_transport_preset_id: `p-${name.split(' — ')[0]}`, linked_camp_tab_id: null, picker_tab: 'airport', sort_order: i }));

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
    if (url.includes('/rest/v1/pricing_catalog')) return json(slug === 'sri-lanka' && url.includes('category=eq.Transport') ? CATALOG : []);
    if (url.includes('/rest/v1/camp_drivers')) { st.calls.push({ t: 'drivers_read' }); return json(DRIVERS); }
    if (url.includes('/rest/v1/rpc/camp_trip_add_own')) {
      st.calls.push({ t: 'add_own', body, ledgerHad: st.ledger.length });
      if (opts.addMissing) return json({ code: 'PGRST202', message: 'Could not find the function public.camp_trip_add_own in the schema cache' }, 404);
      const row = trip({ id: `aaaaaaaa-0000-4000-8000-0000000009${String(st.calls.filter(c => c.t === 'add_own').length).padStart(2, '0')}`, kind: body.p_kind, trip_date: body.p_date, trip_time: null, guest_names: body.p_name,
        expected_price: body.p_price, source: 'manual', charge: 'free', free_reason: body.p_free_reason, added_by_local: true });
      st.trips.push(row); return json(row);
    }
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
async function transportWith(page, desc) {
  await page.click('.exp-quick-btn[data-cat="Transport"]');
  await page.fill('#qe_date', '2026-11-13');
  await page.fill('#qe_desc', desc);
}
const warn = page => page.locator('#qe_paylink_wrap');

test('one door: Transport naming a driver shows «Paying Dilan? Pay in Drivers» — Nadith at 390px; the button opens his Pay sheet in Drivers', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await open(page);
  expect(page.viewportSize().width).toBe(390);
  await transportWith(page, 'fuel for scooter');
  await expect(warn(page)).toHaveCount(0);                                 // no driver named
  await page.fill('#qe_desc', 'Dilan 3 arrivals');
  await expect(warn(page)).toContainText('Paying Dilan? Pay in Drivers');
  await expect(page.locator('#qe_paylink_wrap .pl-onedoor, #qe_paylink_wrap')).toBeVisible();
  await expect(page.locator('#qe_paylink_wrap .pl-row, #qe_paylink_wrap input[type=checkbox]')).toHaveCount(0);   // the old checklist is gone
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.fill('#qe_desc', 'Dilan and Nishantha');
  await expect(warn(page)).toHaveCount(0);                                 // two drivers: no guess
  await page.fill('#qe_desc', 'Nadith petrol');
  await expect(warn(page)).toHaveCount(0);                                 // a contact is not a driver
  await page.fill('#qe_desc', 'dylan tuk tuk sampath');
  await expect(warn(page)).toContainText('Paying Sampath?');
  await page.click('#pl_pay');
  expect(await page.evaluate(() => activePage)).toBe('transport');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Pay Sampath');
  expect(errors).toEqual([]);
});

test('one door: it only warns — saving anyway still saves the expense, and nothing is linked from Quick add', async ({ page }) => {
  const st = await open(page);
  await transportWith(page, 'Dilan 41000');
  await page.selectOption('#qe_linked', 'Airport');
  await page.fill('#qe_amount', '41000');
  await expect(warn(page)).toContainText('Paying Dilan?');
  await page.click('[onclick="saveQuickExpense()"]');
  await expect.poll(() => st.posted.length).toBeGreaterThan(0);
  expect(st.posted[st.posted.length - 1]).toMatchObject({ type: 'expense', category: 'Transport', amount_local: 41000, description: 'Dilan 41000' });
  await expect(page.locator('#toast')).toHaveText('Entry added');
  expect(st.calls.filter(c => c.t === 'link_own' || c.t === 'add_own')).toEqual([]);
  await expect(warn(page)).toHaveCount(0);                                 // the form is reset
});

test('one door: another category never warns; the full view warns too', async ({ page }) => {
  const st = await open(page, { query: '' });
  await page.evaluate(() => showPage('expenses'));
  await page.click('.exp-quick-btn[data-cat="Transport"]');
  await page.fill('#qe_desc', 'Nishantha airport');
  await expect(warn(page)).toContainText('Paying Nishantha? Pay in Drivers');
  await page.evaluate(() => { document.getElementById('qe_cat').value = 'Food'; document.getElementById('qe_cat').dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(warn(page)).toHaveCount(0);
});
