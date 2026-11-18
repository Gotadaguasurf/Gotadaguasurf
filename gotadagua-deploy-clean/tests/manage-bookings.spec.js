// Hub «Manage / Import bookings» (/?openImport=1) — audit 18 Nov 2026:
//   UXC-03  the list loads EVERY booking (the server answers 1000 rows at a time), and the delete confirm shows the
//           number the server counts for the whole month and location — the same filter the delete uses
//   CH-01   the copy of the bookings the import keeps for the camp hub carries dates and guests, never money
// Hermetic: every Supabase call is stubbed (tests/hub-stub.js); the bookings are made up.
const { test, expect } = require('@playwright/test');
const { stubHub, OWNER } = require('./hub-stub');

const SHOTS = process.env.W3_SHOTS || '';
const LOCS = ['Surf Camp Portugal', 'Surf Camp Ahangama', 'Tamraght Camp', 'Surf School Caparica'];
const STATUSES = ['paid', 'confirmed', 'deposit_paid', 'draft'];

// 2,300 bookings over Jan–Nov 2026 in four locations + 17 saved with the location text «Unknown»
function makeBookings() {
  const rows = [];
  for (let i = 0; i < 2300; i++) {
    const mm = String(1 + (i % 11)).padStart(2, '0'); const dd = String(1 + (i % 27)).padStart(2, '0');
    rows.push({ booking_ref: 'T' + String(100000 + i), booker: 'Guest ' + i, check_in_on: `2026-${mm}-${dd}`, month_key: `2026-${mm}`, total: 500,
      location: LOCS[i % 4], partner_name: i % 5 === 0 ? 'Partner X' : null, booking_type: i % 5 === 0 ? 'surfcamp' : 'direct',
      status: STATUSES[i % 3 === 0 ? 3 : i % 3], bookerEmail: `guest${i}@example.com`, paidAmount: '100', country: 'DE', checkoutMs: null });
  }
  for (let i = 0; i < 17; i++) rows.push({ booking_ref: 'U' + i, booker: 'No Place ' + i, check_in_on: '2026-11-20', month_key: '2026-11', total: 700,
    location: 'Unknown', partner_name: null, booking_type: 'direct', status: 'confirmed', bookerEmail: '', paidAmount: null, country: '', checkoutMs: null });
  return rows.sort((a, b) => b.check_in_on.localeCompare(a.check_in_on) || a.booking_ref.localeCompare(b.booking_ref));
}

