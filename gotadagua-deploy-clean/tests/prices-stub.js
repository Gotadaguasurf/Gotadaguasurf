// Stubbed Supabase for the /prices tests (17 Nov 2026): a tiny in-memory PostgREST over tests/prices-data.js.
// Reads honour eq.<value> filters on any column; PATCH / POST / DELETE change the in-memory copy and are recorded in
// ctl.writes, so a test can check exactly what a save would send. Nothing reaches a real database.
const { DATA } = require('./prices-data');
const { fakeOwnerSession } = require('./helpers');

const TABLES = ['locations', 'pricing_catalog', 'pricing_areas', 'accommodation_packs', 'accommodation_seasons',
  'accommodation_room_types', 'accommodation_prices', 'accommodation_rooms', 'ledger_entries', 'camp_tab_items'];

function filtersOf(url) {
  const u = new URL(url); const f = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(eq|neq|gte|lte|in)\.(.*)$/.exec(v); if (!m) continue;
    f.push([k, m[1], m[2]]);
  }
  return f;
}
const match = (row, f) => f.every(([k, op, v]) => {
  const x = row[k]; const s = x == null ? 'null' : String(x);
  if (op === 'eq') return s === v; if (op === 'neq') return s !== v;
  if (op === 'gte') return s >= v; if (op === 'lte') return s <= v;
  if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').map(t => t.replace(/^"|"$/g, '')).includes(s);
  return true;
});

async function stubPrices(page, opts = {}) {
  const db = JSON.parse(JSON.stringify(opts.data || DATA));   // opts.data: another fixture of the same shape
  db.pricing_areas = opts.areas || [{ key: 'diploria', label: 'Diploria', cats: ['Diploria'], icon: null, sort_order: 55, hidden: false }];
  db.ledger_entries = opts.ledger || [];
  db.camp_tab_items = opts.tabItems || [];
  if (opts.mutate) opts.mutate(db);
  const ctl = { db, writes: [], failNext: null };
  let seq = 0;
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    const m = /\/rest\/v1\/([a-z_]+)/.exec(url);
    if (!m) return json([]);
    const table = m[1];
    if (!TABLES.includes(table)) return json([]);
    const rows = db[table] || (db[table] = []);
    const f = filtersOf(url);
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const method = req.method();
    if (method !== 'GET' && method !== 'HEAD') {
      let body = null; try { body = req.postDataJSON(); } catch (_) {}
      ctl.writes.push({ table, method, filters: f, body });
      if (ctl.failNext && (ctl.failNext.table == null || ctl.failNext.table === table)) {
        const err = ctl.failNext; ctl.failNext = null;
        return json({ code: err.code || 'P0001', message: err.message || 'stubbed failure' }, err.status || 400);
      }
      let out = [];
      if (method === 'PATCH') { rows.filter(r => match(r, f)).forEach(r => { Object.assign(r, body); out.push(r); }); }
      else if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        out = list.map(b => {
          const key = table === 'pricing_areas' ? 'key' : 'id';
          const prev = b[key] != null && rows.find(r => r[key] === b[key]);
          if (prev) return Object.assign(prev, b);
          const r = { id: `new-${table}-${++seq}`, ...b }; rows.push(r); return r;
        });
      } else if (method === 'DELETE') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) { out.push(rows[i]); rows.splice(i, 1); } }
      if (single) return out.length ? json(out[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406);
      return json(out, method === 'POST' ? 201 : 200);
    }
    const hit = rows.filter(r => match(r, f));
    if (single) return hit.length ? json(hit[0]) : json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }, 406);
    return json(hit);
  });
  await fakeOwnerSession(page);
  return ctl;
}

// opens /prices for a camp and waits for the catalog
async function openPrices(page, slug = 'portugal', opts = {}) {
  const ctl = await stubPrices(page, opts);
  await page.goto(`/prices/?location=${slug}${opts.query || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return Array.isArray(catalog) && catalog.length > 0 && !!document.getElementById('tableWrap') && __customAreasLoaded === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return ctl;
}

module.exports = { stubPrices, openPrices, DATA };
