// «Who owes us» on the Partners page + the truthful HQ chip (18 Nov 2026 audit, H1 / H2).
// The card lists issued partner invoices not paid (with days), closed months still to
// invoice and receipts with no invoice; hq_todo() counts the same rows with the same rule
// (supabase/partners-open-invoices.sql). Hermetic: Supabase is an in-memory stub, the
// clock is frozen on 18 Nov 2026 and every name and amount below is invented.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession, OWNER_EMAIL } = require('./helpers');
const PartnerAlias = require('../lib/partner-alias.js');

const SHOTS = process.env.OWES_SHOTS || '';   // folder for the 390 / 1280 screenshots (optional)
const UID = '00000000-0000-4000-8000-000000000001';
const AUTH = {
  platform_profiles: [{ id: UID, email: OWNER_EMAIL, full_name: 'Owner', platform_role: 'owner', active: true, password_set_at: '2026-01-01T00:00:00Z' }],
  workspaces: [{ id: 'ws-hq', slug: 'hq', name: 'HQ' }],
  workspace_memberships: [{ id: 'm-hq', user_id: UID, workspace_id: 'ws-hq', member_role: 'super_admin', can_view: true, can_edit: true, active: true, workspaces: { slug: 'hq', name: 'HQ' } }],
};

// ── fixture ────────────────────────────────────────────────────────────────
function fixture() {
  const P = (name, o = {}) => ({ id: 'p-' + name.toLowerCase().replace(/[^a-z]+/g, '-'), name, email: o.email === undefined ? name.toLowerCase().replace(/[^a-z]+/g, '') + '@example.com' : o.email,
    commission_pct: 20, collects_from_guest: o.collects !== false, partner_type: 'surfcamp', is_active: o.active !== false, contact_name: o.contact || null, no_monthly_invoice: !!o.skip });
  const partners = [
    P('Blue Wave Travel', { contact: 'Anna' }), P('North Swell Agency'), P('Coast Line Tours'),
    P('SURFCAMP IT'), P('Surfcamp Italy', { email: '' }),                 // one company, two records (lib/partner-alias.js)
    P('Tide Riders', { collects: false }),                                // we collect, they invoice us their commission
    P('Corporate Kids Club', { skip: true }),                             // billed outside the monthly partner invoices
    P('Old Group', { skip: true, active: false }),                        // inactive records are flagged too
    P('Harbour Hostel'),
  ];
  let n = 0;
  // partner collected (confirmed, nothing paid to us) → the partner owes us the net; `gota` = the guest paid us
  const B = (partner, checkin, net, gota = false) => { const total = +(net / 0.8).toFixed(2); n++;
    return { id: 'b-' + n, booking_ref: '2026-' + String(1000 + n), booker: 'Guest ' + n, check_in_on: checkin, month_key: checkin.slice(0, 7), total, pax: 1, location: 'Portugal', package: 'Surf Week',
      partner_name: partner, partner_commission_pct: 20, commission_amount: +(total - net).toFixed(2), net_amount: net, country: '',
      raw_payload: gota ? { status: 'paid', due: '0', bookingSource: 'Partner' } : { status: 'confirmed', due: String(total), bookingSource: 'Partner' } }; };
  const bookings = [
    B('Blue Wave Travel', '2026-10-05', 820), B('Blue Wave Travel', '2026-10-19', 640),   // closed, overview sent, no invoice
    B('Blue Wave Travel', '2026-09-07', 1200),                                               // Paid
    B('Blue Wave Travel', '2026-08-10', 1000),                                               // invoiced 600 of 1,000
    B('Blue Wave Travel', '2026-11-02', 500),                                                // month still running
    B('North Swell Agency', '2026-08-03', 2000), B('North Swell Agency', '2026-08-17', 500),
    B('North Swell Agency', '2026-06-08', 2150), B('North Swell Agency', '2026-10-12', 900),
    B('Coast Line Tours', '2026-09-14', 480), B('Coast Line Tours', '2026-07-06', 700),
    B('SURFCAMP IT', '2026-07-13', 610), B('Surfcamp Italy', '2026-07-20', 900), B('Surfcamp Italy', '2026-07-27', 750),
    B('SURFCAMP IT', '2026-08-03', 1000), B('Surfcamp Italy', '2026-08-24', 1340),         // one record Paid, the other not
    B('Tide Riders', '2026-09-21', 1200, true),
    B('Corporate Kids Club', '2026-08-10', 325), B('Old Group', '2026-08-11', 150),
  ];
  const S = (partner, month_key, status, notes = null) => ({ id: 's-' + partner + month_key, partner_id: 'x', month_key, status, notes, partners: { name: partner } });
  const partner_month_status = [
    S('Blue Wave Travel', '2026-10', 'Overview Sent'), S('Blue Wave Travel', '2026-09', 'Paid', 'Paid: bank 05-10-2026 +1,200.00 = FT T/100'), S('Blue Wave Travel', '2026-08', 'Invoice Sent'),
    S('North Swell Agency', '2026-08', 'Invoice Sent', 'Portugal paid: bank 06-10-2026 +2,000.00 = FT T/201.\nStill missing FT T/202 (500.00).'),
    S('North Swell Agency', '2026-06', 'Invoice Sent', 'Part paid: 950.00 received on 12-08-2026; nothing since.'), S('North Swell Agency', '2026-10', 'Invoice Sent'),
    S('Coast Line Tours', '2026-09', 'Invoice Sent', 'Invoice sent on 10 Oct.'), S('Coast Line Tours', '2026-07', 'Invoice Sent', 'Em disputa: the partner says the old price applies.'),
    S('SURFCAMP IT', '2026-08', 'Paid'),
  ];
  const I = (partner, month_key, invoice_number, invoice_date, amount, notes = '') => ({ id: 'i-' + invoice_number, partner_id: 'x', partner_name: partner, month_key, invoice_number, invoice_date, amount, drive_link: 'https://drive.google.com/file/d/' + invoice_number.replace(/\W/g, ''), notes, created_at: invoice_date + 'T09:00:00Z' });
  const partner_invoices = [
    I('Blue Wave Travel', '2026-09', 'FT T/100', '2026-10-02', 1200), I('Blue Wave Travel', '2026-08', 'FT T/90', '2026-09-05', 600),
    I('North Swell Agency', '2026-08', 'FT T/201', '2026-09-12', 2000), I('North Swell Agency', '2026-08', 'FT T/202', '2026-09-12', 500),
    I('North Swell Agency', '2026-06', 'FT T/150', '2026-07-10', 2150), I('North Swell Agency', '2026-10', 'FT T/300', '2026-11-10', 900),
    I('North Swell Agency', '2025', 'FT T/50', '2026-08-25', 6300),                       // a whole season on one invoice: the month key is a year
    I('Coast Line Tours', '2026-09', 'FT T/250', '2026-10-10', 480), I('Coast Line Tours', '2026-07', 'FT T/180', '2026-08-01', 700),
    I('SURFCAMP IT', '2026-08', 'FT T/400', '2026-09-04', 1000),
    I('Tide Riders', '2026-09', 'TR 2026-09', '2026-10-01', 300, 'their commission invoice to us'),
  ];
  const L = (partner, entry_date, kind, amount, ref = null, applies_to = null) => ({ id: 'l-' + partner + entry_date + amount, partner_id: 'x', partner_name: partner, entry_date, kind, amount, ref, applies_to, bank: 'cgd', bank_ref: 'TRF', notes: null, deleted_at: null });
  const partner_ledger = [
    L('North Swell Agency', '2026-10-06', 'received', 2000, 'FT T/201', '2026-08'),
    L('North Swell Agency', '2026-08-12', 'received', 950, 'T/150', '2026-06'),           // no «FT» prefix: still the same invoice
    L('Blue Wave Travel', '2026-10-05', 'received', 1200, 'FT T/100', '2026-09'),
    L('Harbour Hostel', '2026-03-02', 'received', 180.5, null, '2026-02'), L('Harbour Hostel', '2026-07-20', 'received', 265, 'Group lessons June', '2026-06'),
    L('Tide Riders', '2026-02-10', 'payment', 1000, 'ADV-1'), L('Tide Riders', '2026-10-20', 'received', 250, 'TR-CN-7'),   // advance partner: stays in the advance balance
  ];
  return { partners, bookings, partner_month_status, partner_invoices, partner_ledger };
}