async function openManage(page, tables = {}) {
  const hub = await stubHub(page, { email: OWNER, role: 'super_admin', areas: [{ slug: 'hq' }, { slug: 'portugal' }] }, { bookings: makeBookings(), ...tables });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('/?openImport=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /bookings? imported/.test(document.getElementById('csvManageStatus')?.textContent || ''), null, { timeout: 20000 });
  return { ...hub, errs };
}
const bucketRow = (page, month, loc) => page.locator('#csvManageTableWrap > table > tbody > tr', { hasText: month }).filter({ hasText: loc }).first();

test('manage bookings: every booking is loaded, 1000 at a time, and all months can be filtered', async ({ page }) => {
  const { calls, errs } = await openManage(page);
  expect(await page.textContent('#csvManageStatus')).toBe('2317 bookings imported');
  const reads = calls.filter(c => c.table === 'bookings' && c.method === 'GET');
  expect(reads.map(c => new URL(c.url.replace(/ /g, '%20')).searchParams.get('offset') || '0')).toEqual(['0', '1000', '2000']);
  expect(reads.every(c => /order=check_in_on\.desc,booking_ref\.asc/.test(c.url))).toBe(true);   // stable paging
  expect(reads.every(c => !/select=[^&]*raw_payload(,|&|$)/.test(c.url))).toBe(true);             // five fields, not the whole payload
  const months = await page.$$eval('#csvManageMonth option', os => os.map(o => o.value));
  expect(months).toEqual(['all', '2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01']);
  // the totals row counts all of them
  expect(await page.locator('#csvManageTableWrap > table > tbody > tr').last().locator('td').nth(1).textContent()).toBe('2317');
  // a bucket opens with its bookings, email and check-out handled without errors
  await bucketRow(page, '2026-01', 'Surf Camp Portugal').click();
  await expect(page.locator('#csvManageTableWrap a[href^="mailto:guest"]').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-manage-bookings-${page.viewportSize().width}.png` });
  expect(errs).toEqual([]);
});

test('manage bookings: with a Status filter on, the confirm shows what the delete really removes (the whole month and location)', async ({ page }) => {
  const { calls, state } = await openManage(page);
  const real = state.bookings.filter(b => b.month_key === '2026-09' && b.location === 'Surf Camp Portugal').length;
  const drafts = state.bookings.filter(b => b.month_key === '2026-09' && b.location === 'Surf Camp Portugal' && b.status === 'draft').length;
  expect(drafts).toBeGreaterThan(0); expect(real).toBeGreaterThan(drafts);
  await page.selectOption('#csvManageMonth', '2026-09');
  await page.selectOption('#csvManageStatusF', 'draft');
  const row = bucketRow(page, '2026-09', 'Surf Camp Portugal');
  expect((await row.locator('td').nth(2).textContent()).trim()).toBe(String(drafts));   // the list shows the drafts only
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.accept('2'); });                    // 2 = Partners only
  await row.locator('button', { hasText: 'Delete' }).click();
  await page.waitForFunction(() => /^Deleted/.test(document.getElementById('csvManageStatus').textContent), null, { timeout: 15000 });
  expect(asked).toContain(`Delete ${real} bookings for Surf Camp Portugal in 2026-09?`);
  expect(asked).toContain(`The list shows ${drafts} (status «draft»), but this deletes ALL ${real}`);
  // count and delete used the same filter: month + location, nothing else
  const count = calls.find(c => c.table === 'bookings' && c.method === 'HEAD');
  const del = calls.find(c => c.table === 'bookings' && c.method === 'DELETE');
  const filterOf = (c) => { const q = new URL(c.url.replace(/ /g, '%20')).searchParams; return [...q.keys()].filter(k => k !== 'select').sort().map(k => `${k}=${q.get(k)}`).join('&'); };
  expect(filterOf(count)).toBe('location=eq.Surf Camp Portugal&month_key=eq.2026-09');
  expect(filterOf(del)).toBe(filterOf(count));
  expect(count.prefer).toContain('count=exact');
  // the message that stays on screen is what the database removed, and the list was read again
  expect(await page.textContent('#csvManageStatus')).toBe(`Deleted ${real} bookings from Partners · ${2317 - real} bookings imported`);
  expect(calls.some(c => c.table === 'location_state_store' && c.method !== 'GET')).toBe(false);   // «Partners only» leaves the camp hub alone
});

test('manage bookings: the «Unknown» location bucket counts and deletes the rows saved as «Unknown» (it deleted nothing before)', async ({ page }) => {
  const { calls } = await openManage(page);
  await page.selectOption('#csvManageLoc', 'Unknown');
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.accept('2'); });
  await bucketRow(page, '2026-11', 'Unknown').locator('button', { hasText: 'Delete' }).click();
  await page.waitForFunction(() => /^Deleted/.test(document.getElementById('csvManageStatus').textContent), null, { timeout: 15000 });
  expect(asked).toContain('Delete 17 bookings for Unknown in 2026-11?');
  expect(asked).not.toContain('deletes ALL');                                           // list and server agree → no extra line
  for (const m of ['HEAD', 'DELETE']) expect(calls.find(c => c.table === 'bookings' && c.method === m).url).toContain('or=(location.is.null,location.eq.Unknown)');
  expect(await page.textContent('#csvManageStatus')).toBe('Deleted 17 bookings from Partners · 2300 bookings imported');
});

test('manage bookings: when the count cannot be read nothing is asked and nothing is deleted', async ({ page }) => {
  let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
  const { calls } = await openManage(page, { onRequest: ({ method, url }) => method === 'HEAD' && url.includes('/rest/v1/bookings') ? { status: 500, body: { message: 'boom' } } : null });
  await bucketRow(page, '2026-09', 'Tamraght Camp').locator('button', { hasText: 'Delete' }).click();
  await page.waitForFunction(() => /Nothing deleted/.test(document.getElementById('csvManageStatus').textContent), null, { timeout: 15000 });
  expect(await page.textContent('#csvManageStatus')).toContain("couldn't count the bookings");
  expect(dialogs).toBe(0);
  expect(calls.some(c => c.method === 'DELETE')).toBe(false);
});

test('manage bookings: an account the database does not let delete is told so (no «Deleted N»), and the camp hub copy is not touched', async ({ page }) => {
  const { calls } = await openManage(page, { deleteBlocked: true, blob: [{ ref: 'T100000', ci: Date.UTC(2026, 8, 3), name: 'Guest' }] });
  page.once('dialog', d => d.accept('1'));                                              // 1 = camp hub and Partners
  await bucketRow(page, '2026-09', 'Surf Camp Portugal').locator('button', { hasText: 'Delete' }).click();
  await page.waitForFunction(() => /Nothing was deleted/.test(document.getElementById('csvManageStatus').textContent), null, { timeout: 15000 });
  expect(await page.textContent('#csvManageStatus')).toBe("Nothing was deleted — this account can't delete bookings. Ask Miguel.");
  expect(calls.some(c => c.table === 'location_state_store' && c.method !== 'GET')).toBe(false);
});

test('bookings import: the copy kept for the camp hub has dates and guests only — no amount, partner or commission (CH-01)', async ({ page }) => {
  // what is already stored keeps whatever it has; only the rows this import writes are checked
  const { calls } = await openManage(page, { blob: [{ ref: 'OLD-1', name: 'Earlier Guest', ci: Date.UTC(2025, 5, 1), co: Date.UTC(2025, 5, 8), pax: 2 }] });
  await page.click('#csvTabUploadBtn');
  const csv = ['Booking #,Booker,Check-in on,Check-out on,Status,Pax,Location,Partner,Partner commission %,Total',
    'IMP-1,Ana Example,2026-12-05,2026-12-12,Paid,2,PT,Partner X,15,1400',
    'IMP-2,Ben Example,2026-12-06,2026-12-13,Confirmed,1,PT,,0,650'].join('\n');
  await page.setInputFiles('#csvTabUpload input[type=file]', { name: 'bookings.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForFunction(() => /2 bookings imported across 1 camp hub/.test(document.getElementById('globalCsvSummary').textContent), null, { timeout: 15000 });
  const blobWrite = calls.find(c => c.table === 'location_state_store' && c.method === 'POST');
  const saved = JSON.parse(blobWrite.body).state_json;
  expect(saved.map(b => b.ref)).toEqual(['OLD-1', 'IMP-1', 'IMP-2']);                    // merged by reference, earlier rows kept
  const imp = saved.find(b => b.ref === 'IMP-1');
  expect(Object.keys(imp).sort()).toEqual(['accommodation', 'ci', 'co', 'location_code', 'location_name', 'name', 'nights', 'pax', 'ref', 'status']);
  expect(JSON.stringify(saved)).not.toMatch(/gross|partner|commission|1400|Partner X/);
  expect(imp).toMatchObject({ name: 'Ana Example', pax: 2, nights: 7, status: 'paid', ci: Date.UTC(2026, 11, 5), co: Date.UTC(2026, 11, 12) });   // who arrives and leaves: unchanged
  // the money still goes where it is protected by role: the bookings table
  const bk = JSON.parse(calls.find(c => c.table === 'bookings' && c.method === 'POST').body);
  expect(bk.find(b => b.booking_ref === 'IMP-1')).toMatchObject({ total: 1400, partner_name: 'Partner X', partner_commission_pct: 15, commission_amount: 210, net_amount: 1190 });
});
