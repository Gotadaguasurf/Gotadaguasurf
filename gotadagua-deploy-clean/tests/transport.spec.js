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
    if (url.includes('/rest/v1/rpc/camp_trips_import')) { st.calls.push({ t: 'import', body }); return json({ inserted: body.p_trips.length, updated: 0, resend: 0, cancelled: 0, missing: 0, untouched: 0, guests: body.p_guests.length }); }
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
test('next week import: the Guests file stands alone — HQ bookings are never read or used (Miguel, 13 Nov)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const hqReads = [];
  page.on('request', r => { if (/\/rest\/v1\/bookings\?.*(booking_ref=in|check_in_on=gte)/.test(r.url())) hqReads.push(r.url()); }); // the import's own HQ reads (the hub's Overview load is separate)
  const st = await openTab(page, {
    bookings: [ // HQ says Maximilian is cancelled — the camp import must not care
      { booking_ref: '2026-4660', booker: 'Lorena Marie Glas', check_in_on: '2026-11-14', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama', partner_name: 'Direct Bookings', raw_payload: { status: 'confirmed' } },
      { booking_ref: '2026-4936', booker: 'Maximilian Ehrler', check_in_on: '2026-11-14', location: 'Surf Camp Ahangama', package: 'Surf Camp Ahangama', partner_name: 'Direct Bookings', raw_payload: { status: 'cancelled' } },
    ],
  });
  await page.click('button.pill:has-text("Next week")');
  await expect(page.locator('#transportRoot .card-title').first()).toContainText('Next week · 14–20 Nov');
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('#transportRoot')).toContainText('Airport trips from this file · 6');
  await expect(page.locator('#transportRoot')).toContainText('Maximilian Ehrler');
  await expect(page.locator('#transportRoot')).not.toContainText('in HQ');
  await expect(page.locator('#transportRoot')).not.toContainText('Cancelled in HQ');
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

test('next week import: every row of the file is accounted for — imported, or left out with its reason (audit of 13 Nov)', async ({ page }) => {
  const st = await openTab(page);
  await page.click('button.pill:has-text("Next week")');
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('#transportRoot .tr-audit')).toHaveText('18 rows in the file = 18 guests imported + 0 left out');
  await expect(page.locator('#transportRoot .tr-audit')).toHaveClass(/hint/);
  await expect(page.locator('#transportRoot .tr-leftout')).toHaveCount(0);
  // invented rows: a +1 with no name, a request, another camp, a row with no dates
  const head = '"Guest","Booking status","Booking","Accommodations","Bed number","Packages","Check-in on","Check-out on","Has transfer"';
  const csv = [head,
    '"Kai Kopp","paid","2026-9007","Hiriketeya Beach Superior Ensuite Room","1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","No"',
    '"","paid","2026-9007","Hiriketeya Beach Superior Ensuite Room","2","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","No"',
    '"Nora Nagel","request","2026-9010","Unawatuna Beach Shared Room (only girls)","1","Surf Camp Ahangama","Sat 14 Nov 2026","Sat 21 Nov 2026","No"',
    '"Pia Pohl","paid","2026-9012","17 - Castelo beach mixed dorm","1","Offseason Custom Package","Fri 27 Nov 2026","Sun 29 Nov 2026","No"',
    '"Quin Quast","paid","2026-9013","Madiha Beach Standard Ensuite Room","1","Surf Camp Ahangama","","","No"'].join('\n');
  await page.setInputFiles('#trGuestsFile', { name: 'Bookinglayer-Guests-2026-11-13 10_00.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.locator('#transportRoot .tr-audit')).toHaveText('5 rows in the file = 2 guests imported + 3 left out · 2 to look at');
  await expect(page.locator('#transportRoot .tr-audit')).toHaveClass(/status-warn/);
  const left = page.locator('#transportRoot .tr-leftout .tr-row');
  await expect(left).toHaveCount(3);
  await expect(left.nth(0)).toContainText('Nora Nagel');
  await expect(left.nth(0)).toContainText('status «request»');
  await expect(left.nth(0).locator('.badge')).toHaveText('Check');
  await expect(left.nth(1)).toContainText('other camp (17 - Castelo beach mixed dorm)');
  await expect(left.nth(1).locator('.badge')).toHaveCount(0);
  await expect(left.nth(2)).toContainText('Quin Quast');
  await expect(left.nth(2)).toContainText('no check-in or check-out date: on no list');
  await expect(page.locator('#transportRoot .tr-soft')).toContainText('1 guest with no name or a repeated name on the booking, kept as separate people: Guest without name (booking 2026-9007)');
  await page.click('#trImportSave');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_guests.map(g => g.guest_key)).toEqual(['kai kopp', 'guest without name (booking 2026-9007)']);
});

test('next week import: a file without a date in its name asks when it was downloaded', async ({ page }) => {
  await openTab(page);
  await page.click('button.pill:has-text("Next week")');
  await page.setInputFiles('#trGuestsFile', path.join(__dirname, 'fixtures', 'guests-13h47.csv'));
  await expect(page.locator('#transportRoot')).toContainText('When did you download this file?');
  await page.fill('#trExportDate', '2026-11-13');
  await page.click('.tr-date-ask button');
  await expect(page.locator('#transportRoot')).toContainText('exported 13 Nov');
  await expect(page.locator('#transportRoot')).toContainText('Airport trips from this file · 6');
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
  await page.click('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a003"] .tr-line1 b'); // the name — the row centre now holds «Ask guest»
  await page.click('#trOv button:has-text("No-show")');
  expect((await call(st, 'trip_update')).body).toMatchObject({ status: 'no_show' });
  await expect(page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a003"] .badge-grey')).toHaveText('No-show');
});

// ── Tuk-tuk day sheet ──────────────────────────────────────────────────────
test('tuk-tuk: one tap = one run saved as done; a double tap saves one; minus removes the last; tour runs carry the tour', async ({ page }) => {
  const st = await openTab(page);
  await page.click('button:has-text("Tuk-tuk runs")');
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
      beforeGoLive: S(T({ trip_date: '2026-10-30' })), paidBeforeGoLive: S(T({ trip_date: '2026-10-30', payment_entry_id: 'p' })),
    };
  });
  expect(r).toEqual({ matched: 'matched', owed: 'owed', owedManual: 'owed', paidNoShow: 'paid_not_done', paidCancelled: 'paid_not_done', paidUpcoming: 'paid_not_done',
    noShow: 'no_show', cancelled: 'cancelled', upcoming: 'upcoming', doneByTime: 'owed', noTimeToday: 'upcoming', extra: 'extra', tuktuk: 'matched',
    beforeGoLive: 'before_go_live', paidBeforeGoLive: 'matched' });
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
  await expect(page.locator('#transportRoot .status-warn')).toContainText('Ask Miguel to run supabase/camp-trips.sql');
  expect(errors).toEqual([]);
});

