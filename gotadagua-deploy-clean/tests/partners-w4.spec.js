// Partners page, audit wave 4 (18 Nov 2026): revenue tiles follow the realized
// rule (PRT-12 / SEAM-02), a new invoice no longer moves the month to «Invoice
// Sent» (PRT-18), Partners & Rates never resets a stored partner (PRT-10), the
// contact-name hint (PRT-11), one debounced reload for a burst of realtime events
// and a slimmer bookings read (PRT-13), received-on-open-months in the KPI (PRT-04).
// Hermetic: Supabase is an in-memory stub, every name and amount is invented.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, OWNER_EMAIL } = require('./helpers');

const UID = '00000000-0000-4000-8000-000000000001';
const AUTH = {
  platform_profiles: [{ id: UID, email: OWNER_EMAIL, full_name: 'Owner', platform_role: 'owner', active: true, password_set_at: '2026-01-01T00:00:00Z' }],
  workspaces: [{ id: 'ws-hq', slug: 'hq', name: 'HQ' }],
  workspace_memberships: [{ id: 'm-hq', user_id: UID, workspace_id: 'ws-hq', member_role: 'super_admin', can_view: true, can_edit: true, active: true, workspaces: { slug: 'hq', name: 'HQ' } }],
};

function fixture({ contactCol = true } = {}) {
  const P = (name, o = {}) => ({ id: 'p-' + name.toLowerCase().replace(/[^a-z]+/g, '-'), name, email: o.email ?? name.toLowerCase().replace(/[^a-z]+/g, '') + '@example.com',
    commission_pct: o.pct ?? 20, collects_from_guest: o.collects !== false, partner_type: 'surfcamp', is_active: o.active !== false, no_monthly_invoice: false,
    ...(contactCol ? { contact_name: o.contact || null } : {}) });
  const partners = [
    P('Blue Wave Travel', { contact: 'Anna' }),
    P('Tide Riders', { collects: false, pct: 15 }),
    P('Old Harbour Hostel', { active: false, collects: false, pct: 10 }),   // archived, still has a booking
  ];
  let n = 0;
  const B = (partner, checkin, total, o = {}) => { n++;
    const pct = o.pct ?? (partner ? 20 : 0); const com = +(total * pct / 100).toFixed(2);
    return { id: 'b-' + n, booking_ref: '2026-' + String(2000 + n), booker: 'Guest ' + n, check_in_on: checkin, month_key: checkin.slice(0, 7), total, pax: 1, location: 'Surf Camp Portugal', package: 'Surf Week',
      partner_name: partner, partner_commission_pct: pct, commission_amount: com, net_amount: +(total - com).toFixed(2), country: '', booking_type: partner ? 'partner' : 'direct',
      raw_payload: { status: o.status || 'paid', due: o.due ?? '0', bookingSource: partner ? 'Partner' : 'Website' } }; };
  const bookings = [
    B('Blue Wave Travel', '2026-09-07', 1000, { status: 'confirmed', due: '1000' }),   // partner collected → owes us 800
    B('Blue Wave Travel', '2026-10-05', 500, { status: 'confirmed', due: '500' }),     // owes us 400
    B('Tide Riders', '2026-09-14', 600, { pct: 15 }),                                 // we collected → we owe 90
    B('Old Harbour Hostel', '2026-03-02', 200, { pct: 10 }),
    B(null, '2026-10-12', 700),                                                       // direct, paid
    B(null, '2026-10-19', 900, { status: 'Canceled' }),                               // direct, cancelled
    B('Blue Wave Travel', '2026-10-26', 300, { status: 'Canceled', due: '300' }),     // partner, cancelled
  ];
  const partner_month_status = [
    { id: 's1', partner_id: 'p-blue-wave-travel', month_key: '2026-09', status: 'Invoice Sent', notes: null, partners: { name: 'Blue Wave Travel' } },
  ];
  const partner_invoices = [];
  const partner_ledger = [
    // 300 arrived for September (not marked Paid yet) — reported, never subtracted
    { id: 'l1', partner_id: 'p-blue-wave-travel', partner_name: 'Blue Wave Travel', entry_date: '2026-10-20', kind: 'received', amount: 300, ref: 'part payment', applies_to: '2026-09', bank: 'cgd', bank_ref: 'TRF', notes: null, deleted_at: null },
  ];
  return { partners, bookings, partner_month_status, partner_invoices, partner_ledger };
}

