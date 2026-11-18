// Camp hub · Transport tab (Sri Lanka, 13 Nov 2026) — stubbed Supabase.
//
// Full view (Francisco / Miguel / HQ). Since 16 Nov 2026 Nadith's ?view=local has the
// same page as «Drivers»: the owed line, the runs and «Pay a driver» (airport rows
// read-only). Reconcile is gone; «Pay a driver» is the one door to pay a driver.
// «Now» is pinned to Fri 13 Nov 2026 10:00 Colombo (window.TRANSPORT_NOW).
const { test, expect } = require('@playwright/test');
// Cancelled / merged transfers of a day sit behind «Show N cancelled» (17 Nov 2026): open every day's.
async function showCancelled(page) {
  for (let i = 0; i < 14; i++) { const b = page.locator('[data-show-off]', { hasText: /^Show/ }); if (!(await b.count())) break; await b.first().click(); }
}
const path = require('path');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const NOW = '2026-11-13T10:00';
const GUESTS_CSV = path.join(__dirname, 'fixtures', 'Bookinglayer-Guests-2026-11-07 14_23.csv');
const D = { dilan: 'dddddddd-0000-4000-8000-000000000001', sampath: 'dddddddd-0000-4000-8000-000000000002', nishantha: 'dddddddd-0000-4000-8000-000000000003', nadith: 'dddddddd-0000-4000-8000-000000000004' };
const DRIVERS = [
  { id: D.dilan, location_id: LOC, name: 'Dilan', label: 'Airport van', phone: null, aliases: ['Dilan'], kinds: ['airport', 'other'], default_for: ['airport'], active: true },
  { id: D.sampath, location_id: LOC, name: 'Sampath', label: 'Tuk-tuk', phone: null, aliases: ['Sampath', 'Sampath tuk tuk'], kinds: ['tuktuk'], default_for: ['tuktuk'], active: true },
  { id: D.nishantha, location_id: LOC, name: 'Nishantha', label: 'Alex Transportation', phone: null, aliases: ['Nishantha'], kinds: ['airport'], default_for: [], active: true },
  { id: D.nadith, location_id: LOC, name: 'Nadith', label: 'Camp manager', phone: '+94771234567', aliases: [], kinds: ['contact'], default_for: ['transfers_contact'], active: true },
];
const CATALOG = [
  ['Ahangama', 500, 'surf'], ['Weligama', 1500, 'surf'], ['South Beach', 500, 'surf'],
  // airport rows carry the capacity column (17 Nov 2026: seats come from /prices only; Car = 3, no third vehicle in Sri Lanka)
  ['Airport → Surfcamp — Car', 21000, 'airport', 3, 80], ['Airport → Surfcamp — Minivan', 26500, 'airport', 8, 95],
  ['Surfcamp → Airport — Car', 20000, 'airport', 3, 80], ['Surfcamp → Airport — Minivan', 25000, 'airport', 8, 95],
  ['River Safari', 1000, 'tours'], ['Tea Plantation', 1500, 'tours'],
].map(([name, cost, tab, capacity, sell], i) => ({ id: `cat-${i}`, name, cost_per_guest: cost, currency: 'LKR', notes: '', linked_transport_preset_id: `p-${name.split(' — ')[0]}`, linked_camp_tab_id: null, picker_tab: tab, sort_order: i,
  capacity: capacity || null, sell_price: sell || null, sell_currency: sell ? 'EUR' : null, covers_pax: sell ? 3 : null }));

let seq = 0;
const uid = (p = 'eeeeeeee') => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
function trip(o) {
  return { id: o.id || uid('aaaaaaaa'), location_id: LOC, kind: 'airport_arrival', trip_date: '2026-11-14', trip_time: null, pickup_time: null, flight: null, place: 'CMB', route: 'Airport → Surfcamp', purpose: 'guests',
    tour_name: null, guest_names: 'Guest', guest_phone: null, booking_ref: null, booking_checkout: null, pax: 1, vehicle: 'Car', driver_id: D.dilan, expected_price: 21000, currency: 'LKR',
    status: 'planned', source: 'bookinglayer', charge: 'bookinglayer', import_key: null, import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null,
    created_at: '2026-11-10T08:00:00Z', ...o };
}
function ledgerRow(id, desc, amount, date = '2026-11-12', extra = {}) {
  return { id, location_id: LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: null, description: desc, payment_method: 'Cash', qty: 1, amount_local: amount, currency: 'LKR',
    entry_date: date, business_area: 'Transport', fx_rate: 340, amount_eur: amount / 340, recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-11-16T09:00:00Z', ...extra };
}
const NEXT_WEEK = () => [
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a001', guest_names: 'Lorena Marie Glas', guest_phone: '+491700000001', trip_time: '01:55', flight: 'QR658', booking_ref: '2026-4660', import_key: 'bl:2026-4660:arr' }),
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a002', guest_names: 'Beliz Kuyumcuoglu', guest_phone: '+491700000002', vehicle: 'Minivan', expected_price: 26500, booking_ref: '2026-4070', import_key: 'bl:2026-4070:arr' }),
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a003', guest_names: 'Maximilian Ehrler', guest_phone: '+41700000003', booking_ref: '2026-4936', import_key: 'bl:2026-4936:arr' }),
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a004', kind: 'airport_departure', trip_date: '2026-11-21', guest_names: 'Beliz Kuyumcuoglu', vehicle: 'Minivan', expected_price: 25000, booking_ref: '2026-4070', import_key: 'bl:2026-4070:dep' }),
];

async function stub(page, opts = {}) {
  const st = {
    trips: (opts.trips || []).map(t => ({ ...t })), drivers: DRIVERS.map(d => ({ ...d })), links: (opts.links || []).map(l => ({ ...l })),
    ledger: (opts.ledger || []).map(r => ({ ...r })), bookings: opts.bookings || [], calls: [], noPrices: !!opts.noPrices, catalogUrls: [],
  };
  const slug = opts.slug || 'sri-lanka';
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
    const idEq = (url.match(/[?&]id=eq\.([^&]+)/) || [])[1];
    if (opts.missingTables && /\/rest\/v1\/(camp_|rpc\/camp_)/.test(url)) return json({ code: '42P01', message: 'relation "public.camp_trips" does not exist' }, 404);
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json(slug === 'sri-lanka'
      ? { id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' }
      : { id: 'loc-ma', name: 'Morocco', slug: 'morocco', currency: 'MAD', default_fx_to_eur: 10.8, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json(st.ledger);
      if (method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(r => { const i = st.ledger.findIndex(x => x.id === r.id); if (i >= 0) st.ledger[i] = { ...st.ledger[i], ...r }; else st.ledger.push({ created_at: new Date().toISOString(), ...r }); }); return json([]); }
      return json([]);
    }
    if (url.includes('/rest/v1/pricing_catalog')) {
      if (url.includes('category=eq.Transport')) st.catalogUrls.push(url);
      // a database where supabase/transport-catalog-one-source.sql has not run yet: the new columns do not exist
      if (opts.noNewCatalogCols && /covers_pax|bl_product/.test(url)) return json({ code: '42703', message: 'column pricing_catalog.covers_pax does not exist' }, 400);
      if (opts.catalogFails && url.includes('category=eq.Transport')) return json({ code: '500', message: 'timeout' }, 500);
      return json(slug === 'sri-lanka' && url.includes('category=eq.Transport') && !st.noPrices ? (opts.catalog || CATALOG) : []);
    }
    if (url.includes('/rest/v1/location_state_store') && method !== 'GET') st.calls.push({ t: 'state_store', body });
    if (url.includes('/rest/v1/camp_drivers')) {
      if (method === 'GET') return json(st.drivers);
      if (method === 'PATCH') { const d = st.drivers.find(x => x.id === idEq); Object.assign(d, body); st.calls.push({ t: 'driver_update', id: idEq, body }); return json([d]); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('dddddddd'), aliases: [], kinds: [], default_for: [], active: true, ...r })); st.drivers.push(...rows); return json(rows); }
    }
    if (url.includes('/rest/v1/camp_trips')) {
      if (method === 'GET') { // PostgREST caps a page at 1.000 rows: honour offset/limit like the server
        const off = Number((url.match(/[?&]offset=(\d+)/) || [])[1] || 0); const lim = Number((url.match(/[?&]limit=(\d+)/) || [])[1] || 1000);
        return json(st.trips.slice(off, off + Math.min(lim, 1000)));
      }
      if (opts.noFreeColumn && body && [].concat(body).some(r => 'free_reason' in r)) { st.calls.push({ t: 'free_refused', method }); return json({ code: 'PGRST204', message: "Could not find the 'free_reason' column of 'camp_trips' in the schema cache" }, 400); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => trip({ id: uid('aaaaaaaa'), created_at: new Date().toISOString(), import_key: null, booking_ref: null, guest_names: null, ...r })); st.trips.push(...rows); st.calls.push({ t: 'trip_insert', rows }); return json(rows); }
      if (method === 'PATCH') { const t = st.trips.find(x => x.id === idEq); Object.assign(t, body); st.calls.push({ t: 'trip_update', id: idEq, body }); return json([t]); }
      if (method === 'DELETE') { st.trips = st.trips.filter(x => x.id !== idEq); st.calls.push({ t: 'trip_delete', id: idEq }); return json([]); }
    }
    if (url.includes('/rest/v1/camp_transport_payments')) return json(st.links);
    if (url.includes('/rest/v1/bookings')) {
      const m = url.match(/booking_ref=in\.\(([^)]*)\)/);
      if (m) { const refs = m[1].split(',').map(s => s.replace(/"/g, '')); return json(st.bookings.filter(b => refs.includes(b.booking_ref))); }
      return json(st.bookings.filter(b => b.location === 'Surf Camp Ahangama' && b.check_in_on >= '2026-11-14' && b.check_in_on <= '2026-11-20'));
    }
    if (url.includes('/rest/v1/rpc/camp_transport_autolink')) return json({});
    if (url.includes('/rest/v1/rpc/camp_trips_import')) { st.calls.push({ t: 'import', body }); return json({ inserted: body.p_trips.length, updated: 0, resend: 0, cancelled: 0, missing: 0, untouched: 0, guests: body.p_guests.length, ...(opts.importResult || {}) }); }
    if (url.includes('/rest/v1/rpc/camp_transport_link_set')) {
      st.calls.push({ t: 'link_set', body });
      st.trips.forEach(t => { if (t.payment_entry_id === body.p_entry) t.payment_entry_id = null; });
      st.trips.forEach(t => { if (body.p_trip_ids.includes(t.id)) t.payment_entry_id = body.p_entry; });
      const e = st.ledger.find(x => x.id === body.p_entry); const sum = st.trips.filter(t => t.payment_entry_id === body.p_entry).reduce((s, t) => s + t.expected_price, 0);
      const n = body.p_trip_ids.length; const state = n && sum === e.amount_local ? 'matched' : body.p_note ? 'explained' : 'review';
      const l = st.links.find(x => x.entry_id === body.p_entry);
      Object.assign(l, { state, trips_amount: sum, trips_count: n, note: body.p_note, linked_by: 'manual', reviewed_by: 'u1', driver_id: body.p_driver, reason: state === 'review' ? (n ? 'amounts differ' : 'unlinked') : null });
      return json({ state, trips: n, trips_amount: sum, amount: e.amount_local });
    }
    if (url.includes('/rest/v1/rpc/camp_trips_pay')) {
      st.calls.push({ t: 'pay', body });
      const rows = body.p_entries.map(e => { const { trip_ids, ...r } = e; trip_ids.forEach(id => { st.trips.find(t => t.id === id).payment_entry_id = r.id; }); return { ...r, source_kind: 'trip_payment', created_at: new Date().toISOString() }; });
      st.ledger.push(...rows);
      rows.forEach(r => st.links.push({ entry_id: r.id, location_id: LOC, driver_id: body.p_driver, entry_amount: r.amount_local, trips_amount: r.amount_local, trips_count: 1, state: 'matched', linked_by: 'pay' }));
      return json({ rows, trips_amount: 0, amount: body.p_typed_amount });
    }
    return json([]);
  });
  return st;
}

// The UI writes asynchronously: wait for the n-th call of a kind, then return it.
async function call(st, kind, n = 1) {
  await expect.poll(() => st.calls.filter(c => c.t === kind).length, { timeout: 5000 }).toBeGreaterThanOrEqual(n);
  return st.calls.filter(c => c.t === kind)[n - 1];
}

async function open(page, opts = {}) {
  const st = await stub(page, opts);
  page.on('dialog', d => d.accept());
  // Go-live (16 Nov) is after the pinned «now»: move it into the past like the SQL check does.
  await page.addInitScript(([now]) => { window.TRANSPORT_NOW = now; window.TRIPS_GO_LIVE_OVERRIDE = '2026-11-01'; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; }, [NOW]);
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${opts.slug || 'sri-lanka'}${opts.query || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return st;
}
async function openTab(page, opts = {}) {
  const st = await open(page, opts);
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  return st;
}
// The Guests import has one door, in Week (15 Nov 2026): Transport's empty week points there (TransportUI.toImport).
async function openImport(page) {
  await page.evaluate(() => TransportUI.toImport());
  await expect(page.locator('#weekRoot .wk-import #trGuestsFile')).toHaveCount(1);
}

// ── Access ─────────────────────────────────────────────────────────────────
test('transport: full view has the tab; Sri Lanka ?view=local has it as «Drivers»; camp-tab-only never (Morocco: tests/morocco-transport.spec.js)', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  await open(page);
  await expect(page.locator('.ntab[data-page="transport"]')).toBeVisible({ visible: true }).catch(async () => {
    // ≤820px the tabs live in the drawer
    expect(await page.locator('.ntab-m[data-page="transport"]').evaluate(el => el.style.display)).toBe('');
  });
  expect(errors).toEqual([]);
  // camp-tab-only: no tab, the page is refused, nothing loads
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await open(p, { query: '&view=camp-tab-only' });
  const r = await p.evaluate(() => {
    const shown = [...document.querySelectorAll('[data-page="transport"]')].some(b => b.style.display !== 'none');
    showPage('transport');
    return { shown, active: activePage, loaded: !!(window.TransportUI && TransportUI._state.loaded) };
  });
  expect(r).toEqual({ shown: false, active: 'pos', loaded: false });
  expect(await p.locator('#transportRoot').innerHTML()).toBe('');
  await p.close();
});

// ── One import door (15 Nov 2026: «Week = guests and camp teams, Transport = drivers and money») ──
test('transport: one view (no Reconcile pill since 16 Nov 2026), no «Next week»; an empty week says the trips come from the Guests file and opens the import in Week', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, { trips: [] });
  await expect(page.locator('#transportRoot .tr-views')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-tripview')).toBeVisible();
  await expect(page.locator('#transportRoot button.pill:has-text("Next week")')).toHaveCount(0);
  // The sheet (16 Nov 2026): an empty week still shows its seven days, each with «+ Add», and says where trips come from.
  await expect(page.locator('#transportRoot .tr-sheet-empty')).toContainText('Airport transfers come from the Guests file (import it in Week)');
  await expect(page.locator('#transportRoot .tr-day')).toHaveCount(7);
  await expect(page.locator('#transportRoot .tr-day [data-add]')).toHaveCount(7);
  await page.click('#transportRoot .tr-sheet-empty button:has-text("Import Guests file")');
  await expect(page.locator('#weekRoot .wk-import .card-title').first()).toHaveText('Guests file');
  expect(await page.evaluate(() => activePage)).toBe('week');
  expect(await page.locator('#trGuestsFile').count()).toBe(1);
  expect(errors).toEqual([]);
});

// ── Guests import (shown in Week, the only door) ───────────────────────────
test('guests import (in Week): the Guests file stands alone — HQ bookings are never read or used (Miguel, 13 Nov)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const hqReads = [];
  page.on('request', r => { if (/\/rest\/v1\/bookings\?.*(booking_ref=in|check_in_on=gte)/.test(r.url())) hqReads.push(r.url()); }); // the import's own HQ reads (the hub's Overview load is separate)
  const st = await openTab(page, {
    bookings: [ // HQ says Maximilian is cancelled — the camp import must not care
      { booking_ref: '2026-4660', booker: 'Lorena Marie Glas', check_in_on: '2026-11-14', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama', partner_name: 'Direct Bookings', raw_payload: { status: 'confirmed' } },
      { booking_ref: '2026-4936', booker: 'Maximilian Ehrler', check_in_on: '2026-11-14', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama', partner_name: 'Direct Bookings', raw_payload: { status: 'cancelled' } },
    ],
  });
  await openImport(page);
  await expect(page.locator('#weekRoot .wk-import .card-title').first()).toHaveText('Guests file');
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 6');
  await expect(page.locator('#weekRoot')).toContainText('Maximilian Ehrler');
  await expect(page.locator('#weekRoot')).not.toContainText('in HQ');
  await expect(page.locator('#weekRoot')).not.toContainText('Cancelled in HQ');
  await expect(page.locator('.tr-soft')).toHaveCount(0);
  await page.click('#trImportSave');
  await expect(page.locator('.status-msg.status-ok')).toContainText('Saved: 6 new');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_trips.map(t => t.key).sort()).toEqual(['bl:2026-4070:arr', 'bl:2026-4070:dep', 'bl:2026-4660:arr', 'bl:2026-4660:dep', 'bl:2026-4936:arr', 'bl:2026-4936:dep']); // every transfer both ways (13 Nov)
  expect(imp.p_trips.every(t => t.hq_match == null)).toBe(true);
  expect(imp.p_cancel_refs).not.toContain('2026-4936');
  expect(imp.p_guests.length).toBe(18);
  // partner comes from the Guests «Booking due» > 0 only (gen_from_guests.py rule)
  expect(imp.p_guests.find(g => g.booking_ref === '2026-4047')).toMatchObject({ partner: 'partner', booking_due: 639 });
  expect(hqReads).toEqual([]);
  expect(errors).toEqual([]);
});

test('guests import (in Week): every row of the file is accounted for — imported, or left out with its reason (audit of 13 Nov)', async ({ page }) => {
  const st = await openTab(page);
  await openImport(page);
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('#weekRoot .tr-audit')).toHaveText('18 rows in the file = 18 guests imported + 0 left out');
  await expect(page.locator('#weekRoot .tr-audit')).toHaveClass(/hint/);
  await expect(page.locator('#weekRoot .tr-leftout')).toHaveCount(0);
  // invented rows: a +1 with no name, a request, another camp, a row with no dates
  const head = '"Guest","Booking status","Booking","Accommodations","Bed number","Packages","Check-in on","Check-out on","Has transfer"';
  const csv = [head,
    '"Kai Kopp","paid","2026-9007","Hiriketeya Beach Superior Ensuite Room","1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","No"',
    '"","paid","2026-9007","Hiriketeya Beach Superior Ensuite Room","2","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","No"',
    '"Nora Nagel","request","2026-9010","Unawatuna Beach Shared Room (only girls)","1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","No"',
    '"Pia Pohl","paid","2026-9012","17 - Castelo beach mixed dorm","1","Offseason Custom Package","Fri 27 Nov 2026","Sun 29 Nov 2026","No"',
    '"Quin Quast","paid","2026-9013","Madiha Beach Standard Ensuite Room","1","Surf Camp Ahangama","","","No"'].join('\n');
  await page.setInputFiles('#trGuestsFile', { name: 'Bookinglayer-Guests-2026-11-13 10_00.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.locator('#weekRoot .tr-audit')).toHaveText('5 rows in the file = 2 guests imported + 3 left out · 2 to look at');
  await expect(page.locator('#weekRoot .tr-audit')).toHaveClass(/status-warn/);
  const left = page.locator('#weekRoot .tr-leftout .tr-row');
  await expect(left).toHaveCount(3);
  await expect(left.nth(0)).toContainText('Nora Nagel');
  await expect(left.nth(0)).toContainText('status «request»');
  await expect(left.nth(0).locator('.badge')).toHaveText('Check');
  await expect(left.nth(1)).toContainText('other camp (17 - Castelo beach mixed dorm)');
  await expect(left.nth(1).locator('.badge')).toHaveCount(0);
  await expect(left.nth(2)).toContainText('Quin Quast');
  await expect(left.nth(2)).toContainText('no check-in or check-out date: on no list');
  await expect(page.locator('#weekRoot .tr-soft')).toContainText('1 guest with no name or a repeated name on the booking, kept as separate people: Guest without name (booking 2026-9007)');
  await page.click('#trImportSave');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_guests.map(g => g.guest_key)).toEqual(['kai kopp', 'guest without name (booking 2026-9007)']);
});

test('guests import (in Week): a file without a date in its name asks when it was downloaded', async ({ page }) => {
  await openTab(page);
  await openImport(page);
  await page.setInputFiles('#trGuestsFile', path.join(__dirname, 'fixtures', 'guests-13h47.csv'));
  await expect(page.locator('#weekRoot')).toContainText('When did you download this file?');
  await page.fill('#trExportDate', '2026-11-13');
  await page.click('.tr-date-ask button');
  await expect(page.locator('#weekRoot')).toContainText('exported 13 Nov');
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 6');
});

