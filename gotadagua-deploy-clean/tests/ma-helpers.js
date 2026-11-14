// Morocco camp hub — stubbed Supabase shared by tests/morocco-*.spec.js (14 Nov 2026).
// Guests = the synthetic Morocco Guests export (tests/fixtures/ma-guests-2026-11-14.csv, fake
// people) read with the Morocco settings (lib/camp-config.js). «Now» is pinned in Casablanca
// time with window.TRANSPORT_NOW. Nothing reaches a real database.
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const GT = require('../lib/guests-trips.js');
const CC = require('../lib/camp-config.js');
const { fakeOwnerSession } = require('./helpers');

const LOC = '45aba3b6-de7f-4f94-ae31-43880e23b1b7';
const FILE = 'ma-guests-2026-11-14.csv';
const FILE2 = 'ma-guests-2026-11-15.csv';
const CSV = name => path.join(__dirname, 'fixtures', name);
const IMPORT_ID = '22222222-0000-4000-8000-000000000001';
const D = { lut: 'dddddddd-0000-4000-8000-0000000000a1', fat: 'dddddddd-0000-4000-8000-0000000000a2', flo: 'dddddddd-0000-4000-8000-0000000000a3' };
const DRIVERS = [
  { id: D.lut, location_id: LOC, name: 'Let Us Tours', label: 'Airport transfers', phone: '+212600000101', aliases: ['Let Us Tours'], kinds: ['airport'], default_for: ['airport', 'transfers_contact'], active: true },
  { id: D.fat, location_id: LOC, name: 'Fathoune', label: 'Surf vans', phone: '+212600000102', aliases: ['Fathoune', 'Mounir'], kinds: ['van'], default_for: ['van', 'van_contact'], active: true },
];
// /prices (pricing_catalog) for Morocco as on 14 Nov 2026: one price per airport and vehicle.
const CATALOG = [['Agadir Airport — Car', 250], ['Agadir Airport — Minivan', 300], ['Agadir Airport — Big Van', 500],
  ['Marrakech Airport — Car', 1200], ['Marrakech Airport — Minivan', 1500], ['Marrakech Airport — Big Van', 2200]]
  .map(([name, cost], i) => ({ id: `cat-${i}`, name, cost_per_guest: cost, currency: 'MAD', notes: '', linked_transport_preset_id: `p-${name.split(' — ')[0]}`, linked_camp_tab_id: null, picker_tab: 'airport', sort_order: i }));

let seq = 0;
const uid = (p = 'eeeeeeee') => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
function guestsFromFile(name = FILE, importId = IMPORT_ID, at = '2026-11-14T08:00:00Z') {
  return GT.guestRows(fs.readFileSync(CSV(name), 'utf8'), name, CC.MA).filter(g => GT.OK_STATUS.has(g.booking_status) && g.check_in && g.check_out)
    .map((g, i) => ({ id: `99999999-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: LOC, ...g, hq_match: null, import_id: importId, updated_at: at }));
}
// Trips as the import would store them (parser → camp_trips rows).
function tripsFromFile(name = FILE) {
  const p = GT.parse(fs.readFileSync(CSV(name), 'utf8'), name, null, CC.MA);
  const price = (t) => { const city = CC.MA.airportCity[t.place] || 'Agadir'; const row = CATALOG.find(c => c.name === `${city} Airport — ${t.vehicle}`); return row ? row.cost_per_guest : 0; };
  return p.trips.map((t, i) => ({ id: `aaaaaaaa-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: LOC, kind: t.kind, trip_date: t.date, trip_time: t.time, pickup_time: null, flight: t.flight || null, place: t.place,
    route: t.kind === 'airport_departure' ? 'Surfcamp → Airport' : 'Airport → Surfcamp', purpose: 'guests', tour_name: null, guest_names: t.guests.join(', '), guest_phone: t.phone || null,
    booking_ref: t.booking_ref, booking_checkout: t.booking_checkout, pax: t.pax, vehicle: t.vehicle, driver_id: D.lut, expected_price: price(t), currency: 'MAD', status: 'planned', source: 'bookinglayer',
    charge: t.charge, import_key: t.key, import_flags: t.flags, edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null, created_at: '2026-11-14T08:00:00Z' }));
}