// In-memory PostgREST (eq / is / in filters). Every write and rpc is recorded
// with its body and Prefer header; `reads` counts GETs per table.
async function stub(page, { tables, calls, reads, rpc = {} }) {
  const T = { ...AUTH, ...tables };
  const match = (row, url) => [...new URL(url).searchParams.entries()].every(([k, v]) => {
    const m = String(v).match(/^(eq|is|in)\.(.*)$/s); if (!m || ['select', 'order', 'limit', 'offset', 'or', 'and'].includes(k)) return true;
    if (m[1] === 'eq') return String(row[k]) === m[2];
    if (m[1] === 'is') return m[2] === 'null' ? row[k] == null : String(row[k]) === m[2];
    return m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(row[k]));
  });
  await page.route(/api\.frankfurter\.dev|accounts\.google/, r => r.abort());
  await page.route(/supabase\.co\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b), headers: { 'content-range': '0-0/0' } });
    if (url.includes('/auth/v1/user')) return json({ id: UID, email: OWNER_EMAIL, aud: 'authenticated', role: 'authenticated' });
    if (/\/(auth\/v1|realtime|storage|functions)\//.test(url)) return json({});
    const rp = (url.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/) || [])[1];
    if (rp) { calls.push({ rpc: rp, body: req.postDataJSON() }); return json(rp in rpc ? rpc[rp] : null); }
    const t = (url.match(/\/rest\/v1\/([a-z_0-9]+)/) || [])[1]; if (!t) return json([]);
    if (method !== 'GET' && method !== 'HEAD') {
      let body = null; try { body = req.postDataJSON(); } catch (e) {}
      calls.push({ write: t, method, url, body, prefer: req.headers().prefer || '' });
      return json([], method === 'POST' ? 201 : 200);
    }
    if (method === 'GET') { reads[t] = (reads[t] || 0) + 1; reads.urls = (reads.urls || []).concat(url); }
    const out = (T[t] || []).filter(r => match(r, url));
    if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
    return json(out);
  });
}
async function openPartners(browser, { width = 1280, tables = fixture() } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 768, timezoneId: 'Europe/Lisbon' });
  const page = await ctx.newPage(); const calls = []; const reads = {}; const errs = []; const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); }); page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-18T10:00:00Z'));
  await stub(page, { tables, calls, reads }); await fakeOwnerSession(page);
  await page.goto('/partners/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#partnerTableBodyCamp tr .pname').first()).toBeVisible({ timeout: 15_000 });
  return { ctx, page, calls, reads, errs, dialogs };
}
const kpi = (page, label) => page.locator('#kpiStrip .kpi').filter({ hasText: label }).locator('.kpi-value').innerText();

// ── PRT-12 / SEAM-02 ─────────────────────────────────────────────────────────
test('revenue tiles count realized bookings only, like the HQ Overview (cancelled stays out)', async ({ browser }) => {
  const { ctx, page, errs } = await openPartners(browser);
  // partner gross: 1000 + 500 + 600 + 200 (the cancelled 300 is out); direct: 700 (the cancelled 900 is out)
  expect(await kpi(page, 'Partner gross revenue')).toBe('€2,300.00');
  expect(await kpi(page, 'Direct bookings')).toBe('€700.00');
  await expect(page.locator('#kpiStrip .kpi').filter({ hasText: 'Direct bookings' })).toContainText('1 booking ·');
  expect(await kpi(page, 'Total gross')).toBe('€3,000.00');
  // net from partners: 800 + 400 + 510 + 180 = 1,890; + direct 700
  expect(await kpi(page, 'Total revenue Gota Dagua')).toBe('€2,590.00');
  expect(errs).toEqual([]);
  await ctx.close();
});

// ── PRT-18 (part A) ──────────────────────────────────────────────────────────
test('+ invoice saves the row but leaves the month status alone; errors are a toast, not a blocking alert', async ({ browser }) => {
  const { ctx, page, calls, errs } = await openPartners(browser);
  const answers = ['FT T/700', '1234.50', ''];
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.type() === 'prompt' ? d.accept(answers.shift()) : d.dismiss());
  await page.evaluate(() => window.addPartnerInvoice('Blue Wave Travel', '2026-10'));
  const ins = calls.find(c => c.write === 'partner_invoices' && c.method === 'POST');
  expect(ins.body).toMatchObject({ partner_name: 'Blue Wave Travel', month_key: '2026-10', invoice_number: 'FT T/700', amount: 1234.5 });
  expect(calls.filter(c => c.rpc)).toEqual([]);                 // no advance_partner_month_status / upsert_partner_month_status
  await expect(page.locator('#toast')).toContainText('Invoice FT T/700 saved');
  // a failed save says so in a red toast that stays readable
  await page.route(/rest\/v1\/partner_invoices/, r => r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'duplicate key value' }) }) : r.fallback());
  answers.push('FT T/701', '10', '');
  await page.evaluate(() => window.addPartnerInvoice('Blue Wave Travel', '2026-10'));
  await expect(page.locator('#toast.err')).toContainText('Could not save the invoice: duplicate key value');
  await page.waitForTimeout(3500);
  await expect(page.locator('#toast.err')).toBeVisible();      // still there after the default 3.2 s
  expect(errs).toEqual([]);
  await ctx.close();
});