// ── Trips list + WhatsApp ──────────────────────────────────────────────────
test('trips: list by day, WhatsApp to the «Send transfers to» contact in Miguel\'s format, status Pending → Message Sent → Confirmed', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, { trips: NEXT_WEEK() });
  await expect(page.locator('.tr-week')).toHaveText('7–13 Nov');   // Fri 13 Nov: this Sat–Fri week
  await page.click('button[title="Next week"]');
  await expect(page.locator('.tr-week')).toHaveText('14–20 Nov');
  const rows = page.locator('.tr-day').first().locator('.tr-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Lorena Marie Glas');      // 01:55 first
  await expect(rows.nth(1).locator('.badge-amber')).toHaveText('time?');
  await rows.first().locator('button[title="Send on WhatsApp"]').click();
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith('https://wa.me/94771234567?text=')).toBe(true);
  expect(decodeURIComponent(url.split('?text=')[1])).toBe('Airport to Camp\nLorena Marie Glas\n+491700000001\n1 person\nFlight Number: QR658\nTime: 01:55\nDate: 14 Nov\nSmall Car');
  // Floriane (16 Nov 2026): one select with the three steps instead of the Sent ✓ / Confirmed ✓ buttons.
  await expect(rows.first().locator('[data-status-sel]')).toHaveValue('planned');
  await expect(rows.first().locator('[data-status-sel] option')).toHaveText(['Pending', 'Message Sent', 'Confirmed']);
  await rows.first().locator('[data-status-sel]').selectOption('sent');
  await expect(rows.first().locator('[data-status-sel]')).toHaveValue('sent');
  await expect(rows.first().locator('[data-pay]')).toHaveCount(0);   // one word per state: the select, no «Sent» badge beside it
  const upd = await call(st, 'trip_update');
  expect(upd.body).toMatchObject({ status: 'sent', needs_resend: false, sent_snapshot: { trip_date: '2026-11-14', trip_time: '01:55', flight: 'QR658', pax: 1 } });
  await expect(page.locator('#trOv.open')).toHaveCount(0);            // the select never opens the trip sheet
  await rows.first().locator('[data-status-sel]').selectOption('confirmed');
  await expect(rows.first().locator('[data-status-sel]')).toHaveValue('confirmed');
  expect((await call(st, 'trip_update', 2)).body).toMatchObject({ status: 'confirmed' });
  // whole day (15 Nov): the same house-style message as the old Week → Transfers day message — one builder
  await page.click('button:has-text("Send the whole day")');
  const day = decodeURIComponent((await page.evaluate(() => window.__opened[1])).split('?text=')[1]);
  expect(day).toBe([
    '*TRANSFERS TOMORROW - 14 NOV*',
    'Airport to Camp _(already sent)_\nLorena Marie Glas\n+491700000001\n1 person\nFlight Number: QR658\nTime: 01:55\nDate: 14 Nov\nSmall Car',
    'Airport to Camp\nBeliz Kuyumcuoglu\n+491700000002\n1 person\nFlight Number: TBC\nTime: TBC\nDate: 14 Nov\nMinivan',
    'Airport to Camp\nMaximilian Ehrler\n+41700000003\n1 person\nFlight Number: TBC\nTime: TBC\nDate: 14 Nov\nSmall Car',
  ].join('\n\n'));
  // … byte for byte what the Week's day message sends (the Week tab dresses it the same way)
  expect(await page.evaluate(() => TransportUI.dayMessage('2026-11-14'))).toBe(day);
  expect(await page.evaluate(() => GuestsTrips.dressTitles(GuestsTrips.transfersText(TransportUI._state.trips, { day: '2026-11-14', now: TransportUI.colomboNow() }), '2026-11-13'))).toBe(day);
  expect(errors).toEqual([]);
});

test('trips: no phone for the contact → wa.me without a number; a changed time shows «Time changed, resend» and a chip', async ({ page }) => {
  const trips = NEXT_WEEK(); trips[0].status = 'sent'; trips[0].needs_resend = true;
  const st = await stub(page, { trips });
  st.drivers.find(d => d.id === D.nadith).phone = null;
  await page.addInitScript(([now]) => { window.TRANSPORT_NOW = now; window.__opened = []; window.open = (u) => { window.__opened.push(u); }; }, [NOW]);
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 15000 });
  await page.evaluate(() => { showPage('transport'); TransportUI.shiftWeek(7); });
  await expect(page.locator('.tr-strip')).toContainText('1 changed — resend');
  const row = page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"]');
  await expect(row).toContainText('Time changed, resend');
  await row.locator('button[title="Send on WhatsApp"]').click();
  expect(await page.evaluate(() => window.__opened[0])).toMatch(/^https:\/\/wa\.me\/\?text=Airport%20to%20Camp/);
  await row.locator('button:has-text("Sent ✓")').click();
  await expect(row).not.toContainText('Time changed, resend');
  await expect(page.locator('#transportRoot')).not.toContainText('changed — resend');
});

test('trips: an airport transfer by hand is FREE only (Miguel 16 Nov 2026: guests\' transfers come from Bookinglayer) — reason and name required, «what we pay the driver» from /prices', async ({ page }) => {
  const st = await openTab(page);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot [data-add="2026-11-12"]')).toHaveText('Free transfer');
  await page.click('#transportRoot [data-add="2026-11-12"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Add a free airport transfer');
  await expect(page.locator('#trOv .tr-free-rule')).toContainText('never add them here');
  await expect(page.locator('#trOv #at_ch, #trOv #at_who')).toHaveCount(0);                  // no «who pays us» / «guest» choice: always free
  await expect(page.locator('#trOv #at_fr .pill')).toHaveText(['Staff', 'Gift to guest', 'Compensation', 'Other']);
  await expect(page.locator('#trOv #at_fr .pill.active')).toHaveCount(0);                     // nothing picked for you
  await expect(page.locator('#at_d')).toHaveValue('2026-11-12');
  await page.fill('#at_g', 'Anna');
  await page.fill('#at_t', '14:30');
  await expect(page.locator('#at_pr')).toHaveValue('21000');
  await expect(page.locator('#trOv label[for], #trOv label').filter({ hasText: 'What we pay the driver (LKR)' })).toHaveCount(1);
  await page.click('#at_save');                                                               // no reason → refused
  await expect(page.locator('#trOv.open')).toHaveCount(1);
  expect(st.calls.filter(c => c.t === 'trip_insert')).toHaveLength(0);
  await page.click('#at_fr .pill:has-text("Compensation")');
  await page.fill('#at_g', '');
  await page.click('#at_save');                                                               // no name → refused
  expect(st.calls.filter(c => c.t === 'trip_insert')).toHaveLength(0);
  await page.fill('#at_g', 'Anna');
  await page.fill('#at_pr', '19000');
  await page.click('#at_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'airport_arrival', trip_date: '2026-11-12', trip_time: '14:30', guest_names: 'Anna', charge: 'free', free_reason: 'compensation', purpose: 'guests', expected_price: 19000, source: 'manual', driver_id: D.dilan });
  await expect(page.locator('.tr-row', { hasText: 'Anna' }).locator('.tr-free')).toHaveText('Free · Compensation');
  // Its edit sheet offers only «Free» + the reason — never «In booking» or «Camp Tab».
  await page.locator('.tr-row', { hasText: 'Anna' }).locator('[data-edit]').click();
  await expect(page.locator('#tr_ch .pill')).toHaveText(['Free (added by hand)']);
  await expect(page.locator('#tr_fr .pill.active')).toHaveText('Compensation');
});

test('trips: no-show from the trip screen', async ({ page }) => {
  const st = await openTab(page, { trips: NEXT_WEEK() });
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await page.click('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a003"] .tr-line1 b'); // the name — the row centre now holds «Ask guest»
  await page.click('#trOv button:has-text("No-show")');
  expect((await call(st, 'trip_update')).body).toMatchObject({ status: 'no_show' });
  await expect(page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a003"] .badge-grey')).toHaveText('No-show');
});

// ── Tuk-tuk day sheet ──────────────────────────────────────────────────────
test('tuk-tuk: one tap = one run saved as done; a double tap saves one; minus removes the last; tour runs carry the tour', async ({ page }) => {
  const st = await openTab(page);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');                  // the Tuk-tuks pill's blue button: «Add tuk-tuk runs»
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Tuk-tuk runs');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Log runs');   // opens on today's log, as before
  await expect(page.locator('#tk_dr')).toHaveValue(D.sampath);
  const ahangama = page.locator('.tr-tap-main[data-key="surf|Ahangama"]');
  await ahangama.click();
  await expect(ahangama.locator('.tr-tap-n')).toHaveText('1');
  await page.waitForTimeout(350);
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"]').click();
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('2');
  await page.waitForTimeout(350);
  // double tap: the second tap lands while the first is still saving
  await page.evaluate(() => { TransportUI.tap('surf|Ahangama'); TransportUI.tap('surf|Ahangama'); });
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('3');
  const inserts = st.calls.filter(c => c.t === 'trip_insert').map(c => c.rows[0]);
  expect(inserts.length).toBe(3);
  expect(inserts[0]).toMatchObject({ kind: 'tuktuk', route: 'Ahangama', purpose: 'surf', expected_price: 500, status: 'done', driver_id: D.sampath, trip_date: '2026-11-13', trip_time: '07:30' });   // 17 Nov 2026: the Morning session's pickup (now = 10:00, before 12:00)
  await expect(page.locator('.tr-tuk-total')).toContainText('3 runs');
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"] + .tr-tap-minus').click();
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('2');
  expect(st.calls.filter(c => c.t === 'trip_delete').length).toBe(1);
  await page.locator('.tr-tap-main[data-key="tour|River Safari"]').click();
  await expect(page.locator('.tr-tap-main[data-key="tour|River Safari"] .tr-tap-n')).toHaveText('1');
  const tour = st.calls.filter(c => c.t === 'trip_insert').pop().rows[0];
  expect(tour).toMatchObject({ purpose: 'tour', route: 'River Safari', tour_name: 'River Safari', expected_price: 1000 });
});

// ── Reconcile ──────────────────────────────────────────────────────────────
const P = { p1: 'bbbbbbbb-0000-4000-8000-000000000001', p2: 'bbbbbbbb-0000-4000-8000-000000000002', p3: 'bbbbbbbb-0000-4000-8000-000000000003', p4: 'bbbbbbbb-0000-4000-8000-000000000004' };
function recFixture() {
  const trips = [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b001', guest_names: 'Matched Guest', trip_date: '2026-11-08', trip_time: '10:00', booking_ref: '2026-1', payment_entry_id: P.p1 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b002', guest_names: 'Owed Guest', trip_date: '2026-11-09', trip_time: '09:00', booking_ref: '2026-2' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b003', guest_names: 'Paid Noshow', trip_date: '2026-11-09', status: 'no_show', booking_ref: '2026-3', payment_entry_id: P.p2, expected_price: 20000 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b004', guest_names: 'Plain Noshow', trip_date: '2026-11-10', status: 'no_show', booking_ref: '2026-4' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b005', guest_names: 'Extra Guest', kind: 'airport_departure', trip_date: '2026-11-10', source: 'manual', charge: 'camp_tab', payment_entry_id: P.p1 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b006', guest_names: 'Later Today', trip_date: '2026-11-13', trip_time: '22:00', booking_ref: '2026-6' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b007', kind: 'tuktuk', route: 'Ahangama', purpose: 'surf', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', charge: null, trip_date: '2026-11-11', payment_entry_id: P.p3 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000b008', kind: 'tuktuk', route: 'Weligama', purpose: 'surf', driver_id: D.sampath, expected_price: 1500, status: 'done', source: 'manual', charge: null, trip_date: '2026-11-11' }),
  ];
  const ledger = [ledgerRow(P.p1, 'Dilan 42000', 42000), ledgerRow(P.p2, 'Dilan 25000', 25000), ledgerRow(P.p3, 'Sampath tuk tuk', 500), ledgerRow(P.p4, 'Fuel For Scooter', 1500)];
  const links = [
    { entry_id: P.p1, location_id: LOC, driver_id: D.dilan, entry_amount: 42000, trips_amount: 42000, trips_count: 2, state: 'matched', linked_by: 'auto' },
    { entry_id: P.p2, location_id: LOC, driver_id: D.dilan, entry_amount: 25000, trips_amount: 20000, trips_count: 1, state: 'review', reason: 'amounts differ', linked_by: 'auto' },
    { entry_id: P.p3, location_id: LOC, driver_id: D.sampath, entry_amount: 500, trips_amount: 500, trips_count: 1, state: 'matched', linked_by: 'auto' },
    { entry_id: P.p4, location_id: LOC, driver_id: null, entry_amount: 1500, trips_amount: 0, trips_count: 0, state: 'review', reason: 'no driver named', linked_by: 'auto' },
  ];
  return { trips, ledger, links };
}

test('reconcile: status precedence (pure rule)', async ({ page }) => {
  await openTab(page);
  const r = await page.evaluate(() => {
    const T = (o) => ({ kind: 'airport_arrival', trip_date: '2026-11-10', trip_time: '10:00', status: 'planned', source: 'bookinglayer', payment_entry_id: null, ...o });
    const S = TransportUI.reconcileStatus;
    return {
      matched: S(T({ payment_entry_id: 'p' })), owed: S(T({})), owedManual: S(T({ source: 'manual' })),
      paidNoShow: S(T({ status: 'no_show', payment_entry_id: 'p' })), paidCancelled: S(T({ status: 'cancelled', payment_entry_id: 'p' })),
      paidUpcoming: S(T({ trip_date: '2026-11-20', payment_entry_id: 'p' })), noShow: S(T({ status: 'no_show' })), cancelled: S(T({ status: 'cancelled' })),
      upcoming: S(T({ trip_date: '2026-11-13', trip_time: '10:01' })), doneByTime: S(T({ trip_date: '2026-11-13', trip_time: '09:59' })),
      noTimeToday: S(T({ trip_date: '2026-11-13', trip_time: null })), extra: S(T({ source: 'manual', payment_entry_id: 'p' })),
      tuktuk: S(T({ kind: 'tuktuk', source: 'manual', status: 'done', payment_entry_id: 'p' })),
      beforeGoLive: S(T({ trip_date: '2026-10-30' })), paidBeforeGoLive: S(T({ trip_date: '2026-10-30', payment_entry_id: 'p' })),
    };
  });
  expect(r).toEqual({ matched: 'matched', owed: 'owed', owedManual: 'owed', paidNoShow: 'paid_not_done', paidCancelled: 'paid_not_done', paidUpcoming: 'paid_not_done',
    noShow: 'no_show', cancelled: 'cancelled', upcoming: 'upcoming', doneByTime: 'owed', noTimeToday: 'upcoming', extra: 'extra', tuktuk: 'matched',
    beforeGoLive: 'before_go_live', paidBeforeGoLive: 'matched' });
});

// ── Pay a driver (full view tool) ──────────────────────────────────────────
test('pay a driver: ticked trips prefill the amount; a difference needs a reason; one Cash row per linked item through the RPC', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const trips = [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000c001', guest_names: 'A', trip_date: '2026-11-08', expected_price: 21000 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000c002', guest_names: 'B', trip_date: '2026-11-09', expected_price: 21000 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000c003', guest_names: 'C', kind: 'airport_departure', trip_date: '2026-11-10', expected_price: 21000 }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000c004', kind: 'other', route: 'Yala Safari', purpose: 'tour', tour_name: 'Yala Safari', trip_date: '2026-11-07', expected_price: 0, status: 'done', source: 'manual' }),
  ];
  const st = await openTab(page, { trips: trips.slice(0, 3) });
  // One way to pay (16 Nov 2026 UX pass): «Pay» on each driver of «Owed to drivers»; «Pay another driver» opens the picker
  // (a driver with nothing owed yet). No header «Pay a driver» button any more.
  await expect(page.locator('#trPayBtn')).toHaveCount(0);
  await expect(page.locator(`#trOwed [data-owed="${D.dilan}"] .tr-owed-pay`)).toHaveText('Pay');
  await page.click('#trPayOther');
  await expect(page.locator('#trOv .tr-pick-btn:has-text("Dilan")')).toContainText('owed 3 trips');
  await page.click('#trOv .mclose');
  await page.click(`#trOwed [data-owed="${D.dilan}"]`);
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Pay Dilan');
  await expect(page.locator('#trOv [data-pay-group]')).toHaveCount(3);
  await expect(page.locator('#py_amt')).toHaveValue('63000');
  await expect(page.locator('#py_save')).toBeEnabled();
  await page.fill('#py_amt', '70000');
  await expect(page.locator('#py_diff')).toContainText('difference +');
  await expect(page.locator('#py_save')).toBeDisabled();
  await page.click('#py_reasons .pill:has-text("Waiting time")');
  await expect(page.locator('#py_save')).toBeEnabled();
  await page.click('#py_save');
  await expect(page.locator('#trOv')).not.toHaveClass(/open/);
  const pay = (await call(st, 'pay')).body;
  expect(pay.p_typed_amount).toBe(70000);
  expect(pay.p_diff_note).toBe('Waiting time');
  expect(pay.p_entries.length).toBe(1);
  expect(pay.p_entries[0]).toMatchObject({ category: 'Transport', payment_method: 'Cash', linked_item: 'Airport', amount_local: 70000, source_kind: 'trip_payment', entry_date: '2026-11-13' });
  expect(pay.p_entries[0].trip_ids.length).toBe(3);
  expect(pay.p_entries[0].description).toBe('Dilan · 2 arrivals, 1 departure · 8–10 Nov · +7.000 waiting time');
  // The new ledger row is in the hub at once
  expect(await page.evaluate((id) => S.ledger.some(e => e.id === id && e.amountLocal === 70000 && e.paymentMethod === 'Cash'), pay.p_entries[0].id)).toBe(true);
  expect(errors).toEqual([]);
});

test('pay a driver: a tuk-tuk week splits into one row per linked item (surf, food, tour route)', async ({ page }) => {
  const runs = [
    trip({ kind: 'tuktuk', route: 'Ahangama', purpose: 'surf', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', trip_date: '2026-11-10' }),
    trip({ kind: 'tuktuk', route: 'Weligama', purpose: 'surf', driver_id: D.sampath, expected_price: 1500, status: 'done', source: 'manual', trip_date: '2026-11-11' }),
    trip({ kind: 'tuktuk', route: 'Market / food', purpose: 'food', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', trip_date: '2026-11-11' }),
    trip({ kind: 'tuktuk', route: 'River Safari', purpose: 'tour', tour_name: 'River Safari', driver_id: D.sampath, expected_price: 1000, status: 'done', source: 'manual', trip_date: '2026-11-12' }),
  ];
  const st = await openTab(page, { trips: runs });
  await page.evaluate((id) => { TransportUI.openPay(); TransportUI.payPick(id); }, D.sampath);
  await expect(page.locator('#py_amt')).toHaveValue('3500');
  await page.click('#py_save');
  await expect(page.locator('#trOv')).not.toHaveClass(/open/);
  const pay = (await call(st, 'pay')).body;
  const byItem = Object.fromEntries(pay.p_entries.map(e => [e.linked_item, e.amount_local]));
  expect(byItem).toEqual({ 'Transport Surf Lesson': 2000, 'Food Supply': 500, 'River Safari': 1000 });
  expect(pay.p_entries.find(e => e.linked_item === 'River Safari').description).toContain('tour run (River Safari)');
});

// ── Drivers + chip ─────────────────────────────────────────────────────────
test('drivers: phone, default vehicle, aliases and the «Send transfers to» contact', async ({ page }) => {
  const st = await openTab(page);
  await page.click('button:has-text("Drivers")');
  const dilan = page.locator(`.tr-driver[data-driver="${D.dilan}"]`);
  await dilan.locator('[data-f="phone"]').fill('+94 77 000 1111');
  await dilan.locator('[data-f="default_vehicle"]').selectOption('Minivan');
  await page.selectOption('#dv_contact', D.dilan);
  await page.click('#trOv .btn-p');
  await call(st, 'driver_update', 2);
  const upd = st.calls.filter(c => c.t === 'driver_update');
  const dil = upd.find(c => c.id === D.dilan).body;
  expect(dil).toMatchObject({ phone: '+94770001111', default_vehicle: 'Minivan' });
  expect(dil.default_for).toContain('transfers_contact');
  expect(upd.find(c => c.id === D.nadith).body.default_for).not.toContain('transfers_contact');
});

test('chip «Transport payment not linked to trips»: counts review payments; silent before load and in the local view', async ({ page }) => {
  await openTab(page, recFixture());
  const r = await page.evaluate(() => {
    const check = window.CAMP_CHECKS.find(c => c.id === 'transport-payment-unlinked');
    const ctx = { ledger: S.ledger, location: 'sri-lanka', isLocal: false, today: '2026-11-13' };
    const hit = check.run(ctx);
    const local = check.run({ ...ctx, isLocal: true });
    const morocco = check.run({ ...ctx, location: 'morocco' });
    TransportUI._state.loaded = false; const before = check.run(ctx); TransportUI._state.loaded = true;
    hit.onClick();
    return { text: hit.text, level: hit.level, local, morocco, before, page: activePage, view: TransportUI._state.view, modal: document.querySelector('#trOv.open .mhdr-title')?.textContent };
  });
  expect(r.text).toMatch(/^Transport payment not linked to trips · 2 · LKR\s6,500$/);
  expect(r.level).toBe('warn');
  expect([r.local, r.morocco, r.before]).toEqual([null, null, null]);
  expect([r.page, r.view, r.modal]).toEqual(['transport', 'trips', 'Payments to check']);   // Reconcile is gone: the list of payments to check opens
});

test('transport: more than 1.000 trips load in pages (tuk-tuk runs add up fast)', async ({ page }) => {
  const runs = Array.from({ length: 1234 }, (_, i) => trip({ id: `aaaaaaaa-0000-4000-8000-${String(900000 + i).padStart(12, '0')}`, kind: 'tuktuk', route: 'Ahangama', purpose: 'surf', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', trip_date: '2026-11-0' + (1 + (i % 9)) }));
  await openTab(page, { trips: runs });
  expect(await page.evaluate(() => TransportUI._state.trips.length)).toBe(1234);
});

test('transport: works with the tables missing (SQL not run yet) — a clear message, no crash', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await open(page, { missingTables: true });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.error, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  await expect(page.locator('#transportRoot .status-warn')).toContainText('Transport is not set up yet — tell Miguel');
  await expect(page.locator('#transportRoot .status-warn')).not.toContainText('supabase/');   // no file names for staff (UXC-09)
  expect(errors).toEqual([]);
});

test('guests import (in Week): a Bookinglayer Guests .xlsx is read like the CSV (Excel reader stubbed)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const csv = require('fs').readFileSync(GUESTS_CSV, 'utf8');
  // Stand-in for SheetJS: the app only calls XLSX.read + XLSX.utils.sheet_to_csv.
  await page.addInitScript(text => {
    window.XLSX = { read: () => ({ SheetNames: ['Guests'], Sheets: { Guests: {} } }), utils: { sheet_to_csv: () => text } };
  }, csv);
  await openTab(page);
  await openImport(page);
  expect(await page.locator('#trGuestsFile').getAttribute('accept')).toContain('.xlsx');
  await page.setInputFiles('#trGuestsFile', { name: 'Bookinglayer-Guests-2026-11-07 14_23.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake xlsx') });
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 6');
  await expect(page.locator('#weekRoot')).toContainText('exported 7 Nov');
  expect(errors).toEqual([]);
});

test('trips: a transfer without flight or time has «Ask guest» — WhatsApp to the GUEST asking for the flight; «asked» shows after', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, { trips: NEXT_WEEK() });
  await page.click('button[title="Next week"]');
  const rows = page.locator('.tr-day').first().locator('.tr-row');
  await expect(rows.first().locator('button:has-text("Ask guest")')).toHaveCount(0);           // Lorena has flight + time
  const beliz = rows.filter({ hasText: 'Beliz Kuyumcuoglu' });
  await beliz.locator('button:has-text("Ask guest for flight & time")').click();
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith('https://wa.me/491700000002?text=')).toBe(true);                      // the guest, not the driver contact
  const text = decodeURIComponent(url.split('?text=')[1]);
  expect(text).toContain('Hi Beliz!');
  expect(text).toContain('flight number');
  expect(text).toContain("I'm Francisco, the manager of *Gota Dagua Surf Camp Sri Lanka*.");
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);                                         // no emoji (wa.me shows «?» on desktop)
  await expect(page.locator('.tr-day').first().locator('.tr-row').filter({ hasText: 'Beliz Kuyumcuoglu' })).toContainText('asked');
  // kept in the browser's real storage, so it survives a reload (the hub shadows `localStorage` with an in-memory map — CH-13)
  expect(await page.evaluate(() => Object.keys(JSON.parse(window.localStorage.getItem('tr-asked-v1') || '{}')).length)).toBe(1);
  expect(errors).toEqual([]);
});

