// A small fake of what the hub (/index.html) and the app shell read for a signed-in person.
// Every Supabase call is answered here — nothing reaches the real project. Used by app-access.spec.js
// and manage-bookings.spec.js. No real people: the addresses are example.com.
const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const UID = '00000000-0000-4000-8000-0000000000aa';
const OWNER = 'miguel@gotadaguasurf.com';

// every area the hub has a card for, plus two the database has and the hub does not («hub», «junior-camp»)
const SLUGS = ['sri-lanka', 'portugal', 'junior', 'morocco', 'surf-school', 'wild-wednesday', 'the-suk', 'diploria',
  'prices-sri-lanka', 'prices-portugal', 'prices-junior', 'prices-morocco', 'prices-surf-school',
  'partners', 'crm', 'instructors', 'hq', 'settings', 'profit', 'hub', 'junior-camp'];
const WS = SLUGS.map(slug => ({ id: 'ws-' + slug, slug, name: slug }));

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function fakeSession(page, email, uid = UID) {
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: uid, email, role: 'authenticated', exp: 9_999_999_999 })}.test-signature`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'test-refresh',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' } };
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

// person: { email, role, areas: [{ slug, can_edit?, role? }] }
// tables: { bookings: [...], onRequest(req, url) → optional custom answer {status, body, headers} }
async function stubHub(page, person, tables = {}) {
  const calls = [];
  const state = { bookings: (tables.bookings || []).slice() };
  await fakeSession(page, person.email);
  await page.route(/supabase\.co\/(auth|rest|functions|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const method = req.method(); const u = new URL(req.url()); const url = decodeURIComponent(req.url());
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-expose-headers': 'content-range', ...headers }, body: method === 'HEAD' ? '' : JSON.stringify(body) });
    const one = (o) => json(single ? o : (o ? [o] : []));
    calls.push({ method, url, table: (u.pathname.match(/\/rest\/v1\/([^/?]+)/) || [])[1] || '', body: req.postData(), prefer: req.headers()['prefer'] || '' });
    if (tables.onRequest) { const custom = tables.onRequest({ method, url, u }); if (custom) return json(custom.body, custom.status || 200, custom.headers || {}); }
    if (url.includes('/auth/v1/user')) return json({ id: UID, email: person.email, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/logout')) return json({});
    if (url.includes('/rest/v1/rpc/')) return json([]);
    if (url.includes('/rest/v1/platform_profiles')) {
      const me = { id: UID, email: person.email, full_name: person.name || 'Test Person', platform_role: person.role, active: true, password_set_at: '2026-01-01T00:00:00Z' };
      return url.includes(`id=eq.${UID}`) ? one(me) : json([me]);
    }
    if (url.includes('/rest/v1/workspace_memberships')) {
      const rows = (person.areas || []).map(a => ({ user_id: UID, workspace_id: 'ws-' + a.slug, member_role: a.role || person.role, can_view: true, can_edit: a.can_edit !== false,
        can_manage_team: !!person.manager && a.can_edit !== false, active: true, workspaces: { slug: a.slug }, platform_profiles: { email: person.email, full_name: person.name || 'Test Person' } }));
      const want = (url.match(/workspaces\.slug=eq\.([a-z-]+)/) || [])[1];
      if (want || single) return one(rows.find(r => !want || r.workspaces.slug === want) || null);
      return json(rows);
    }
    if (url.includes('/rest/v1/workspaces')) return json(WS);
    if (url.includes('/rest/v1/locations')) {
      const slug = (url.match(/slug=eq\.([a-z-]+)/) || [])[1] || 'portugal';
      return one({ id: 'loc-' + slug, slug, name: slug });
    }
    if (url.includes('/rest/v1/bookings')) {
      // the filters the hub uses: month_key, location (eq / is.null / or=(location.is.null,location.eq.Unknown)), booking_ref
      const mk = u.searchParams.get('month_key'), loc = u.searchParams.get('location'), or = u.searchParams.get('or'), ref = u.searchParams.get('booking_ref');
      const match = (r) => (!mk || (mk === 'is.null' ? r.month_key == null : r.month_key === mk.slice(3)))
        && (!loc || (loc === 'is.null' ? r.location == null : r.location === loc.slice(3)))
        && (!or || r.location == null || r.location === 'Unknown')
        && (!ref || (ref.startsWith('eq.') ? r.booking_ref === ref.slice(3) : true));
      const rows = state.bookings.filter(match);
      if (method === 'DELETE') {
        const removed = tables.deleteBlocked ? [] : rows;
        if (!tables.deleteBlocked) state.bookings = state.bookings.filter(r => !match(r));
        return json([], 200, { 'content-range': `*/${removed.length}` });
      }
      if (method === 'POST') return json([], 201);
      const off = Number(u.searchParams.get('offset') || 0), lim = Math.min(Number(u.searchParams.get('limit') || 1000), 1000);   // the server never answers more than 1000 rows
      const slice = method === 'HEAD' ? [] : rows.slice(off, off + lim);
      return json(slice, 200, { 'content-range': `${slice.length ? off + '-' + (off + slice.length - 1) : '*'}/${rows.length}` });
    }
    if (url.includes('/rest/v1/location_state_store')) {
      if (method === 'GET') return one(tables.blob ? { state_json: tables.blob } : null);
      return json([], 201);
    }
    if (url.includes('/rest/v1/partners')) return json(method === 'GET' ? [] : [], method === 'GET' ? 200 : 201);
    return json([]);
  });
  return { calls, state };
}

module.exports = { stubHub, fakeSession, UID, OWNER, WS, SLUGS };
