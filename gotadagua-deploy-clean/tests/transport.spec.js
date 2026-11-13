// Camp hub · Transport tab (Sri Lanka, 13 Nov 2026) — stubbed Supabase.
//
// Full view only (Francisco / Miguel / HQ). Nadith's ?view=local keeps exactly
// what he has today: no Transport tab; his ledger payments are linked to the
// trips by the database (supabase/camp-trips.sql, checked separately).
// «Now» is pinned to Fri 13 Nov 2026 10:00 Colombo (window.TRANSPORT_NOW).
const { test, expect } = require('@playwright/test');
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
  ['Airport → Surfcamp — Car', 21000, 'airport'], ['Airport → Surfcamp — Minivan', 26500, 'airport'], ['Airport → Surfcamp — Large Van', 29500, 'airport'],
  ['Surfcamp → Airport — Car', 20000, 'airport'], ['Surfcamp → Airport — Minivan', 25000, 'airport'], ['Surfcamp → Airport — Large Van', 28000, 'airport'],
  ['River Safari', 1000, 'tours'], ['Tea Plantation', 1500, 'tours'],
].map(([name, cost, tab], i) => ({ id: `cat-${i}`, name, cost_per_guest: cost, currency: 'LKR', notes: '', linked_transport_preset_id: `p-${name.split(' — ')[0]}`, linked_camp_tab_id: null, picker_tab: tab, sort_order: i }));

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
    ledger: (opts.ledger || []).map(r => ({ ...r })), bookings: opts.bookings || [], calls: [],
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
    if (url.includes('/rest/v1/pricing_catalog')) return json(slug === 'sri-lanka' && url.includes('category=eq.Transport') ? CATALOG : []);
    if (url.includes('/rest/v1/camp_drivers')) {
      if (method === 'GET') return json(st.drivers);
      if (method === 'PATCH') { const d = st.drivers.find(x => x.id === idEq); Object.assign(d, body); st.calls.push({ t: 'driver_update', id: idEq, body }); return json([d]); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('dddddddd'), aliases: [], kinds: [], default_for: [], active: true, ...r })); st.drivers.push(...rows); return json(rows); }
    }
    if (url.includes('/rest/v1/camp_trips')) {
      if (method === 'GET') return json(st.trips);
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
    if (url.includes('/rest/v1/rpc/camp_trips_import')) { st.calls.push({ t: 'import', body }); return json({ inserted: body.p_trips.length, updated: 0, resend: 0, cancelled: 0, missing: 0, untouched: 0, guests: body.p_guests.length }); }
    if (url.includes('/rest/v1/rpc/camp_transport_link_set')) {
      st.calls.push({ t: 'link_set', body });
      st.trips.forEach(t => { if (t.payment_entry_id === body.p_entry) t.payment_entry_id = null; });
      st.trips.forEach(t => { if (body.p_trip_ids.includes(t.id)) t.payment_entry_id = body.p_entry; });
      const e = st.ledger.find(x => x.id === body.p_entry); const sum = st.trips.filter(t => t.payment_entry_id === body.p_entry).reduce((s, t) => s + t.expected_price, 0);
      const n = body.p_trip_ids.length; const state = n && sum === e.amount_local ? 'matched' : body.p_note ? 'explained' : 'review';
      const l = st.links.find(x => x.entry_id === body.p_entry);
      Object.assign(l, { state, trips_amount: sum, trips_count: n, note: body.p_note, linked_by: 'manual', driver_id: body.p_driver, reason: state === 'review' ? (n ? 'amounts differ' : 'unlinked') : null });
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
  await page.addInitScript(([now]) => { window.TRANSPORT_NOW = now; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; }, [NOW]);
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

// ── Access ─────────────────────────────────────────────────────────────────
test('transport: tab shows for full Sri Lanka users only — not in local view, camp-tab-only or Morocco', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  await open(page);
  await expect(page.locator('.ntab[data-page="transport"]')).toBeVisible({ visible: true }).catch(async () => {
    // ≤820px the tabs live in the drawer
    expect(await page.locator('.ntab-m[data-page="transport"]').evaluate(el => el.style.display)).toBe('');
  });
  expect(errors).toEqual([]);
  for (const [query, slug] of [['&view=local', 'sri-lanka'], ['&view=camp-tab-only', 'sri-lanka'], ['', 'morocco']]) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await open(p, { query, slug });
    const r = await p.evaluate(() => {
      const shown = [...document.querySelectorAll('[data-page="transport"]')].some(b => b.style.display !== 'none');
      showPage('transport');
      return { shown, active: activePage, loaded: !!(window.TransportUI && TransportUI._state.loaded) };
    });
    expect(r.shown, `${slug}${query}`).toBe(false);
    if (slug === 'sri-lanka') expect(r.active, `${slug}${query}`).not.toBe('transport'); // local / camp-tab-only views refuse the page
    expect(await p.locator('#transportRoot').innerHTML()).toBe('');                    // Morocco: nothing renders
    expect(r.loaded).toBe(false);
    await p.close();
  }
});