test('trips: a departure on the closing Saturday shows in the week it ends (14–20 Nov shows Sat 21), not in the next one', async ({ page }) => {
  await openTab(page, { trips: [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000d001', kind: 'airport_departure', guest_names: 'Beliz Kuyumcuoglu', trip_date: '2026-11-21', trip_time: '15:00', booking_ref: '2026-4070' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000d002', guest_names: 'Next Week Arrival', trip_date: '2026-11-21', trip_time: '09:00' }),
  ] });
  await page.click('button[title="Next week"]');
  await expect(page.locator('.tr-week')).toHaveText('14–20 Nov');
  await expect(page.locator('#transportRoot')).toContainText('Beliz Kuyumcuoglu');
  await expect(page.locator('#transportRoot')).not.toContainText('Next Week Arrival');
  await page.click('button[title="Next week"]');
  await expect(page.locator('#transportRoot')).toContainText('Next Week Arrival');
  await expect(page.locator('#transportRoot')).not.toContainText('Beliz Kuyumcuoglu');
});

// ════════════════════════════════════════════════════════════════════════════
//  13 Nov (Miguel): edit / delete tuk-tuks, plan tomorrow + order, paid or not
//  on every row, free / offered transfers, week totals, the logic in one line.
// ════════════════════════════════════════════════════════════════════════════
const R = n => `aaaaaaaa-0000-4000-8000-00000000c${String(n).padStart(3, '0')}`;
const run = (n, o = {}) => trip({ id: R(n), kind: 'tuktuk', guest_names: null, route: 'Ahangama', purpose: 'surf', driver_id: D.sampath, expected_price: 500, status: 'done', source: 'manual', charge: null, vehicle: 'Tuk-tuk',
  trip_date: '2026-11-12', trip_time: '07:30', created_at: `2026-11-12T02:0${n % 10}:00Z`, ...o });
function weekFixture() {
  const trips = [
    trip({ id: R(101), guest_names: 'Lorena Marie Glas', trip_date: '2026-11-08', trip_time: '01:55', flight: 'QR658', booking_ref: '2026-4660', payment_entry_id: P.p1 }),
    trip({ id: R(102), guest_names: 'Beliz Kuyumcuoglu', trip_date: '2026-11-09', trip_time: '09:00', vehicle: 'Minivan', expected_price: 26500, booking_ref: '2026-4070' }),
    trip({ id: R(103), guest_names: 'Kasun Perera', trip_date: '2026-11-10', trip_time: '11:00', source: 'manual', charge: 'free', free_reason: 'staff', added_by_local: true, purpose: 'staff' }),
    trip({ id: R(104), kind: 'airport_departure', guest_names: 'Alicia Pohl', trip_date: '2026-11-11', trip_time: '14:00', expected_price: 20000, booking_ref: '2026-5000', charge: 'free', free_reason: 'gift', payment_entry_id: P.p1 }),
    trip({ id: R(105), guest_names: 'Maximilian Ehrler', trip_date: '2026-11-13', trip_time: '22:00', booking_ref: '2026-4936' }),
    trip({ id: R(106), guest_names: 'Cancelled Guest', trip_date: '2026-11-09', status: 'cancelled', booking_ref: '2026-9' }),
    run(1), run(2), run(3),
    run(4, { route: 'Weligama', expected_price: 1500, payment_entry_id: P.p3 }),
  ];
  const ledger = [ledgerRow(P.p1, 'Airport transfers', 41000), ledgerRow(P.p3, 'Sampath tuk tuk', 1500)];
  const links = [
    { entry_id: P.p1, location_id: LOC, driver_id: D.dilan, entry_amount: 41000, trips_amount: 41000, trips_count: 2, state: 'matched', linked_by: 'manual', reviewed_by: null },
    { entry_id: P.p3, location_id: LOC, driver_id: D.sampath, entry_amount: 1500, trips_amount: 1500, trips_count: 1, state: 'matched', linked_by: 'auto' },
  ];
  return { trips, ledger, links };
}
const norm = s => s.replace(/\s+/g, ' ').trim();

for (const [name, size] of [['phone 390', { width: 390, height: 844 }], ['desktop 1280', { width: 1280, height: 900 }]]) {
  test(`trips: paid or not on every row, free tags; no week-total tiles (16 Nov 2026) — ${name}`, async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize(size);
    await openTab(page, weekFixture());
    // The logic in one plain line under the title.
    await expect(page.locator('#transportRoot .tr-how')).toHaveText('Airport transfers to and from Colombo, and the tuk-tuk runs. Pay a driver from «Owed to drivers».');
    await expect(page.locator('.tr-week')).toHaveText('7–13 Nov');
    await expect(page.locator('[data-total]')).toHaveCount(0);
    expect(norm(await page.locator('#trOwed').innerText())).toBe('OWED TO DRIVERS Dilan LKR 47,500 Pay Sampath LKR 1,500 Pay Pay another driver');
    if (size.width <= 700) expect(await page.evaluate(() => document.querySelector('.tr-day .tr-row').getBoundingClientRect().top)).toBeLessThan(size.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    // Every airport row says where it stands, without opening Reconcile.
    const row = id => page.locator(`.tr-row[data-trip="${id}"]`);
    await expect(row(R(101)).locator('[data-pay]')).toHaveText('Paid');
    await expect(row(R(101)).locator('.tr-pay')).toContainText('12 Nov · linked by Nadith');
    await expect(row(R(102)).locator('[data-pay="owed"]')).toHaveText('Owed');
    await expect(row(R(103)).locator('[data-pay="owed"]')).toHaveText('Owed');            // free for the guest, still owed to the driver
    await expect(row(R(103)).locator('.tr-free')).toHaveText('Free · Staff');
    await expect(row(R(103))).toContainText('added by Nadith');
    await expect(row(R(104)).locator('.tr-free')).toHaveText('Free · Gift');
    await expect(row(R(104)).locator('[data-pay="paid"]')).toHaveText('Paid');
    await expect(row(R(105)).locator('[data-status-sel]')).toHaveValue('planned');      // still to come: the status select (Pending)
    await showCancelled(page);                                                            // cancelled rows sit behind «Show N cancelled» (17 Nov 2026)
    await expect(row(R(106)).locator('[data-pay="off"]')).toHaveText('Cancelled');
    // Tuk-tuk lines: one per route and state.
    const lines = page.locator('.tr-tuk-line');
    await expect(lines).toHaveCount(2);
    // The sheet (16 Nov 2026): Time | What | People | Driver | Price | Status — identical runs are one row «× N».
    expect(norm(await lines.nth(0).innerText())).toBe('Ahangama × 3 Sampath LKR 1,500 Owed done, not paid');
    expect(norm(await lines.nth(1).innerText())).toBe('07:30 Weligama Sampath LKR 1,500 Paid 12 Nov · linked automatically');
    // The Airport / Tuk-tuk pills filter the list.
    await page.click('.tr-tabs .pill:has-text("Tuk-tuk")');
    await expect(page.locator('.tr-row')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    // Before go-live (the real one, 14 Nov) nothing is «owed»: it is not tracked.
    await page.evaluate(() => { window.TRIPS_GO_LIVE_OVERRIDE = '2026-11-14'; TransportUI.setFilter('all'); });
    await expect(row(R(102)).locator('[data-pay="old"]')).toHaveText('Before go-live');
    expect(errors).toEqual([]);
  });
}

test('tuk-tuk: tap a line to edit its runs, remove one, delete them; a paid run is read-only («unlink the payment first»)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, weekFixture());
  const owed = page.locator('.tr-tuk-line[data-run-group]', { hasText: 'Ahangama' });
  // A row «× 3» opens on tap to show each run (tap one to edit it); the pencil edits the three together.
  await owed.click();
  await expect(page.locator('.tr-kids [data-run-one]')).toHaveCount(3);
  await expect(page.locator('#trOv.open')).toHaveCount(0);
  await page.locator('.tr-kids [data-run-one]').first().click();
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Edit tuk-tuk run · Thu 12 Nov');
  await expect(page.locator('#trOv .tr-run-n')).toHaveCount(0);                 // one run
  await page.evaluate(() => TransportUI.closeModal());
  await owed.locator('[data-run-edit]').click();
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Edit tuk-tuk runs · Thu 12 Nov');
  await expect(page.locator('#trOv .tr-run-n')).toHaveText('3 runs on this line — what you change applies to all 3.');
  await expect(page.locator('#rn_r')).toHaveValue('surf|Ahangama');
  // Edit: route (price follows /prices), time, driver, note.
  await page.selectOption('#rn_r', 'surf|Weligama');
  await expect(page.locator('#rn_pr')).toHaveValue('1500');
  await page.fill('#rn_pr', '1400');
  await page.fill('#rn_t', '08:15');
  await page.fill('#rn_n', 'big swell');
  await page.click('#rn_save');
  await call(st, 'trip_update', 3);
  const upd = st.calls.filter(c => c.t === 'trip_update');
  expect(upd.map(c => c.id).sort()).toEqual([R(1), R(2), R(3)]);
  expect(upd[0].body).toEqual({ notes: 'big swell', trip_time: '08:15', expected_price: 1400, route: 'Weligama' });
  await expect(page.locator('#toast')).toHaveText('3 runs saved');
  const line = page.locator('.tr-tuk-line[data-run-group]', { hasText: 'Weligama × 3' });
  await expect(line).toContainText('LKR 4,200');
  // Remove one.
  await line.locator('[data-run-edit]').click();
  await page.click('#rn_one');
  await call(st, 'trip_delete', 1);
  await expect(page.locator('.tr-tuk-line', { hasText: 'Weligama × 2' })).toHaveCount(1);
  // Delete the rest (asks first when it is more than one).
  await page.locator('.tr-tuk-line', { hasText: 'Weligama × 2' }).locator('[data-run-edit]').click();
  await expect(page.locator('#rn_del')).toHaveText('Delete 2 runs');
  await page.click('#rn_del');
  await call(st, 'trip_delete', 3);
  await expect(page.locator('#toast')).toHaveText('2 runs deleted');
  // What is left is the paid run: read-only, no delete.
  const paid = page.locator('.tr-tuk-line');
  await expect(paid).toHaveCount(1);
  await paid.click();
  await expect(page.locator('#trOv .tr-paid-note')).toContainText('Paid 12 Nov · linked automatically — unlink the payment first');
  for (const id of ['rn_d', 'rn_t', 'rn_r', 'rn_dr', 'rn_pr']) await expect(page.locator('#' + id)).toBeDisabled();
  await expect(page.locator('#rn_del')).toHaveCount(0);
  await page.click('#trOv .tr-paid-note [data-unlink]');                            // Reconcile is gone: unlink right here
  expect((await call(st, 'link_set')).body).toMatchObject({ p_entry: P.p3, p_trip_ids: [] });
  expect(st.calls.filter(c => c.t === 'trip_delete').length).toBe(3);
  expect(errors).toEqual([]);
});

// ════════════════════════════════════════════════════════════════════════════
//  Plan the day → send (17 Nov 2026). Sri Lanka marks the tuk-tuks per lesson session (Morning / Afternoon, pickup
//  07:30 / 14:00) and sends each batch at once; the afternoon never repeats the morning; a change after sending → the
//  batch is «Changed after sending — send again» and the resend lists only the change («UPDATE:»).
//  The page clock is pinned to the same instant as TRANSPORT_NOW (Fri 13 Nov 10:00 Colombo = 04:30 UTC) so «Sent 10:00» reads.
// ════════════════════════════════════════════════════════════════════════════
const fsp = require('fs');
const PLAN_SHOTS = process.env.PLAN_SHOTS || path.join(__dirname, '..', 'test-results', 'plan-shots');
async function openAt(page, opts = {}) {
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  return openTab(page, opts);
}
const sentText = async (page, i) => decodeURIComponent((await page.evaluate(n => window.__opened[n], i)).split('?text=')[1]);
const owedSampath = async page => page.evaluate(id => TransportUI._state.trips.filter(t => t.driver_id === id && TransportUI.reconcileStatus(t) === 'owed').reduce((s, t) => s + Number(t.expected_price || 0), 0), D.sampath);

test('plan the day (Sri Lanka): default TODAY, Tomorrow a tap away; «Plan the day» names the mode; Morocco-style sheet still adds timed runs', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openAt(page);
  expect(await page.evaluate(() => TransportUI.PLAN_DAY)).toBe('today');
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await expect(page.locator('#transportRoot [data-plan]')).toHaveText('Plan the day');
  await page.click('#transportRoot [data-plan]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Plan the day');
  await expect(page.locator('#tk_pday .pill')).toHaveText(['Today', 'Tomorrow']);
  await expect(page.locator('#tk_pday .pill.active')).toHaveAttribute('data-day', '2026-11-13');     // today (now = Fri 13 Nov 10:00)
  await expect(page.locator('#tk_pt')).toHaveValue('10:15');                                        // 07:30 has passed: the next quarter hour
  await page.click('#tk_pday .pill[data-day="2026-11-14"]');
  await expect(page.locator('#tk_pday .pill.active')).toHaveText('Tomorrow');
  await expect(page.locator('#tk_pt')).toHaveValue('07:30');
  await page.selectOption('#tk_pr', 'surf|Ahangama'); await page.fill('#tk_pn', '2'); await page.click('#tk_padd');
  await expect(page.locator('#tk_sent')).toHaveText('Not sent');
  await expect(page.locator('#tk_send')).toHaveText('Send to Sampath on WhatsApp');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*TUK TUKS - MORNING SAT 14 NOV · PICKUP 07:30*\n\n07:30 Camp → Ahangama ×2');
  await expect(page.locator('#tk_sent')).toHaveText('Sent 10:00 ✓ to Sampath');
  await expect(page.locator('#tk_send')).toHaveCount(0);
  await expect(page.locator('#tk_done')).toHaveClass(/btn-p/);
  expect(errors).toEqual([]);
});

test('tuk-tuks by session (Sri Lanka): tap the runs → «Send to Sampath»; the afternoon batch never repeats the morning; change / remove after sending → «Changed — send again» and an UPDATE with only the change; reload keeps it; Pay unchanged', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openAt(page);
  fsp.mkdirSync(PLAN_SHOTS, { recursive: true });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await expect(page.locator('#trDay-2026-11-13 [data-plan-state]').first()).toHaveAttribute('data-plan-state', 'none');
  await expect(page.locator('#trDay-2026-11-13 .tr-dstate')).toContainText('Not planned');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  // Morning by the clock (10:00 < 12:00), pickup 07:30; the counts are the session's
  await expect(page.locator('#tk_ses .pill.active')).toHaveText('Morning');
  await expect(page.locator('#tk_st')).toHaveValue('07:30');
  const tapK = async k => { await page.locator(`.tr-tap-main[data-key="${k}"]`).click(); await page.waitForTimeout(350); };
  await tapK('surf|Ahangama'); await tapK('surf|Ahangama'); await tapK('surf|Weligama');
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Not sent');
  await expect(page.locator('#tk_send')).toHaveText('Send to Sampath on WhatsApp');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
  await page.waitForTimeout(450); await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-run-sheet-not-sent-390.png') });
  const owed0 = await owedSampath(page);
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:30*\n\n07:30 Camp → Ahangama ×2\n07:30 Camp → Weligama ×1');
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_update').length).toBe(3);
  const ups = st.calls.filter(c => c.t === 'trip_update');
  expect(ups.every(c => c.body.sent_at && c.body.needs_resend === false && !('status' in c.body))).toBe(true);   // a done run stays done (owed)
  expect(ups[0].body.sent_snapshot).toMatchObject({ trip_date: '2026-11-13', trip_time: '07:30', label: 'Camp → Ahangama', to: 'Sampath', batch: 'morning' });
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Sent 10:00 ✓ to Sampath');
  await expect(page.locator('#tk_send')).toHaveCount(0);
  expect(await owedSampath(page)).toBe(owed0);                                       // sending never changes what is owed
  // Afternoon: its own batch, its own message
  await page.click('#tk_ses .pill[data-ses="afternoon"]');
  await expect(page.locator('#tk_st')).toHaveValue('14:00');
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('0');
  await tapK('surf|Ahangama'); await tapK('camp|Market / food');
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Not sent');
  await page.click('#tk_send');
  expect(await sentText(page, 1)).toBe('*TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 14:00*\n\n14:00 Camp → Ahangama ×1\n14:00 Market / food ×1');
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Sent 10:00 ✓ to Sampath');
  // A change after sending: one more Ahangama, Market / food removed (it is still to come: kept as cancelled for the message)
  await tapK('surf|Ahangama');
  await page.locator('.tr-tap-main[data-key="camp|Market / food"] + .tr-tap-minus').click();
  const tomb = await call(st, 'trip_update', 6);
  expect(tomb.body).toMatchObject({ status: 'cancelled', needs_resend: true });
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Changed after sending — send again');
  await expect(page.locator('#tk_batches [data-batch="afternoon"] .tr-batch-ch')).toContainText('14:00 Camp → Ahangama ×2 (was 1)');
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Sent 10:00 ✓');      // the morning is untouched
  await expect(page.locator('#tk_send')).toHaveText('Send the update to Sampath on WhatsApp');
  await page.evaluate(() => { const b = document.getElementById('tk_batches'); if (b) b.scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(450); await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-run-sheet-changed-390.png') });
  await page.click('#tk_send');
  expect(await sentText(page, 2)).toBe('*UPDATE: TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 14:00*\n\n14:00 Camp → Ahangama ×2 (was 1)\n14:00 Market / food ×1 CANCELLED');
  expect(/\p{Extended_Pictographic}/u.test(await sentText(page, 2))).toBe(false);
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_delete').length).toBe(1);      // the tombstone goes once he is told
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Sent 10:00 ✓ to Sampath');
  await page.click('#tk_done');
  // Editing a sent run that is still to come flags it: the day header asks to send again
  const aft = await page.evaluate(() => TransportUI._state.trips.filter(t => t.kind === 'tuktuk' && t.trip_time === '14:00').map(t => t.id));
  await page.evaluate(id => TransportUI.openRuns([id]), aft[0]);
  await page.fill('#rn_t', '14:30'); await page.click('#rn_save');
  await expect(page.locator('#trDay-2026-11-13 [data-batch="afternoon"]')).toHaveAttribute('data-plan-state', 'changed');
  await expect(page.locator('#trDay-2026-11-13 [data-batch="morning"]')).toHaveAttribute('data-plan-state', 'sent');
  await expect(page.locator('#trDay-2026-11-13 .tr-dstate')).toContainText('Afternoon · Changed after sending — send again');
  await expect(page.locator('.tr-strip')).toContainText('Tuk-tuk runs for today changed — send the update');
  expect(await page.evaluate(() => TransportUI.planMessage('2026-11-13', TransportUI._state.drivers.find(d => d.name === 'Sampath').id)))
    .toBe('*UPDATE: TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 14:00*\n\n14:00 Camp → Ahangama ×1 (was 2)\n14:30 Camp → Ahangama ×1 NEW');
  await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-day-header-changed-390.png'), fullPage: false });
  // Reload: the states come from the rows (sent_at / needs_resend / sent_snapshot), not from this screen
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 15000 });
  await page.evaluate(() => { showPage('transport'); TransportUI.setFilter('tuktuk'); });
  await expect(page.locator('#trDay-2026-11-13 [data-batch="afternoon"]')).toHaveAttribute('data-plan-state', 'changed');
  await expect(page.locator('#trDay-2026-11-13 [data-batch="morning"]')).toContainText('Morning · Sent 10:00 ✓ to Sampath');
  // Send straight from the day header: only the afternoon change goes
  await page.click('#trDay-2026-11-13 [data-send-day]');
  expect(await sentText(page, 0)).toBe('*UPDATE: TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 14:00*\n\n14:00 Camp → Ahangama ×1 (was 2)\n14:30 Camp → Ahangama ×1 NEW');
  await expect(page.locator('#trDay-2026-11-13 [data-batch="afternoon"]')).toHaveAttribute('data-plan-state', 'sent');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-day-header-sent-1280.png'), fullPage: false });
  // Pay: every run once, at the price it was saved with — the plan / send steps add nothing
  const runs = st.trips.filter(t => t.kind === 'tuktuk' && t.status !== 'cancelled');
  expect(runs.length).toBe(5);                                                       // 3 morning + 2 Ahangama afternoon (one moved to 14:30); Market / food removed
  await page.evaluate(id => TransportUI.payPick(id), D.sampath);
  const payIds = await page.evaluate(() => TransportUI.payGroups(TransportUI._state.payDraft).flatMap(g => g.ids));
  expect(new Set(payIds).size).toBe(payIds.length);
  for (const r of runs.filter(t => t.trip_time <= '10:00')) expect(payIds).toContain(r.id);  // the morning runs are owed (done, time passed)
  expect(errors).toEqual([]);
});

