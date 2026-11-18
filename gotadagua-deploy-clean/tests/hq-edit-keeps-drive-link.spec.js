// Editing an expense must not erase its Drive link (audit 18 Nov 2026, HQ-01): the edit form
// read the row without drive_link, showed an empty field and saved null over the link.
// Hermetic: every Supabase call is stubbed.
const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const OWNER = 'miguel@gotadaguasurf.com';
const LINK = 'https://drive.google.com/file/d/abc123/view';
const ROW = { id: '11111111-1111-4111-8111-111111111111', location_slug: 'general', paying_company: 'water-movements', invoice_date: '2026-11-03',
  company: 'Test Supplier', description: 'Paper', amount: 12.5, currency: 'EUR', amount_eur: 12.5, payment_type: 'Bank Transfer', invoice_number: 'FT 1/2',
  category_id: 'cat-1', category_name: 'Services', file_url: null, file_name: null, file_mime: null, needs_review: false, notes: '', supplier_nif: '', fx_rate: 1, drive_link: LINK };

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function fakeSession(page) {
  const id = '00000000-0000-4000-8000-000000000001';
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email: OWNER, role: 'authenticated', exp: 9_999_999_999 })}.test-signature`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'test-refresh',
    user: { id, aud: 'authenticated', role: 'authenticated', email: OWNER, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' } };
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

test('HQ: Edit loads the Drive link, and saving sends it back unchanged', async ({ page }) => {
  const seen = { editSelect: '', patch: null };
  await fakeSession(page);
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(), url = req.url();
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (obj) => json(single ? obj : (obj ? [obj] : []));
    if (url.includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001', email: OWNER, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return one({ id: '00000000-0000-4000-8000-000000000001', email: OWNER, full_name: 'Test', platform_role: 'super_admin' });
    if (url.includes('/rest/v1/workspace_memberships')) return one({ workspace_id: 'w-hq', can_view: true, active: true, workspaces: { slug: 'hq' } });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/')) return json({});
    if (url.includes('/rest/v1/hq_invoice_categories')) return json([{ id: 'cat-1', name: 'Services', slug: 'services', area: 'general', sort_order: 1, is_active: true, active: true }]);
    if (url.includes('/rest/v1/hq_invoices') && req.method() === 'PATCH') { seen.patch = JSON.parse(req.postData() || '{}'); return json([]); }
    if (url.includes('/rest/v1/hq_invoices') && url.includes(`id=eq.${ROW.id}`) && req.method() === 'GET') {
      seen.editSelect = decodeURIComponent(url);
      return one(ROW);
    }
    return json([]);
  });
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#tab-overview') && document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
  await page.evaluate(id => window.openEditInvoice(id), ROW.id);
  await expect(page.locator('#inv_drive_link')).toHaveValue(LINK);
  expect(seen.editSelect).toContain('drive_link');
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.patch).not.toBeNull();
  expect(seen.patch.drive_link).toBe(LINK);
});