// In-memory PostgREST (eq / is / in filters). `calls` records every write and rpc.
async function stub(page, { tables = {}, rpc = {}, noFlagColumn = false, calls = [] } = {}) {
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
    if (method !== 'GET' && method !== 'HEAD') { calls.push({ write: t, method }); return json([], method === 'POST' ? 201 : 200); }
    // before supabase/partners-open-invoices.sql is run the column does not exist
    if (noFlagColumn && t === 'partners' && /no_monthly_invoice/.test(url)) return json({ code: '42703', message: 'column partners.no_monthly_invoice does not exist' }, 400);
    let out = (T[t] || []).filter(r => match(r, url));
    if (noFlagColumn && t === 'partners') out = out.map(({ no_monthly_invoice, ...r }) => r);
    if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
    return json(out);
  });
}
async function openPartners(browser, { width = 1280, tables = fixture(), noFlagColumn = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, timezoneId: 'Europe/Lisbon' });
  const page = await ctx.newPage(); const calls = []; const errs = [];
  page.on('dialog', d => d.dismiss().catch(() => {})); page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-18T10:00:00Z'));
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await stub(page, { tables, noFlagColumn, calls }); await fakeOwnerSession(page);
  await page.goto('/partners/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#partnerTableBodyCamp tr .pname').first()).toBeVisible({ timeout: 15_000 });
  return { ctx, page, calls, errs };
}
const rowsOf = (page, list) => page.locator(`.owes-tbl[data-owes="${list}"] tbody tr`).evaluateAll(trs => trs.map(tr => tr.innerText.replace(/\s+/g, ' ').trim()));
const pageWidth = page => page.evaluate(() => document.scrollingElement.scrollWidth);

