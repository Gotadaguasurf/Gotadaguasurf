// Camp hub — audit of 18 Nov 2026 (findings CH-01, CH-02, CH-03, CH-09).
//
//  · CH-03  every failed save says why (the database's own words), every time;
//           the red «tap to retry» pill really sends the change again; a delete
//           the database refuses is never reported as «Deleted.».
//  · CH-01  a Camp-Tab-only account does not download or keep the saved copy of
//           the bookings (guest names, gross amounts, partner, commission).
//  · CH-02  a Camp-Tab-only account loads only the Camp Tab's own ledger lines.
//  · CH-09  the unused embedded copy of the Camp Tab page is gone.
//
// Hermetic: the page is served locally and every Supabase call is answered by
// the small in-memory fake below (nothing reaches production).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const LOC = '11111111-0000-4000-8000-000000000001';
const FX = 340;
const RLS = { message: 'new row violates row-level security policy for table "ledger_entries"', code: '42501' };

function row(n, o = {}) {
  const amount = o.amount_local || 1000;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, location_id: LOC, week_id: null, type: 'expense', category: 'Food',
    linked_item: null, description: `row ${n}`, payment_method: 'Cash', qty: 1, amount_local: amount, currency: 'LKR', entry_date: '2026-11-10',
    business_area: null, fx_rate: FX, amount_eur: Number((amount / FX).toFixed(2)), recurring_source_id: null, recurring_month: null,
    source_kind: 'manual', is_comp: false, zone_id: null, paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-11-10T10:00:00Z', ...o,
  };
}
const fixture = () => [
  row(1, { description: 'Market', amount_local: 7000 }),
  row(2, { description: 'Fish', amount_local: 4200 }),
  row(3, { type: 'expense', category: 'Salary', description: 'Cook salary', amount_local: 90000, payment_method: 'HQ Paid', source_kind: 'hq_invoice' }),
  row(4, { type: 'revenue', category: 'Drinks', description: 'Camp Tab · Ann · Drinks: Lion Lager', amount_local: 1500, source_kind: 'camp_tab_per_guest' }),
];

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
// A member of staff (not on the owner list): the hub asks the database what the account may open.
async function fakeStaffSession(page, email) {
  const id = '00000000-0000-4000-8000-0000000000aa';
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', exp: 9_999_999_999 })}.test-signature`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'test-refresh',
    user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' } };
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

// A small PostgREST stand-in for ledger_entries and location_state_store.
//   db.failWrites   → every ledger upsert is refused with a PostgREST-shaped error
//   db.failDeletes  → 'error' (403 + message) or 'silent' (200, nothing removed: what RLS does)
//   db.failState    → every location_state_store write is refused
//   db.failLedgerRead → the ledger cannot be read
async function openHub(page, { rows = fixture(), query = '', staff = null, savedBookings = null } = {}) {
  const db = { rows: rows.map(r => ({ ...r })), failWrites: false, failDeletes: '', failState: false, failLedgerRead: false, requests: [] };
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|functions|storage)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const table = (url.match(/\/rest\/v1\/([a-z_0-9]+)/) || [])[1] || '';
    db.requests.push({ method, table, url, body: method === 'GET' ? null : req.postData() });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: staff ? staff.email : 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (!table) return json({});
    if (table === 'ledger_entries') {
      const idEq = (url.match(/[?&]id=eq\.([^&]+)/) || [])[1];
      if (method === 'GET') {
        if (db.failLedgerRead) return json({ message: 'canceling statement due to statement timeout', code: '57014' }, 500);
        let out = db.rows;
        if (idEq) out = out.filter(r => r.id === idEq);
        const kinds = (url.match(/source_kind=in\.\(([^)]*)\)/) || [])[1];
        if (kinds != null) { const set = kinds.split(',').map(s => s.replace(/"/g, '')); out = out.filter(r => set.includes(r.source_kind)); }
        return json(out);
      }
      if (method === 'POST') {
        if (db.failWrites) return json(RLS, 403);
        JSON.parse(req.postData() || '[]').forEach(r => { const i = db.rows.findIndex(x => x.id === r.id); if (i >= 0) db.rows[i] = { ...db.rows[i], ...r }; else db.rows.push(r); });
        return json([], 201);
      }
      if (method === 'DELETE') {
        if (db.failDeletes === 'error') return json(RLS, 403);
        if (db.failDeletes === 'silent') return json([], 200, { 'content-range': '*/0', 'access-control-expose-headers': 'content-range' });
        const before = db.rows.length; db.rows = db.rows.filter(r => r.id !== idEq);
        return json([], 200, { 'content-range': `*/${before - db.rows.length}`, 'access-control-expose-headers': 'content-range' });
      }
    }
    if (method !== 'GET') {
      if (table === 'location_state_store' && db.failState) return json({ message: 'permission denied for table location_state_store', code: '42501' }, 403);
      return json([], method === 'POST' ? 201 : 200);
    }
    if (table === 'locations') return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: FX, camp_tab_mode: 'per_guest' });
    if (table === 'workspace_memberships' && staff) {
      return json([{ workspace_id: 'w1', can_view: true, can_edit: staff.canEdit, member_role: staff.role, active: true, workspaces: { slug: 'sri-lanka', name: 'Sri Lanka', workspace_type: 'location' } }]);
    }
    if (table === 'platform_profiles') return json(null);
    if (table === 'location_state_store' && url.includes('camphub_ov_bookings_v3')) return json(savedBookings ? { state_json: savedBookings } : null);
    if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return json(null);
    return json([]);
  });
  page.on('dialog', d => d.accept());
  if (staff) await fakeStaffSession(page, staff.email); else await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka' + query, { waitUntil: 'domcontentloaded' });
  return db;
}
const hydrated = page => page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
async function fillQuickAdd(page, description, amount) {
  await page.evaluate(() => showPage('expenses'));
  await page.locator('#qe_date').fill('2026-11-18');
  await page.locator('#qe_amount').fill(String(amount));
  await page.locator('#qe_desc').fill(description);
}
const pill = page => page.evaluate(() => ({ failed: document.getElementById('savePill').classList.contains('failed'), text: document.getElementById('savePillTxt').textContent }));
const toastText = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') ? t.textContent : ''; });
const ledgerPosts = db => db.requests.filter(r => r.table === 'ledger_entries' && r.method === 'POST').map(r => JSON.parse(r.body)[0]);