test('next week import: a Bookinglayer Guests .xlsx is read like the CSV (Excel reader stubbed)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const csv = require('fs').readFileSync(GUESTS_CSV, 'utf8');
  // Stand-in for SheetJS: the app only calls XLSX.read + XLSX.utils.sheet_to_csv.
  await page.addInitScript(text => {
    window.XLSX = { read: () => ({ SheetNames: ['Guests'], Sheets: { Guests: {} } }), utils: { sheet_to_csv: () => text } };
  }, csv);
  await openTab(page);
  await page.click('button.pill:has-text("Next week")');
  expect(await page.locator('#trGuestsFile').getAttribute('accept')).toContain('.xlsx');
  await page.setInputFiles('#trGuestsFile', { name: 'Bookinglayer-Guests-2026-11-07 14_23.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake xlsx') });
  await expect(page.locator('#transportRoot')).toContainText('Airport trips from this file · 6');
  await expect(page.locator('#transportRoot')).toContainText('exported 7 Nov');
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
  expect(text).toContain("I'm Francisco, the manager of Gota Dagua Surf Camp Sri Lanka.");
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);                                         // no emoji (wa.me shows «?» on desktop)
  await expect(page.locator('.tr-day').first().locator('.tr-row').filter({ hasText: 'Beliz Kuyumcuoglu' })).toContainText('asked');
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
  test(`trips: paid or not on every row, free tags and the week totals — ${name}`, async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize(size);
    await openTab(page, weekFixture());
    // The logic in one plain line under the title.
    await expect(page.locator('#transportRoot .tr-how')).toHaveText('Transfers come from the Guests file (Week → Import). Tuk-tuks: plan tomorrow and send the order. Nadith pays in the Ledger (Transport · Airport) and ticks the guests, and they show as Paid here.');
    await expect(page.locator('.tr-week')).toHaveText('7–13 Nov');
    // Week totals: drivers' prices; cancelled left out; free is a part of the airport count, not an extra.
    const air = norm(await page.locator('[data-total="airport"]').innerText());
    expect(air).toBe('AIRPORT · 5 TRANSFERS LKR 109,500 Paid LKR 41,000 · Owed LKR 47,500 · Planned LKR 21,000 Free: 2 · LKR 41,000 (Staff: Kasun; Gift: Alicia)');
    expect(norm(await page.locator('[data-total="tuktuk"]').innerText())).toBe('TUK-TUK · 4 RUNS LKR 3,000 Paid LKR 1,500 · Owed LKR 1,500');
    expect(norm(await page.locator('[data-total="week"]').innerText())).toBe('WEEK TOTAL LKR 112,500 Paid LKR 42,500 · Owed LKR 49,000 · Planned LKR 21,000');
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
    await expect(row(R(105)).locator('[data-pay="planned"]')).toHaveText('Planned');
    await expect(row(R(106)).locator('[data-pay="off"]')).toHaveText('Cancelled');
    // Tuk-tuk lines: one per route and state.
    const lines = page.locator('.tr-tuk-line');
    await expect(lines).toHaveCount(2);
    expect(norm(await lines.nth(0).innerText())).toBe('Ahangama × 3 Sampath · done, not paid Owed LKR 1,500');
    expect(norm(await lines.nth(1).innerText())).toBe('Weligama × 1 Sampath · 12 Nov · linked automatically Paid LKR 1,500');
    // The Airport / Tuk-tuk pills filter the list, never the totals.
    await page.click('.tr-filters .pill:has-text("Tuk-tuk")');
    await expect(page.locator('.tr-row')).toHaveCount(0);
    expect(norm(await page.locator('[data-total="airport"]').innerText())).toBe(air);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    // Before go-live (the real one, 14 Nov) nothing is «owed»: it is not tracked.
    await page.evaluate(() => { window.TRIPS_GO_LIVE_OVERRIDE = '2026-11-14'; TransportUI.setFilter('all'); });
    await expect(row(R(102)).locator('[data-pay="old"]')).toHaveText('Before go-live');
    expect(norm(await page.locator('[data-total="airport"]').innerText())).toContain('Owed LKR 0 · Planned LKR 21,000 · Before go-live LKR 47,500');
    expect(errors).toEqual([]);
  });
}