test('tuk-tuks: a run logged on a day with nothing planned still works (done, owed, Pay lists it); a past day has no «Not sent»', async ({ page }) => {
  const st = await openAt(page, { trips: [run(1), run(2)] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await expect(page.locator('#trDay-2026-11-12 .tr-dstate')).toHaveCount(0);       // yesterday: history, nothing to send
  await page.click('#transportRoot [data-add="2026-11-12"]');
  await expect(page.locator('#tk_send')).toHaveCount(0);
  await expect(page.locator('#tk_planlog')).toHaveCount(0);
  await page.locator('.tr-tap-main[data-key="surf|Weligama"]').click();
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ status: 'done', trip_date: '2026-11-12', route: 'Weligama' });
  await expect(page.locator('#tk_send')).toHaveCount(0);
  await page.click('#tk_done');
  await page.evaluate(id => TransportUI.payPick(id), D.sampath);
  const ids = await page.evaluate(() => TransportUI.payGroups(TransportUI._state.payDraft).flatMap(g => g.ids));
  expect(ids).toEqual(expect.arrayContaining([R(1), R(2), ins.id]));
});

test('tuk-tuks · a full day by hand (Sri Lanka): plan tomorrow from the run sheet → send → change → resend → the day arrives → a tap logs a planned run (no new row), «−» on a planned one, «All went as planned» → Pay (saved); owed checked at every step', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openAt(page);
  fsp.mkdirSync(PLAN_SHOTS, { recursive: true });
  const shot = async name => { for (const [w, hgt] of [[390, 844], [1280, 900]]) { await page.setViewportSize({ width: w, height: hgt }); await page.waitForTimeout(450); await page.screenshot({ path: path.join(PLAN_SHOTS, `${name}-${w}.png`) }); } await page.setViewportSize({ width: 390, height: 844 }); };
  const owed = () => owedSampath(page);
  const tapK = async k => { await page.locator(`.tr-tap-main[data-key="${k}"]`).click(); await page.waitForTimeout(350); };
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await shot('sl-1-day-header-not-planned');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await page.click('#tk_dday .pill[data-day="2026-11-14"]');                       // Tomorrow
  await expect(page.locator('#tk_d')).toHaveValue('2026-11-14');
  await page.click('#tk_ses .pill[data-ses="morning"]');
  await tapK('surf|Ahangama'); await tapK('surf|Ahangama'); await tapK('surf|Weligama');
  expect(st.calls.filter(c => c.t === 'trip_insert').map(c => c.rows[0].status)).toEqual(['planned', 'planned', 'planned']);   // a later day: planned
  await page.click('#tk_ses .pill[data-ses="afternoon"]');
  await tapK('camp|Market / food');
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Not sent');
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Not sent');
  await page.evaluate(() => { const b = document.getElementById('tk_batches'); if (b) b.scrollIntoView({ block: 'center' }); });
  await shot('sl-2-run-sheet-not-sent');
  expect(await owed()).toBe(0);
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*TUK TUKS - MORNING SAT 14 NOV · PICKUP 07:30*\n\n07:30 Camp → Ahangama ×2\n07:30 Camp → Weligama ×1\n\n*TUK TUKS - AFTERNOON SAT 14 NOV · PICKUP 14:00*\n\n14:00 Market / food ×1');
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Sent 10:00 ✓ to Sampath');
  await page.evaluate(() => { const b = document.getElementById('tk_batches'); if (b) b.scrollIntoView({ block: 'center' }); });
  await shot('sl-3-run-sheet-sent');
  // change: one Weligama less in the morning (kept as cancelled), the afternoon untouched
  await page.click('#tk_ses .pill[data-ses="morning"]');
  await page.locator('.tr-tap-main[data-key="surf|Weligama"] + .tr-tap-minus').click();
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Changed after sending — send again');
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Sent 10:00 ✓');
  await page.evaluate(() => { const b = document.getElementById('tk_batches'); if (b) b.scrollIntoView({ block: 'center' }); });
  await shot('sl-4-run-sheet-changed');
  await page.click('#tk_done');
  await page.evaluate(() => TransportUI.shiftWeek(7));                                 // Sat 14 Nov starts the next camp week
  await expect(page.locator('#trDay-2026-11-14 [data-batch="morning"]')).toHaveAttribute('data-plan-state', 'changed');
  await expect(page.locator('.tr-strip [data-chip="order"]')).toHaveText('Tuk-tuk runs for tomorrow changed — send the update');
  await shot('sl-5-day-header-changed');
  await page.click('.tr-strip [data-chip="order"]');                                  // the chip opens the run sheet on that day
  await expect(page.locator('#tk_d')).toHaveValue('2026-11-14');
  await page.click('#tk_send');
  expect(await sentText(page, 1)).toBe('*UPDATE: TUK TUKS - MORNING SAT 14 NOV · PICKUP 07:30*\n\n07:30 Camp → Weligama ×1 CANCELLED');
  await page.click('#tk_done');
  await expect(page.locator('#trDay-2026-11-14 [data-batch="morning"]')).toContainText('Morning · Sent 10:00 ✓ to Sampath');
  await expect(page.locator('#trDay-2026-11-14 [data-batch="afternoon"]')).toContainText('Afternoon · Sent 10:00 ✓ to Sampath');
  await shot('sl-6-day-header-sent');
  expect(await owed()).toBe(0);                                                      // nothing has happened yet
  // the day arrives: Sat 14 Nov 16:00
  await page.clock.setFixedTime(new Date('2026-11-14T10:30:00Z'));
  await page.evaluate(() => { window.TRANSPORT_NOW = '2026-11-14T16:00'; TransportUI.render(); });
  const market = await page.evaluate(() => TransportUI._state.trips.find(t => t.route === 'Market / food').expected_price);
  expect(await owed()).toBe(500 + 500 + market);                                    // planned runs are owed once their time has passed
  const n0 = st.trips.filter(t => t.kind === 'tuktuk').length;
  await page.click('#transportRoot [data-add="2026-11-14"]');
  await expect(page.locator('#tk_planlog')).toHaveAttribute('data-n', '3');
  await page.click('#tk_ses .pill[data-ses="morning"]');
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-plan')).toHaveText('+2 planned');
  await tapK('surf|Ahangama');                                                       // logs one of the planned ones: the same row
  expect(st.trips.filter(t => t.kind === 'tuktuk').length).toBe(n0);
  expect(st.calls.filter(c => c.t === 'trip_update').pop().body).toMatchObject({ status: 'done' });
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('1');
  await expect(page.locator('.tr-tap-main[data-key="surf|Ahangama"] .tr-tap-plan')).toHaveText('+1 planned');
  await page.click('#tk_ses .pill[data-ses="afternoon"]');
  await page.locator('.tr-tap-main[data-key="camp|Market / food"] + .tr-tap-minus').click();   // the market run did not happen
  await expect.poll(() => st.trips.filter(t => t.route === 'Market / food').length).toBe(0);
  expect(await owed()).toBe(1000);
  await expect(page.locator('#tk_allplan')).toBeVisible();
  await shot('sl-7-log-sheet-planned');
  await page.click('#tk_allplan');
  await expect(page.locator('#tk_allplan')).toHaveCount(0);
  expect(st.trips.filter(t => t.kind === 'tuktuk').map(t => t.status).sort()).toEqual(['done', 'done']);
  expect(st.trips.filter(t => t.kind === 'tuktuk').length).toBe(n0 - 1);
  expect(await owed()).toBe(1000);
  await page.click('#tk_done');
  // Pay: the two Ahangama runs, once, saved
  await page.click(`#trOwed [data-owed="${D.sampath}"]`);
  const ids = await page.evaluate(() => TransportUI.payGroups(TransportUI._state.payDraft).flatMap(g => g.ids));
  expect(ids.length).toBe(2);
  await shot('sl-8-pay-after-plan');
  await page.click('#py_save');
  const pay = (await call(st, 'pay')).body;
  expect(pay.p_typed_amount).toBe(1000);
  expect(pay.p_entries.flatMap(e => e.trip_ids).sort()).toEqual(ids.slice().sort());
  expect(errors).toEqual([]);
});

test('local view (Nadith): changes a sent run and sends the update', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const st = await open(page, { query: '&view=local', trips: [
    run(11, { trip_date: '2026-11-13', trip_time: '14:00', route: 'Market / food', purpose: 'food', expected_price: 0, status: 'done', sent_at: '2026-11-13T04:00:00Z', sent_snapshot: { trip_date: '2026-11-13', trip_time: '14:00', label: 'Market / food', to: 'Sampath', batch: 'afternoon' } }),
  ] });
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await expect(page.locator('#trDay-2026-11-13 [data-batch="afternoon"]')).toContainText('Afternoon · Sent 09:30 ✓ to Sampath');
  await page.locator('#trDay-2026-11-13 .tr-dstate-b').first().click();
  await page.click('#tk_ses .pill[data-ses="afternoon"]');
  await page.locator('.tr-tap-main[data-key="camp|Market / food"]').click();
  await call(st, 'trip_insert');
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Changed after sending — send again');
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*UPDATE: TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 14:00*\n\n14:00 Market / food ×2 (was 1)');
  await expect(page.locator('#tk_batches [data-batch="afternoon"]')).toContainText('Sent 10:00 ✓');
});

test('airport week line (Sri Lanka): after «Send the whole week» + «Mark all sent ✓» the week reads sent — next week\'s Saturday arrival is not counted; a change after → «N changed since» and the week UPDATE lists only it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const st = await openTab(page, { trips: [
    trip({ id: R(401), guest_names: 'Week Guest', guest_phone: '+491700000041', trip_date: '2026-11-16', trip_time: '10:00', flight: 'QR1' }),
    trip({ id: R(402), kind: 'airport_departure', guest_names: 'Leaving Saturday', guest_phone: '+491700000042', trip_date: '2026-11-21', trip_time: '15:00', flight: 'QR2' }),
    trip({ id: R(403), guest_names: 'Next Week Arrival', trip_date: '2026-11-21', trip_time: '10:00', flight: 'QR3' }),
  ] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await expect(page.locator('#transportRoot [data-week-sent]')).toHaveText('Week not sent yet');
  await page.click('#transportRoot [data-send-week]');
  await page.click('#transportRoot [data-week-tick]');
  await call(st, 'trip_update', 2);
  await expect(page.locator('#transportRoot [data-week-sent]')).toHaveText('Week sent 13 Nov 10:00 ✓');
  await expect(page.locator('#transportRoot [data-send-week-update]')).toHaveCount(0);
  await expect(page.locator('#trDay-2026-11-21 [data-air-state]')).toHaveText('Sent 10:00 ✓ to Nadith');   // the closing Saturday: its departure only
  // a time changes after sending (as the trip sheet stores it: the new time + needs_resend)
  await page.evaluate(id => { const t = TransportUI._state.trips.find(x => x.id === id); t.trip_time = '11:30'; t.needs_resend = true; TransportUI.render(); }, R(401));
  await expect(page.locator('#transportRoot [data-week-sent]')).toHaveText('Week sent 13 Nov 10:00 · 1 changed since');
  await page.click('#transportRoot [data-send-week-update]');
  const txt = decodeURIComponent((await page.evaluate(() => window.__opened.pop())).split('?text=')[1]);
  expect(txt).toBe('*UPDATE: TRANSFERS - 14 TO 21 NOV*\n\n*MON 16 NOV*\n\nAirport to Camp _(changed: time 10:00 → 11:30)_\nWeek Guest\n+491700000041\n1 person\nFlight Number: QR1\nTime: 11:30\nDate: 16 Nov\nSmall Car');
});

// ── QA 17 Nov 2026 (independent review of the plan → send branch): one test per bug ─────────────────────────
const QSNAP = (time, label = 'Camp → Ahangama') => ({ trip_date: '2026-11-13', trip_time: time, label, to: 'Sampath', batch: time < '12:00' ? 'morning' : 'afternoon' });
const sentRun = (n, time, o = {}) => run(n, { trip_date: '2026-11-13', trip_time: time, status: 'done', sent_at: '2026-11-13T01:30:00Z', sent_snapshot: QSNAP(time), ...o });
const batchKey = (page, b) => page.evaluate(b => TransportUI.batchesOf('2026-11-13', TransportUI._state.drivers.find(d => d.name === 'Sampath').id).find(x => x.batch === b).key, b);
const runMsg = page => page.evaluate(() => TransportUI.planMessage('2026-11-13', TransportUI._state.drivers.find(d => d.name === 'Sampath').id));

test('QA bug 1: a run marked late into a session already sent (morning sent 07:00, tapped at 10:00) is NEW — «Changed», Send, the UPDATE names it', async ({ page }) => {
  const st = await openAt(page, { trips: [sentRun(1, '07:30')] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await expect(page.locator('#tk_ses .pill.active')).toHaveText('Morning');
  await page.locator('.tr-tap-main[data-key="surf|Weligama"]').click();
  await call(st, 'trip_insert');
  await expect.poll(() => batchKey(page, 'morning')).toBe('changed');
  await expect(page.locator('#tk_send')).toHaveText('Send the update to Sampath on WhatsApp');
  expect(await runMsg(page)).toBe('*UPDATE: TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:30*\n\n07:30 Camp → Weligama ×1 NEW');
});

test('QA bug 2: removed after sending and tapped again before the update → the same row comes back, nothing to send (no empty UPDATE)', async ({ page }) => {
  const st = await openAt(page, { trips: [sentRun(1, '14:00')] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await page.click('#tk_ses .pill[data-ses="afternoon"]');
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"] + .tr-tap-minus').click();
  expect((await call(st, 'trip_update')).body).toMatchObject({ status: 'cancelled', needs_resend: true });
  await expect.poll(() => batchKey(page, 'afternoon')).toBe('changed');
  await page.waitForTimeout(350);
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"]').click();
  expect((await call(st, 'trip_update', 2)).body).toMatchObject({ status: 'done', needs_resend: false });
  expect(st.calls.filter(c => c.t === 'trip_insert').length).toBe(0);
  await expect.poll(() => batchKey(page, 'afternoon')).toBe('sent');
  await expect(page.locator('#tk_send')).toHaveCount(0);
  expect(await runMsg(page)).toBe('');
  // a tombstone and a new row on the same line (as another computer could leave them): «Sent», never an empty UPDATE
  await page.evaluate(id => { const t = TransportUI._state.trips.find(x => x.id === id); Object.assign(t, { status: 'cancelled', needs_resend: true }); TransportUI._state.trips.push({ ...t, id: 'aaaaaaaa-0000-4000-8000-00000000c999', status: 'done', needs_resend: false, sent_at: null, sent_snapshot: null }); }, R(1));
  expect(await batchKey(page, 'afternoon')).toBe('sent');
});

test('QA bug 3: Sri Lanka — a marked (done) run moved to tomorrow is planned again: not owed, not payable today; planned today is done (as a tap)', async ({ page }) => {
  const st = await openAt(page, { trips: [run(1, { trip_date: '2026-11-13', trip_time: '14:00', status: 'done' }), sentRun(2, '14:00', { route: 'Weligama', expected_price: 1500, sent_snapshot: QSNAP('14:00', 'Camp → Weligama') })] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.evaluate(id => TransportUI.openRuns([id]), R(1));
  await page.fill('#rn_d', '2026-11-14'); await page.click('#rn_save');
  expect((await call(st, 'trip_update')).body).toMatchObject({ trip_date: '2026-11-14', status: 'planned' });
  await expect.poll(() => page.evaluate(id => TransportUI.reconcileStatus(TransportUI._state.trips.find(t => t.id === id)), R(1))).toBe('upcoming');
  // a sent one moved to tomorrow: cancelled here (UPDATE), planned there — never done before it happens
  await page.evaluate(id => TransportUI.openRuns([id]), R(2));
  await page.fill('#rn_d', '2026-11-14'); await page.click('#rn_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ trip_date: '2026-11-14', status: 'planned', route: 'Weligama' });
  await call(st, 'trip_update', 2);
  await expect(page.locator('#trOv.open')).toHaveCount(0);
  await page.evaluate(id => TransportUI.payPick(id), D.sampath);
  const ids = await page.evaluate(() => TransportUI.payGroups(TransportUI._state.payDraft).flatMap(g => g.ids));
  expect(ids).not.toContain(R(1)); expect(ids).not.toContain(ins.id);
  await page.evaluate(() => TransportUI.closeModal());
  // «Plan the day» on today saves done (the same as a tap in the run sheet)
  await page.click('#transportRoot [data-plan]');
  await expect(page.locator('#tk_pday .pill.active')).toHaveAttribute('data-day', '2026-11-13');
  await page.fill('#tk_pt', '15:00'); await page.selectOption('#tk_pr', 'surf|South Beach'); await page.click('#tk_padd');
  expect((await call(st, 'trip_insert', 2)).rows[0]).toMatchObject({ trip_date: '2026-11-13', route: 'South Beach', status: 'done' });
});

test('QA airport: the closing Saturday — «Send the update» and «Mark all sent ✓» see only that week\'s departure (as its badge); the chip says «changed — resend»', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const sentAt = '2026-11-12T13:00:00Z';
  const st = await openTab(page, { trips: [
    trip({ id: R(501), kind: 'airport_departure', guest_names: 'Leaving Saturday', guest_phone: '+491700000051', trip_date: '2026-11-21', trip_time: '15:00', flight: 'QR2', status: 'sent', sent_at: sentAt, needs_resend: true, sent_snapshot: { trip_date: '2026-11-21', trip_time: '14:00', flight: 'QR2', pax: 1, place: 'CMB' } }),
    trip({ id: R(502), guest_names: 'Next Week Arrival', guest_phone: '+491700000052', trip_date: '2026-11-21', trip_time: '10:00', flight: 'QR3' }),
  ] });
  await expect(page.locator('.tr-strip')).toContainText('1 changed — resend');
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const sat = page.locator('#trDay-2026-11-21');
  await expect(sat.locator('[data-air-state]')).toHaveText('Changed after sending — send again · 1');
  await sat.locator('[data-send-update]').click();
  const txt = decodeURIComponent((await page.evaluate(() => window.__opened.pop())).split('?text=')[1]);
  expect(txt).toContain('Leaving Saturday'); expect(txt).not.toContain('Next Week Arrival');
  await sat.locator('[data-tick-day]').click();
  await call(st, 'trip_update');
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => c.t === 'trip_update').map(c => c.id)).toEqual([R(501)]);
  // the week bar: one blue button, the whole week as a link, one status line
  await expect(page.locator('#transportRoot .tr-weekacts .btn-p')).toHaveCount(1);
  await expect(page.locator('#transportRoot [data-week-count] [data-week-sent]')).toHaveCount(1);
});

test('QA UX: «Not planned» only on today / tomorrow; the Sri Lanka run sheet shows the sessions on top; the footer is one row at 390', async ({ page }) => {
  const st = await openAt(page, { trips: [sentRun(1, '07:30')] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await expect(page.locator('#trDay-2026-11-14 .tr-dstate')).toContainText('Not planned');            // tomorrow
  await expect(page.locator('#trDay-2026-11-16 .tr-dstate')).toHaveCount(0);                          // an empty later day: nothing
  await page.evaluate(() => TransportUI.shiftWeek(-7));
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await page.locator('.tr-tap-main[data-key="surf|Weligama"]').click();
  await call(st, 'trip_insert');
  const top = await page.evaluate(() => { const b = document.getElementById('tk_batches'), d = document.getElementById('tk_dday'); return !!b && !!d && (b.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; });
  expect(top).toBe(true);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#trOv .mfooter .btn')].map(b => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(rows).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('drivers: «Tuk-tuk orders to» — the order goes to that contact, else to the default tuk-tuk driver', async ({ page }) => {
  const st = await openTab(page, { trips: [run(1, { trip_date: '2026-11-14', status: 'planned' })] });
  await page.click('button:has-text("Drivers")');
  await expect(page.locator('#dv_tuk')).toHaveValue('');
  await expect(page.locator('#dv_tuk option').first()).toHaveText('Default tuk-tuk driver (Sampath)');
  await page.selectOption('#dv_tuk', D.nadith);
  await page.click('#trOv .btn-p');
  const upd = await call(st, 'driver_update');
  expect(upd.id).toBe(D.nadith);
  expect(upd.body.default_for.sort()).toEqual(['transfers_contact', 'tuktuk_contact']);
  await expect(page.locator('#toast')).toHaveText('Drivers saved');
  await page.evaluate(() => TransportUI.openPlan('2026-11-14'));
  await expect(page.locator('#tk_send')).toHaveText('Send to Nadith on WhatsApp');
  await page.click('#tk_send');
  await call(st, 'trip_update');
  expect(await page.evaluate(() => window.__opened[0])).toContain('https://wa.me/94771234567?text=' + encodeURIComponent('*TUK TUKS - MORNING SAT 14 NOV · PICKUP 07:30*'));
});

test('airport (Sri Lanka): the day header — Not sent / Sent ✓ to the contact / Changed after sending · N; «Send the update» lists only new, changed and cancelled transfers; «Mark all sent ✓» clears exactly those; the week line', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const sentAt = '2026-11-12T13:00:00Z';   // 12 Nov 18:30 Colombo
  const snap = { trip_date: '2026-11-14', trip_time: '01:55', flight: 'QR658', pax: 1, place: 'CMB' };
  const st = await openAt(page, { trips: [
    trip({ id: R(201), guest_names: 'Same Guest', guest_phone: '+491700000001', trip_time: '01:55', flight: 'QR658', status: 'sent', sent_at: sentAt, sent_snapshot: snap }),
    trip({ id: R(202), guest_names: 'Moved Guest', guest_phone: '+491700000002', trip_time: '15:30', flight: 'QR654', status: 'confirmed', sent_at: sentAt, needs_resend: true, sent_snapshot: { ...snap, trip_time: '14:10', flight: 'QR654' } }),
    trip({ id: R(203), guest_names: 'Gone Guest', guest_phone: '+491700000003', trip_time: '09:00', flight: 'EK1', status: 'cancelled', sent_at: sentAt, needs_resend: true, sent_snapshot: { ...snap, trip_time: '09:00', flight: 'EK1' } }),
    trip({ id: R(204), guest_names: 'New Guest', guest_phone: '+491700000004', trip_time: '11:00', flight: 'EK2' }),
    trip({ id: R(205), guest_names: 'Sunday Guest', guest_phone: '+491700000005', trip_date: '2026-11-15', trip_time: '11:00', flight: 'EK3' }),
  ] });
  fsp.mkdirSync(PLAN_SHOTS, { recursive: true });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const sat = page.locator('#trDay-2026-11-14');
  await expect(sat.locator('[data-air-state]')).toHaveAttribute('data-air-state', 'changed');
  await expect(sat.locator('[data-air-state]')).toHaveText('Changed after sending — send again · 3');
  await expect(page.locator('#trDay-2026-11-15 [data-air-state]')).toHaveText('Not sent');
  await expect(page.locator('#transportRoot [data-week-sent]')).toHaveText('Week sent 12 Nov 18:30 · 3 changed since · 1 not sent');
  await expect(page.locator('#transportRoot [data-send-week-update]')).toHaveText('Send the week update');
  await page.waitForTimeout(450); await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-airport-changed-390.png'), fullPage: true });
  await sat.locator('[data-send-update]').click();
  expect(await sentText(page, 0)).toBe([
    '*UPDATE: TRANSFERS TOMORROW - 14 NOV*',
    'Airport to Camp _(CANCELLED)_\nGone Guest\n+491700000003\n1 person\nFlight Number: EK1\nTime: 09:00\nDate: 14 Nov\nSmall Car',
    'Airport to Camp _(new)_\nNew Guest\n+491700000004\n1 person\nFlight Number: EK2\nTime: 11:00\nDate: 14 Nov\nSmall Car',
    'Airport to Camp _(changed: time 14:10 → 15:30)_\nMoved Guest\n+491700000002\n1 person\nFlight Number: QR654\nTime: 15:30\nDate: 14 Nov\nSmall Car',
  ].join('\n\n'));
  // the whole day stays available, byte for byte as before
  await expect(sat.locator('button:has-text("Send the whole day")')).toHaveCount(1);
  await sat.locator('[data-tick-day]').click();
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_update').length).toBe(3);
  const by = id => st.calls.filter(c => c.t === 'trip_update' && c.id === id).pop().body;
  expect(by(R(202))).toMatchObject({ status: 'confirmed', needs_resend: false });       // a Confirmed one stays Confirmed
  expect(by(R(203))).toMatchObject({ needs_resend: false }); expect(by(R(203)).status).toBeUndefined();
  expect(by(R(204))).toMatchObject({ status: 'sent', needs_resend: false });
  await expect(sat.locator('[data-air-state]')).toHaveText('Sent 10:00 ✓ to Nadith');
  await expect(page.locator('#transportRoot [data-week-sent]')).toHaveText('Week sent 13 Nov 10:00 ✓ · 1 not sent');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-airport-sent-1280.png'), fullPage: false });
  // cancelling a sent transfer by hand → the day asks again
  await page.evaluate(id => TransportUI.setStatus(id, 'cancelled'), R(201));
  await expect(sat.locator('[data-air-state]')).toHaveText('Changed after sending — send again · 1');
  expect(errors).toEqual([]);
});

test('local view (Nadith): the tuk-tuk day header, mark → send, no price edit; the airport state is shown without a button', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const st = await open(page, { query: '&view=local', trips: [trip({ id: R(301), guest_names: 'Air Guest', trip_date: '2026-11-13', trip_time: '22:00', flight: 'QR1' })] });
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  const day = page.locator('#trDay-2026-11-13');
  await expect(day.locator('[data-plan-state]').first()).toHaveAttribute('data-plan-state', 'none');
  await expect(day.locator('[data-air-state]')).toHaveText('Not sent');
  await expect(day.locator('[data-send-update], [data-tick-day]')).toHaveCount(0);
  await expect(page.locator('#transportRoot [data-plan]')).toHaveText('Plan the day');
  await day.locator('.tr-dstate-b').first().click();                                  // the badge opens the run sheet
  await page.locator('.tr-tap-main[data-key="camp|Laundry"]').click();
  await call(st, 'trip_insert');
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:30*\n\n07:30 Laundry ×1');
  await expect(page.locator('#tk_batches [data-batch="morning"]')).toContainText('Sent 10:00 ✓');
  await page.click('#tk_done');
  await page.locator('#transportRoot .tr-tuk-line').first().click();
  await expect(page.locator('#rn_pr')).toBeDisabled();
  expect(errors).toEqual([]);
});

// ── Run areas and run times (Miguel, 17 Nov 2026) ─────────────────────────────────────────────────────────────
test('run areas (Sri Lanka): Nadith (?view=local) taps / plans / sends only the camp runs — surf and tours are read-only there and left out of his Send; Francisco\'s Send has the surf runs', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const surf = run(21, { trip_date: '2026-11-13', trip_time: '07:30', status: 'done' });           // marked by Francisco, not sent yet
  const tour = run(22, { trip_date: '2026-11-13', trip_time: '07:30', status: 'done', route: 'River Safari', purpose: 'tour', tour_name: 'River Safari', expected_price: 1000 });
  const st = await open(page, { query: '&view=local', trips: [surf, tour] });
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  fsp.mkdirSync(PLAN_SHOTS, { recursive: true });
  await page.locator('#trDay-2026-11-13 .tr-dstate-b').first().click();
  await expect(page.locator('.tr-tap-ro[data-ro="surf"]')).toHaveCount(3);                     // Ahangama, Weligama, South Beach
  await expect(page.locator('.tr-tap-ro[data-ro="tours"]')).toHaveCount(2);
  await expect(page.locator('button.tr-tap-main[data-key="surf|Ahangama"]')).toHaveCount(0);
  await expect(page.locator('.tr-tap-ro .tr-tap-main[data-key="surf|Ahangama"] .tr-tap-n')).toHaveText('1');   // visible, not his
  await page.evaluate(() => TransportUI.tap('surf|Ahangama'));
  await page.evaluate(() => TransportUI.untap('surf|Ahangama'));
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => ['trip_insert', 'trip_update', 'trip_delete'].includes(c.t))).toEqual([]);
  await expect(page.locator('#tk_send')).toHaveCount(0);                                          // nothing of his to send
  await page.locator('button.tr-tap-main[data-key="camp|Market / food"]').click();
  await call(st, 'trip_insert');
  await expect(page.locator('#tk_send')).toHaveText('Send to Sampath on WhatsApp');
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-nadith-run-sheet-390.png') });
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:30*\n\n07:30 Market / food ×1');   // only his camp run
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_update').length).toBe(1);
  expect(st.calls.find(c => c.t === 'trip_update').id).not.toBe(R(21));
  // «Plan the day»: only camp runs to add; a surf line is shown without + / −
  await page.click('#tk_mode .pill:has-text("Plan the day")');
  const opts = await page.locator('#tk_pr option').allInnerTexts();
  expect(opts.length).toBe(4); expect(opts.every(o => /^(Market \/ food|Laundry|Staff|Errand)/.test(o))).toBe(true);
  await expect(page.locator('#tk_plan .tr-step-ro[data-ro="surf"]')).toHaveCount(1);
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-nadith-plan-sheet-390.png') });
  await page.evaluate(() => TransportUI.closeModal());
  // a surf run from the Trips list: read-only for him
  await page.evaluate(id => TransportUI.openRuns([id]), R(21));
  await expect(page.locator('[data-ro-run]')).toBeVisible();
  await expect(page.locator('#rn_save, #rn_del')).toHaveCount(0);
  await expect(page.locator('#rn_t')).toBeDisabled();
  // Francisco (full view) on the same rows: his Send has the surf run (the tour is his too; the camp run is already sent)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  await openTab(p2, { trips: st.trips.map(t => ({ ...t })) });
  expect(await p2.evaluate(id => TransportUI.planMessage('2026-11-13', id), D.sampath))
    .toBe('*UPDATE: TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:30*\n\n07:30 Camp → Ahangama ×1 NEW\n07:30 Tour · River Safari ×1 NEW');
  await ctx.close();
  expect(errors).toEqual([]);
});

test('run times (Sri Lanka): the time picker before tapping — the run takes it and the message shows it; a time after 12:00 moves to the Afternoon session', async ({ page }) => {
  const st = await openAt(page);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await expect(page.locator('#tk_st')).toHaveValue('07:30');
  await page.fill('#tk_st', '07:45'); await page.locator('#tk_st').dispatchEvent('change');
  await expect(page.locator('#tk_st')).toHaveValue('07:45');
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"]').click();
  expect((await call(st, 'trip_insert')).rows[0]).toMatchObject({ trip_time: '07:45', status: 'done' });
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(PLAN_SHOTS, 'sl-time-picker-390.png') });
  await page.fill('#tk_st', '15:10'); await page.locator('#tk_st').dispatchEvent('change');
  await expect(page.locator('#tk_ses .pill.active')).toHaveText('Afternoon');
  await page.locator('.tr-tap-main[data-key="surf|Weligama"]').click();
  expect((await call(st, 'trip_insert', 2)).rows[0]).toMatchObject({ trip_time: '15:10' });
  await page.click('#tk_send');
  expect(await sentText(page, 0)).toBe('*TUK TUKS - MORNING FRI 13 NOV · PICKUP 07:45*\n\n07:45 Camp → Ahangama ×1\n\n*TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 15:10*\n\n15:10 Camp → Weligama ×1');
});