// ── Next week import ───────────────────────────────────────────────────────
test('next week import: the Guests file is the source; HQ cross-checks (ok / missing / cancelled) and the RPC gets only live rows', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, {
    bookings: [
      { booking_ref: '2026-4660', booker: 'Lorena Marie Glas', check_in_on: '2026-11-14', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama', partner_name: 'Direct Bookings', raw_payload: { status: 'confirmed' } },
      { booking_ref: '2026-4936', booker: 'Maximilian Ehrler', check_in_on: '2026-11-14', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama', partner_name: 'Direct Bookings', raw_payload: { status: 'cancelled' } },
      { booking_ref: '2026-9999', booker: 'Ana Transfer', check_in_on: '2026-11-15', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama, Airport Transfer Sri Lanka', partner_name: 'Direct Bookings', raw_payload: { status: 'paid' } },
    ],
  });
  await page.click('button.pill:has-text("Next week")');
  await expect(page.locator('#transportRoot .card-title').first()).toContainText('Next week · 14–20 Nov'); // Fri 13 Nov → the coming Sat–Fri
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  // group 1: trips from the file — Maximilian is cancelled in HQ, so 3 of the 4 legs
  await expect(page.locator('#transportRoot')).toContainText('Airport trips from this file · 3');
  await expect(page.locator('#transportRoot')).toContainText('Lorena Marie Glas');
  await expect(page.locator('#transportRoot')).toContainText('in HQ');
  // soft line: refs not in HQ yet (16 bookings in the file − Lorena − Maximilian)
  await expect(page.locator('.tr-soft')).toContainText('14 bookings not yet in HQ — import bookings');
  // group 2: cancelled in HQ
  await expect(page.locator('#transportRoot')).toContainText('Cancelled in HQ · 1');
  // group 3: an HQ booking with a transfer product that the file does not have
  await expect(page.locator('#transportRoot')).toContainText('Transfer booked in HQ, not in this file · 1');
  await expect(page.locator('#transportRoot')).toContainText('Ana Transfer');
  await page.click('#trImportSave');
  await expect(page.locator('.status-msg.status-ok')).toContainText('Saved: 3 new');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_trips.map(t => t.key).sort()).toEqual(['bl:2026-4070:arr', 'bl:2026-4070:dep', 'bl:2026-4660:arr']);
  // HQ has Lorena as a direct booking → no partner, although the Guests file shows 599 due
  expect(imp.p_trips.find(t => t.key === 'bl:2026-4660:arr')).toMatchObject({ hq_match: 'ok', time: '01:55', expected_price: 21000, partner: null });
  expect(imp.p_trips.find(t => t.key === 'bl:2026-4070:arr')).toMatchObject({ hq_match: 'missing', vehicle: 'Minivan', expected_price: 26500 });
  expect(imp.p_cancel_refs).toEqual(['2026-4936']);
  expect(imp.p_guests.length).toBe(17); // 18 guests − Maximilian (cancelled in HQ)
  expect(imp.p_guests.every(g => ['ok', 'missing'].includes(g.hq_match))).toBe(true);
  // not in HQ → partner from the Guests «Booking due» > 0 (gen_from_guests.py rule)
  expect(imp.p_guests.find(g => g.booking_ref === '2026-4047')).toMatchObject({ hq_match: 'missing', partner: 'partner', booking_due: 639 });
  expect(imp.p_is_preset).toBe(true);
  expect(imp.p_export_date).toBe('2026-11-07');
  expect(errors).toEqual([]);
});

