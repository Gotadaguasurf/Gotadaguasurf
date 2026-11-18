// Quiet Supabase for the surf-school smoke tests that only exercise in-page maths
// (price card, expected return, Sales tab, Clients). Without it the page's boot
// asked the REAL auth server about the fake token; the 401 came back at a random
// moment and replaced the page with «Sign in required» while the test was still
// reading fields, so these tests failed under load (audit 18 Nov 2026, W4).
// Every call is answered here: the owner is signed in, the Surf School location
// exists and every list is empty. Nothing reaches the real project.
const SS_UID = '00000000-0000-4000-8000-000000000001';

async function quietSurfSchool(page) {
  await page.route(/supabase\.co\/(auth|rest|functions|realtime|storage)\/v1\/.*/, route => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-expose-headers': 'content-range', 'content-range': '*/0' },
      body: req.method() === 'HEAD' ? '' : JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: SS_UID, email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/')) return json({});
    if (url.includes('/rest/v1/locations')) { const loc = { id: 'loc-ss', name: 'Surf School', slug: 'surf-school' }; return json(single ? loc : [loc]); }
    if (url.includes('/rest/v1/platform_profiles')) { const me = { id: SS_UID, full_name: 'Test Person', email: 'miguel@gotadaguasurf.com' }; return json(single ? me : [me]); }
    return json(single ? null : []);
  });
}

module.exports = { quietSurfSchool };