async function stub(page, opts = {}) {
  const st = { guests: opts.guests || guestsFromFile(), msgs: [], drivers: (opts.drivers || DRIVERS).map(d => ({ ...d })), trips: (opts.trips || []).map(t => ({ ...t })),
    ledger: (opts.ledger || []).map(r => ({ ...r })), links: opts.links || [], calls: [], urls: [], posted: [], group: opts.group || null };
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    st.urls.push(method + ' ' + url);
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
    const q = k => (url.match(new RegExp(`[?&]${k}=([^&]+)`)) || [])[1];
    const idEq = (q('id') || '').replace(/^eq\./, '');
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Morocco', slug: 'morocco', currency: 'MAD', default_fx_to_eur: 10.8, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(r => { st.posted.push(r); const i = st.ledger.findIndex(x => x.id === r.id); if (i >= 0) st.ledger[i] = { ...st.ledger[i], ...r }; else st.ledger.push({ created_at: new Date().toISOString(), ...r }); }); return json([]); }
      return json(method === 'GET' ? st.ledger : []);
    }
    if (url.includes('/rest/v1/camp_drivers')) {
      if (method === 'GET') return json(st.drivers);
      if (method === 'PATCH') { const d = st.drivers.find(x => x.id === idEq); Object.assign(d, body); st.calls.push({ t: 'driver_update', id: idEq, body }); return json([d]); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('dddddddd'), active: true, ...r })); st.drivers.push(...rows); st.calls.push({ t: 'driver_insert', rows }); return json(rows); }
    }
    if (url.includes('/rest/v1/camp_trips')) {
      if (method === 'GET') return json(st.trips);
      if (method === 'PATCH') { const t = st.trips.find(x => x.id === idEq); Object.assign(t, body); st.calls.push({ t: 'trip_update', id: idEq, body }); return json([t]); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('bbbbbbbb'), created_at: new Date().toISOString(), payment_entry_id: null, needs_resend: false, import_flags: [], edited_fields: [], ...r })); st.trips.push(...rows); st.calls.push({ t: 'trip_insert', rows }); return json(rows); }
      if (method === 'DELETE') { st.trips = st.trips.filter(x => x.id !== idEq); st.calls.push({ t: 'trip_delete', id: idEq }); return json([]); }
    }
    if (url.includes('/rest/v1/camp_transport_payments')) return json(st.links);
    if (url.includes('/rest/v1/pricing_catalog')) return json(url.includes('category=eq.Transport') && !opts.noPrices ? CATALOG : []);
    if (url.includes('/rest/v1/rpc/camp_transport_autolink')) return json({});
    if (url.includes('/rest/v1/rpc/camp_transport_link_set')) {
      st.calls.push({ t: 'link_set', body });
      const ids = body.p_trip_ids || []; st.trips.forEach(t => { if (ids.includes(t.id)) t.payment_entry_id = body.p_entry; });
      const e = st.ledger.find(x => x.id === body.p_entry) || {}; const sum = st.trips.filter(t => ids.includes(t.id)).reduce((s, t) => s + Number(t.expected_price || 0), 0);
      const state = sum === Number(e.amount_local) ? 'matched' : body.p_note ? 'explained' : 'review';
      st.links = st.links.filter(l => l.entry_id !== body.p_entry).concat({ entry_id: body.p_entry, location_id: LOC, driver_id: body.p_driver, entry_amount: Number(e.amount_local), trips_amount: sum, trips_count: ids.length, state, reason: state === 'review' ? 'amounts differ' : null, linked_by: 'manual', reviewed_by: 'u1', note: body.p_note });
      return json({ state, trips: ids.length, trips_amount: sum, amount: e.amount_local });
    }
    if (url.includes('/rest/v1/rpc/camp_transport_link_own')) { st.calls.push({ t: 'link_own', body }); return json({ state: 'matched' }); }
    if (url.includes('/rest/v1/rpc/camp_trips_import')) { st.calls.push({ t: 'import', body }); return json({ inserted: body.p_trips.length, updated: 0, resend: 0, cancelled: 0, missing: 0, untouched: 0, guests: body.p_guests.length }); }
    if (url.includes('/rest/v1/bookings')) { st.calls.push({ t: 'bookings', url }); return json([]); }
    if (url.includes('/rest/v1/location_state_store') && url.includes('week_group_v1') && method === 'GET') return json(st.group ? [{ state_json: st.group }] : []);
    if (url.includes('/rest/v1/location_state_store') && method === 'POST' && body && body.state_key === 'week_group_v1') { st.group = body.state_json; st.calls.push({ t: 'group_save', body }); return json([]); }
    if (url.includes('/rest/v1/camp_week_guests')) {
      if (method === 'PATCH') { const g = st.guests.find(x => x.id === idEq); Object.assign(g, body); st.calls.push({ t: 'guest_update', id: idEq, body }); return json([g]); }
      let rows = st.guests.filter(g => g.location_id === LOC);
      if (q('order') === 'updated_at.desc') return json(rows.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 1).map(g => ({ import_id: g.import_id, updated_at: g.updated_at })));
      const imp = (q('import_id') || '').replace(/^eq\./, ''); if (imp) return json(rows.filter(g => g.import_id === imp).map(g => ({ check_in: g.check_in })));
      const lte = (q('check_in') || '').replace(/^lte\./, ''); const gte = (q('check_out') || '').replace(/^gte\./, '');
      if (lte) rows = rows.filter(g => g.check_in <= lte); if (gte) rows = rows.filter(g => g.check_out >= gte);
      return json(rows);
    }
    if (url.includes('/rest/v1/camp_week_messages')) {
      if (method === 'GET') { const ws = (q('week_start') || '').replace(/^eq\./, ''); return json(st.msgs.filter(m => !ws || m.week_start === ws).sort((a, b) => b.sent_at.localeCompare(a.sent_at))); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('77777777'), sent_at: '2026-11-14T09:31:00Z', sent_by: 'u1', ...r })); st.msgs.push(...rows); st.calls.push({ t: 'msg_insert', rows }); return json(rows); }
      if (method === 'DELETE') { st.msgs = st.msgs.filter(m => m.id !== idEq); return json([]); }
    }
    return json([]);
  });
  return st;
}
async function open(page, opts = {}) {
  const st = await stub(page, opts);
  page.on('dialog', d => d.accept());
  await page.addInitScript(([now, golive]) => { window.TRANSPORT_NOW = now; if (golive) window.TRIPS_GO_LIVE_OVERRIDE = golive; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; };
    window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); } catch (_) {} }, [opts.now || '2026-11-14T10:00', opts.goLive || null]);
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=morocco${opts.query || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return st;
}
async function openWeek(page, opts = {}) {
  const st = await open(page, opts);
  await page.waitForFunction(() => window.WeekUI && WeekUI._state.metaLoaded && window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('week'));
  await expect(page.locator('#weekRoot .wk-tabs')).toBeVisible();
  return st;
}
async function call(st, kind, n = 1) {
  await expect.poll(() => st.calls.filter(c => c.t === kind).length, { timeout: 5000 }).toBeGreaterThanOrEqual(n);
  return st.calls.filter(c => c.t === kind)[n - 1];
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
// Emoji and pictographs (WhatsApp desktop shows some of them as «?» in wa.me links).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

module.exports = { LOC, FILE, FILE2, CSV, D, DRIVERS, CATALOG, GT, CC, guestsFromFile, tripsFromFile, stub, open, openWeek, call, noOverflow, EMOJI, uid };