test('next week import: a file without a date in its name asks when it was downloaded', async ({ page }) => {
  await openTab(page);
  await page.click('button.pill:has-text("Next week")');
  await page.setInputFiles('#trGuestsFile', path.join(__dirname, 'fixtures', 'guests-13h47.csv'));
  await expect(page.locator('#transportRoot')).toContainText('When did you download this file?');
  await page.fill('#trExportDate', '2026-11-13');
  await page.click('.tr-date-ask button');
  await expect(page.locator('#transportRoot')).toContainText('exported 13 Nov');
  await expect(page.locator('#transportRoot')).toContainText('Airport trips from this file · 3');
});

// ── Trips list + WhatsApp ──────────────────────────────────────────────────
test('trips: list by day, WhatsApp to the «Send transfers to» contact in Miguel\'s format, Sent ✓ then Confirmed ✓', async ({ page }) => {
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
  await rows.first().locator('button:has-text("Sent ✓")').click();
  await expect(rows.first().locator('.badge-blue:has-text("Sent")')).toBeVisible();
  const upd = await call(st, 'trip_update');
  expect(upd.body).toMatchObject({ status: 'sent', needs_resend: false, sent_snapshot: { trip_date: '2026-11-14', trip_time: '01:55', flight: 'QR658', pax: 1 } });
  await rows.first().locator('button:has-text("Confirmed ✓")').click();
  await expect(rows.first().locator('.badge-green:has-text("Confirmed")')).toBeVisible();
  // whole day: 3 blocks separated by a blank line
  await page.click('button:has-text("Send the whole day")');
  const day = decodeURIComponent((await page.evaluate(() => window.__opened[1])).split('?text=')[1]);
  expect(day.split('\n\n').length).toBe(3);
  expect(day).toContain('Beliz Kuyumcuoglu\n+491700000002\n1 person\nFlight Number: TBC\nTime: TBC\nDate: 14 Nov\nMinivan');
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
  await expect(page.locator('.tr-strip')).toContainText('1 time changed — resend');
  const row = page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"]');
  await expect(row).toContainText('Time changed, resend');
  await row.locator('button[title="Send on WhatsApp"]').click();
  expect(await page.evaluate(() => window.__opened[0])).toMatch(/^https:\/\/wa\.me\/\?text=Airport%20to%20Camp/);
  await row.locator('button:has-text("Sent ✓")').click();
  await expect(row).not.toContainText('Time changed, resend');
  await expect(page.locator('#transportRoot')).not.toContainText('time changed — resend');
});

test('trips: manual transfer in one screen — who pays, price from /prices', async ({ page }) => {
  const st = await openTab(page);
  await page.click('button:has-text("Add transfer")');
  await page.fill('#at_g', 'Anna');
  await page.fill('#at_d', '2026-11-15');
  await page.fill('#at_t', '14:30');
  await expect(page.locator('#at_pr')).toHaveValue('21000');
  await page.click('#at_ch .pill:has-text("Free")');
  await page.click('#at_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'airport_arrival', trip_date: '2026-11-15', trip_time: '14:30', guest_names: 'Anna', charge: 'free', expected_price: 21000, source: 'manual', driver_id: D.dilan });
  await expect(page.locator('.tr-row')).toContainText('Anna');
});

test('trips: no-show from the trip screen', async ({ page }) => {
  const st = await openTab(page, { trips: NEXT_WEEK() });
  await page.evaluate(() => TransportUI.shiftWeek(7));
  await page.click('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a003"]');
  await page.click('#trOv button:has-text("No-show")');
  expect((await call(st, 'trip_update')).body).toMatchObject({ status: 'no_show' });
  await expect(page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a003"] .badge-grey')).toHaveText('No-show');
});

// ── Tuk-tuk day sheet ──────────────────────────────────────────────────────
test('tuk-tuk: one tap = one run saved as done; a double tap saves one; minus removes the last; tour runs carry the tour', async ({ page }) => {
  const st = await openTab(page);
  await page.click('button:has-text("Log tuk-tuk run")');
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
  expect(inserts[0]).toMatchObject({ kind: 'tuktuk', route: 'Ahangama', purpose: 'surf', expected_price: 500, status: 'done', driver_id: D.sampath, trip_date: '2026-11-13', trip_time: '10:00' });
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
    };
  });
  expect(r).toEqual({ matched: 'matched', owed: 'owed', owedManual: 'owed', paidNoShow: 'paid_not_done', paidCancelled: 'paid_not_done', paidUpcoming: 'paid_not_done',
    noShow: 'no_show', cancelled: 'cancelled', upcoming: 'upcoming', doneByTime: 'owed', noTimeToday: 'upcoming', extra: 'extra', tuktuk: 'matched' });
});

