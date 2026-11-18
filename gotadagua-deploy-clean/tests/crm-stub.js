// Hermetic CRM for the tests: every *.supabase.co call (auth, rest, realtime,
// Edge Functions) is answered here from in-memory tables — nothing leaves the
// machine. The REST part behaves like PostgREST where it matters for the bugs
// under test: filters, order, offset/limit, the 1000-row page cap, HEAD counts.
const { fakeOwnerSession } = require('./helpers');

const uuid = (i, p = 'a') => `${p}0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const ME = '00000000-0000-4000-8000-000000000001';   // the fake session's user id
const MAX_ROWS = 1000;                                // PostgREST's page cap

function matches(val, expr) {
  let neg = false;
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.'); const op = expr.slice(0, dot); const arg = expr.slice(dot + 1);
  let ok;
  if (op === 'eq') ok = String(val) === arg;
  else if (op === 'neq') ok = String(val) !== arg;
  else if (op === 'is') ok = arg === 'null' ? val == null : String(val) === arg;
  else if (op === 'in') ok = arg.slice(1, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(val));
  else if (op === 'gte') ok = val != null && String(val) >= arg;
  else if (op === 'gt') ok = val != null && String(val) > arg;
  else if (op === 'lte') ok = val != null && String(val) <= arg;
  else if (op === 'lt') ok = val != null && String(val) < arg;
  else if (op === 'like' || op === 'ilike') {
    const re = new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*') + '$', op === 'ilike' ? 'is' : 's');
    ok = val != null && re.test(String(val));
  } else ok = true;
  return neg ? !ok : ok;
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function filterRows(rows, params) {
  for (const [k, v] of params) if (!RESERVED.has(k)) rows = rows.filter(r => matches(r[k], v));
  return rows;
}
function orderRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map(s => { const [k, ...mods] = s.split('.'); return { k, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') || (mods.includes('desc') && !mods.includes('nullslast')) }; });
  return rows.slice().sort((a, b) => {
    for (const { k, desc, nullsFirst } of keys) {
      const x = a[k], y = b[k];
      if (x == null && y == null) continue;
      if (x == null) return nullsFirst ? -1 : 1;
      if (y == null) return nullsFirst ? 1 : -1;
      if (x < y) return desc ? 1 : -1;
      if (x > y) return desc ? -1 : 1;
    }
    return 0;
  });
}

// stubCrm(page, tables, { functions }) → { tables, calls, fnCalls }
//   calls   — every REST request: { method, table, query, body }
//   fnCalls — every Edge Function request: { name, headers, query }
async function stubCrm(page, tables = {}, opts = {}) {
  const T = tables; const calls = []; const fnCalls = []; let seq = 0;
  await fakeOwnerSession(page);
  // no realtime socket
  await page.addInitScript(() => { window.WebSocket = class { constructor() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose({}), 0); } send() {} close() {} addEventListener() {} removeEventListener() {} }; });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request(); const u = new URL(req.url()); const method = req.method();
    const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (u.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (u.pathname.startsWith('/functions/v1/')) {
      const name = u.pathname.split('/')[3];
      fnCalls.push({ name, headers: req.headers(), query: u.search });
      return json((opts.functions && opts.functions[name]) || { ok: true, fetched: 0, newInbound: 0, matched: 0, advanced: 0 });
    }
    if (!u.pathname.startsWith('/rest/v1/')) return json({});
    const table = u.pathname.split('/').pop();
    const prefer = req.headers()['prefer'] || ''; const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    let body = null; try { body = req.postDataJSON(); } catch (_) {}
    calls.push({ method, table, query: decodeURIComponent(u.search), body });
    if (u.pathname.includes('/rpc/')) return json(null);
    const rows = T[table] || (T[table] = []);
    if (method === 'POST') {
      const added = (Array.isArray(body) ? body : [body]).map(o => ({ id: uuid(++seq, '9'), created_at: new Date().toISOString(), ...o }));
      rows.push(...added);
      return json(/return=representation/.test(prefer) ? (single ? added[0] : added) : null, 201);
    }
    let hit = filterRows(rows, u.searchParams);
    if (method === 'PATCH') { hit.forEach(r => Object.assign(r, body)); return json(/return=representation/.test(prefer) ? hit : null); }
    if (method === 'DELETE') { T[table] = rows.filter(r => !hit.includes(r)); return json(null); }
    const total = hit.length;
    hit = orderRows(hit, u.searchParams.get('order'));
    const off = Number(u.searchParams.get('offset') || 0);
    const lim = Math.min(Number(u.searchParams.get('limit') || MAX_ROWS), MAX_ROWS);
    hit = hit.slice(off, off + lim);
    const range = { 'content-range': `${hit.length ? `${off}-${off + hit.length - 1}` : '*'}/${/count=exact/.test(prefer) ? total : '*'}` };
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, ...range } });
    if (single) return hit[0] ? json(hit[0], 200, range) : json({ code: 'PGRST116', message: 'no rows' }, 406);
    return json(hit, 200, range);
  });
  return { tables: T, calls, fnCalls };
}

async function openCrm(page) {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return CONTACTS.length > 0 && !document.getElementById('app').classList.contains('hidden') && document.getElementById('heroTodayTitle').textContent !== 'Loading…'; } catch (_) { return false; } }, null, { timeout: 20000 });
  return errs;
}

// ── fixtures (invented names and example.org addresses only) ───────────────
const days = n => new Date(Date.now() - n * 86400000).toISOString();
function company(i, over = {}) {
  return { id: uuid(i), company: `Surf Club ${i}`, segment: 'University', country: 'Germany', city: 'Berlin', email: `club${i}@example.org`,
    status: 'follow_up', last_contacted_at: days(40), follow_up_at: null, replied: false, notes: '', language: 'en', lifecycle: 'lead',
    account_manager_id: ME, created_at: days(120), updated_at: days(40), last_interaction_at: days(40), ...over };
}
function baseTables(over = {}) {
  return {
    outreach_contacts: Array.from({ length: 8 }, (_, i) => company(i + 1)),
    contacts: [], tasks: [], outreach_groups: [], outreach_saved_views: [], pipelines: [], pipeline_stages: [], contact_pipeline: [],
    outreach_activity: [], outreach_sequences: [], outreach_sequence_runs: [], meetings: [], email_messages: [],
    team_users: [{ id: ME, full_name: 'Test Owner', email: 'miguel@gotadaguasurf.com', role: 'Sales', active: true, signature: 'Test Owner\nGota Dagua' }],
    outreach_templates: [{ id: uuid(1, 'f'), name: 'First email', subject: 'Surf trip for {{company}}', body: 'Hi,\n\nWould your club like a surf week?', language: 'en', sort_order: 1 }],
    email_campaigns: [], email_queue: [], email_campaign_stats: [], email_suppression: [],
    ...over,
  };
}
function campaign(i, over = {}) {
  return { id: uuid(i, 'e'), name: `Campaign ${i}`, sender_user_id: ME, status: 'done', daily_cap: 80, window_start: '08:30', window_end: '19:30',
    timezone: 'Europe/Lisbon', stop_on_reply: true, template_name: 'First email', created_by: 'miguel@gotadaguasurf.com', created_at: days(30 + i), updated_at: days(30 + i), ...over };
}
let qSeq = 0;
function queueRows(campaignId, n, status, over = {}) {
  return Array.from({ length: n }, (_, i) => { const k = ++qSeq; return { id: uuid(k, 'b'), campaign_id: campaignId, company_id: uuid(k, 'c'), contact_id: null,
    to_email: `person${k}@example.org`, subject: 'Surf trip for your club', body: 'Hi,\n\nWould your club like a surf week in October?\n\nTest Owner', status,
    error: null, attempts: 0, sent_at: status === 'sent' ? days(20) : null, created_at: new Date(Date.now() - 60 * 86400000 + k * 1000).toISOString(), ...(typeof over === 'function' ? over(i) : over) }; });
}

module.exports = { stubCrm, openCrm, uuid, ME, days, company, baseTables, campaign, queueRows };