test('tuk-tuk: tap a line to edit its runs, remove one, delete them; a paid run is read-only («unlink the payment first»)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, weekFixture());
  const owed = page.locator('.tr-tuk-line', { hasText: 'Ahangama' });
  await owed.click();
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Tuk-tuk · Thu 12 Nov');
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
  await line.click();
  await page.click('#rn_one');
  await call(st, 'trip_delete', 1);
  await expect(page.locator('.tr-tuk-line', { hasText: 'Weligama × 2' })).toHaveCount(1);
  // Delete the rest (asks first when it is more than one).
  await page.locator('.tr-tuk-line', { hasText: 'Weligama × 2' }).click();
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
  await page.click('#trOv .tr-paid-note button');
  await expect(page.locator('.tr-rec')).toBeVisible();                              // straight to Reconcile → Tuk-tuk
  expect(st.calls.filter(c => c.t === 'trip_delete').length).toBe(3);
  expect(errors).toEqual([]);
});

test('tuk-tuk: plan tomorrow — timed runs saved as planned, the WhatsApp order in the camp format, Sent ✓, changed since sent', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page);
  await page.click('button:has-text("Tuk-tuk runs")');
  await page.click('#tk_mode .pill:has-text("Plan tomorrow")');
  await expect(page.locator('#tk_pd')).toHaveValue('2026-11-14');                   // tomorrow (now = Fri 13 Nov)
  await expect(page.locator('#tk_pt')).toHaveValue('07:30');
  await expect(page.locator('#tk_send')).toBeDisabled();
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);                        // one blue button
  const add = async (time, route, n) => { await page.fill('#tk_pt', time); await page.selectOption('#tk_pr', route); await page.fill('#tk_pn', String(n)); await page.click('#tk_padd'); };
  await add('07:30', 'surf|Ahangama', 2);
  await expect(page.locator('.tr-plan-line')).toHaveCount(1);
  await add('15:00', 'camp|Market / food', 1);
  await add('07:30', 'surf|Weligama', 1);
  await expect(page.locator('.tr-plan-line')).toHaveCount(3);
  const ins = st.calls.filter(c => c.t === 'trip_insert').map(c => c.rows[0]);
  expect(ins.length).toBe(4);
  expect(ins[0]).toMatchObject({ kind: 'tuktuk', trip_date: '2026-11-14', trip_time: '07:30', route: 'Ahangama', purpose: 'surf', status: 'planned', driver_id: D.sampath, expected_price: 500, source: 'manual' });
  expect(ins[2]).toMatchObject({ trip_time: '15:00', route: 'Market / food', purpose: 'food', status: 'planned' });
  await expect(page.locator('#tk_sent')).toHaveText('Not sent yet');
  await expect(page.locator('#tk_send')).toHaveText('Send order to Sampath');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Planned, not done: done by itself once the time passes (like an airport trip).
  expect(await page.evaluate(() => { const t = TransportUI._state.trips.find(x => x.kind === 'tuktuk'); return [TransportUI.isDone(t), TransportUI.payState(t).key, TransportUI.isDone({ ...t, trip_date: '2026-11-13', trip_time: '07:30' }), TransportUI.payState({ ...t, trip_date: '2026-11-13', trip_time: '07:30' }).key]; }))
    .toEqual([false, 'planned', true, 'owed']);
  // Send: no phone for Sampath yet → wa.me without a number; the camp's own format, no emoji.
  await page.click('#tk_send');
  await call(st, 'trip_update', 4);
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith('https://wa.me/?text=')).toBe(true);
  const text = decodeURIComponent(url.split('?text=')[1]);
  expect(text).toBe('*TUK TUKS - SAT 14 NOV*\n\n07:30 Camp → Ahangama ×2\n07:30 Camp → Weligama ×1\n\n15:00 Market / food ×1');
  expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  expect(st.calls.filter(c => c.t === 'trip_update').every(c => c.body.status === 'sent' && c.body.sent_at && c.body.needs_resend === false)).toBe(true);
  await expect(page.locator('#tk_sent')).toHaveText('Sent ✓');
  await expect(page.locator('#tk_send')).toContainText('Send again to Sampath');
  // One more Ahangama after the order went out → it has to be sent again.
  await page.locator('.tr-plan-line', { hasText: 'Camp → Ahangama' }).locator('button[title="One run more"]').click();
  await expect(page.locator('.tr-plan-line', { hasText: 'Camp → Ahangama' }).locator('.tr-step b')).toHaveText('3');
  await expect(page.locator('#tk_sent')).toHaveText('Changed since sent');
  await page.locator('.tr-plan-line', { hasText: 'Market / food' }).locator('button[title="One run less"]').click();
  await expect(page.locator('.tr-plan-line')).toHaveCount(2);
  // Back on the page: tomorrow's runs show with their time and state, and a chip asks for the order.
  await page.click('#trOv .mfooter .btn-s');
  await expect(page.locator('.tr-strip')).toContainText('1 tuk-tuk run for tomorrow — send the order');
  await page.evaluate(() => TransportUI.shiftWeek(7));
  const lines = page.locator('.tr-tuk-line');
  await expect(lines).toHaveCount(3);
  expect((await lines.allInnerTexts()).map(norm)).toEqual([
    '07:30 Ahangama × 1 Sampath Planned LKR 500',
    '07:30 Ahangama × 2 Sampath Sent LKR 1,000',
    '07:30 Weligama × 1 Sampath Sent LKR 1,500',
  ]);
  await page.click('.tr-strip .health-chip:has-text("send the order")');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Plan tomorrow');
  expect(errors).toEqual([]);
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
  await page.evaluate(() => TransportUI.openPlan());
  await expect(page.locator('#tk_send')).toHaveText('Send order to Nadith');
  await page.click('#tk_send');
  await call(st, 'trip_update');
  expect(await page.evaluate(() => window.__opened[0])).toContain('https://wa.me/94771234567?text=' + encodeURIComponent('*TUK TUKS - SAT 14 NOV*'));
});