test('reconcile: rows, statuses and totals for the week, like the bank reconcile', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, recFixture());
  await page.click('button.pill:has-text("Reconcile")');          // this week: Sat 7 – Fri 13 Nov
  await expect(page.locator('.tr-rec .card-title')).toHaveText('Reconcile 7–13 Nov');
  const status = async (id) => page.locator(`tr[data-trip="${id}"]`).getAttribute('data-rec');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b001')).toBe('matched');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b002')).toBe('owed');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b003')).toBe('paid_not_done');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b004')).toBe('no_show');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b005')).toBe('extra');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b006')).toBe('upcoming');
  await expect(page.locator('tr[data-trip="aaaaaaaa-0000-4000-8000-00000000b001"]')).toContainText('Dilan 42000');
  const kpi = async (label) => (await page.locator(`.tr-kpis .kpi:has(.kpi-label:text-is("${label}")) .kpi-value`).textContent()).trim();
  expect(await kpi('Booked')).toBe('5');
  expect(await kpi('Done')).toBe('5');     // b001, b002, b005 + 2 tuk-tuk runs
  expect(await kpi('Paid')).toBe('4');     // b001, b003, b005, b007
  expect((await kpi('Owed to drivers')).replace(/[^0-9]/g, '')).toBe('22500');   // b002 21.000 + b008 1.500
  expect((await kpi('Paid without trips')).replace(/[^0-9]/g, '')).toBe('6500'); // p2 5.000 + p4 1.500
  await expect(page.locator('.tr-reconciled')).toHaveCount(0);
  // To do filter keeps only the problems
  await page.click('.tr-rec-right .pill:has-text("To do")');
  await expect(page.locator('tr[data-trip]')).toHaveCount(2);
  // Tuk-tuk tab: one paid run, one owed
  await page.click('.tr-rec-pills .pill:has-text("Tuk-tuk")');
  await page.click('.tr-rec-right .pill:has-text("All")');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b007')).toBe('matched');
  expect(await status('aaaaaaaa-0000-4000-8000-00000000b008')).toBe('owed');
  // Payments tab: 2 to review, 2 matched
  await page.click('.tr-rec-pills .pill:has-text("Payments")');
  await expect(page.locator('tr[data-pay][data-state="review"]')).toHaveCount(2);
  await expect(page.locator(`tr[data-pay="${P.p4}"]`)).toContainText('no driver named');
  expect(errors).toEqual([]);
});

test('reconcile: «Week reconciled» when every done trip is paid and every payment has its trips', async ({ page }) => {
  const f = recFixture();
  f.trips = f.trips.filter(t => ['aaaaaaaa-0000-4000-8000-00000000b001', 'aaaaaaaa-0000-4000-8000-00000000b005', 'aaaaaaaa-0000-4000-8000-00000000b006', 'aaaaaaaa-0000-4000-8000-00000000b004', 'aaaaaaaa-0000-4000-8000-00000000b007'].includes(t.id));
  f.links = f.links.filter(l => l.state === 'matched'); f.ledger = f.ledger.filter(e => f.links.some(l => l.entry_id === e.id));
  await openTab(page, f);
  await page.click('button.pill:has-text("Reconcile")');
  await expect(page.locator('.tr-reconciled')).toContainText('Week reconciled');
});