// ── one list of aliases, one hq_todo ─────────────────────────────────────────
test('aliases: one display name per company, and the SQL mirror says the same', () => {
  expect(PartnerAlias.display(' Surfcamp Italy ')).toBe('Surf Camp IT');
  expect(PartnerAlias.display('SURFHOUSE.IT')).toBe('Surf Camp IT');
  expect(PartnerAlias.same('SURFWISE', 'Surfwise Travel')).toBe(true);
  expect(PartnerAlias.display('Blue Wave Travel')).toBe('Blue Wave Travel');   // no alias: unchanged
  expect(PartnerAlias.key('BLUE WAVE travel')).toBe('blue wave travel');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'partners-open-invoices.sql'), 'utf8');
  const fn = sql.match(/function public\.partner_alias\(p_name text\)[\s\S]*?\$\$;/)[0];
  const inSql = Object.fromEntries([...fn.matchAll(/when '([^']+)'\s+then '([^']+)'/g)].map(m => [m[1], m[2]]));
  const inJs = Object.fromEntries(Object.entries(PartnerAlias.GROUPS).flatMap(([d, names]) => names.map(n => [n.toLowerCase(), d])));
  expect(inSql).toEqual(inJs);
});

test('SQL file: hq_todo is the same text in both files, nothing is granted to anon or public, the internal helper stays internal', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
  const fn = s => s.match(/create or replace function public\.hq_todo\(\)[\s\S]*?end \$\$;/)[0];
  const mine = read('partners-open-invoices.sql');
  expect(fn(read('hq-todo.sql'))).toBe(fn(mine));
  const grants = [...mine.matchAll(/grant execute on function [^;]+ to ([^;]+);/g)].map(m => m[1].trim());
  expect(grants.length).toBe(3);
  grants.forEach(g => expect(g).toMatch(/^(authenticated|service_role)(, (authenticated|service_role))?$/));
  expect(mine).toMatch(/revoke all on function public\.partner_open_items\(\) from public, anon, authenticated;/);
  expect(mine).not.toMatch(/\b(insert into|delete from|drop table|truncate)\b/i);   // a flag column and read-only functions, nothing else
});