test('free: a transfer for staff or a gift — Add transfer (Staff → Free · Staff), mark a trip Free with its reason, delete one added by hand', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page, { trips: NEXT_WEEK() });
  await page.click('button:has-text("Add transfer")');
  await expect(page.locator('#at_who .pill.active')).toHaveText('Guest');
  await expect(page.locator('#at_fr_wrap')).toBeHidden();
  await page.click('#at_who .pill:has-text("Staff")');
  await expect(page.locator('#at_g_lbl')).toHaveText('Name');
  await expect(page.locator('#at_ch .pill.active')).toHaveText('Free');
  await expect(page.locator('#at_fr .pill.active')).toHaveText('Staff');
  await page.fill('#at_g', 'Kasun');
  await page.fill('#at_d', '2026-11-15');
  await page.fill('#at_n', 'visa run');
  await page.click('#at_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'airport_arrival', guest_names: 'Kasun', purpose: 'staff', charge: 'free', free_reason: 'staff', notes: 'visa run', expected_price: 21000, source: 'manual' });
  const mine = page.locator('.tr-row', { hasText: 'Kasun' });
  await expect(mine.locator('.tr-free')).toHaveText('Free · Staff');
  await expect(page.locator('[data-total="airport"] .tr-t-free')).toHaveText('Free: 1 · LKR 21,000 (Staff: Kasun)');
  // A Bookinglayer transfer becomes a gift.
  await page.click('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"] .tr-line1 b');
  await expect(page.locator('#tr_del')).toHaveCount(0);                             // imported trips are cancelled, never deleted
  await page.click('#tr_ch .pill:has-text("Free")');
  await page.click('#tr_fr .pill:has-text("Gift to guest")');
  await page.click('#trOv .btn-p');
  expect((await call(st, 'trip_update')).body).toEqual({ charge: 'free', free_reason: 'gift' });   // not an import field: edited_fields untouched
  await expect(page.locator('.tr-row[data-trip="aaaaaaaa-0000-4000-8000-00000000a001"] .tr-free')).toHaveText('Free · Gift');
  await expect(page.locator('[data-total="airport"] .tr-t-free')).toHaveText('Free: 2 · LKR 42,000 (Staff: Kasun; Gift: Lorena)');
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
  await page.click('button:has-text("Add transfer")');
  await page.click('#at_who .pill:has-text("Staff")');
  await page.fill('#at_g', 'Kasun');
  await page.fill('#at_d', '2026-11-15');
  await page.click('#at_save');
  const ins = (await call(st, 'trip_insert')).rows[0];
  expect(ins.charge).toBe('free');
  expect('free_reason' in ins).toBe(false);
  expect(st.calls.filter(c => c.t === 'free_refused').length).toBe(1);
  await expect(page.locator('#toast')).toHaveText('Transfer added');
  await expect(page.locator('.tr-row', { hasText: 'Kasun' }).locator('.tr-free')).toHaveText('Free');
});

test('local view: Nadith still has no Transport tab and none of the new Transport tools', async ({ page }) => {
  await open(page, { query: '&view=local', ...weekFixture() });
  await expect(page.locator('.ntab[data-page="transport"]:visible, .ntab-m[data-page="transport"]:visible')).toHaveCount(0);
  expect(await page.evaluate(() => { TransportUI.openPlan && 0; return document.getElementById('transportRoot').innerHTML; })).toBe('');
});