test('QA re-check: closing Saturday «Send the whole day» sends only that week\'s departure (next week\'s arrival goes with next week); «Mark all sent ✓» ticks the same', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const st = await openTab(page, { trips: [
    trip({ id: R(601), kind: 'airport_departure', guest_names: 'Leaving Saturday', guest_phone: '+491700000061', trip_date: '2026-11-21', trip_time: '15:00', flight: 'QR2' }),
    trip({ id: R(602), guest_names: 'Next Week Arrival', guest_phone: '+491700000062', trip_date: '2026-11-21', trip_time: '10:00', flight: 'QR3' }),
  ] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const sat = page.locator('#trDay-2026-11-21');
  await sat.locator('button:has-text("Send the whole day")').click();
  const txt = decodeURIComponent((await page.evaluate(() => window.__opened.pop())).split('?text=')[1]);
  expect(txt).toContain('Leaving Saturday'); expect(txt).not.toContain('Next Week Arrival');
  await sat.locator('[data-tick-day]').click();
  await call(st, 'trip_update');
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => c.t === 'trip_update').map(c => c.id)).toEqual([R(601)]);
  // next week: the arrival is still to send, alone
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await expect(page.locator('#trDay-2026-11-21 [data-air-state]')).toHaveText('Not sent');
  await page.locator('#trDay-2026-11-21 button:has-text("Send the whole day")').click();
  const nxt = decodeURIComponent((await page.evaluate(() => window.__opened.pop())).split('?text=')[1]);
  expect(nxt).toContain('Next Week Arrival'); expect(nxt).not.toContain('Leaving Saturday');
});