// ── the card ────────────────────────────────────────────────────────────────
test('who owes us at 1280: total and oldest first, days coloured, part-paid and paid invoices handled, on hold has no button', async ({ browser }) => {
  const { ctx, page, errs } = await openPartners(browser);
  const card = page.locator('.owes-card');
  await expect(card.locator('.card-title')).toHaveText('Partners owe €10,680.00');
  await expect(card.locator('.card-hint')).toHaveText('7 invoices waiting for payment · oldest 131 days · €700.00 on hold');
  // five rows first, the rest one tap away
  expect((await rowsOf(page, 'waiting')).length).toBe(5);
  await card.getByRole('button', { name: 'Show all 7' }).click();
  const w = await rowsOf(page, 'waiting');
  expect(w.length).toBe(7);
  // oldest first; part-paid shows what is still open; the paid half of a month (FT T/201) and Paid months (FT T/100, FT T/400) are gone
  expect(w[0]).toMatch(/^North Swell Agency FT T\/150 · Jun 2026 Part paid: 950\.00 received on 12-08-2026; nothing since\. €1,200\.00 of €2,150\.00 131 days Reminder$/);
  expect(w[1]).toMatch(/^Coast Line Tours FT T\/180 · Jul 2026 .* €700\.00 On hold$/);          // disputed: no button
  expect(w[2]).toMatch(/^North Swell Agency FT T\/50 · 2025 €6,300\.00 85 days Reminder$/);     // year-long month key
  expect(w[4]).toMatch(/FT T\/202 · Aug 2026 Still missing FT T\/202 \(500\.00\)\. €500\.00 67 days Reminder$/);   // last line of the note only
  expect(w.join('|')).not.toMatch(/T\/201|T\/100|T\/400|TR 2026-09/);                             // paid, or the partner's own invoice to us
  const badge = d => card.locator('.owes-tbl[data-owes="waiting"] .badge').getByText(d, { exact: true });
  await expect(badge('131 days')).toHaveClass(/badge-red/);
  await expect(badge('39 days')).toHaveClass(/badge-amber/);
  await expect(badge('8 days')).toHaveClass(/badge-grey/);
  // one action per row, never a primary button in the card
  expect(await card.locator('.owes-tbl tr').evaluateAll(trs => Math.max(...trs.map(tr => tr.querySelectorAll('button').length)))).toBe(1);
  await expect(card.locator('.btn-p')).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('to invoice: closed months worth more than their invoices, aliases grouped, they-invoice-us and flagged partners left out', async ({ browser }) => {
  const { ctx, page } = await openPartners(browser);
  await expect(page.locator('.owes-lbl', { hasText: 'To invoice' }).locator('.owes-sum')).toHaveText('4 months · €5,460.00');
  expect((await rowsOf(page, 'toInvoice')).length).toBe(3);                                  // three first, the rest one tap away
  await page.locator('.owes-card').getByRole('button', { name: 'Show all 4' }).click();
  expect(await rowsOf(page, 'toInvoice')).toEqual([
    'Blue Wave Travel Oct 2026 · 2 bookings €1,460.00 Overview Sent Overview',
    'Surf Camp IT Aug 2026 · 1 booking €1,340.00 Overview',                                   // the other record of the company is Paid
    'Blue Wave Travel Aug 2026 · 1 booking €600.00 of €1,000.00 already invoiced €400.00 Invoice Sent Overview',   // amounts, not «has an invoice»
    'Surf Camp IT Jul 2026 · 3 bookings €2,260.00 Overview',                                  // two records, one row
  ]);
  // received with no invoice: only partners that pay month by month, only receipts not tied to an invoice number
  await expect(page.locator('.owes-lbl', { hasText: 'Received, no invoice' }).locator('.owes-sum')).toHaveText('2 receipts · €445.50');
  expect(await rowsOf(page, 'received')).toEqual([
    'Harbour Hostel 20 Jul 2026 · for Jun 2026 Group lessons June €265.00 Open month',
    'Harbour Hostel 2 Mar 2026 · for Feb 2026 €180.50 Open month',
  ]);
  await page.locator('.owes-tbl[data-owes="received"] button').first().click();
  await expect(page.locator('#stmtModal.open #stmtPartner')).toHaveText('Harbour Hostel');
  await ctx.close();
});

test('Reminder opens a draft about that invoice and changes no status; Overview is the existing statement email for every spelling', async ({ browser }) => {
  const { ctx, page, calls } = await openPartners(browser);
  calls.length = 0;
  await page.locator('.owes-tbl[data-owes="waiting"] tr', { hasText: 'FT T/50' }).getByRole('button', { name: 'Reminder' }).click();   // a month with no status at all
  await page.waitForTimeout(400);
  let url = decodeURIComponent((await page.evaluate(() => window.__opened)).pop());
  expect(url).toContain('to=northswellagency@example.com');
  expect(url).toContain('su=Payment reminder — invoice FT T/50');
  expect(url).toContain('invoice FT T/50 of 25/08/2026 (€6,300.00), for the bookings of 2025, is still open');
  await page.locator('.owes-tbl[data-owes="waiting"] tr', { hasText: 'FT T/150' }).getByRole('button', { name: 'Reminder' }).click();
  await page.waitForTimeout(400);
  url = decodeURIComponent((await page.evaluate(() => window.__opened)).pop());
  expect(url).toContain('We received €950.00 so far; €1,200.00 is still open.');
  expect(calls).toEqual([]);                                                 // no rpc, no write: a reminder never touches a status
  await expect(page.locator('.owes-card .card-title')).toHaveText('Partners owe €10,680.00');

  // «Overview» = the statement email; the group has no email on one record, so the other record's is used
  await page.locator('.owes-card').getByRole('button', { name: 'Show all 4' }).click();
  await page.locator('.owes-tbl[data-owes="toInvoice"] tr', { hasText: 'Jul 2026' }).getByRole('button', { name: 'Overview' }).click();
  await page.waitForTimeout(600);
  url = decodeURIComponent((await page.evaluate(() => window.__opened)).pop());
  expect(url).toContain('su=Bookings for July 2026 — confirmation');
  expect(url).toContain('Total bookings: 3');
  expect(url).toContain('Amount due to Gota Dagua (bookings collected by the partner): €2,260.00');
  // the opener's own automatic step (empty → Overview Sent), once per record; never anything else
  expect(calls.map(c => [c.rpc, c.body.p_partner_name, c.body.p_month_key, c.body.p_status])).toEqual([
    ['advance_partner_month_status', 'Surfcamp Italy', '2026-07', 'Overview Sent'],
    ['advance_partner_month_status', 'SURFCAMP IT', '2026-07', 'Overview Sent'],
  ]);
  await ctx.close();
});

test('who owes us at 390: rows stack, every button on screen, no sideways page', async ({ browser }) => {
  const { ctx, page } = await openPartners(browser, { width: 390 });
  await expect(page.locator('.owes-card .card-title')).toHaveText('Partners owe €10,680.00');
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  const fit = await page.evaluate(() => [...document.querySelectorAll('.owes-card button, .owes-card .ow-amt, .owes-card .badge')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  expect(fit).toBe(true);
  // touch target, and the amount is never wrapped
  expect(await page.locator('.owes-tbl .ow-act .btn').first().evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
  expect(await page.locator('.owes-tbl .ow-amt').first().evaluate(e => e.getBoundingClientRect().height)).toBeLessThan(44);
  await page.locator('.owes-card').getByRole('button', { name: 'Show all 7' }).click();
  await page.locator('.owes-card').getByRole('button', { name: 'Show all 4' }).click();
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test('before the SQL is run (no flag column, no status notes) the card still works; with nothing open it says so', async ({ browser }) => {
  const f = fixture(); f.partner_month_status.forEach(s => { delete s.notes; });
  { const { ctx, page, errs } = await openPartners(browser, { tables: f, noFlagColumn: true });
    await expect(page.locator('.owes-card .card-title')).toHaveText('Partners owe €10,680.00');
    // nobody is flagged yet, so the two flagged months show: the old behaviour, not an error
    expect((await rowsOf(page, 'toInvoice')).length).toBe(3);
    await page.locator('.owes-card').getByRole('button', { name: 'Show all 6' }).click();
    expect((await rowsOf(page, 'toInvoice')).join('|')).toMatch(/Corporate Kids Club Aug 2026 · 1 booking €325\.00.*Old Group Aug 2026 · 1 booking €150\.00/);
    expect(errs).toEqual([]);
    await ctx.close(); }
  { const g = fixture(); g.partner_invoices = []; g.partner_ledger = [];
    g.bookings = g.bookings.filter(b => b.partner_name === 'Blue Wave Travel' && b.check_in_on.startsWith('2026-09'));
    const { ctx, page } = await openPartners(browser, { tables: g });
    await expect(page.locator('.owes-card .card-title')).toHaveText('Nothing open');
    await expect(page.locator('.owes-card .owes-tbl')).toHaveCount(0);
    await ctx.close(); }
});

// ── the HQ chip ─────────────────────────────────────────────────────────────
async function openHq(browser, todo, width = 1280, shot = '') {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768 });
  const page = await ctx.newPage();
  await stub(page, { tables: { hq_invoice_categories: [], hq_invoices: [], hq_bank_movements: [], ledger_entries: [] }, rpc: { hq_todo: todo, hq_overview_rollup: { bookings: [], invoices: [], ledger: [] } } });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#overviewBody .hero-val'), null, { timeout: 15_000 });
  const chips = (await page.locator('.health-chip').allTextContents()).map(c => c.trim());
  chips.pageWidth = await pageWidth(page);
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot) });
  await ctx.close();
  return chips;
}
test('HQ chip: the truthful count, and «waiting > 60 days» only when there is one', async ({ browser }) => {
  const row = (partner, month, amount) => ({ partner, month, worth: amount, invoiced: 0, amount, status: null });
  const to7 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i) => row('Partner ' + x, '2026-10', 100 + i));
  const late = [{ partner: 'Partner a', month: '2026-06', invoice: 'FT T/150', date: '2026-07-10', amount: 2150, open: 1200, days: 131, hold: false }];
  let chips = await openHq(browser, { partner_to_issue: to7, partner_waiting_60: late.concat(late, late, late) }, 1280, 'hq-chips-1280.png');
  expect(chips).toContain('7 partner invoices to issue');
  expect(chips).toContain('4 partner invoices waiting > 60 days');
  // both chips on a phone: they wrap, the page never scrolls sideways
  chips = await openHq(browser, { partner_to_issue: to7, partner_waiting_60: late.concat(late, late, late) }, 390, 'hq-chips-390.png');
  expect(chips).toContain('4 partner invoices waiting > 60 days');
  expect(chips.pageWidth).toBeLessThanOrEqual(390);
  chips = await openHq(browser, { partner_to_issue: to7.slice(0, 1), partner_waiting_60: null });
  expect(chips).toContain('1 partner invoice to issue');
  expect(chips.some(c => /waiting/.test(c))).toBe(false);
  // the function before this change has no partner_waiting_60 key: one chip, as before
  chips = await openHq(browser, { partner_to_issue: to7 });
  expect(chips.filter(c => /partner invoice/.test(c))).toEqual(['7 partner invoices to issue']);
  chips = await openHq(browser, { partner_to_issue: null, partner_error: 'function public.partner_open_items() does not exist' });
  expect(chips.some(c => /partner invoice/.test(c))).toBe(false);
});

test('screenshots of the card (optional: OWES_SHOTS=folder)', async ({ browser }) => {
  test.skip(!SHOTS, 'set OWES_SHOTS to save the screenshots');
  const { ctx, page } = await openPartners(browser, { width: 1280 });
  await page.screenshot({ path: path.join(SHOTS, 'owes-1280.png'), fullPage: true });
  await ctx.close();
  const m = await openPartners(browser, { width: 390 });
  await m.page.screenshot({ path: path.join(SHOTS, 'owes-390.png'), fullPage: true });
  await m.ctx.close();
});