// ── CH-03 ────────────────────────────────────────────────────────────────────
test('camp hub: a refused save says why every time, and the red pill sends the same entry again', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const db = await openHub(page);
  await hydrated(page);
  db.failWrites = true;

  await fillQuickAdd(page, 'Tuna for dinner', 2222);
  await page.locator('.exp-inline button', { hasText: 'Add entry' }).click();
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.locator('#toast')).toContainText('row-level security policy');   // the database's own words
  await expect(page.locator('#toast')).toContainText('not allowed');                 // and what they mean
  expect(await pill(page)).toEqual({ failed: true, text: 'Save failed — tap to retry' });
  expect(await page.evaluate(() => S.ledger.some(x => x.description === 'Tuna for dinner'))).toBe(false);
  await expect(page.locator('#qe_desc')).toHaveValue('Tuna for dinner');                // the form keeps what was typed

  // The second failure of the session is as loud as the first (it used to be silent).
  await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
  await page.locator('.exp-inline button', { hasText: 'Add entry' }).click();
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await expect(page.locator('#toast')).toContainText('row-level security policy');
  const failed = ledgerPosts(db);
  expect(failed.length).toBe(2);
  expect(failed[1].id).toBe(failed[0].id);   // pressing «Add entry» again re-uses the id: a write that did land is not doubled

  // The database accepts again: one tap on the red pill sends that same entry.
  db.failWrites = false;
  await page.locator('#savePill').click();
  await expect(page.locator('#toast')).toContainText('Entry added');
  const sent = ledgerPosts(db);
  expect(sent.length).toBe(3);
  expect(sent[2].id).toBe(failed[0].id);
  expect(sent[2]).toMatchObject({ description: 'Tuna for dinner', amount_local: 2222, type: 'expense' });
  expect(db.rows.filter(r => r.description === 'Tuna for dinner').length).toBe(1);
  expect(await page.evaluate(() => S.ledger.filter(x => x.description === 'Tuna for dinner').length)).toBe(1);
  await expect.poll(() => pill(page)).toEqual({ failed: false, text: 'Saved' });
  await expect(page.locator('#qe_desc')).toHaveValue('');                               // saved → the form is cleared, it cannot be added twice
  // Nothing left to retry: another tap sends nothing.
  await page.locator('#savePill').click();
  await page.waitForTimeout(300);
  expect(ledgerPosts(db).length).toBe(3);
  expect(errors).toEqual([]);
});

test('camp hub: a failure at boot does not use up the message of the next failed save', async ({ page }) => {
  const db = await openHub(page);
  db.failLedgerRead = true;
  await expect(page.locator('#toast')).toContainText("Couldn't load the latest data");
  await expect(page.locator('#toast')).toContainText('statement timeout');
  db.failWrites = true;
  await fillQuickAdd(page, 'AC repair', 3333);
  await page.evaluate(() => saveQuickExpense());
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.locator('#toast')).toContainText('row-level security policy');
});