test('QA re-check: a planned run and a removed (tombstone) one on the same route — a tap logs the planned run first; only the next tap brings the removed one back (one tap = one run)', async ({ page }) => {
  const sent = { sent_at: '2026-11-13T01:30:00Z', sent_snapshot: { trip_date: '2026-11-13', trip_time: '14:00', label: 'Camp → Ahangama', to: 'Sampath', batch: 'afternoon' } };
  const st = await openAt(page, { trips: [
    run(31, { trip_date: '2026-11-13', trip_time: '14:00', status: 'sent', ...sent }),
    run(32, { trip_date: '2026-11-13', trip_time: '14:00', status: 'cancelled', needs_resend: true, ...sent }),
  ] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tuktuk"]');
  await page.click('#transportRoot [data-add-runs="tuktuk"]');
  await page.click('#tk_ses .pill[data-ses="afternoon"]');
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"]').click();
  const u1 = await call(st, 'trip_update');
  expect(u1.id).toBe(R(31)); expect(u1.body).toMatchObject({ status: 'done' });
  await page.waitForTimeout(400);
  await page.locator('.tr-tap-main[data-key="surf|Ahangama"]').click();
  const u2 = await call(st, 'trip_update', 2);
  expect(u2.id).toBe(R(32)); expect(u2.body).toMatchObject({ status: 'done', needs_resend: false });
  expect(st.calls.filter(c => c.t === 'trip_insert').length).toBe(0);
});

test('final QA: Nadith\'s Send never carries Francisco\'s surf cancellation; Pay «−» on a run the driver has (still to come) keeps it as CANCELLED for the next Send; in the local view Pay adds / removes only his areas', async ({ page, browser }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const snap = (label) => ({ trip_date: '2026-11-13', trip_time: '14:00', label, to: 'Sampath', batch: 'afternoon' });
  const trips = [
    run(41, { trip_date: '2026-11-13', trip_time: '14:00', status: 'cancelled', needs_resend: true, sent_at: '2026-11-13T01:30:00Z', sent_snapshot: snap('Camp → Ahangama') }),   // Francisco removed a surf run
    run(42, { trip_date: '2026-11-13', trip_time: '14:00', status: 'done', route: 'Market / food', purpose: 'food', expected_price: 300, sent_at: '2026-11-13T01:30:00Z', sent_snapshot: snap('Market / food') }),
    run(43, { trip_date: '2026-11-12', trip_time: '07:30', status: 'done' }),                                                                           // a surf run owed (yesterday)
  ];
  const st = await open(page, { query: '&view=local', trips });
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  const key = (p) => p.evaluate(id => TransportUI.batchesOf('2026-11-13', id).find(x => x.batch === 'afternoon').key, D.sampath);
  expect(await key(page)).toBe('sent');                                                       // he does not see Francisco's change
  expect(await page.evaluate(id => TransportUI.planMessage('2026-11-13', id), D.sampath)).toBe('');
  // Pay (local): the surf group has no «−»; «Run not in the list» offers only his camp runs
  await page.evaluate(id => TransportUI.payPick(id), D.sampath);
  await expect(page.locator('#trOv [data-pay-group*="Ahangama"] [data-pay-minus]')).toHaveCount(0);
  await page.evaluate(() => TransportUI.payMinus(TransportUI.payGroups(TransportUI._state.payDraft).find(g => /Ahangama/.test(g.key)).key));
  await page.waitForTimeout(300);
  expect(st.calls.filter(c => ['trip_delete', 'trip_update'].includes(c.t))).toEqual([]);
  await page.click('#py_add');
  const opts = await page.locator('#py_ar option').allInnerTexts();
  expect(opts.every(o => /^(Market \/ food|Laundry|Staff|Errand)/.test(o))).toBe(true);
  // Francisco: Pay «−» on the market run he sent (still to come) → kept as cancelled, the next Send says so
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  const st2 = await openTab(p2, { trips: trips.map(t => ({ ...t })) });
  expect(await key(p2)).toBe('changed');                                                      // he sees his own cancellation
  await p2.evaluate(id => TransportUI.payPick(id), D.sampath);
  await p2.locator('#trOv [data-pay-group*="Market"] [data-pay-minus]').click();
  expect((await call(st2, 'trip_update')).body).toMatchObject({ status: 'cancelled', needs_resend: true });
  expect(st2.calls.filter(c => c.t === 'trip_delete').length).toBe(0);
  await expect.poll(() => p2.evaluate(id => TransportUI.planMessage('2026-11-13', id), D.sampath))
    .toBe('*UPDATE: TUK TUKS - AFTERNOON FRI 13 NOV · PICKUP 14:00*\n\n14:00 Camp → Ahangama ×1 CANCELLED\n14:00 Market / food ×1 CANCELLED');
  await ctx.close();
});

test('free: a transfer for staff or a gift — Add a free airport transfer (Staff), mark a trip Free with its reason, delete one added by hand', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, { trips: NEXT_WEEK() });
  await page.evaluate(() => TransportUI.openAddTransfer());
  await page.click('#at_fr .pill:has-text("Staff")');
  await page.fill('#at_g', 'Kasun');
  await page.fill('#at_d', '2026-11-15');
  await page.fill('#at_n', 'visa run');
  await page.click('#at_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'airport_arrival', guest_names: 'Kasun', purpose: 'staff', charge: 'free', free_reason: 'staff', notes: 'visa run', expected_price: 21000, source: 'manual' });
  const mine = page.locator('.tr-row', { hasText: 'Kasun' });
  await expect(mine.locator('.tr-free')).toHaveText('Free · Staff');
  // A Bookinglayer transfer becomes a gift.
  await page.click('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"] .tr-line1 b');
  await expect(page.locator('#tr_del')).toHaveCount(0);                             // imported trips are cancelled, never deleted
  await page.click('#tr_ch .pill:has-text("Free")');
  await page.click('#tr_fr .pill:has-text("Gift to guest")');
  await page.click('#trOv .btn-p');
  expect((await call(st, 'trip_update')).body).toEqual({ charge: 'free', free_reason: 'gift' });   // not an import field: edited_fields untouched
  await expect(page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"] .tr-free')).toHaveText('Free · Gift');
  // … and back to «In booking».
  await page.click('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"] .tr-line1 b');
  await page.click('#tr_ch .pill:has-text("In booking")');
  await page.click('#trOv .btn-p');
  expect((await call(st, 'trip_update', 2)).body).toEqual({ charge: 'bookinglayer', free_reason: null });
  // The transfer added by hand can be deleted while unpaid.
  await mine.locator('.tr-line1 b').click();
  await page.click('#tr_del');
  await call(st, 'trip_delete');
  await expect(page.locator('.tr-row', { hasText: 'Kasun' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('free: before the database update (no free_reason column) the save is repeated without it — nothing lost, no error', async ({ page }) => {
  const st = await openTab(page, { trips: NEXT_WEEK().map(t => { const { free_reason, ...r } = t; return r; }), noFreeColumn: true });
  await page.evaluate(() => TransportUI.openAddTransfer());
  await page.click('#at_fr .pill:has-text("Staff")');
  await page.fill('#at_g', 'Kasun');
  await page.fill('#at_d', '2026-11-15');
  await page.click('#at_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins.charge).toBe('free');
  expect('free_reason' in ins).toBe(false);
  expect(st.calls.filter(c => c.t === 'free_refused').length).toBe(1);
  await expect(page.locator('#toast')).toHaveText('Free transfer added');
  await expect(page.locator('.tr-row', { hasText: 'Kasun' }).locator('.tr-free')).toHaveText('Free');
});

// ════════════════════════════════════════════════════════════════════════════
//  Scenario fixes (sl_design/transport_scenarios.md), named after their ids.
//  The database side of each (import, automatic link) is checked in PGlite:
//  scratchpad/tv2/sql_check_v2.mjs.
// ════════════════════════════════════════════════════════════════════════════
const A = n => `aaaaaaaa-0000-4000-8000-00000000d${String(n).padStart(3, '0')}`;
const nextWeekFlags = () => [
  trip({ id: A(1), guest_names: 'Callum Downes', trip_time: '12:35', flight: 'UL504', booking_ref: '2026-4360', import_key: 'bl:2026-4360:arr' }),
  trip({ id: A(2), guest_names: 'Maximilian Ehrler', trip_time: '08:20', flight: 'QR664', booking_ref: '2026-4936', import_key: 'bl:2026-4936:arr', missing_since: '2026-11-13' }),                                  // A6: booking gone from the file
  trip({ id: A(3), guest_names: 'Lorena Marie Glas', trip_time: '07:00', flight: 'QR658', booking_ref: '2026-4660', import_key: 'bl:2026-4660:arr', missing_since: '2026-11-13', import_flags: ['transfer removed in Bookinglayer — cancel it?'] }),   // A7
  trip({ id: A(4), guest_names: 'Emilia Faccenna', trip_date: '2026-11-17', trip_time: '02:45', flight: 'EK650', booking_ref: '2026-5100', import_key: 'bl:2026-5100:arr', import_flags: ['night arrival: lands 02:45 on Tue 17 Nov, driver leaves camp Mon 16 Nov evening — confirm the night'] }),   // A10
  trip({ id: A(5), kind: 'airport_departure', trip_date: '2026-11-21', trip_time: '14:00', guest_names: 'Alicia Pohl', booking_ref: '2026-4155', import_key: 'bl:2026-4155:dep', expected_price: 20000,
    import_flags: ['guest says: «Don\'t need airport transfer, I\'ll arrive a day earlier» — check if this transfer is still needed'] }),                                                                                  // A11
  trip({ id: A(6), kind: 'airport_departure', trip_date: '2026-11-21', trip_time: '12:55', flight: 'UL503', guest_names: 'Callum Downes', booking_ref: '2026-4360', import_key: 'bl:2026-4360:dep', expected_price: 20000 }),
];

test('A6 / A7 — a trip whose booking or transfer left the file is flagged on the day list and held back from «Send the whole day» until «Still needed»', async ({ page }) => {
  const st = await openTab(page, { trips: nextWeekFlags() });
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const row = id => page.locator(`.tr-row[data-trip="${id}"]`);
  await expect(row(A(2)).locator('[data-flag]')).toHaveText('Not in the latest Bookinglayer file');
  await expect(row(A(3)).locator('[data-flag]')).toHaveText('Transfer removed in Bookinglayer — cancel it, or keep it if it is still needed');
  await expect(row(A(1)).locator('[data-flag]')).toHaveCount(0);
  await expect(page.locator('.tr-strip')).toContainText('2 not in the latest Bookinglayer file');
  // Sat 14 Nov has three arrivals; only Callum goes to the driver: the «whole day» button shows for one sendable transfer
  // (15 Nov 2026, the house-style titled message now lives here only) and the day send carries him alone.
  const sat = page.locator('.tr-day', { hasText: 'Sat 14 Nov' });
  await expect(sat.locator('button:has-text("Send the whole day")')).toHaveCount(1);
  await sat.locator('button:has-text("Send the whole day")').click();
  let text = decodeURIComponent((await page.evaluate(() => window.__opened[0])).split('?text=')[1]);
  expect(text).toContain('Callum Downes');
  expect(text).not.toContain('Maximilian Ehrler');
  expect(text).not.toContain('Lorena Marie Glas');
  await page.evaluate(() => TransportUI.tickDay('2026-11-14'));
  await call(st, 'trip_update', 1);
  await page.waitForTimeout(200);
  expect(st.calls.filter(c => c.t === 'trip_update').map(c => c.id)).toEqual([A(1)]);          // «Mark all sent ✓» never ticks a held trip
  // Francisco checked with the guest: «Still needed» clears the flag and the trip goes out again.
  await row(A(3)).locator('.tr-line1 b').click();
  await page.click('#tr_keep');
  expect((await call(st, 'trip_update', 2)).body).toEqual({ missing_since: null, import_flags: [] });
  await expect(row(A(3)).locator('[data-flag]')).toHaveCount(0);
  await page.evaluate(() => { window.__opened.length = 0; TransportUI.sendDay('2026-11-14'); });
  text = decodeURIComponent((await page.evaluate(() => window.__opened[0])).split('?text=')[1]);
  expect(text).toContain('Lorena Marie Glas');
  expect(text).not.toContain('Maximilian Ehrler');
});

test('A6 — the import sends «preset» for the real kind of file and the refs still in it; the result line says what to check', async ({ page }) => {
  const st = await openTab(page, { importResult: { missing: 2, replaced: 1 } });
  await openImport(page);
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await page.click('#trImportSave');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_is_preset).toBe(true);
  expect(imp.p_refs_present.length).toBe(16);
  await expect(page.locator('.status-msg.status-ok')).toContainText('2 not in this file — check them · 1 regrouped');
});

test('A10 / A11 — a night arrival and «guest says don\'t need» show as one amber line on the day list', async ({ page }) => {
  await openTab(page, { trips: nextWeekFlags() });
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const row = id => page.locator(`.tr-row[data-trip="${id}"]`);
  await expect(row(A(4)).locator('[data-flag]')).toHaveText('Night arrival — the driver leaves the evening before (Mon 16 Nov)');
  await expect(row(A(5)).locator('[data-flag]')).toHaveText('Guest says: «Don\'t need airport transfer, I\'ll arrive a day earlier» — still needed?');
  await expect(row(A(6)).locator('[data-flag]')).toHaveCount(0);
  expect(await row(A(5)).locator('[data-flag]').evaluate(el => getComputedStyle(el).color)).toBe('rgb(154, 103, 0)');   // amber
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('A13 — an import while the prices have not loaded never saves trips at 0', async ({ page }) => {
  const st = await openTab(page);
  await openImport(page);
  st.noPrices = true;
  await page.evaluate(() => { transportPresets = { airport: [], tuktuk: [], surf: [], tours: [] }; });   // a slow phone: /prices not in yet
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('.tr-noprice')).toContainText('6 transfers have no price yet');
  await page.click('#trImportSave');
  await expect(page.locator('#toast')).toHaveText('The transfer prices have not loaded — nothing saved. Check the connection and try again.');
  expect(st.calls.filter(c => c.t === 'import').length).toBe(0);
  // The prices arrive: the same Save now works, with real prices.
  st.noPrices = false;
  await page.click('#trImportSave');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_trips.every(t => t.expected_price > 0)).toBe(true);
  expect(imp.p_trips.find(t => t.key === 'bl:2026-4660:arr').expected_price).toBe(21000);
});

test('E10 / E7 / E18 — the review list explains itself, a misspelt driver name still raises the chip, and «Owed to drivers» sits on top', async ({ page }) => {
  const fx = weekFixture();
  const P5 = 'bbbbbbbb-0000-4000-8000-000000000005', P6 = 'bbbbbbbb-0000-4000-8000-000000000006', P7 = 'bbbbbbbb-0000-4000-8000-000000000007';
  fx.ledger.push(ledgerRow(P5, 'Dilan and Nishantha', 41000), ledgerRow(P6, 'Dilan 42000', 42000), ledgerRow(P7, 'Dylan 42000', 42000), ledgerRow('bbbbbbbb-0000-4000-8000-000000000008', 'Fuel for scooter', 1500));
  fx.links.push({ entry_id: P5, location_id: LOC, driver_id: null, entry_amount: 41000, trips_amount: 0, trips_count: 0, state: 'review', reason: 'two drivers named', linked_by: 'auto' },
    { entry_id: P6, location_id: LOC, driver_id: D.dilan, entry_amount: 42000, trips_amount: 0, trips_count: 0, state: 'review', reason: 'no exact match', linked_by: 'auto' });
  await openTab(page, fx);
  // One line on top: what is owed to each driver, and what needs a look.
  expect(norm(await page.locator('#trOwed').innerText())).toBe('OWED TO DRIVERS Dilan LKR 47,500 Pay Sampath LKR 1,500 Pay Pay another driver');
  await expect(page.locator('[data-chip="check"]')).toHaveText('2 payments to check');
  await page.click('[data-chip="check"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Payments to check');
  await expect(page.locator(`#trOv [data-check="${P5}"]`)).toContainText('Dilan and Nishantha');                // E7: no driver, no trips
  await expect(page.locator(`#trOv [data-check="${P5}"]`)).toContainText('no trips linked');
  await expect(page.locator(`#trOv [data-check="${P6}"]`)).toContainText('Dilan · no trips linked');            // E18: nothing stamped, to check
  await page.click(`#trOv [data-check="${P6}"]`);
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Link trips');
  // E10: «Dylan 42000» has no link row yet (old database) — the chip still counts it; fuel is left alone.
  const chip = await page.evaluate(() => window.CAMP_CHECKS.find(c => c.id === 'transport-payment-unlinked').run({ ledger: S.ledger, location: 'sri-lanka', isLocal: false, today: '2026-11-13' }).text);
  expect(chip).toMatch(/^Transport payment not linked to trips · 3 · LKR\s125,000$/);
});

// ── Confirm the transfer with the GUEST (Miguel, 13 Nov) ───────────────────
const guestWeek = () => [
  trip({ id: A(11), guest_names: 'Lorena Marie Glas', guest_phone: '+491700000001', trip_time: '07:00', flight: 'QR658', booking_ref: '2026-4660' }),
  trip({ id: A(12), guest_names: 'Beliz Kuyumcuoglu, Deniz Kuyumcuoglu', guest_phone: '+491700000002', pax: 2, booking_ref: '2026-4070' }),                 // no flight, no time
  trip({ id: A(13), guest_names: 'Callum Downes', guest_phone: '+447000000003', trip_time: '12:35', flight: 'UL504', booking_ref: '2026-4360' }),
  trip({ id: A(14), guest_names: 'No Phone Guest', trip_time: '15:00', flight: 'EK650', booking_ref: '2026-1' }),
  trip({ id: A(15), kind: 'airport_departure', trip_date: '2026-11-21', trip_time: '12:55', pickup_time: '08:30', flight: 'UL503', guest_names: 'Callum Downes', guest_phone: '+447000000003', expected_price: 20000, booking_ref: '2026-4360' }),
];
const opened = async (page, i = 0) => { const u = await page.evaluate(n => window.__opened[n], i); return { url: u, text: decodeURIComponent(u.split('?text=')[1]) }; };

test('guest: «Confirm with guest» — the details and the sign with their name go to the guest on WhatsApp; Guest told ✓ → Guest confirmed ✓; a changed time asks to tell them again', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, { trips: guestWeek() });
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const row = id => page.locator(`.tr-row[data-trip="${id}"]`);
  // Flight and time known + a phone → Confirm. Missing flight → «Ask guest», never Confirm. No phone → neither.
  await expect(row(A(11)).locator('[data-guest-send]')).toHaveText('Confirm with guest');
  await expect(row(A(12)).locator('[data-guest-send]')).toHaveCount(0);
  await expect(row(A(12)).locator('button:has-text("Ask guest for flight & time")')).toHaveCount(1);
  await expect(row(A(14)).locator('[data-guest-send]')).toHaveCount(0);
  await page.evaluate(id => TransportUI.confirmGuest(id), A(12));                    // even when called directly it asks instead
  expect((await opened(page)).text).toContain('- your *flight number*');
  expect(st.calls.filter(c => c.t === 'trip_update').length).toBe(0);
  // Arrival.
  await row(A(11)).locator('[data-guest-send]').click();
  const m = await opened(page, 1);
  expect(m.url.startsWith('https://wa.me/491700000001?text=')).toBe(true);
  expect(m.text).toBe([
    "Hi Lorena! I'm Francisco, the manager of *Gota Dagua Surf Camp Sri Lanka*.", '',
    '*Your airport pick-up is booked*', '',
    '*Date:* Sat 14 Nov', '*Flight:* QR658', '*Landing:* 07:00', '*Persons:* 1', '',
    'Our driver will be waiting for you at the *arrivals exit* of Colombo airport, holding a *sign with your name*.', '',
    'Please reply to confirm these details are correct, or tell us what changed.', '', 'See you soon!'].join('\n'));
  expect(m.url).toContain(encodeURIComponent('holding a *sign with your name*'));
  expect(m.text).not.toMatch(/\n{3,}/);                                               // one blank line between blocks, never two
  expect(/\p{Extended_Pictographic}/u.test(m.text)).toBe(false);
  const told = (await call(st, 'trip_update')).body;
  expect(told.guest_notified_at).toBeTruthy();
  expect(told).toMatchObject({ guest_confirmed_at: null, guest_told_snapshot: { trip_date: '2026-11-14', trip_time: '07:00', flight: 'QR658', pickup_time: null, pax: 1 } });
  await expect(row(A(11)).locator('[data-guest="told"] .badge')).toHaveText('Guest told ✓');
  // The guest replies → one manual tick.
  await row(A(11)).locator('[data-guest-ok]').click();
  expect((await call(st, 'trip_update', 2)).body.guest_confirmed_at).toBeTruthy();
  await expect(row(A(11)).locator('[data-guest="confirmed"] .badge')).toHaveText('Guest confirmed ✓');
  // The time changes afterwards (typed here; a re-import changes the same fields) → tell the guest again.
  await row(A(11)).locator('.tr-line1 b').click();
  await page.fill('#tr_t', '09:10');
  await page.click('#trOv .btn-p');
  await call(st, 'trip_update', 3);
  await expect(row(A(11)).locator('[data-guest="changed"] .badge')).toHaveText('Changed — tell guest again');
  await row(A(11)).locator('[data-guest-send]').click();
  expect((await opened(page, 2)).text).toContain('*Landing:* 09:10');
  await expect(row(A(11)).locator('[data-guest="told"]')).toHaveCount(1);          // told again; the old confirmation is gone
  expect((await call(st, 'trip_update', 4)).body.guest_confirmed_at).toBe(null);
  // Departure: flight time and, when set, the pick-up at the camp.
  await row(A(15)).locator('[data-guest-send]').click();
  expect((await opened(page, 3)).text).toBe([
    "Hi Callum! I'm Francisco, the manager of *Gota Dagua Surf Camp Sri Lanka*.", '',
    '*Your drop-off at Colombo airport is booked*', '',
    '*Date:* Sat 21 Nov', '*Flight:* UL503', '*Flight time:* 12:55', '*Pick-up at the camp:* 08:30', '*Persons:* 1', '',
    'Please reply to confirm these details are correct, or tell us what changed.', '', 'Thank you!'].join('\n'));
  expect(await page.evaluate(() => TransportUI.confirmText({ kind: 'airport_departure', trip_date: '2026-11-21', trip_time: '12:55', flight: 'UL503', guest_names: 'Callum', pax: 2 }))).not.toContain('Pick-up at the camp');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('guest: «Confirm with all guests of the day» — one Send per guest, a ✓ once sent', async ({ page }) => {
  const st = await openTab(page, { trips: guestWeek() });
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const sat = page.locator('.tr-day', { hasText: 'Sat 14 Nov' });
  await expect(sat.locator('button:has-text("Send the whole day")')).toHaveCount(1);
  await sat.locator('[data-guest-day]').click();
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Confirm with guests · Sat 14 Nov');
  await expect(page.locator('#gd_list .tr-gd')).toHaveCount(2);                     // Lorena and Callum; Beliz (no flight) and the guest without a phone are not listed
  await expect(page.locator('#trOv')).toContainText('0 of 2 told');
  await page.locator(`.tr-gd[data-gd="${A(13)}"] [data-guest-send]`).click();
  await call(st, 'trip_update');
  expect((await opened(page)).url.startsWith('https://wa.me/447000000003?text=')).toBe(true);
  await expect(page.locator(`.tr-gd[data-gd="${A(13)}"] .badge`)).toHaveText('Guest told ✓');
  await expect(page.locator('#trOv')).toContainText('1 of 2 told');
  await expect(page.locator(`.tr-gd[data-gd="${A(11)}"] [data-guest-send]`)).toHaveCount(1);
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
});

test('guest: before the database update the states still show on this screen (nothing else is sent to the server)', async ({ page }) => {
  const st = await openTab(page, { trips: guestWeek() });
  await page.route(/\/rest\/v1\/camp_trips\?id=eq\./, r => r.request().method() === 'PATCH' && /guest_notified_at|guest_confirmed_at/.test(r.request().postData() || '')
    ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST204', message: "Could not find the 'guest_notified_at' column of 'camp_trips' in the schema cache" }) }) : r.fallback());
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await page.locator(`.tr-row[data-trip="${A(11)}"] [data-guest-send]`).click();
  await expect(page.locator(`.tr-row[data-trip="${A(11)}"] [data-guest="told"]`)).toHaveCount(1);
  await expect(page.locator('#toast')).not.toHaveClass(/err/);
  expect(st.calls.filter(c => c.t === 'trip_update').length).toBe(0);
});

test('E8 — a weekly tuk-tuk lump that is not an exact sum: «Tick all» links the driver\'s runs in one tap, with a note', async ({ page }) => {
  const PS = 'bbbbbbbb-0000-4000-8000-0000000000b1';
  const runs = Array.from({ length: 12 }, (_, i) => run(200 + i, { trip_date: '2026-11-10' }));
  const st = await openTab(page, { trips: runs, ledger: [ledgerRow(PS, 'Sampath For Tuk Tuks (07/11-13/11)', 6300)],
    links: [{ entry_id: PS, location_id: LOC, driver_id: D.sampath, entry_amount: 6300, trips_amount: 0, trips_count: 0, state: 'review', reason: 'no exact match', linked_by: 'auto' }] });
  await page.click('[data-chip="check"]');                                          // one payment to check → Link trips at once
  await expect(page.locator('#trOv input[type=checkbox]:checked')).toHaveCount(0);
  await page.click('#lk_all');
  await expect(page.locator('#trOv input[type=checkbox]:checked')).toHaveCount(12);
  await expect(page.locator('#lk_sum')).toContainText('Ticked LKR 6,000 of LKR 6,300 · difference LKR 300');
  await page.click('#lk_none');
  await expect(page.locator('#trOv input[type=checkbox]:checked')).toHaveCount(0);
  await page.click('#lk_all');
  await page.fill('#lk_note', 'waiting time');
  await page.click('#lk_save');
  const c = (await call(st, 'link_set')).body;
  expect(c.p_trip_ids.length).toBe(12);
  expect(c).toMatchObject({ p_entry: PS, p_driver: D.sampath, p_note: 'waiting time' });
});

test('trips: a Confirmed trip can go back a step (status select → Message Sent), and the sheet offers «Back to Sent / Planned»', async ({ page }) => {
  const st = await openTab(page, { trips: [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000u001', guest_names: 'Lorena Marie Glas', guest_phone: '+491700000001', trip_date: '2026-11-14', trip_time: '07:00', flight: 'QR658', status: 'confirmed' }),
  ] });
  await page.click('button[title="Next week"]');
  const row = page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000u001"]');
  await row.locator('[data-status-sel]').selectOption('sent');
  expect((await call(st, 'trip_update')).body).toEqual({ status: 'sent' });   // a step back only moves the status
  await row.locator('.tr-line1 b').click();
  await page.click('#trOv [data-undo]');
  expect((await call(st, 'trip_update', 2)).body).toMatchObject({ status: 'planned' });
});


// ════════════════════════════════════════════════════════════════════════════
//  Driver payments, one door (Miguel 16 Nov 2026, «sim, avança com a proposta dos motoristas»)
// ════════════════════════════════════════════════════════════════════════════
const fsx = require('fs');
const DRV_SHOTS = process.env.DRV_SHOTS || path.join(__dirname, '..', 'test-results', 'drv-shots');
test('local view (16 Nov 2026): Nadith has «Drivers» — owed line, runs, airport rows read-only; Pay with «Run not in the list» and «−», Cash rows split by item', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const st = await open(page, { query: '&view=local', ...weekFixture() });
  expect(await page.evaluate(() => [...document.querySelectorAll('[data-page="transport"]')].some(b => b.style.display !== 'none' && /Drivers/.test(b.textContent)))).toBe(true);
  expect(await page.evaluate(() => TransportUI._state.loaded)).toBe(false);                  // nothing loads until he opens «Drivers»
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  expect(await page.evaluate(() => activePage)).toBe('transport');
  await expect(page.locator('#transportRoot .section-title')).toHaveText('Drivers');
  // One blue button: «Add tuk-tuk runs» (+ «Plan tomorrow»); paying lives in «Owed to drivers»; no Drivers / Export / Overview.
  await expect(page.locator('#transportRoot .btn-p:visible')).toHaveCount(1);
  await expect(page.locator('#transportRoot [data-add-runs="tuktuk"]')).toHaveText('Add tuk-tuk runs');
  await expect(page.locator('#transportRoot .tr-tabs .pill')).toHaveText(['All', 'Airport', 'Tuk-tuks']);
  await expect(page.locator('#transportRoot [data-foot-links], #transportRoot [data-view="overview"], #trPayBtn')).toHaveCount(0);
  // Airport rows: read-only (Francisco sends and confirms them) — the same checkpoints, no buttons, no select, no link.
  await expect(page.locator('#transportRoot .tr-row-ro').first()).toBeVisible();
  await expect(page.locator('#transportRoot .tr-btns, #transportRoot [data-send-week], #transportRoot .tr-day-btns')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-row-ro [data-steps]').first()).toBeVisible();
  await expect(page.locator('#transportRoot .tr-row-ro select, #transportRoot .tr-row-ro button, #transportRoot .tr-row-ro a')).toHaveCount(0);
  await page.locator('#transportRoot .tr-row-ro').first().click();
  await expect(page.locator('#trOv.open')).toHaveCount(0);
  expect(norm(await page.locator('#trOwed').innerText())).toBe('OWED TO DRIVERS Dilan LKR 47,500 Pay Sampath LKR 1,500 Pay Pay another driver');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  fsx.mkdirSync(DRV_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(DRV_SHOTS, 'nadith-drivers-390.png'), fullPage: true });
  // Tap Sampath → everything owed since the last payment, by day × route, ticked.
  await page.click(`#trOwed [data-owed="${D.sampath}"]`);
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Pay Sampath');
  const ah = page.locator('#trOv [data-pay-group]', { hasText: 'Ahangama' });
  await expect(ah).toContainText('× 3');
  await expect(ah).toContainText('LKR 1,500');
  await expect(page.locator('#py_amt')).toHaveValue('1500');
  await expect(page.locator('#trOv label:has-text("Cash you are giving Sampath")')).toHaveCount(1);
  // A run nobody logged: added done, ticked — Nadith only adds camp runs (runAreas, 17 Nov 2026: surf and tours are Francisco's).
  await page.click('#py_add');
  await page.fill('#py_ad', '2026-11-11');
  expect((await page.locator('#py_ar option').allInnerTexts()).every(o => /^(Market \/ food|Laundry|Staff|Errand)/.test(o))).toBe(true);
  await page.selectOption('#py_ar', 'camp|Laundry');
  await page.fill('#py_an', '2');
  await page.click('#py_addok');
  const ins = (await call(st, 'trip_insert', 2)).rows[0];
  expect(ins).toMatchObject({ kind: 'tuktuk', trip_date: '2026-11-11', route: 'Laundry', purpose: 'laundry', driver_id: D.sampath, status: 'done', source: 'manual' });
  const lau = page.locator('#trOv [data-pay-group]', { hasText: 'Laundry' });
  await expect(lau).toContainText('× 2');
  // A run that did not happen: «−» removes one of his; the surf line has no «−» for him.
  await expect(ah.locator('[data-pay-minus]')).toHaveCount(0);
  await lau.locator('[data-pay-minus]').click();
  await call(st, 'trip_delete');
  await expect(page.locator('#trOv [data-pay-group]', { hasText: 'Laundry' })).not.toContainText('× 2');
  await expect(page.locator('#py_amt')).toHaveValue('1500');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.waitForTimeout(600);                                                    // let the sheet and the toast settle
  await page.screenshot({ path: path.join(DRV_SHOTS, 'nadith-pay-390.png') });
  // Sampath says 1,700: the difference needs a reason.
  await page.fill('#py_amt', '1700');
  await expect(page.locator('#py_save')).toBeDisabled();
  await page.click('#py_reasons .pill:has-text("Extra stop")');
  await page.click('#py_save');
  const pay = (await call(st, 'pay')).body;
  expect(pay.p_driver).toBe(D.sampath);
  expect(pay.p_typed_amount).toBe(1700);
  expect(pay.p_diff_note).toBe('Extra stop');
  expect(pay.p_entries.every(e => e.payment_method === 'Cash' && e.source_kind === 'trip_payment')).toBe(true);
  expect(pay.p_entries.reduce((a, e) => a + e.amount_local, 0)).toBe(1700);
  expect(pay.p_entries.flatMap(e => e.trip_ids).length).toBe(4);
  await expect(page.locator('#trOv')).not.toHaveClass(/open/);
  expect(norm(await page.locator('#trOwed').innerText())).toBe('OWED TO DRIVERS Dilan LKR 47,500 Pay Pay another driver');
  expect(st.calls.filter(c => c.t === 'link_set')).toEqual([]);
  expect(errors).toEqual([]);
});

test('pay a driver: airport transfers up to 14 days ahead are listed «(not yet)», not ticked; Dilan can log a tour run (Yala) from the run sheet', async ({ page }) => {
  const trips = [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000e001', guest_names: 'Done Guest', trip_date: '2026-11-10', trip_time: '10:00' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000e002', guest_names: 'Ahead Guest', trip_date: '2026-11-20', trip_time: '10:00' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000e003', guest_names: 'Far Guest', trip_date: '2026-12-10', trip_time: '10:00' }),
  ];
  const st = await openTab(page, { trips });
  await page.evaluate(id => TransportUI.payPick(id), D.dilan);
  await expect(page.locator('#trOv [data-pay-group]')).toHaveCount(2);
  const ahead = page.locator('#trOv [data-pay-group]', { hasText: 'Ahead Guest' });
  await expect(ahead).toContainText('(not yet)');
  await expect(ahead.locator('input')).not.toBeChecked();
  await expect(page.locator('#py_amt')).toHaveValue('21000');
  await ahead.locator('input').check();
  await expect(page.locator('#py_amt')).toHaveValue('42000');
  await page.evaluate(() => TransportUI.closeModal());
  await page.evaluate(() => TransportUI.openTuktuk());
  expect(await page.locator('#tk_dr option').allTextContents()).toEqual(expect.arrayContaining(['Dilan · Airport van', 'Sampath · Tuk-tuk', 'Nishantha · Alex Transportation']));
  expect(await page.locator('#tk_dr option', { hasText: 'Nadith' }).count()).toBe(0);         // a contact is not a driver
});

// ════════════════════════════════════════════════════════════════════════════
//  16 Nov 2026 (Miguel): «a lista dos transferes… adicionar e ver por dia quase como se fosse um excel…
//  dividido tipo tuk tuks e aeroporto». The week as one sheet: seven days (empty ones too), each with
//  «+ Add»; Time | What | People | Driver | Price | Status; a footer line per category.
// ════════════════════════════════════════════════════════════════════════════
const SHEET_SHOTS = process.env.SHEET_SHOTS || path.join(__dirname, '..', 'test-results', 'sheet-shots');
test('sheet: Airport / Tuk-tuks pills, seven days with «+ Add» (prefilled with the day and the category), a footer per category', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, weekFixture());
  await expect(page.locator('#transportRoot .tr-cats .pill')).toHaveText(['All', 'Airport', 'Tuk-tuks', 'Overview']);
  await expect(page.locator('#transportRoot .tr-day')).toHaveCount(7);
  await expect(page.locator('#trDay-2026-11-07')).toContainText('Nothing on this day');
  await expect(page.locator('#transportRoot [data-foot]')).toHaveCount(2);
  await expect(page.locator('#transportRoot [data-foot="tuktuk"]')).toContainText('4 runs · LKR 3,000');
  await expect(page.locator('#transportRoot [data-foot="tuktuk"]')).toContainText('Paid LKR 1,500 · Owed LKR 1,500 · Planned LKR 0');
  // Airport: transfers only.
  await page.click('#transportRoot .tr-cats .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot .tr-tuk-line')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-row').first()).toBeVisible();
  await expect(page.locator('#transportRoot [data-foot]')).toHaveCount(1);
  await page.click('#transportRoot [data-add="2026-11-12"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Add a free airport transfer');
  await expect(page.locator('#at_d')).toHaveValue('2026-11-12');
  await page.evaluate(() => TransportUI.closeModal());
  // Tuk-tuks: runs only; «+ Add» opens the run sheet on that day (17 Nov 2026: Sri Lanka marks and sends there; a later day's runs are planned).
  await page.click('#transportRoot .tr-cats .pill[data-cat="tuktuk"]');
  await expect(page.locator('#transportRoot .tr-row')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-tuk-line[data-n="3"]')).toContainText('Ahangama × 3');
  await page.click('#transportRoot [data-add="2026-11-12"]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Log runs');
  await expect(page.locator('#tk_d')).toHaveValue('2026-11-12');
  await expect(page.locator('#tk_dr')).toHaveValue(D.sampath);
  await page.evaluate(() => TransportUI.closeModal());
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await page.click('#transportRoot [data-add="2026-11-16"]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Log runs');
  await expect(page.locator('#tk_d')).toHaveValue('2026-11-16');
  await page.evaluate(() => { TransportUI.closeModal(); TransportUI.shiftWeek(-7); });
  // All: «+ Add» asks which one (one decision per screen).
  await page.click('#transportRoot .tr-cats .pill[data-cat="all"]');
  await page.click('#transportRoot [data-add="2026-11-10"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Add on Tue 10 Nov');
  await expect(page.locator('#trOv [data-add-cat]')).toHaveText(['Free airport transfer (staff, gift…)', 'Tuk-tuk run']);
  await page.click('#trOv [data-add-cat="airport"]');
  await expect(page.locator('#at_d')).toHaveValue('2026-11-10');
  expect(errors).toEqual([]);
});

for (const [name, size] of [['390', { width: 390, height: 844 }], ['1280', { width: 1280, height: 900 }]]) {
  test(`sheet layout ${name}: ${size.width <= 700 ? 'two lines per row (time · what · price, then people · driver · status)' : 'aligned columns with a header row'}, no sideways scroll`, async ({ page }) => {
    await page.setViewportSize(size);
    await openTab(page, weekFixture());
    const box = async sel => page.locator(sel).first().boundingBox();
    const run = '#transportRoot .tr-tuk-line[data-n="3"]';
    const air = `#transportRoot .tr-row[data-trip="${R(102)}"]`;
    if (size.width <= 700) {
      await expect(page.locator('#transportRoot .tr-scols')).toBeHidden();
      await expect(page.locator(`${run} .tr-c-meta`)).toBeVisible();
      await expect(page.locator(`${run} .tr-c-meta`)).toHaveText('Sampath');
      await expect(page.locator(`${run} .tr-c-drv`)).toBeHidden();
      await expect(page.locator(`${air} .tr-c-meta`)).toHaveText('1 person · Dilan');
      const what = await box(`${run} .tr-what-l`), price = await box(`${run} .tr-c-price`), status = await box(`${run} .tr-c-status [data-pay]`);
      expect(Math.abs(price.y - what.y)).toBeLessThan(8);            // line 1: what · price
      expect(status.y).toBeGreaterThan(price.y + price.height - 2);    // line 2: the status under the price
    } else {
      await expect(page.locator('#transportRoot .tr-scols')).toBeVisible();
      await expect(page.locator('#transportRoot .tr-scols')).toHaveText(/Time\s*What\s*People\s*Driver\s*Price\s*Status/);
      await expect(page.locator(`${run} .tr-c-meta`)).toBeHidden();
      await expect(page.locator(`${run} .tr-c-drv`)).toHaveText('Sampath');
      const right = async sel => { const b = await box(sel); return b.x + b.width; };
      const head = await right('#transportRoot .tr-scols .tr-c-r');
      expect(Math.abs(await right(`${run} .tr-c-price`) - head)).toBeLessThan(2);
      expect(Math.abs(await right(`${air} .tr-c-price`) - head)).toBeLessThan(2);
      expect(Math.abs((await box(`${run} .tr-c-drv`)).x - (await box(`${air} .tr-c-drv`)).x)).toBeLessThan(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    fsx.mkdirSync(SHEET_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHEET_SHOTS, `sl-full-${name}.png`), fullPage: true });
  });
}

test('sheet · Nadith (?view=local): the same sheet; airport rows read-only and no «+ Add» on Airport; «+ Add» on a day opens the tuk-tuk runs', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { query: '&view=local', ...weekFixture() });
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await expect(page.locator('#transportRoot .tr-cats .pill')).toHaveText(['All', 'Airport', 'Tuk-tuks']);
  await expect(page.locator('#transportRoot .tr-day')).toHaveCount(7);
  await page.click('#transportRoot .tr-cats .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot [data-add]')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-row-ro').first()).toBeVisible();
  await expect(page.locator('#transportRoot .tr-row-ro .tr-btns')).toHaveCount(0);
  await page.click('#transportRoot .tr-cats .pill[data-cat="all"]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  fsx.mkdirSync(SHEET_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHEET_SHOTS, 'nadith-drivers-390.png'), fullPage: true });
  await page.click('#transportRoot [data-add="2026-11-12"]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Log runs');
  await expect(page.locator('#tk_d')).toHaveValue('2026-11-12');
  expect(errors).toEqual([]);
});

// Floriane's feedback (16 Nov 2026), Sri Lanka side: the missing-information line and the IN / OUT colours apply in
// both camps; a Sri Lanka departure with its flight time is complete (its driver message falls back on it).
test('trips (Sri Lanka): missing information — red row «No flight · no time · no phone»; a departure with the flight time is complete; IN / OUT tags', async ({ page }) => {
  await openTab(page, { trips: [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000m001', guest_names: 'Ana Example', trip_time: null, flight: null, guest_phone: null }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000m002', kind: 'airport_departure', route: 'Surfcamp → Airport', trip_date: '2026-11-15', guest_names: 'Ben Example', trip_time: '15:00', flight: 'QR655', guest_phone: '+491700000009' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000m003', guest_names: 'Cleo Example', trip_time: '11:00', flight: 'QR658', guest_phone: '+491700000008', vehicle: null }),
  ] });
  await page.click('button[title="Next week"]');
  const row = n => page.locator(`.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000m00${n}"]`);
  await expect(row(1)).toHaveClass(/tr-missing/);
  await expect(row(1).locator('[data-missline]')).toHaveText(/No flight · no time · no phone$/);
  await expect(row(2)).not.toHaveClass(/tr-missing/);
  await expect(row(3).locator('[data-missline]')).toHaveText(/No vehicle$/);
  await expect(row(1).locator('.tr-dir.in')).toHaveText('Arrival');
  await expect(row(2).locator('.tr-dir.out')).toHaveText('Departure');
});

// Transport → Overview (16 Nov 2026; v2), Sri Lanka: the same view with the tuk-tuks; fits a phone without sideways scroll.
test('overview (Sri Lanka): month by kind — Airport and Tuk-tuks (the pills), LKR with ≈ € (ledger rate 340), drivers; no errors; at 390 nothing scrolls sideways', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, weekFixture());
  await page.click('#transportRoot [data-view="overview"]');
  await expect(page.locator('.tr-ov-period')).toHaveText('November 2026');
  await expect(page.locator('#transportRoot .tr-strip, #trOwed')).toHaveCount(0);               // the Overview is its own screen: no To do / Owed line on it
  expect((await page.locator('[data-ov-table="summary"] [data-ov-row] .tr-kind-t').allInnerTexts()).map(l => l.trim())).toEqual(['Airport', 'Tuk-tuks']);
  await expect(page.locator('[data-ov-row="tuktuk"]')).toContainText('Surf · Ahangama 3 · Surf · Weligama 1');
  await expect(page.locator('[data-ov-row="tuktuk"] .tr-kind-cost')).toContainText('LKR');
  await expect(page.locator('[data-ov-kpi="cost"] .tr-eur')).toHaveText(/^≈ €[\d,]+$/);
  await expect(page.locator('[data-ov-note]')).toContainText('€ ≈ at 340 LKR per €');
  expect(await page.locator('[data-ov-drivers] [data-ov-driver]').evaluateAll(rs => rs.map(r => r.dataset.ovDriver))).toEqual(['Dilan', 'Sampath']);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-ov-row="tuktuk"] .tr-kind-meta')).toBeVisible();          // phone: trips · people · per person under the bar
  expect(await page.locator('#transportRoot .tr-ov-card').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

// ── Checked in Bookinglayer (supabase/camp-trips-bl-check.sql, 16 Nov 2026) ─────────────────────────────────────────
// The Guests export cannot tell one transfer leg from two: every imported airport leg is «to check in Bookinglayer»
// (bl_checked_at null) until somebody looked at the booking page. Invented guests. «Now» = Fri 13 Nov 10:00.
const BL_SHOTS = process.env.BLCHK_SHOTS || path.join(__dirname, '..', 'test-results', 'blchk-shots');
const BLID = n => `aaaaaaaa-0000-4000-8000-0000000b${String(n).padStart(4, '0')}`;
function blFixture() {
  return { trips: [
    trip({ id: BLID(1), guest_names: 'Ana Testperson', guest_phone: '+491700000101', trip_time: '09:30', flight: 'QR668', booking_ref: '2026-9001', import_key: 'bl:2026-9001:arr', bl_checked_at: null }),
    trip({ id: BLID(2), guest_names: 'Bruno Fictive', guest_phone: '+491700000102', trip_time: '11:00', flight: 'EK650', booking_ref: '2026-9002', import_key: 'bl:2026-9002:arr', bl_checked_at: '2026-11-12T08:00:00Z', bl_check_note: 'booking page: 1x 14 Nov' }),
    trip({ id: BLID(3), kind: 'airport_departure', route: 'Surfcamp → Airport', trip_date: '2026-11-15', guest_names: 'Carla Madeup', guest_phone: '+491700000103', trip_time: '18:00', flight: 'QR655', booking_ref: '2026-9003', import_key: 'bl:2026-9003:dep', status: 'sent', bl_checked_at: null }),
    // never «to check»: added by hand, cancelled, older than yesterday, and a row read before the SQL (no column)
    trip({ id: BLID(4), guest_names: 'Dario Handadded', trip_time: '12:00', flight: 'UL504', guest_phone: '+491700000104', source: 'manual', charge: 'camp_tab', bl_checked_at: null }),
    trip({ id: BLID(5), guest_names: 'Elsa Cancelled', trip_time: '13:00', booking_ref: '2026-9005', status: 'cancelled', cancel_reason: 'bookinglayer', bl_checked_at: null }),
    trip({ id: BLID(6), guest_names: 'Fritz Earlier', trip_date: '2026-11-10', trip_time: '08:00', booking_ref: '2026-9006', bl_checked_at: null }),
    trip({ id: BLID(7), guest_names: 'Gina Nocolumn', trip_time: '15:00', flight: 'QR668', guest_phone: '+491700000107', booking_ref: '2026-9007' }),
    // yesterday, done by time: still «to check» (the morning check reads from yesterday on)
    trip({ id: BLID(8), guest_names: 'Hugo Yesterday', trip_date: '2026-11-12', trip_time: '07:00', flight: 'QR664', guest_phone: '+491700000108', booking_ref: '2026-9008', bl_checked_at: null }),
    // kept by camp_trips_bl_verify: in the past and not on the booking page
    trip({ id: BLID(9), guest_names: 'Ines Pastflag', trip_date: '2026-11-11', trip_time: '10:00', flight: 'QR664', guest_phone: '+491700000109', booking_ref: '2026-9009', bl_checked_at: '2026-11-13T05:00:00Z',
      import_flags: ['Not booked in Bookinglayer: did the driver go? If not, cancel this trip'] }),
  ] };
}

test('bl check: the amber line «Check in Bookinglayer» only on unchecked imported legs from yesterday on; chip = filtered list = day counts = hub check = Week → To check', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, blFixture());
  const row = n => page.locator(`#transportRoot .tr-row[data-trip="${BLID(n)}"]`);
  const chip = page.locator('#transportRoot [data-chip="blcheck"]');
  await expect(chip).toHaveText('3 transfers to check in Bookinglayer');
  // this week (7–13 Nov): yesterday's arrival keeps the line; the past trip the booking page does not have says so
  await expect(row(8).locator('[data-blcheck]')).toContainText('Check in Bookinglayer');
  await expect(row(6).locator('[data-blcheck]')).toHaveCount(0);
  await expect(row(9).locator('[data-blcheck]')).toHaveCount(0);
  await expect(row(9).locator('[data-flag]')).toHaveText(/Not booked in Bookinglayer — did the driver go\? If not, cancel this trip/);
  await expect(row(9).locator('[data-went]')).toHaveText('Driver went (pay)');
  await expect(row(9).locator('[data-didnt]')).toHaveText("Didn't go (cancel)");
  await page.click('button[title="Next week"]');
  await expect(row(1).locator('[data-blcheck] .tr-bl-t')).toHaveText(/Check in Bookinglayer/);
  await expect(row(1).locator('[data-blcheck] .tr-bl-ref')).toHaveText('2026-9001');
  const href = await row(1).locator('[data-blcheck] a.tr-bl-open').getAttribute('href');
  expect(href).toBe('https://app.bookinglayer.io/bookings?page=1&limit=25&search=2026-9001&query=2026-9001');
  expect(await row(1).locator('[data-blcheck] a.tr-bl-open').getAttribute('target')).toBe('_blank');
  await expect(row(1).locator('[data-blcheck] [data-bl-booked]')).toHaveText('Booked ✓');
  await expect(row(1).locator('[data-blcheck] [data-bl-not]')).toHaveText('Not booked');
  await expect(row(3).locator('[data-blcheck]')).toHaveCount(1);
  for (const n of [2, 4, 5, 7]) await expect(row(n).locator('[data-blcheck]')).toHaveCount(0);
  // 16 Nov 2026 UX pass: the check is the first step of the row's checkpoint strip (Booked · Info · Driver · Guest · Paid);
  // a checked leg says «Booked ✓»; the buttons stay on the right with a labelled «Edit».
  await expect(row(1).locator('.tr-c-steps [data-step="booked"][data-blcheck]')).toHaveCount(1);
  await expect(row(2).locator('[data-step="booked"]')).toHaveText('Booked');
  await expect(row(2).locator('[data-step="booked"]')).toHaveAttribute('data-state', 'ok');
  await expect(row(7).locator('[data-step="booked"]')).toHaveCount(0);                         // a row read before the SQL: no step at all
  await expect(row(4).locator('[data-step="booked"]')).toHaveCount(0);                         // added by hand: nothing to check
  expect(await row(1).locator('[data-step]').evaluateAll(els => els.map(e => e.dataset.step))).toEqual(['booked', 'info', 'driver', 'guest']);
  await expect(row(1).locator('.tr-btns button[title="Send on WhatsApp"]')).toHaveCount(1);
  await expect(row(1).locator('.tr-btns [data-edit]')).toHaveText('Edit');
  // the day cards count them (shown only — «Send the whole day» still sends them)
  await expect(page.locator('#trDay-2026-11-14 [data-day-bl]')).toHaveText('1 to check in Bookinglayer');
  await expect(page.locator('#trDay-2026-11-15 [data-day-bl]')).toHaveText('1 to check in Bookinglayer');
  await expect(page.locator('#trDay-2026-11-14 button:has-text("Send the whole day")')).toHaveCount(1);
  expect(await page.evaluate(() => TransportUI.dayMessage('2026-11-14'))).toContain('Ana Testperson');
  // the chip filters to exactly those
  await chip.click();
  await expect(page.locator('#transportRoot .tr-row[data-trip]')).toHaveCount(3);
  expect(await page.locator('#transportRoot .tr-row[data-trip]').evaluateAll(els => els.map(e => e.dataset.trip))).toEqual([BLID(8), BLID(1), BLID(3)]);
  // the hub's shared checks and Week → To check say the same number
  expect(await page.evaluate(() => TransportUI.blCheck.run({ location: 'sri-lanka', isLocal: false }).text)).toBe('3 transfers to check in Bookinglayer');
  expect(await page.evaluate(() => TransportUI.blCheck.run({ location: 'sri-lanka', isLocal: true }))).toBe(null);
  expect(await page.evaluate(() => (WeekUI.toCheck().find(c => c.go === 'blcheck') || {}).short)).toBe('3 transfers to check in Bookinglayer');
  expect(errors).toEqual([]);
});

// Owner, 16 Nov 2026 (Lorena / Callum, Sri Lanka, Sat 14 Nov): a past trip that still asks «Not booked in Bookinglayer — did the
// driver go?» showed «✓ Booked» (bl_checked_at was set by the check that raised the question) and «Owed». While the question is
// open: «Not booked?» in amber, «On hold — answer first», and it counts in no «Owed» (the owed line, the Overview) until answered.
test('bl check: an open «did the driver go?» is «Not booked?» + «On hold», never «Booked ✓» nor owed; «Driver went» → owed', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, blFixture());
  const row = page.locator(`#transportRoot .tr-row[data-trip="${BLID(9)}"]`);
  await expect(row.locator('[data-step="booked"]')).toHaveAttribute('data-state', 'todo');
  await expect(row.locator('[data-step="booked"]')).toHaveText('Not booked?');
  await expect(row.locator('[data-step="paid"]')).toHaveAttribute('data-state', 'hold');
  await expect(row.locator('[data-step="paid"] [data-pay]')).toHaveText('On hold');
  await expect(row.locator('[data-step="paid"]')).toContainText('answer first');
  expect(await page.evaluate(id => TransportUI.reconcileStatus(TransportUI._state.trips.find(t => t.id === id)), BLID(9))).toBe('on_hold');
  const owedSum = () => page.evaluate(() => TransportUI._state.trips.filter(t => TransportUI.reconcileStatus(t) === 'owed').reduce((s, t) => s + Number(t.expected_price), 0));
  const before = await owedSum();
  const dilan = page.locator(`#trOwed [data-owed="${D.dilan}"] b`);
  const num = async () => Number((await dilan.textContent()).replace(/[^\d]/g, ''));
  expect(await num()).toBe(before);                                                   // the owed line leaves it out
  expect(await page.evaluate(() => TransportUI.ovData().owed.total)).toBe(before);     // and so does the Overview,
  await page.click('#transportRoot [data-view="overview"]');                           // which points at the open question instead
  await expect(page.locator('[data-ov-kpi="owed"] [data-ov-holds]')).toHaveText('1 trip on hold — did the driver go?');
  await page.click('[data-ov-holds]');
  await expect(page.locator(`#transportRoot .tr-row[data-trip]`)).toHaveCount(1);
  await page.click('#transportRoot .tr-cats .pill[data-cat="all"]');
  // He went → the question goes: plain owed, «Booked» again.
  await row.locator('[data-went]').click();
  await expect(row.locator('[data-step="paid"]')).toHaveAttribute('data-state', 'owed');
  await expect(row.locator('[data-step="booked"]')).toHaveAttribute('data-state', 'ok');
  expect(await num()).toBe(before + 21000);
  expect(errors).toEqual([]);
});

test('bl check: «Booked ✓» stamps the check (who and when); «Not booked» cancels with its own reason, asks the driver to be told when it was sent', async ({ page }) => {
  const st = await openTab(page, blFixture());
  await page.click('button[title="Next week"]');
  const row = n => page.locator(`#transportRoot .tr-row[data-trip="${BLID(n)}"]`);
  await row(1).locator('[data-bl-booked]').click();
  const up = await call(st, 'trip_update');
  expect(up.id).toBe(BLID(1));
  expect(Object.keys(up.body).sort()).toEqual(['bl_check_note', 'bl_checked_at', 'bl_checked_by']);
  expect(up.body.bl_check_note).toBe('checked by hand');
  expect(up.body.bl_checked_by).toBe('00000000-0000-4000-8000-000000000001');
  expect(Date.parse(up.body.bl_checked_at)).toBeGreaterThan(0);
  await expect(row(1).locator('[data-blcheck]')).toHaveCount(0);
  await expect(page.locator('#transportRoot [data-chip="blcheck"]')).toHaveText('2 transfers to check in Bookinglayer');
  await row(3).locator('[data-bl-not]').click();
  const c = await call(st, 'trip_update', 2);
  expect(c.id).toBe(BLID(3));
  expect(c.body).toMatchObject({ status: 'cancelled', cancel_reason: 'Not booked in Bookinglayer (checked by hand)', needs_resend: true, bl_check_note: 'not booked (checked by hand)' });
  await showCancelled(page);
  await expect(row(3).locator('[data-pay="off"]')).toHaveText('Cancelled');
  await expect(row(3).locator('[data-blcheck]')).toHaveCount(0);
  await expect(page.locator('#transportRoot [data-chip="blcheck"]')).toHaveText('1 transfer to check in Bookinglayer');   // yesterday's
});

test('bl check: Nadith (?view=local) sees the amber state read-only — no link, no buttons, no chip', async ({ page }) => {
  await open(page, { query: '&view=local', ...blFixture() });
  await page.evaluate(() => showPage('transport'));
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.click('button[title="Next week"]');
  const line = page.locator(`#transportRoot .tr-row-ro[data-trip="${BLID(1)}"] [data-blcheck]`);
  await expect(line).toContainText('Check in Bookinglayer');
  await expect(line.locator('a, button')).toHaveCount(0);
  await expect(page.locator('#transportRoot [data-chip="blcheck"]')).toHaveCount(0);
});

test('bl check: screenshots — a Transport day with checked and unchecked transfers (1280 and 390, no sideways scroll)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTab(page, blFixture());
  await page.click('button[title="Next week"]');
  fsx.mkdirSync(BL_SHOTS, { recursive: true });
  await page.locator('#trDay-2026-11-14').screenshot({ path: path.join(BL_SHOTS, 'transport-day-1280.png') });
  await page.screenshot({ path: path.join(BL_SHOTS, 'transport-week-1280.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(`#transportRoot .tr-row[data-trip="${BLID(1)}"] [data-bl-booked]`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#trDay-2026-11-14').screenshot({ path: path.join(BL_SHOTS, 'transport-day-390.png') });
  await page.screenshot({ path: path.join(BL_SHOTS, 'transport-week-390.png'), fullPage: true });
  expect(errors).toEqual([]);
});

// ── The camp report's questions on a trip, and cancelled rows (17 Nov 2026) ─────────────────────────
const RPID = n => `aaaaaaaa-0000-4000-8000-0000000c${String(n).padStart(4, '0')}`;
const TOG_FLAG = 'Different times — coming together? If not, the guest at 0 € has to pay a transfer (Tsz Yin Scarlet Tang · LS1129 · 19:00)';
function reportFixture() {
  return { trips: [
    trip({ id: RPID(1), trip_date: '2026-11-13', trip_time: '18:00', flight: 'U22621', guest_names: 'Hoi Yi Law, Tsz Yin Scarlet Tang', guest_phone: '+447456304372', pax: 2, booking_ref: '2026-4717', import_key: 'bl:2026-4717:arr', bl_checked_at: '2026-11-16T08:00:00Z', import_flags: [TOG_FLAG] }),
    trip({ id: RPID(2), trip_date: '2026-11-13', trip_time: '20:00', flight: 'AT431', guest_names: 'Ada Example, Ben Example', guest_phone: '+491700000201', pax: 2, booking_ref: '2026-9095', import_key: 'bl:2026-9095:arr', bl_checked_at: '2026-11-16T08:00:00Z', import_flags: ['2 transfers paid, same flight — confirm they come together'] }),
    trip({ id: RPID(3), trip_date: '2026-11-13', trip_time: '21:00', flight: 'QR664', guest_names: 'Val Example', guest_phone: '+491700000203', booking_ref: '2026-9099', import_key: 'bl:2026-9099:arr', edited_fields: ['trip_time'], bl_checked_at: '2026-11-16T08:00:00Z', import_flags: ['Bookinglayer says: time 21:30 — use it?'] }),
    trip({ id: RPID(4), trip_date: '2026-11-13', trip_time: '15:00', flight: 'UL504', guest_names: 'Callum Downes', booking_ref: '2026-4360', import_key: 'bl:2026-4360:arr', status: 'cancelled', bl_checked_at: '2026-11-16T08:00:00Z',
      cancel_reason: 'Not booked in Bookinglayer (no arrival transfer on the booking); cancelled by Miguel 16 Nov 2026' }),
    trip({ id: RPID(5), trip_date: '2026-11-13', trip_time: '19:00', flight: 'LS1129', guest_names: 'Tsz Yin Scarlet Tang', booking_ref: '2026-4717', import_key: 'bl:2026-4717:arr:tszyinscarlettang', status: 'merged', merged_into: RPID(1), cancel_reason: 'merged — same transfer', bl_checked_at: '2026-11-16T08:00:00Z' }),
  ] };
}

test('cancelled trips: behind «Show N cancelled», never «Booked» (only «Cancelled», the reason on hover); merged ones never counted', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, reportFixture());
  const day = page.locator('#trDay-2026-11-13');
  await expect(day.locator('.card-hint')).toContainText('3 transfers');                       // the cancelled and the merged one are not transfers
  await expect(page.locator(`.tr-row[data-trip="${RPID(4)}"]`)).toHaveCount(0);
  await expect(page.locator(`.tr-row[data-trip="${RPID(5)}"]`)).toHaveCount(0);
  await expect(day.locator('[data-show-off]')).toHaveText('Show 2 cancelled');
  await day.locator('[data-show-off]').click();
  const callum = page.locator(`.tr-row[data-trip="${RPID(4)}"]`);
  await expect(callum.locator('[data-step="booked"]')).toHaveCount(0);                        // bl_checked_at is set, still no «Booked»
  await expect(callum.locator('[data-step]')).toHaveCount(1);
  await expect(callum.locator('[data-pay="off"]')).toHaveText('Cancelled');
  await expect(callum.locator('[data-pay="off"]')).toHaveAttribute('title', /Not booked in Bookinglayer/);
  await expect(page.locator(`.tr-row[data-trip="${RPID(5)}"] [data-step="booked"]`)).toHaveCount(0);
  // the merged trip is not a transfer to send: no send button, no «missing info»
  await expect(page.locator(`.tr-row[data-trip="${RPID(5)}"]`)).not.toHaveClass(/tr-missing/);
  await expect(page.locator(`.tr-row[data-trip="${RPID(5)}"] button[title="Send on WhatsApp"]`)).toHaveCount(0);
  await expect(day.locator('[data-show-off]')).toHaveText('Hide cancelled');
  expect(await page.evaluate(id => TransportUI.reconcileStatus(TransportUI._state.trips.find(t => t.id === id)), RPID(5))).toBe('cancelled');
  expect(errors).toEqual([]);
});