test('reconcile: Link trips / Unlink / Mark explained on a payment, Link and Unlink on a trip', async ({ page }) => {
  const st = await openTab(page, recFixture());
  await page.evaluate(() => TransportUI.setRec('payments'));
  // Link the owed trip to the 25.000 payment (which already has the paid no-show)
  await page.locator(`tr[data-pay="${P.p2}"] button:has-text("Link trips")`).click();
  await page.locator('#trOv input[data-id="aaaaaaaa-0000-4000-8000-00000000b002"]').check();
  await expect(page.locator('#lk_sum')).toContainText('difference');
  await page.locator('#trOv input[data-id="aaaaaaaa-0000-4000-8000-00000000b003"]').uncheck();
  await page.fill('#lk_note', 'Waiting time');
  await page.click('#lk_save');
  let last = (await call(st, 'link_set', 1)).body;
  expect(last).toMatchObject({ p_entry: P.p2, p_driver: D.dilan, p_trip_ids: ['aaaaaaaa-0000-4000-8000-00000000b002'], p_note: 'Waiting time' });
  await expect(page.locator(`tr[data-pay="${P.p2}"]`)).toHaveAttribute('data-state', 'explained');
  // Unlink it again
  await page.locator(`tr[data-pay="${P.p2}"] button:has-text("Unlink")`).click();
  last = (await call(st, 'link_set', 2)).body;
  expect(last).toMatchObject({ p_entry: P.p2, p_trip_ids: [], p_note: null });
  await expect(page.locator(`tr[data-pay="${P.p2}"]`)).toHaveAttribute('data-state', 'review');
  // Mark the fuel row explained
  await page.locator(`tr[data-pay="${P.p4}"] button:has-text("Mark explained")`).click();
  await page.fill('#ex_note', 'scooter fuel, not a driver');
  await page.click('#trOv .btn-p');
  last = (await call(st, 'link_set', 3)).body;
  expect(last).toMatchObject({ p_entry: P.p4, p_trip_ids: [], p_note: 'scooter fuel, not a driver' });
  await expect(page.locator(`tr[data-pay="${P.p4}"]`)).toHaveAttribute('data-state', 'explained');
  // From a trip row: Link → pick the payment; Unlink → removes only that trip
  await page.evaluate(() => TransportUI.setRec('airport'));
  await page.locator('tr[data-trip="aaaaaaaa-0000-4000-8000-00000000b002"] button:has-text("Link")').click();
  await page.locator(`#trOv .tr-pick-btn:has-text("Dilan 25000")`).click();
  last = (await call(st, 'link_set', 4)).body;
  expect(last).toMatchObject({ p_entry: P.p2, p_trip_ids: ['aaaaaaaa-0000-4000-8000-00000000b002'] });
  await page.locator('tr[data-trip="aaaaaaaa-0000-4000-8000-00000000b005"] button:has-text("Unlink")').click();
  last = (await call(st, 'link_set', 5)).body;
  expect(last).toMatchObject({ p_entry: P.p1, p_trip_ids: ['aaaaaaaa-0000-4000-8000-00000000b001'], p_note: null });
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
  await page.click('button:has-text("Pay a driver")');
  await page.click('#trOv .tr-pick-btn:has-text("Dilan")');
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
    return { text: hit.text, level: hit.level, local, morocco, before, page: activePage, rec: TransportUI._state.view, tab: TransportUI._state.recTab };
  });
  expect(r.text).toMatch(/^Transport payment not linked to trips · 2 · LKR\s6,500$/);
  expect(r.level).toBe('warn');
  expect([r.local, r.morocco, r.before]).toEqual([null, null, null]);
  expect([r.page, r.rec, r.tab]).toEqual(['transport', 'reconcile', 'payments']);
});

test('transport: works with the tables missing (SQL not run yet) — a clear message, no crash', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await open(page, { missingTables: true });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.error, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  await expect(page.locator('#transportRoot .status-warn')).toContainText('Ask Miguel to run supabase/camp-trips.sql');
  expect(errors).toEqual([]);
});
