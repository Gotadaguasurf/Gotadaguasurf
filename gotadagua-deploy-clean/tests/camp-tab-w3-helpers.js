// Shared by the Camp Tab audit specs (18 Nov 2026): a small in-memory PostgREST and the
// way into the Camp Tab — always through the camp hub, never camp-tab-inner.html on its own.
// Hermetic: every Supabase call is answered here, nothing leaves the machine.
const { fakeOwnerSession } = require('./helpers');

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
const uuid = (kind, n) => `0000${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// name, category, sell_price, alt_price, alt_label, stock_qty, notes — like pricing_catalog
const BASE_CATALOG = [
  ['Soft Drink', 'Drinks', 400, 200, 'Staff', null], ['Cocktail', 'Drinks', 2000, 1000, 'Staff', null],
  ['Lion Lager', 'Drinks', 600, 300, 'Staff', 50], ['Shot', 'Drinks', 1000, 500, 'Staff', null],
  ['T-Shirt M', 'Merch', 9000, 3000, 'Staff', 54], ['Zink Stick', 'Merch', 6000, null, null, 38],
  ['River Safari', 'Tour', 6000, null, null, null],
];
const catalog = (rows = BASE_CATALOG) => rows.map(([name, category, sell, alt, altLabel, stock, notes], i) => ({
  id: uuid('c47a', i + 1), location_id: LOC, name, category, audience: 'general', notes: notes || null,
  sell_price: sell, sell_currency: 'LKR', currency: 'LKR', cost_per_guest: 0, alt_price: alt, alt_label: altLabel, stock_qty: stock,
  show_in_camp_tab: true, show_in_transport_picker: false, active: true, sort_order: (i + 1) * 100,
}));

// Rows as the Camp Tab itself writes them (buildCampTabSyncRows).
const guestRow = (n, name, extra = {}) => ({
  id: uuid('9e57', n), week_id: WEEK, location_id: LOC, name, booking_ref: null, is_staff: false, paid: false, paid_at: null, closed_at: null,
  checkin: null, checkout: null, pax: 1, sort_order: n * 10, meta: { staffNote: null, bikeNo: null }, ...extra,
});
const itemRow = (n, guestId, name, category, price, extra = {}) => ({
  id: uuid('17e3', n), guest_id: guestId, week_id: WEEK, location_id: LOC, category, item_name: name, qty: 1, price_local: price, currency: 'LKR',
  added_at: '2026-06-08T14:05:00.000Z', paid_at: null, price_type: 'regular', sort_order: n * 10, meta: { time: '14:05', staffNote: null },
  created_by: null, updated_by: null, updated_at: '2026-06-08T08:35:00.000Z', ...extra,
});

// GET filters: eq / is / in / gte / lte, also on a json path («deleted_row->>location_id»).
async function stub(page, tables, location = null) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, fail: null, writes: [], reads: [] };
  const val = (row, k) => { const p = k.split('->>'); return p.length === 2 ? (row[p[0]] || {})[p[1]] : row[k]; };
  const match = (row, url) => [...new URL(url).searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) return true;
    const m = v.match(/^(eq|is|in|gte|lte)\.(.*)$/s); if (!m) return true;
    const x = val(row, k);
    if (m[1] === 'eq') return String(x) === m[2];
    if (m[1] === 'gte') return String(x) >= m[2];
    if (m[1] === 'lte') return String(x) <= m[2];
    if (m[1] === 'is') return m[2] === 'null' ? x == null : String(x) === m[2];
    return m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
  });
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/')) return json({});
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]; if (!t) return json([]);
    if (t === 'locations') return json(location || { id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' });
    if (ctl.fail && ctl.fail(t, method)) return json({ message: 'stub failure', code: '500' }, 500);
    const rows = T[t] || (T[t] = []);
    if (method !== 'GET') ctl.writes.push([method, t]); else ctl.reads.push(t);
    if (method === 'GET') {
      let out = rows.filter(r => match(r, url));
      if (t === 'camp_tab_items' && /camp_guests\(/.test(new URL(url).searchParams.get('select') || '')) out = out.map(r => ({ ...r, camp_guests: (T.camp_guests || []).find(g => g.id === r.guest_id) || null }));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
      return json(out);
    }
    if (method === 'POST') {
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      const key = (new URL(url).searchParams.get('on_conflict') || 'id').split(',');
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = rows.findIndex(x => key.every(c => String(x[c]) === String(r[c]))); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') {
      // like the production trigger (supabase/audit-log.sql): every delete leaves its row in audit_log
      const gone = rows.filter(r => match(r, url));
      if (['camp_tab_items', 'camp_guests'].includes(t)) gone.forEach(r => (T.audit_log || (T.audit_log = [])).push({
        id: `a-${T.audit_log.length + 1}`, at: new Date().toISOString(), actor_id: 'u1', actor_email: 'host@example.com', table_name: t, action: 'DELETE', row_id: String(r.id), deleted_row: { ...r } }));
      T[t] = rows.filter(r => !match(r, url)); return json([]);
    }
    return json([]);
  });
  return ctl;
}

async function openCampTab(page, extra = {}, location = null) {
  const ctl = await stub(page, {
    pricing_catalog: catalog(), ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: LOC, start_date: '2026-06-07', end_date: '2026-06-13', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [], audit_log: [], platform_profiles: [], ...extra,
  }, location);
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${location ? location.slug : 'sri-lanka'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  await frame.waitForFunction(() => { try { return campTabBootstrapped === true && !!S.activeWeek && Object.keys(MENU).some(c => (MENU[c] || []).length); } catch (_) { return false; } }, null, { timeout: 20000 });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(800);
  return { ctl, frame };
}
async function addConsumer(frame, name) {
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill(name);
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
}
const cat = (frame, label) => frame.locator('#catTabs button', { hasText: label }).first().click();
const tap = (frame, name) => frame.locator('#itemGrid button').filter({ has: frame.locator('.ci-name', { hasText: name }) }).first().click();
const sub = (frame, name) => frame.locator(`.snav-btn[data-sub="${name}"]`).click();
const revenue = (ctl) => (ctl.T.ledger_entries || []).filter(r => ['camp_tab_per_item', 'camp_tab_per_guest'].includes(r.source_kind));

module.exports = { LOC, WEEK, uuid, catalog, BASE_CATALOG, guestRow, itemRow, stub, openCampTab, addConsumer, cat, tap, sub, revenue };