test('camp report questions: «Coming together» clears the question for good; «Use it» takes Bookinglayer\'s value; «Confirmed» on two paid transfers', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, reportFixture());
  const row = n => page.locator(`.tr-row[data-trip="${RPID(n)}"]`);
  await expect(row(1).locator('[data-together]')).toContainText('Different times — coming together? If not, the guest at 0 € has to pay a transfer');
  await expect(row(1).locator('[data-together]')).toContainText('(Tsz Yin Scarlet Tang LS1129 19:00)');
  await expect(row(2).locator('[data-paid-twice]')).toHaveText('2 transfers paid, same flight — confirm they come together');
  await expect(row(3).locator('[data-blsays]')).toContainText('Bookinglayer says: time 21:30');
  expect(await page.locator('#transportRoot').textContent()).not.toMatch(/refund|devol/i);
  await page.screenshot({ path: test.info().outputPath('transport-flags-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.locator('#trDay-2026-11-13 [data-show-off]').click();
  await page.locator('#trDay-2026-11-13').screenshot({ path: test.info().outputPath('transport-flags-1280.png') });
  await page.locator('#trDay-2026-11-13 [data-show-off]').click(); await page.setViewportSize({ width: 390, height: 844 });
  await row(1).locator('[data-together-yes]').click();
  let c = await call(st, 'trip_update', 1);
  expect(c.id).toBe(RPID(1)); expect(c.body.import_flags).toEqual([]); expect(c.body.edited_fields).toContain('together_ok');
  await expect(row(1).locator('[data-together]')).toHaveCount(0);
  await row(3).locator('[data-blsays-use]').click();
  c = await call(st, 'trip_update', 2);
  expect(c.body).toMatchObject({ trip_time: '21:30', import_flags: [], edited_fields: [] });
  await row(2).locator('[data-paid-twice-ok]').click();
  c = await call(st, 'trip_update', 3);
  expect(c.body.import_flags).toEqual([]); expect(c.body.edited_fields).toContain('paid_twice_ok');
  expect(errors).toEqual([]);
});

test('camp report questions: «Separate» gives the 0 € guest a trip of their own (Camp Tab, the guest pays) and keeps the paid trip for the paying guest', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, reportFixture());
  await page.locator(`.tr-row[data-trip="${RPID(1)}"] [data-together-sep]`).click();
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ guest_names: 'Tsz Yin Scarlet Tang', pax: 1, vehicle: 'Car', charge: 'camp_tab', trip_time: '19:00', flight: 'LS1129', booking_ref: '2026-4717', import_key: 'bl:2026-4717:arr:sep', expected_price: 21000,
    import_flags: ['Separate from the paid transfer of this booking: the guest at 0 € has to pay a transfer'] });
  expect(ins.bl_checked_at).toBeTruthy();
  const up = await call(st, 'trip_update');
  expect(up.id).toBe(RPID(1));
  expect(up.body).toMatchObject({ guest_names: 'Hoi Yi Law', pax: 1, vehicle: 'Car', import_flags: [] });
  expect(up.body.edited_fields).toEqual(expect.arrayContaining(['pax', 'guest_names', 'together_split']));
  await expect(page.locator('#trDay-2026-11-13 .card-hint')).toContainText('4 transfers');
  expect(errors).toEqual([]);
});

