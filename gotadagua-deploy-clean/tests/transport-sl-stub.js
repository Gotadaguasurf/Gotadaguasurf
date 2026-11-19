// Sri Lanka camp hub — a small stubbed Supabase for the Transport specs of 19 Nov 2026 (tests/surf-people.spec.js,
// tests/transport-mobile.spec.js). The same shape as tests/transport.spec.js; «now» = Fri 13 Nov 2026 10:00 Colombo.
const { fakeOwnerSession } = require('./helpers');
// ── Sri Lanka: a small stub (the same shape as tests/transport.spec.js) ─────────────────────────────────────
const SL_LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const SAMPATH = 'dddddddd-0000-4000-8000-000000000002';
const SL_DRIVERS = [
  { id: 'dddddddd-0000-4000-8000-000000000001', location_id: SL_LOC, name: 'Dilan', label: 'Airport van', phone: null, aliases: ['Dilan'], kinds: ['airport', 'other'], default_for: ['airport'], active: true },
  { id: SAMPATH, location_id: SL_LOC, name: 'Sampath', label: 'Tuk-tuk', phone: '+94770000002', aliases: ['Sampath'], kinds: ['tuktuk'], default_for: ['tuktuk'], active: true },
  { id: 'dddddddd-0000-4000-8000-000000000004', location_id: SL_LOC, name: 'Nadith', label: 'Camp manager', phone: '+94771234567', aliases: [], kinds: ['contact'], default_for: ['transfers_contact'], active: true },
];
// The live Sri Lanka /prices transport rows of 19 Nov 2026 (surf rows without capacity).
const SL_CAT = [['Ahangama', 500, 'surf'], ['South Beach', 500, 'surf'], ['Weligama', 1500, 'surf'], ['Ice Bath', 1500, 'tours'], ['River Safari', 1000, 'tours'],
  ['Market / food', 500, 'tuktuk'], ['Laundry', 500, 'tuktuk'], ['Staff', 500, 'tuktuk'], ['Errand', 500, 'tuktuk'],
  ['Airport → Surfcamp — Car', 20500, 'airport', 3], ['Airport → Surfcamp — Minivan', 25500, 'airport', 8], ['Surfcamp → Airport — Car', 19000, 'airport', 3], ['Surfcamp → Airport — Minivan', 24000, 'airport', 8]]
  .map(([name, cost, tab, capacity], i) => ({ id: `sl-${i}`, name, cost_per_guest: cost, currency: 'LKR', notes: '', linked_transport_preset_id: `p-${name.split(' — ')[0]}`, linked_camp_tab_id: null,
    picker_tab: tab, sort_order: i, capacity: capacity || null, sell_price: null, sell_currency: null, covers_pax: null }));
let seq = 0;
const uid = p => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
async function openSl(page, opts = {}) {
  const st = { trips: (opts.trips || []).map(t => ({ ...t })), ledger: opts.ledger || [], calls: [] };
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
    const idEq = (url.match(/[?&]id=eq\.([^&]+)/) || [])[1];
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: SL_LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/pricing_catalog')) return json(url.includes('category=eq.Transport') ? SL_CAT : []);
    if (url.includes('/rest/v1/camp_drivers')) return json(method === 'GET' ? SL_DRIVERS : []);
    if (url.includes('/rest/v1/ledger_entries')) return json(method === 'GET' ? st.ledger : []);
    if (url.includes('/rest/v1/camp_trips')) {
      if (method === 'GET') return json(st.trips);
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('aaaaaaaa'), location_id: SL_LOC, created_at: new Date().toISOString(), payment_entry_id: null, needs_resend: false, import_flags: [], edited_fields: [], currency: 'LKR', ...r })); st.trips.push(...rows); st.calls.push({ t: 'trip_insert', rows }); return json(rows); }
      if (method === 'PATCH') { const t = st.trips.find(x => x.id === idEq); Object.assign(t, body); st.calls.push({ t: 'trip_update', id: idEq, body }); return json([t]); }
      if (method === 'DELETE') { st.trips = st.trips.filter(x => x.id !== idEq); st.calls.push({ t: 'trip_delete', id: idEq }); return json([]); }
    }
    return json([]);
  });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.TRANSPORT_NOW = '2026-11-13T10:00'; window.TRIPS_GO_LIVE_OVERRIDE = '2026-11-01'; window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await page.clock.setFixedTime(new Date('2026-11-13T04:30:00Z'));
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=sri-lanka${opts.query || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  return st;
}
module.exports = { SL_LOC, SAMPATH, SL_DRIVERS, SL_CAT, openSl, uid };
