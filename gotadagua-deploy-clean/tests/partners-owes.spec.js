// «Who owes us» on the Partners page + the truthful HQ chip (18 Nov 2026 audit, H1 / H2).
// Since 19 Nov 2026 it is the «Payments» tab (?tab=payments), shown by month with one row per
// partner and month (tap for the invoices); the overview keeps only one chip linking to it.
// It lists issued partner invoices not paid (with days), closed months still to invoice and
// receipts with no invoice; hq_todo() counts the same rows with the same rule
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
    P('Nordic Trails', { contact: 'Sofie' }),                              // one invoice per country office: 7 invoices, one month
    P('Atlantic Hostel'),                                                 // an old invoice, 200+ days
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
    S('Nordic Trails', '2026-10', 'Invoice Sent', 'Invoices sent on 9 Nov, one per country office.\nWaiting for their finance team to approve the whole batch before paying; they said the end of November, after the board meeting.'),
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
    ...[['FT T/501', 610], ['FT T/502', 540.4], ['FT T/503', 488.8], ['FT T/504', 3120], ['FT T/505', 2405.6], ['FT T/506', 455.2]]
      .map(([no, amt]) => I('Nordic Trails', '2026-10', no, '2026-11-09', amt)),
    I('Nordic Trails', '2026-10', 'FT T/507', '2026-11-09', 280, 'on hold: credit note pending'),   // one of the seven on hold
    I('Atlantic Hostel', '2025-04', 'FT T/40', '2026-04-23', 410),
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
async function openPartners(browser, { width = 1280, tables = fixture(), noFlagColumn = false, tab = 'payments' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, timezoneId: 'Europe/Lisbon' });
  const page = await ctx.newPage(); const calls = []; const errs = [];
  page.on('dialog', d => d.dismiss().catch(() => {})); page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-18T10:00:00Z'));
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await stub(page, { tables, noFlagColumn, calls }); await fakeOwnerSession(page);
  await page.goto(tab === 'payments' ? '/partners/?tab=payments' : '/partners/', { waitUntil: 'domcontentloaded' });
  if (tab === 'payments') await expect(page.locator('#owesTab .kpi').first()).toBeVisible({ timeout: 15_000 });
  else await expect(page.locator('#partnerTableBodyCamp tr .pname').first()).toBeVisible({ timeout: 15_000 });
  return { ctx, page, calls, errs };
}
const txt = s => s.replace(/\s+/g, ' ').trim();
const rowsOf = (page, list) => page.locator(`.owes-tbl[data-owes="${list}"] tbody tr:not(.ow-detail)`).evaluateAll(trs => trs.map(tr => tr.innerText.replace(/\s+/g, ' ').trim()));
const monthsOf = (page, list) => page.locator(`[data-owes-block="${list}"] .owes-lbl`).evaluateAll(ls => ls.map(l => [...l.children].map(c => c.textContent.trim()).join(' ')));
const kpi = (page, k) => page.locator(`[data-owes-kpi="${k}"]`);
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