test('cancelled trips the driver still has («changed, resend») stay in view, also in the resend chip', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const fx = reportFixture();
  fx.trips.push(trip({ id: RPID(6), trip_date: '2026-11-13', trip_time: '16:00', flight: 'EK650', guest_names: 'Rita Resend', booking_ref: '2026-9066', import_key: 'bl:2026-9066:arr', status: 'cancelled', needs_resend: true, cancel_reason: 'bookinglayer' }));
  await openTab(page, fx);
  await expect(page.locator(`.tr-row[data-trip="${RPID(6)}"]`)).toHaveCount(1);
  await expect(page.locator('#trDay-2026-11-13 [data-show-off]')).toHaveText('Show 2 cancelled');   // Callum and the merged one only
  await page.evaluate(() => TransportUI.setFilter('resend'));
  await expect(page.locator(`#transportRoot .tr-row[data-trip="${RPID(6)}"]`)).toHaveCount(1);
  await expect(page.locator('#transportRoot [data-show-off]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── /prices is the one source of vehicles, seats and prices (17 Nov 2026) ──────────────────────────────
test('/prices loader: capacity, cost, currency, sell price, covers and product are read (capacity from the column); nothing is written back to state_store', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page);
  expect(st.catalogUrls.length).toBeGreaterThan(0);
  expect(st.catalogUrls[0]).toMatch(/select=[^&]*capacity/);
  ['cost_per_guest', 'currency', 'sell_price', 'sell_currency', 'covers_pax', 'bl_product'].forEach(c => expect(st.catalogUrls[0]).toContain(c));
  const v = await page.evaluate(() => TransportUI.airVehicles('airport_arrival', 'CMB').map(x => [x.label, x.capacity, x.cost, x.sell, x.coversPax]));
  expect(v).toEqual([['Car', 3, 21000, 80, 3], ['Minivan', 8, 26500, 95, 3]]);
  expect(await page.evaluate(() => [TransportUI.pickAir('airport_arrival', 'CMB', 4).label, TransportUI.presetPrice('airport_departure', 'Minivan', 'CMB')])).toEqual(['Minivan', 25000]);
  expect(st.calls.filter(c => c.t === 'state_store' && JSON.stringify(c.body).includes('transport_presets'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('/prices loader: before transport-catalog-one-source.sql (no covers_pax / bl_product) the select is repeated without them and the prices load', async ({ page }) => {
  const st = await openTab(page, { noNewCatalogCols: true });
  expect(st.catalogUrls.some(u => !/covers_pax/.test(u))).toBe(true);
  expect(await page.evaluate(() => TransportUI.pricesReady())).toBe(true);
  expect(await page.evaluate(() => TransportUI.airVehicles('airport_arrival').map(x => x.capacity))).toEqual([3, 8]);
});

test('/prices failed: no seed presets, a clear «prices not loaded», nothing saved to state_store', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, { catalogFails: true });
  expect(await page.evaluate(() => [TransportUI.pricesReady(), !!__transportPricesError, TransportUI.airVehicles('airport_arrival').length, transportPresets.airport.length])).toEqual([false, true, 0, 0]);
  await page.evaluate(() => { openTransportQuickAdd(); });
  await expect(page.locator('#tqChipsWrap [data-prices-not-loaded]')).toContainText('Transport prices not loaded');
  expect(st.calls.filter(c => c.t === 'state_store' && JSON.stringify(c.body).includes('transport_presets'))).toEqual([]);
  // a free airport transfer is not saved without its /prices vehicle and price
  await page.evaluate(() => { document.getElementById('transportQuickOv')?.classList.remove('open'); TransportUI.openAddTransfer(); });
  await page.click('#at_fr .pill:has-text("Staff")');
  await page.fill('#at_g', 'Anna');
  await page.evaluate(() => TransportUI.saveTransfer());
  await expect(page.locator('#toast')).toContainText('prices have not loaded');
  expect(st.calls.filter(c => c.t === 'trip_insert')).toEqual([]);
  expect(errors).toEqual([]);
});

test('a renamed /prices row is never a silent 0: the route is found by direction, the vehicle by capacity; no route at all → flagged', async ({ page }) => {
  const renamed = CATALOG.map(r => r.picker_tab !== 'airport' ? r : { ...r, name: r.name.replace('Airport → Surfcamp', 'CMB Airport → Gota camp').replace('— Car', '— Small car') });
  await openTab(page, { catalog: renamed });
  expect(await page.evaluate(() => { const pk = TransportUI.pickAir('airport_arrival', 'CMB', 2); return [pk.label, TransportUI.presetPrice('airport_arrival', pk.label, 'CMB')]; })).toEqual(['Small car', 21000]);
  const TC = require('../lib/transport-catalog.js'); const G = require('../lib/guests-trips.js'); const CCfg = require('../lib/camp-config.js');
  const noRoute = TC.group(CATALOG.filter(r => !/^Airport →/.test(r.name)));
  const pk = G.pickVehicle(2, { vehicles: TC.airportVehicles(noRoute, CCfg.SL, 'airport_arrival', 'CMB') });
  expect([pk.label, pk.flag]).toEqual([null, 'no vehicle in /prices for this route — vehicle and price to set']);
});

test('edit a trip: a new vehicle at its /prices price is not «price typed by hand»; a typed price is', async ({ page }) => {
  const t = trip({ id: 'aaaaaaaa-0000-4000-8000-0000000000e1', trip_date: '2026-11-15', import_key: 'bl:2026-1:arr', booking_ref: '2026-1', guest_names: 'Ann A', pax: 2, edited_fields: ['expected_price'] });
  const st = await openTab(page, { trips: [t] });
  await page.evaluate(id => TransportUI.openTrip(id), t.id);
  await expect(page.locator('#tr_v option')).toHaveText(['Car', 'Minivan']);          // the route's /prices vehicles, no «Large Van»
  await page.selectOption('#tr_v', 'Minivan');
  await expect(page.locator('#tr_pr')).toHaveValue('26500');
  await page.click('#trOv .btn-p');
  const up = (await call(st, 'trip_update')).body;
  expect(up).toMatchObject({ vehicle: 'Minivan', expected_price: 26500 });
  expect(up.edited_fields).toContain('vehicle');
  expect(up.edited_fields).not.toContain('expected_price');                           // back on /prices (an old wrong mark is cleared)
  await expect(page.locator('#trOv.open')).toHaveCount(0);                             // the save closed the sheet
  await page.evaluate(id => TransportUI.openTrip(id), t.id);
  await expect(page.locator('#tr_pr')).toBeVisible();
  await page.fill('#tr_pr', '30000');
  await page.evaluate(id => TransportUI.saveTrip(id), t.id);
  expect((await call(st, 'trip_update', 2)).body.edited_fields).toContain('expected_price');
});

test('Overview: airport guests € (report prices, else estimated from /prices: people ÷ covers × guest price) against the drivers €, and the margin', async ({ page }) => {
  const base = { trip_date: '2026-11-10', trip_time: '10:00', status: 'done', source: 'bookinglayer', charge: 'bookinglayer' };
  const trips = [trip({ ...base, id: 'aaaaaaaa-0000-4000-8000-0000000000f1', pax: 2, expected_price: 21000, guest_eur: 80, paid_lines: 1 }),
    trip({ ...base, id: 'aaaaaaaa-0000-4000-8000-0000000000f2', pax: 4, vehicle: 'Minivan', expected_price: 26500 }),                // no report price: 2 × €80 estimated
    trip({ ...base, id: 'aaaaaaaa-0000-4000-8000-0000000000f3', kind: 'airport_departure', pax: 1, expected_price: 20000, charge: 'free', free_reason: 'staff' })];
  await openTab(page, { trips });
  await page.evaluate(() => TransportUI.ovMode('month'));
  const card = page.locator('[data-ov-guest-money]');
  await expect(card.locator('[data-ov-gm="revenue"] .kpi-value')).toHaveText('€240');
  await expect(card.locator('[data-ov-gm="revenue"] .kpi-label')).toHaveText('Guests paid (est.)');
  await expect(card.locator('[data-ov-gm="revenue"] .kpi-sub')).toContainText('1 trip at the report\'s prices · 1 trip estimated from /prices · 1 trip free or on the Camp Tab');
  const G = await page.evaluate(() => { const P = TransportOverview.period('month', '2026-11'); return TransportOverview.guestMoney(TransportUI._state.trips, P, { rate: 340, sellFor: () => ({ eur: 80, covers: 3 }) }); });
  expect([G.revenue, G.cost, G.fromReport, G.estimated, G.free, G.margin]).toEqual([240, 67500, 1, 1, 1, Math.round((240 - 67500 / 340) * 100) / 100]);
  await expect(card.locator('[data-ov-gm="margin"] .kpi-value')).toHaveText(/^€\d+$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);   // 390 px: no sideways scroll
});

test('money questions are answered like «Coming together»: «OK — known» never comes back for the same text (re-import), a new count asks again; «Charge guest» puts it on the Camp Tab', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const id = n => `aaaaaaaa-0000-4000-8000-0000000000m${n}`;
  const base = { trip_date: '2026-11-13', trip_time: '18:00', source: 'bookinglayer', charge: 'bookinglayer', status: 'planned' };
  const UP = '4 people, 1 transfer paid — one covers 3';
  const trips = [trip({ ...base, id: id(1), import_key: 'bl:2026-81:arr', booking_ref: '2026-81', guest_names: 'A, B, C, D', pax: 4, vehicle: 'Minivan', expected_price: 26500, import_flags: [UP] }),
    trip({ ...base, id: id(2), import_key: 'bl:2026-82:arr', booking_ref: '2026-82', guest_names: 'Eve E', pax: 1, import_flags: ['no transfer paid'] }),
    trip({ ...base, id: id(3), import_key: 'bl:2026-83:arr', booking_ref: '2026-83', guest_names: 'Flo F', pax: 1, import_flags: ['paid €70, /prices €80 (Flo F)'] })];
  const st = await openTab(page, { trips });
  const row = n => page.locator(`.tr-row[data-trip="${id(n)}"]`);
  await expect(row(1).locator('[data-money]')).toHaveText(UP);
  await expect(row(1).locator('[data-money-charge]')).toHaveCount(1);
  await expect(row(3).locator('[data-money]')).toHaveText('Paid €70, /prices €80 (Flo F)');
  await expect(row(3).locator('[data-money-charge]')).toHaveCount(0);                 // a lower price is a question, not a charge
  // OK — known
  await row(1).locator('[data-money-ok]').click();
  const c1 = await call(st, 'trip_update', 1);
  expect(c1.body.edited_fields).toContain('money_ok:' + UP);
  await expect(row(1).locator('[data-money]')).toHaveCount(0);
  // the next import brings the same text back: still answered; a new count (5 people) is a new question
  await page.evaluate(([i, f]) => { const t = TransportUI._state.trips.find(x => x.id === i); t.import_flags = [f]; TransportUI.render(); }, [id(1), UP]);
  await expect(row(1).locator('[data-money]')).toHaveCount(0);
  await page.evaluate(([i]) => { const t = TransportUI._state.trips.find(x => x.id === i); t.import_flags = ['5 people, 1 transfer paid — one covers 3']; TransportUI.render(); }, [id(1)]);
  await expect(row(1).locator('[data-money]')).toHaveText('5 people, 1 transfer paid — one covers 3');
  // Charge guest on «no transfer paid»: the trip is the guest's to pay (Camp Tab), with what to charge
  await row(2).locator('[data-money-charge]').click();
  const c2 = await call(st, 'trip_update', 2);
  expect(c2.body).toMatchObject({ charge: 'camp_tab' });
  expect(c2.body.edited_fields).toContain('money_charge:no transfer paid');
  await expect(row(2).locator('[data-money]')).toHaveCount(0);
  await expect(row(2).locator('[data-money-charged]')).toHaveText('Camp Tab: the guest pays 1 transfer (€80)');
  expect(errors).toEqual([]);
});

test('tuk-tuk camp runs: the price is the /prices row only — no row → «price to confirm», saved at 0 and flagged; a row → its price', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const withLaundry = CATALOG.concat([{ id: 'cat-tk1', name: 'Laundry', cost_per_guest: 700, currency: 'LKR', notes: '', linked_transport_preset_id: 'p-Laundry', linked_camp_tab_id: null, picker_tab: 'tuktuk', sort_order: 50 }]);
  const st = await openTab(page, { catalog: withLaundry });
  await page.evaluate(() => TransportUI.openTuktuk());
  await expect(page.locator('.tr-tap-main[data-key="camp|Laundry"] .hint')).toHaveText(/^LKR\s700$/);
  await expect(page.locator('.tr-tap-main[data-key="camp|Market / food"] .hint')).toHaveText('price to confirm');
  await page.locator('.tr-tap-main[data-key="camp|Market / food"]').click();
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ route: 'Market / food', expected_price: 0, import_flags: ['no /prices row for «Market / food» — price to set in /prices'] });
  await page.locator('.tr-tap-main[data-key="camp|Laundry"]').click();
  expect((await call(st, 'trip_insert', 2)).rows[0]).toMatchObject({ route: 'Laundry', expected_price: 700 });
  expect(errors).toEqual([]);
});