test('camp hub: changing the form after a failed save lets go of the old entry (the pill never saves stale data)', async ({ page }) => {
  const db = await openHub(page);
  await hydrated(page);
  db.failWrites = true;
  await fillQuickAdd(page, 'Tuna for dinner', 2222);
  await page.evaluate(() => saveQuickExpense());
  await expect.poll(() => pill(page)).toEqual({ failed: true, text: 'Save failed — tap to retry' });
  // The manager corrects the amount instead of tapping the pill.
  await page.locator('#qe_amount').fill('2500');
  await expect.poll(() => pill(page)).toEqual({ failed: false, text: 'Saved' });
  db.failWrites = false;
  await page.locator('#savePill').click();
  await page.waitForTimeout(300);
  expect(db.rows.some(r => r.description === 'Tuna for dinner')).toBe(false);           // nothing was sent behind his back
  await page.locator('.exp-inline button', { hasText: 'Add entry' }).click();
  await expect(page.locator('#toast')).toContainText('Entry added');
  expect(db.rows.filter(r => r.description === 'Tuna for dinner').map(r => r.amount_local)).toEqual([2500]);
});

for (const mode of ['silent', 'error']) {
  test(`camp hub: a delete the database refuses (${mode === 'silent' ? 'no error, nothing removed' : 'with an error'}) is never «Deleted.»; the pill sends it again`, async ({ page }) => {
    const errors = collectFatalErrors(page);
    const db = await openHub(page);
    await hydrated(page);
    await page.evaluate(() => showPage('expenses'));
    const id = fixture()[0].id;
    db.failDeletes = mode;
    const shown = [];   // every toast text of this delete
    await page.exposeFunction('__toastSeen', t => { shown.push(t); });
    await page.evaluate(() => { const orig = toast; toast = (msg, kind) => { window.__toastSeen(String(msg)); return orig(msg, kind); }; });

    await page.evaluate(i => delLedger(i), id);
    await expect(page.locator('#toast')).toContainText('Not deleted');
    expect(shown.some(t => /^Deleted\.?$/.test(t))).toBe(false);
    expect(await pill(page)).toEqual({ failed: true, text: 'Delete failed — tap to retry' });
    expect(await page.evaluate(i => S.ledger.some(x => x.id === i), id)).toBe(true);     // the line is back
    await expect(page.locator('#expTable')).toContainText('Market');

    // A later save that works does not turn the pill green over the delete that is still pending.
    await fillQuickAdd(page, 'Bread', 500);
    await page.evaluate(() => saveQuickExpense());
    await expect(page.locator('#toast')).toContainText('Entry added');
    expect(await pill(page)).toEqual({ failed: true, text: 'Delete failed — tap to retry' });

    // The database allows it now: the pill sends the delete again, with no second question.
    db.failDeletes = '';
    await page.locator('#savePill').click();
    await expect(page.locator('#toast')).toContainText('Deleted.');
    expect(db.rows.some(r => r.id === id)).toBe(false);
    expect(await page.evaluate(i => S.ledger.some(x => x.id === i), id)).toBe(false);
    await expect.poll(() => pill(page)).toEqual({ failed: false, text: 'Saved' });
    expect(errors).toEqual([]);
  });
}

test('camp hub: «Deleted.» and the Camp Tab message wait for the database', async ({ page }) => {
  const db = await openHub(page);
  await hydrated(page);
  await page.evaluate(() => showPage('expenses'));
  const id = fixture()[0].id;
  // Hold the DELETE answer: while it is pending nothing may claim the line is deleted.
  let release; const gate = new Promise(r => { release = r; });
  await page.route(/rest\/v1\/ledger_entries/, async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await gate; return route.fallback();
  });
  await page.evaluate(i => { delLedger(i); }, id);
  await page.waitForTimeout(500);
  expect(await toastText(page)).not.toContain('Deleted');
  release();
  await expect(page.locator('#toast')).toContainText('Deleted.');
  expect(db.rows.some(r => r.id === id)).toBe(false);
});

test('camp hub: a transport preset the database refuses is not applied and not shown as saved', async ({ page }) => {
  const db = await openHub(page);
  await hydrated(page);
  db.failState = true;
  const r = await page.evaluate(async () => {
    const before = JSON.stringify(transportPresets);
    const ok = await saveTransportStateOrRollback({ airport: [{ id: 'x1', name: 'Test run', unitPrice: 1, vehicles: [] }], tuktuk: [] });
    return { ok, unchanged: JSON.stringify(transportPresets) === before };
  });
  expect(r).toEqual({ ok: false, unchanged: true });
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.locator('#toast')).toContainText('permission denied');
  expect((await pill(page)).failed).toBe(true);
});