// ── the overview keeps one chip ──────────────────────────────────────────────
test('overview: no card any more, one chip above the month pills opens «Payments», and back', async ({ browser }) => {
  const { ctx, page, errs } = await openPartners(browser, { tab: 'overview' });
  await expect(page.locator('#page-partners')).toBeVisible();
  await expect(page.locator('#page-payments')).toBeHidden();
  await expect(page.locator('#page-partners .owes-tbl, #page-partners .owes-block, #owesCard')).toHaveCount(0);
  const chip = page.locator('#owesLink .health-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText('Unpaid invoices €18,990.00 · 5 over 60 days');      // held invoices are not «over 60», like the HQ chip
  // the chip is the only new thing: it sits right above the month pills, the rest is the overview as before
  expect(await page.evaluate(() => document.getElementById('owesLink').nextElementSibling.id)).toBe('monthTabs');
  await expect(page.locator('#kpiStrip .kpi')).toHaveCount(7);
  await expect(page.locator('.ntab[data-page="overview"]')).toHaveClass(/active/);
  await chip.click();
  await expect(page).toHaveURL(/\/partners\/\?tab=payments$/);
  await expect(page.locator('#page-payments')).toBeVisible();
  await expect(page.locator('#page-partners')).toBeHidden();
  await expect(page.locator('.ntab[data-page="payments"]')).toHaveClass(/active/);
  await expect(kpi(page, 'owe').locator('.kpi-value')).toHaveText('€18,990.00');
  await page.locator('.ntab[data-page="overview"]').click();
  await expect(page).toHaveURL(/\/partners\/$/);
  await expect(page.locator('#partnerTableBodyCamp tr .pname').first()).toBeVisible();
  expect(errs).toEqual([]);
  await ctx.close();
});

// ── the «Payments» tab ──────────────────────────────────────────────────────
test('payments at 1280: totals on top, months newest first, one row per partner and month, days coloured, on hold has no button', async ({ browser }) => {
  const { ctx, page, errs } = await openPartners(browser);
  await expect(kpi(page, 'owe')).toHaveText(/^Partners owe\s*€18,990\.00\s*15 invoices · oldest 209 days · 5 over 60 days · €980\.00 on hold$/);
  await expect(kpi(page, 'invoice')).toHaveText(/^To invoice\s*€5,460\.00\s*4 closed months with no invoice yet$/);
  expect(await monthsOf(page, 'waiting')).toEqual([
    'Oct 2026 €8,800.00', 'Sep 2026 €480.00', 'Aug 2026 €1,100.00', 'Jul 2026 €700.00', 'Jun 2026 €1,200.00', 'Apr 2025 €410.00', '2025 €6,300.00',
  ]);
  const w = await rowsOf(page, 'waiting');
  expect(w).toEqual([
    // seven invoices, one row; the note once, its last line only (the full note is in the expansion)
    'Nordic Trails 7 invoices · 1 on hold Waiting for their finance team to approve the whole batch before paying; they said the end of November, after the board meeting. €7,900.00 9 days Reminder',
    'North Swell Agency FT T/300 €900.00 8 days Reminder',
    'Coast Line Tours FT T/250 Invoice sent on 10 Oct. €480.00 39 days Reminder',
    'Blue Wave Travel FT T/90 €600.00 74 days Reminder',
    'North Swell Agency FT T/202 Still missing FT T/202 (500.00). €500.00 67 days Reminder',
    'Coast Line Tours FT T/180 Em disputa: the partner says the old price applies. €700.00 On hold',              // disputed: no button
    'North Swell Agency FT T/150 Part paid: 950.00 received on 12-08-2026; nothing since. €1,200.00 of €2,150.00 131 days Reminder',
    'Atlantic Hostel FT T/40 €410.00 209 days Reminder',
    'North Swell Agency FT T/50 €6,300.00 85 days Reminder',                                                    // year-long month key
  ]);
  expect(w.join('|')).not.toMatch(/T\/201|T\/100|T\/400|TR 2026-09/);                                          // paid, or the partner's own invoice to us
  // a long note is one line on the row
  const note = page.locator('.owes-tbl[data-owes="waiting"] tr.ow-grp').first().locator('.ow-note span');
  expect(await note.evaluate(e => [getComputedStyle(e).whiteSpace, getComputedStyle(e).textOverflow, e.scrollWidth > e.clientWidth])).toEqual(['nowrap', 'ellipsis', true]);
  const badge = d => page.locator('.owes-tbl[data-owes="waiting"] tr.ow-grp .badge').getByText(d, { exact: true });
  await expect(badge('209 days')).toHaveClass(/badge-red/);
  await expect(badge('39 days')).toHaveClass(/badge-amber/);
  await expect(badge('9 days')).toHaveClass(/badge-grey/);
  // one action per row, never a primary button in the tab
  expect(await page.locator('#owesTab .owes-tbl tr').evaluateAll(trs => Math.max(...trs.map(tr => tr.querySelectorAll('button').length)))).toBe(1);
  await expect(page.locator('#owesTab .btn-p')).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test('tapping a row lists its invoices (Drive link, part-paid, on hold) and the full note; tapping again closes it', async ({ browser }) => {
  const { ctx, page } = await openPartners(browser);
  const grp = page.locator('.owes-tbl[data-owes="waiting"] tr.ow-grp', { hasText: 'Nordic Trails' });
  await expect(page.locator('tr.ow-detail')).toHaveCount(0);
  await grp.click();
  await expect(grp).toHaveAttribute('aria-expanded', 'true');
  const det = page.locator('tr.ow-detail');
  await expect(det).toHaveCount(1);
  const lines = (await det.locator('.ow-inv').allInnerTexts()).map(txt);
  expect(lines.length).toBe(7);
  expect(lines[0]).toBe('FT T/501 9 Nov 2026 €610.00 9 days');
  expect(lines[6]).toBe('FT T/507 9 Nov 2026 €280.00 On hold');
  await expect(det.locator('a', { hasText: 'FT T/504' })).toHaveAttribute('href', 'https://drive.google.com/file/d/FTT504');
  await expect(det.locator('.ow-fullnote')).toHaveCount(1);                                                    // the same note on seven invoices: shown once
  expect(txt(await det.locator('.ow-fullnote').textContent())).toBe('NoteInvoices sent on 9 Nov, one per country office. Waiting for their finance team to approve the whole batch before paying; they said the end of November, after the board meeting.');
  // a second row open at the same time; the part-paid invoice says what is still open
  await page.locator('tr.ow-grp', { hasText: 'FT T/150' }).click();
  await expect(page.locator('tr.ow-detail')).toHaveCount(2);
  expect(txt(await page.locator('tr.ow-detail').nth(1).locator('.ow-inv').innerText())).toBe('FT T/150 10 Jul 2026 €1,200.00 of €2,150.00 131 days');
  await grp.click();
  await expect(grp).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('tr.ow-detail')).toHaveCount(1);
  await ctx.close();
});

test('to invoice and received, no invoice: by month too, aliases grouped, they-invoice-us and flagged partners left out', async ({ browser }) => {
  const { ctx, page } = await openPartners(browser);
  expect(await monthsOf(page, 'toInvoice')).toEqual(['Oct 2026 €1,460.00', 'Aug 2026 €1,740.00', 'Jul 2026 €2,260.00']);
  expect(await rowsOf(page, 'toInvoice')).toEqual([
    'Blue Wave Travel 2 bookings €1,460.00 Overview Sent Overview',
    'Surf Camp IT 1 booking €1,340.00 Overview',                                   // the other record of the company is Paid
    'Blue Wave Travel 1 booking €600.00 of €1,000.00 already invoiced €400.00 Invoice Sent Overview',   // amounts, not «has an invoice»
    'Surf Camp IT 3 bookings €2,260.00 Overview',                                  // two records, one row
  ]);
  // received with no invoice: only partners that pay month by month, only receipts not tied to an invoice number
  await expect(page.locator('[data-owes-block="received"] .card-hint')).toHaveText('2 receipts · €445.50');
  expect(await monthsOf(page, 'received')).toEqual(['Jun 2026 €265.00', 'Feb 2026 €180.50']);
  expect(await rowsOf(page, 'received')).toEqual([
    'Harbour Hostel 20 Jul 2026 Group lessons June €265.00 Open month',
    'Harbour Hostel 2 Mar 2026 €180.50 Open month',
  ]);
  await page.locator('.owes-tbl[data-owes="received"] button').first().click();
  await expect(page.locator('#stmtModal.open #stmtPartner')).toHaveText('Harbour Hostel');
  await ctx.close();
});

test('Reminder: one draft per partner and month (held invoice left out), changes no status and does not open the row; Overview is the statement email', async ({ browser }) => {
  const { ctx, page, calls } = await openPartners(browser);
  calls.length = 0;
  const opened = async () => decodeURIComponent((await page.evaluate(() => window.__opened)).pop());
  const grp = page.locator('tr.ow-grp', { hasText: 'Nordic Trails' });
  await grp.getByRole('button', { name: 'Reminder' }).click();
  await page.waitForTimeout(400);
  let url = await opened();
  expect(url).toContain('to=nordictrails@example.com');
  expect(url).toContain('su=Payment reminder — 6 invoices, October 2026');
  expect(url).toContain('Hello Sofie,');
  expect(url).toContain('these invoices for the bookings of October 2026 are still open on our side:\n- FT T/501 of 09/11/2026: €610.00\n- FT T/502 of 09/11/2026: €540.40\n');   // same order as the expansion
  expect(url).toContain('Total open: €7,620.00');
  expect(url).not.toContain('T/507');
  await expect(grp).toHaveAttribute('aria-expanded', 'false');                     // the button does not toggle the row
  // one invoice: the same draft as before
  await page.locator('tr.ow-grp', { hasText: 'FT T/50 ' }).getByRole('button', { name: 'Reminder' }).click();   // a month with no status at all
  await page.waitForTimeout(400);
  url = await opened();
  expect(url).toContain('to=northswellagency@example.com');
  expect(url).toContain('su=Payment reminder — invoice FT T/50');
  expect(url).toContain('invoice FT T/50 of 25/08/2026 (€6,300.00), for the bookings of 2025, is still open');
  await page.locator('tr.ow-grp', { hasText: 'FT T/150' }).getByRole('button', { name: 'Reminder' }).click();
  await page.waitForTimeout(400);
  url = await opened();
  expect(url).toContain('We received €950.00 so far; €1,200.00 is still open.');
  expect(calls).toEqual([]);                                                 // no rpc, no write: a reminder never touches a status
  await expect(kpi(page, 'owe').locator('.kpi-value')).toHaveText('€18,990.00');

  // «Overview» = the statement email; the group has no email on one record, so the other record's is used
  await page.locator('.owes-tbl[data-owes="toInvoice"] tr', { hasText: '3 bookings' }).getByRole('button', { name: 'Overview' }).click();
  await page.waitForTimeout(600);
  url = await opened();
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

test('payments at 390x844: rows stack, every button on screen, no sideways page (also with rows open); the drawer has both tabs', async ({ browser }) => {
  const { ctx, page } = await openPartners(browser, { width: 390 });
  await expect(kpi(page, 'owe').locator('.kpi-value')).toHaveText('€18,990.00');
  const fits = () => page.evaluate(() => [...document.querySelectorAll('#owesTab button, #owesTab .ow-amt, #owesTab .badge, #owesTab .ow-inv-amt')].filter(e => e.offsetParent).every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await fits()).toBe(true);
  // touch target, and the amount is never wrapped
  expect(await page.locator('.owes-tbl .ow-act .btn').first().evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
  expect(await page.locator('.owes-tbl .ow-amt').first().evaluate(e => e.getBoundingClientRect().height)).toBeLessThan(44);
  await page.locator('tr.ow-grp', { hasText: 'Nordic Trails' }).click();
  await page.locator('tr.ow-grp', { hasText: 'FT T/150' }).click();
  await expect(page.locator('tr.ow-detail')).toHaveCount(2);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await fits()).toBe(true);
  // header tabs live in the drawer on a phone
  await page.locator('.nav-hamburger').click();
  await expect(page.locator('#mobNavDrawer .ntab-m[data-page="payments"]')).toHaveClass(/active/);
  await page.locator('#mobNavDrawer .ntab-m[data-page="overview"]').click();
  await expect(page.locator('#page-partners')).toBeVisible();
  await expect(page.locator('#owesLink .health-chip')).toBeVisible();
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test('before the SQL is run (no flag column, no status notes) the tab still works; with nothing open it says so', async ({ browser }) => {
  const f = fixture(); f.partner_month_status.forEach(s => { delete s.notes; });
  { const { ctx, page, errs } = await openPartners(browser, { tables: f, noFlagColumn: true });
    await expect(kpi(page, 'owe').locator('.kpi-value')).toHaveText('€18,990.00');
    // nobody is flagged yet, so the two flagged months show: the old behaviour, not an error
    expect((await rowsOf(page, 'toInvoice')).join('|')).toMatch(/Corporate Kids Club 1 booking €325\.00.*Old Group 1 booking €150\.00/);
    expect(errs).toEqual([]);
    await ctx.close(); }
  { const g = fixture(); g.partner_invoices = []; g.partner_ledger = [];
    g.bookings = g.bookings.filter(b => b.partner_name === 'Blue Wave Travel' && b.check_in_on.startsWith('2026-09'));
    const { ctx, page } = await openPartners(browser, { tables: g });
    await expect(page.locator('#owesTab .empty-title')).toHaveText('Nothing open');
    await expect(page.locator('#owesTab .owes-tbl')).toHaveCount(0);
    await ctx.close();
    const o = await openPartners(browser, { tables: g, tab: 'overview' });
    await expect(o.page.locator('#owesLink .health-chip')).toHaveCount(0);           // nothing open: no chip on the overview
    await o.ctx.close(); }
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
  chips.partnerLinks = await page.locator('.health-chip', { hasText: 'partner invoice' }).evaluateAll(cs => cs.map(c => c.getAttribute('onclick')));
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
  expect(chips.partnerLinks).toEqual(["window.open('/partners/?tab=payments','_self')", "window.open('/partners/?tab=payments','_self')"]);   // both open the «Payments» tab
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

test('screenshots of the tab and the overview chip (optional: OWES_SHOTS=folder)', async ({ browser }) => {
  test.skip(!SHOTS, 'set OWES_SHOTS to save the screenshots');
  for (const width of [1280, 390]) {
    const { ctx, page } = await openPartners(browser, { width });
    await page.screenshot({ path: path.join(SHOTS, `payments-${width}.png`), fullPage: true });
    await page.locator('tr.ow-grp', { hasText: 'Nordic Trails' }).click();
    await page.locator('tr.ow-grp', { hasText: 'FT T/150' }).click();
    await page.evaluate(() => scrollTo(0, 0));                                    // the sticky header stays on top of the full-page capture
    await page.screenshot({ path: path.join(SHOTS, `payments-${width}-open.png`), fullPage: true });
    await ctx.close();
    const o = await openPartners(browser, { width, tab: 'overview' });
    await o.page.screenshot({ path: path.join(SHOTS, `overview-top-${width}.png`) });
    await o.ctx.close();
  }
});
