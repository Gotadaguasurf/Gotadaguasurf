// Surf School rentals (/surf-school/) — audit 18 Nov 2026:
//   UXC-05 / SA-21  «Boards out» reads every board still out (no «latest 500» cap); History asks the server for the
//                   type and period picked, 300 at a time, with the real total and «Show more»
//   SA-01           a failed save tells the truth: refused by the database = nothing saved; no answer = check the list
//   SA-02           «Delete entry» really deletes (revenue line first, the database removes the rental with it)
//                   and says so honestly when the account may not delete
// Hermetic: every Supabase call is answered here; the rentals are made up (example.com, «Student n»).
const { test, expect } = require('@playwright/test');
const { fakeSession, UID, OWNER } = require('./hub-stub');

const LOC = 'loc-surf-school';
const HOUR = 3600 * 1000;

// n rentals, newest first, one every 3 hours; the oldest `stillOut` are still out (opened weeks ago)
function makeRentals(n, stillOut = 0) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(Date.now() - (i + 1) * 3 * HOUR).toISOString();
    const out = i >= n - stillOut;
    rows.push({ id: 'r' + String(i).padStart(5, '0'), location_id: LOC, kind: 'rental', student_name: 'Student ' + i, student_email: null, id_card_number: null,
      item_id: null, item_name: 'Board + Wetsuit', qty: 1, price_local: 20, currency: 'EUR', payment_method: 'Cash', opened_at: t, opened_by: UID,
      closed_at: out ? null : t, closed_by: out ? null : UID, is_returned: !out, ledger_entry_id: out ? null : 'led-' + i, terms_accepted: true,
      customer_type: 'Standard', rental_type: 'Same Day', duration: '2H', items: [], start_time: t, expected_return_at: null });
  }
  return rows;
}

// opts: { rentals, insert: 'ok' | 'refused' | 'offline', ledgerDelete: 'ok' | 'blocked' }
async function stubSurfSchool(page, opts = {}) {
  const state = { rentals: (opts.rentals || []).slice(), ledger: new Set((opts.rentals || []).map(r => r.ledger_entry_id).filter(Boolean)), calls: [] };
  await fakeSession(page, OWNER);
  await page.route(/supabase\.co\/(auth|rest|functions|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const method = req.method(); const u = new URL(req.url()); const url = decodeURIComponent(req.url());
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const prefer = req.headers()['prefer'] || '';
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-expose-headers': 'content-range', ...headers }, body: method === 'HEAD' ? '' : JSON.stringify(body) });
    const table = (u.pathname.match(/\/rest\/v1\/([^/?]+)/) || [])[1] || '';
    state.calls.push({ method, table, url });
    if (url.includes('/auth/v1/user')) return json({ id: UID, email: OWNER, aud: 'authenticated', role: 'authenticated' });
    if (table === 'platform_profiles') {
      const me = { id: UID, email: OWNER, full_name: 'Test Person', platform_role: 'super_admin', active: true };
      return json(single ? me : [me]);
    }
    if (table === 'locations') { const loc = { id: LOC, name: 'Surf School', slug: 'surf-school' }; return json(single ? loc : [loc]); }
    if (table === 'workspace_memberships') return json(single ? null : []);
    if (table === 'surf_school_rentals') {
      const p = u.searchParams;
      const val = (k) => (p.get(k) || '').replace(/^[a-z]+\./, '');
      const match = (r) => {
        if (p.get('location_id') && r.location_id !== val('location_id')) return false;
        if (p.get('id') && r.id !== val('id')) return false;
        if (p.get('kind') && r.kind !== val('kind')) return false;
        if (p.get('opened_at') && !(r.opened_at >= val('opened_at'))) return false;
        if (p.get('is_returned') && String(r.is_returned) !== val('is_returned')) return false;
        if (p.get('closed_at') && !(r.closed_at && r.closed_at >= val('closed_at'))) return false;
        return true;
      };
      if (method === 'POST') {
        if (opts.insert === 'refused') return json({ code: '42501', message: 'new row violates row-level security policy', details: null, hint: null }, 403);
        if (opts.insert === 'offline') return route.abort('internetdisconnected');
        const row = JSON.parse(req.postData() || '{}'); const rows = Array.isArray(row) ? row : [row];
        rows.forEach((r, i) => state.rentals.unshift({ id: 'new' + i, ...r }));
        return json([], 201);
      }
      if (method === 'DELETE') {
        const gone = state.rentals.filter(match);
        state.rentals = state.rentals.filter(r => !match(r));
        return json([], 200, { 'content-range': `*/${gone.length}` });
      }
      const rows = state.rentals.filter(match).sort((a, b) => b.opened_at.localeCompare(a.opened_at) || a.id.localeCompare(b.id));
      if (single) return json(rows[0] || null, rows[0] ? 200 : 406);
      const off = Number(p.get('offset') || 0), lim = Math.min(Number(p.get('limit') || 1000), 1000);   // the server never answers more than 1000 rows
      const slice = rows.slice(off, off + lim);
      const total = /count=exact/.test(prefer) ? rows.length : '*';
      return json(slice, 200, { 'content-range': `${slice.length ? off + '-' + (off + slice.length - 1) : '*'}/${total}` });
    }
    if (table === 'ledger_entries' && method === 'DELETE') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      if (opts.ledgerDelete === 'blocked' || !state.ledger.has(id)) return json([], 200, { 'content-range': '*/0' });   // RLS: no error, 0 rows
      state.ledger.delete(id);
      state.rentals = state.rentals.filter(r => r.ledger_entry_id !== id);   // tr_ledger_cascade_surf_rental
      return json([], 200, { 'content-range': '*/1' });
    }
    return json(single ? null : []);
  });
  return state;
}