// ── CH-01 / CH-02 ────────────────────────────────────────────────────────────
const SAVED_BOOKINGS = [{ ref: 'B-9', name: 'Guest Nine', ci: Date.parse('2026-11-14T00:00:00'), co: Date.parse('2026-11-21T00:00:00'), pax: 2, gross: 1890, partner: 'Some Partner', commission_pct: 15, status: 'confirmed' }];
const BAR = { email: 'bar-tablet@example.test', role: 'bar_man', canEdit: false };
// Hands the page's own realtime handler a change of the saved bookings copy, as Supabase would.
function realtimeBookingsCopy(saved) {
  const before = JSON.stringify(ovBookings);
  const handlers = (HUB_REALTIME_CHANNEL?.bindings?.postgres_changes || []).filter(b => b.filter?.table === 'location_state_store');
  handlers.forEach(b => b.callback({ new: { state_key: 'camphub_ov_bookings_v3', state_json: saved } }));
  return { handlers: handlers.length, changed: JSON.stringify(ovBookings) !== before, gross: ovBookings.some(b => 'gross' in b) };
}

test('camp hub: a Camp-Tab-only account neither downloads nor keeps the saved bookings copy, and loads only Camp Tab ledger lines', async ({ page }) => {
  const errors = collectFatalErrors(page);
  // An old browser copy from before Sep 2026, in the REAL localStorage (the page's own `localStorage` is an in-memory stand-in).
  // (seeded once: the init script runs again after the guard's redirect)
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('seeded')) return;
    window.sessionStorage.setItem('seeded', '1');
    window.localStorage.setItem('camphub_ov_bookings_v3_sri-lanka', JSON.stringify([{ name: 'Old Guest', gross: 999 }]));
    window.localStorage.setItem('camphub_ov_bookings_v3', JSON.stringify([{ name: 'Older Guest', gross: 111 }]));
  });
  const db = await openHub(page, { staff: BAR, savedBookings: SAVED_BOOKINGS });
  await page.waitForURL(/view=camp-tab-only/);   // the access guard sends the account to the Camp Tab view
  await hydrated(page);
  await page.waitForTimeout(400);

  // 1. the copy is never asked for …
  expect(db.requests.filter(r => r.table === 'location_state_store' && r.method === 'GET' && r.url.includes('camphub_ov_bookings_v3'))).toEqual([]);
  // … an old browser copy is removed …
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter(k => k.startsWith('camphub_ov_bookings')))).toEqual([]);
  // … and one that arrives over realtime is not kept.
  const kept = await page.evaluate(realtimeBookingsCopy, SAVED_BOOKINGS);
  expect(kept).toEqual({ handlers: 1, changed: false, gross: false });

  // 2. the ledger request is limited to the Camp Tab's own lines; salaries and HQ lines never reach the device.
  const ledgerGets = db.requests.filter(r => r.table === 'ledger_entries' && r.method === 'GET');
  expect(ledgerGets.length).toBeGreaterThan(0);
  expect(ledgerGets.every(r => /source_kind=in\.\(/.test(r.url))).toBe(true);
  const onDevice = await page.evaluate(() => S.ledger.map(x => x.sourceKind).sort());
  expect(onDevice).toEqual(['camp_tab_per_guest']);
  // 3. the POS is what the account sees.
  expect(await page.evaluate(() => activePage)).toBe('pos');
  expect(errors).toEqual([]);
});

test('camp hub: a full account is unchanged — whole ledger, and the saved bookings copy fills a camp with no bookings table rows', async ({ page }) => {
  const db = await openHub(page, { savedBookings: SAVED_BOOKINGS });
  await hydrated(page);
  await page.waitForFunction(() => ovBookings.length === 1);
  expect(db.requests.some(r => r.table === 'location_state_store' && r.method === 'GET' && r.url.includes('camphub_ov_bookings_v3'))).toBe(true);
  const ledgerGets = db.requests.filter(r => r.table === 'ledger_entries' && r.method === 'GET');
  expect(ledgerGets.some(r => /source_kind=in\./.test(r.url))).toBe(false);
  expect(await page.evaluate(() => S.ledger.length)).toBe(4);
  // and a newer copy arriving over realtime is taken (the bookings table is empty here)
  const newer = [...SAVED_BOOKINGS, { ...SAVED_BOOKINGS[0], ref: 'B-10', name: 'Guest Ten' }];
  expect(await page.evaluate(realtimeBookingsCopy, newer)).toEqual({ handlers: 1, changed: true, gross: true });
});

// ── CH-09 ────────────────────────────────────────────────────────────────────
test('camp hub: the page no longer ships the unused embedded copy of the Camp Tab', async () => {
  const file = path.join(__dirname, '..', 'camp-hub', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  expect(html).not.toContain('CAMP_TAB_EMBED_HTML');
  expect(html).not.toMatch(/atob\('[A-Za-z0-9+/=]{1000,}'\)/);        // no large base64 blob of any name
  expect(html).toContain("frame.src='/camp-hub/camp-tab-inner.html?location='"); // the Camp Tab is still the iframe
  expect(fs.statSync(file).size).toBeLessThan(700 * 1024);            // was 778,660 bytes
});