// ── PRT-10 ───────────────────────────────────────────────────────────────────
test('Partners & Rates save: stored records are never reset to defaults or re-activated; only real edits are written', async ({ browser }) => {
  const tables = fixture();
  tables.partners.push({ id: 'p-quiet', name: 'Quiet Partner', email: 'quiet@example.com', commission_pct: 12, collects_from_guest: true, partner_type: 'surfcamp', is_active: true, no_monthly_invoice: false, contact_name: null });
  tables.bookings.push({ ...tables.bookings[0], id: 'b-new', booking_ref: '2026-2999', partner_name: 'Fresh Hostel' });   // a name with no record yet
  const { ctx, page, calls, errs } = await openPartners(browser, { tables });
  await page.evaluate(() => window.openSettings());
  const rowOf = name => page.locator('#partnerRatesList .partner-row').filter({ has: page.locator(`input[value="${name}"]`) });
  // X on a partner with bookings: refused with a message, the row stays
  await rowOf('Blue Wave Travel').locator('button.btn-r').click();
  await expect(page.locator('#toast')).toContainText('Blue Wave Travel has 3 bookings');
  await expect(rowOf('Blue Wave Travel')).toHaveCount(1);
  // X on a partner with no bookings: removed, archived on save
  await rowOf('Quiet Partner').locator('button.btn-r').click();
  await expect(rowOf('Quiet Partner')).toHaveCount(0);
  // a real edit
  await rowOf('Tide Riders').locator('input[id^="pemail_"]').fill('desk@tide.example.com');
  calls.length = 0;
  await page.evaluate(() => window.saveSettings());
  await expect.poll(() => calls.some(c => c.write === 'partners' && c.method === 'PATCH')).toBe(true);
  const posts = calls.filter(c => c.write === 'partners' && c.method === 'POST');
  const written = posts.flatMap(c => [].concat(c.body).map(r => ({ ...r, prefer: c.prefer })));
  const byName = Object.fromEntries(written.map(r => [r.name, r]));
  // the archived record that still has a booking is not touched (it showed with defaults in the modal)
  expect(byName['Old Harbour Hostel']).toBeUndefined();
  // loaded records keep their stored values; the edit goes through
  expect(byName['Tide Riders']).toMatchObject({ email: 'desk@tide.example.com', commission_pct: 15, collects_from_guest: false, is_active: true });
  expect(byName['Tide Riders'].prefer).toContain('merge-duplicates');
  expect(byName['Blue Wave Travel']).toMatchObject({ email: 'bluewavetravel@example.com', commission_pct: 20, contact_name: 'Anna' });
  // a name seen only on bookings is inserted, never merged over an existing record
  expect(byName['Fresh Hostel'].prefer).toContain('ignore-duplicates');
  // only the removed row is archived
  const patch = calls.find(c => c.write === 'partners' && c.method === 'PATCH');
  expect(patch.body).toEqual({ is_active: false });
  expect(patch.url.replace(/\+/g, ' ')).toContain('name=in.(Quiet Partner)');
  expect(errs).toEqual([]);
  await ctx.close();
});

// ── PRT-11 + the wave-4 SQL file ────────────────────────────────────────────
test('contact names: the modal says they cannot be stored while the column is missing, and is quiet once it exists', async ({ browser }) => {
  for (const contactCol of [false, true]) {
    const { ctx, page } = await openPartners(browser, { tables: fixture({ contactCol }) });
    await page.evaluate(() => window.openSettings());
    await expect(page.locator('#contactColHint')).toBeVisible({ visible: !contactCol });
    await ctx.close();
  }
});

test('audit-w4-partners.sql: schema only runs, every data fix is commented with its before-count, nothing for anon/public', () => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'audit-w4-partners.sql'), 'utf8');
  const live = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  expect(live).toMatch(/alter table public\.partners add column if not exists contact_name text;/);
  expect(live).not.toMatch(/\b(update|delete|insert|truncate|drop)\b/i);
  expect(live).not.toMatch(/grant[^;]*\bto\s+(anon|public)\b/i);
  const fixes = sql.split('\n').filter(l => /^--\s+update /.test(l));
  expect(fixes.length).toBeGreaterThanOrEqual(2);
  expect((sql.match(/-- expect \d+/g) || []).length).toBeGreaterThanOrEqual(fixes.length);
});