async function openSchool(page) {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/surf-school/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LOCATION_ID !== 'undefined' && LOCATION_ID && document.getElementById('openBadge'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return errs;
}
const toastText = (page) => page.evaluate(() => document.getElementById('toast').textContent);

test('surf school: a board out for weeks is still under «Boards out», and History pages through everything with the real total', async ({ page }) => {
  // 1,200 entries; the 3 oldest (opened ~150 days ago) are still out — beyond the old «latest 500» window
  const state = await stubSurfSchool(page, { rentals: makeRentals(1200, 3) });
  const errs = await openSchool(page);
  await expect(page.locator('#openBadge')).toHaveText('3');
  // the board list asks the server for what is out (or came back in the last 24 h), not for the newest 500
  const listRead = state.calls.find(c => c.table === 'surf_school_rentals' && c.method === 'GET' && c.url.includes('is_returned=eq.false'));
  expect(listRead).toBeTruthy();
  expect(listRead.url).not.toMatch(/limit=500/);

  await page.click('[data-page="history"]');
  await page.selectOption('#filt_period', 'all');
  await expect(page.locator('#historyList .list-note')).toContainText('Showing the latest 300 of 1200');
  await expect(page.locator('#historyList .rental-row')).toHaveCount(300);
  await page.click('#historyList .list-note button');
  await expect(page.locator('#historyList .rental-row')).toHaveCount(600);
  // a refresh (e.g. another device saves a rental) keeps the 600 on screen
  await page.evaluate(() => renderHistory());
  await page.waitForTimeout(300);
  await expect(page.locator('#historyList .rental-row')).toHaveCount(600);
  // another period starts again at the newest 300; «Today» on this data = the last entries only
  await page.selectOption('#filt_period', 'today');
  await page.waitForTimeout(300);
  const today = await page.locator('#historyList .rental-row').count();
  expect(today).toBeLessThanOrEqual(8);
  expect(errs).toEqual([]);
});

async function fillRental(page) {
  await page.fill('#fld_name', 'Ana Example');
  await page.evaluate(() => { const s = document.getElementById('fld_customer_type'); s.value = 'Standard'; recalcRentalTotal(); });
  if (!(Number(await page.inputValue('#fld_price')) > 0)) await page.fill('#fld_price', '20');
  await page.check('#fld_terms', { force: true });
}

test('surf school: a save the database refuses says nothing was saved, shows the real error and keeps the form', async ({ page }) => {
  await stubSurfSchool(page, { rentals: makeRentals(5), insert: 'refused' });
  const errs = await openSchool(page);
  await fillRental(page);
  await page.click('#saveBtn');
  await expect(page.locator('#toast')).toContainText('Not saved — nothing was recorded');
  const t = await toastText(page);
  expect(t).toContain('row-level security');
  expect(t).not.toMatch(/Payment saved|Don't enter it again/i);
  await expect(page.locator('#fld_name')).toHaveValue('Ana Example');
  await expect(page.locator('#saveBtn')).toBeEnabled();
  expect(errs).toEqual([]);
});

test('surf school: a save with no answer (connection dropped) asks to check the list before saving again', async ({ page }) => {
  await stubSurfSchool(page, { rentals: makeRentals(5), insert: 'offline' });
  const errs = await openSchool(page);
  await fillRental(page);
  await page.click('#saveBtn');
  await expect(page.locator('#toast')).toContainText('Not sure it saved');
  expect(await toastText(page)).toContain('Check Boards out before saving again');
  await expect(page.locator('#fld_name')).toHaveValue('Ana Example');
  await expect(page.locator('#saveBtn')).toBeEnabled();
  expect(errs).toEqual([]);
});

test('surf school: «Delete entry» removes a returned rental with its revenue line, and a board still out on its own', async ({ page }) => {
  const state = await stubSurfSchool(page, { rentals: makeRentals(4, 1) });
  const errs = await openSchool(page);
  page.on('dialog', d => d.accept('Student'));
  await page.click('[data-page="history"]');
  await page.selectOption('#filt_period', 'all');
  await expect(page.locator('#historyList .rental-row')).toHaveCount(4);
  // returned rental (has a revenue line): the line is deleted, the database removes the rental with it
  await page.locator('#historyList .rental-row', { hasText: 'Student 0' }).locator('button', { hasText: 'Delete entry' }).click();
  await expect(page.locator('#toast')).toHaveText('Deleted');
  expect(state.calls.some(c => c.table === 'ledger_entries' && c.method === 'DELETE' && c.url.includes('led-0'))).toBe(true);
  expect(state.rentals.map(r => r.id)).not.toContain('r00000');
  await expect(page.locator('#historyList .rental-row')).toHaveCount(3);
  // board still out (no revenue line yet): the rental itself is deleted
  await page.locator('#historyList .rental-row', { hasText: 'Student 3' }).locator('button', { hasText: 'Delete entry' }).click();
  await expect(page.locator('#historyList .rental-row')).toHaveCount(2);
  await expect(page.locator('#toast')).toHaveText('Deleted');
  expect(state.rentals.map(r => r.id)).not.toContain('r00003');
  expect(errs).toEqual([]);
});

test('surf school: when the database refuses the delete, the page says so and deletes nothing', async ({ page }) => {
  const state = await stubSurfSchool(page, { rentals: makeRentals(3), ledgerDelete: 'blocked' });
  const errs = await openSchool(page);
  page.on('dialog', d => d.accept('Student'));
  await page.click('[data-page="history"]');
  await page.selectOption('#filt_period', 'all');
  await page.locator('#historyList .rental-row', { hasText: 'Student 1' }).locator('button', { hasText: 'Delete entry' }).click();
  await expect(page.locator('#toast')).toContainText("Not deleted — this account can't delete entries");
  expect(state.rentals).toHaveLength(3);
  // it never went on to delete a rental that still has its revenue line
  expect(state.calls.filter(c => c.table === 'surf_school_rentals' && c.method === 'DELETE')).toHaveLength(0);
  expect(errs).toEqual([]);
});
