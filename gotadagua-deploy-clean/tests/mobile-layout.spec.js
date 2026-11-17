// Phone layout (17 Nov 2026) — Miguel: everything must work on a phone (390px) and desktop stays as it is.
// Each test opens a page at 390×844 with touch (or 360 for the header), a fake owner session and an in-memory
// PostgREST stub (nothing reaches production), then checks the page never scrolls sideways and the controls
// that used to sit off-screen (ledger Edit, Expenses amount, partner Balance, Save, menus) are on screen.
// The last tests open the same pages at 1280 and check the desktop tables still show every column.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const UID = '00000000-0000-4000-8000-000000000001';
const SL = { id: '83cda02b-b63f-46fd-979a-945fd30ba5ab', name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' };
const WS = [{ id: 'ws-sl', slug: 'sri-lanka', name: 'Sri Lanka' }, { id: 'ws-pt', slug: 'portugal', name: 'Portugal' }];
const AUTH = {
  platform_profiles: [{ id: UID, email: 'miguel@gotadaguasurf.com', full_name: 'Miguel', platform_role: 'owner', active: true, password_set_at: '2026-01-01T00:00:00Z' }],
  workspaces: WS,
  workspace_memberships: WS.map(w => ({ id: 'm-' + w.id, user_id: UID, workspace_id: w.id, member_role: 'super_admin', can_view: true, can_edit: true, can_manage_team: true, active: true, workspaces: { slug: w.slug, name: w.name } })),
};
const LOCATIONS = [SL, { id: 'loc-pt', name: 'Portugal', slug: 'portugal', currency: 'EUR', default_fx_to_eur: 1 }, { id: 'loc-suk', name: 'The Suk', slug: 'the-suk', currency: 'EUR' }, { id: 'loc-wild', name: 'Wild Wednesday', slug: 'wild-wednesday', currency: 'EUR' }];
const CATS = ['Salary', 'Partners', 'Food', 'Rent', 'Utilities', 'Equipment & maintenance'].map((name, i) => ({ id: `c-${i}`, name, sort_order: i, is_personal: false, active: true }));

const LONG = ['Keells supermarket — vegetables, rice, coconut milk and eggs for the whole week (kitchen)', 'Villa Marissa rent November 2026 — prepaid 6 months to landlord', 'FEE:VISH_CORP_CHG_30072026'];
const ledger = () => Array.from({ length: 8 }, (_, i) => ({ id: `e1e1e1e1-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: SL.id, type: 'expense', category: CATS[i % CATS.length].name,
  description: LONG[i % LONG.length], payment_method: i % 2 ? 'Cash' : 'Bank Transfer', vendor: 'Vendor with a long name ' + i, qty: 1, amount_local: 48650 + i * 1000, currency: 'LKR', entry_date: `2026-11-${String(10 + i).padStart(2, '0')}`,
  business_area: 'General', fx_rate: 340, amount_eur: (48650 + i * 1000) / 340, source_kind: 'manual', is_comp: false, paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-11-16T09:00:00Z' }));
const invoices = (company) => Array.from({ length: 12 }, (_, i) => ({ id: `inv-${i}`, invoice_date: `2026-${String(11 - (i % 3)).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`,
  company: ['LG-Leasing Portugal — Locação Financeira de Equipamentos S.A.', 'Meo — Serviços de Comunicações e Multimédia', 'Pingo Doce'][i % 3], description: 'Fatura FT 2026/' + (1000 + i) + ' — serviços mensais',
  invoice_number: 'FT 2026/' + (1000 + i), amount: 1234.56 + i * 97, amount_eur: 1234.56 + i * 97, currency: 'EUR', paying_company: company, category_id: CATS[i % CATS.length].id, category_name: CATS[i % CATS.length].name,
  location_slug: ['portugal', 'sri-lanka', 'general'][i % 3], is_duplicate: false, needs_review: i % 4 === 0, deleted_at: null, payment_type: 'Bank Transfer', drive_link: i % 2 ? 'https://drive.google.com/file/d/x' + i : null, file_url: null, notes: '', created_at: '2026-11-01T00:00:00Z' }));
function partnersTables() {
  const partners = ['KILROY', 'Surf Camp IT', 'Surf Tribe — The Adventure Travel Company', 'AASHA'].map((name, i) => ({ id: `p-${i}`, name, commission_pct: 15 + i, email: `info${i}@example.com`, is_active: true, type: 'agency', contact_name: 'Contact Person ' + i, collects: i % 2 === 0 }));
  const bookings = Array.from({ length: 24 }, (_, i) => ({ id: `b-${i}`, booking_ref: `2026-${4000 + i}`, booker: 'Guest ' + i, check_in_on: `2026-${String(9 + (i % 2)).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`, location: 'Surf Camp Ahangama', pax: 2,
    package: 'Surf Week', total: 589 + i * 13, net_amount: (589 + i * 13) * 0.82, commission_amount: (589 + i * 13) * 0.18, partner_commission_pct: 18, partner_name: partners[i % partners.length].name, raw_payload: { status: 'paid', due: i % 6 === 0 ? 120 : 0, bookingSource: 'Partner' } }));
  return { partners, bookings, partner_month_status: [], partner_ledger: [], partner_invoices: [] };
}

// In-memory PostgREST: eq/is/in filters, single-object reads, writes answered empty.
async function stub(page, { tables = {}, location = null, rpc = {} } = {}) {
  const T = { ...AUTH, ...tables };
  const match = (row, url) => [...new URL(url).searchParams.entries()].every(([k, v]) => {
    const m = String(v).match(/^(eq|is|in)\.(.*)$/s); if (!m || ['select', 'order', 'limit', 'offset', 'or', 'and'].includes(k)) return true;
    if (m[1] === 'eq') return String(row[k]) === m[2];
    if (m[1] === 'is') return m[2] === 'null' ? row[k] == null : String(row[k]) === m[2];
    return m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(row[k]));
  });
  await page.route(/api\.frankfurter\.dev|googleapis|accounts\.google/, r => r.abort());
  await page.route(/supabase\.co\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b), headers: { 'content-range': '0-0/0' } });
    if (url.includes('/auth/v1/user')) return json({ id: UID, email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (/\/(auth\/v1|realtime|storage|functions)\//.test(url)) return json({});
    const rp = (url.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/) || [])[1]; if (rp) return json(rp in rpc ? rpc[rp] : null);
    const t = (url.match(/\/rest\/v1\/([a-z_0-9]+)/) || [])[1]; if (!t) return json([]);
    if (method !== 'GET') return json([], method === 'POST' ? 201 : 200);
    const one = /vnd\.pgrst\.object/.test(req.headers().accept || '');
    const out = t === 'locations' ? (location ? [location] : LOCATIONS.filter(r => match(r, url))) : (T[t] || []).filter(r => match(r, url));
    if (one) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
    return json(out);
  });
}
async function open(browser, path, { width = 390, tables = {}, location = null, rpc = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, timezoneId: 'Europe/Lisbon' });
  const page = await ctx.newPage(); page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.clock.setFixedTime(new Date('2026-11-17T10:00:00Z'));
  await page.addInitScript(() => { window.open = () => null; });
  await stub(page, { tables, location, rpc }); await fakeOwnerSession(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}
async function openCamp(browser, width = 390) {
  const r = await open(browser, '/camp-hub/?location=sri-lanka', { width, location: SL, tables: { ledger_entries: ledger(), camp_weeks: [], camp_guests: [], camp_tab_items: [] } });
  await r.page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20_000 });
  await r.page.evaluate(() => { showPage('expenses'); }); await r.page.waitForTimeout(800);
  return r;
}
const pageWidth = page => page.evaluate(() => document.scrollingElement.scrollWidth);
const box = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);
// the element at the centre of `sel` is `sel` itself (or inside it): on screen and not covered
const tappable = (page, sel, scroll = true) => page.evaluate(([s, scroll]) => { const e = document.querySelector(s); if (!e) return false; if (scroll) e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); if (r.right > innerWidth || r.left < 0 || r.bottom > innerHeight || r.top < 0) return false; const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); }, [sel, scroll]);
// opens a header tab once its button is there, then waits for the rows
async function openTab(page, tab, rowSel) {
  await page.waitForFunction(t => document.querySelector(`.ntab[data-tab="${t}"], .ntab[data-page="${t}"]`), tab, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.evaluate(t => document.querySelector(`.ntab[data-tab="${t}"], .ntab[data-page="${t}"]`).click(), tab);
  await expect(page.locator(rowSel).first()).toBeAttached({ timeout: 15_000 });
}
const headerOverlap = page => page.evaluate(() => {
  const els = [...document.querySelectorAll('.app-nav .nav-home, .app-nav summary, .app-nav .nav-hamburger, .app-nav .nav-mob-logout, .app-nav .save-pill')].filter(e => e.getBoundingClientRect().width).map(e => e.getBoundingClientRect());
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) if (els[i].right > els[j].left + 1 && els[j].right > els[i].left + 1) return true;
  return els.some(r => r.right > innerWidth + 1);
});

test('camp hub ledger at 390: Date | Type | Actions, Edit and Delete on screen, no sideways page', async ({ browser }) => {
  const { ctx, page } = await openCamp(browser);
  const heads = await page.evaluate(() => [...document.querySelectorAll('#expTable thead th')].filter(th => th.getBoundingClientRect().width > 0).map(th => th.innerText.trim().toLowerCase()));
  expect(heads).toEqual(['date', 'type', 'actions']);
  expect(await tappable(page, '#expTable tbody button[title=Edit]')).toBe(true);
  // touch screen: the row buttons are a 36px target
  expect((await box(page, '#expTable tbody button[title=Edit]')).h).toBeGreaterThanOrEqual(36);
  expect(await tappable(page, '#expTable tbody button[title=Delete]')).toBe(true);
  // the «what» line wraps to two lines instead of being cut at 150px
  const what = await page.evaluate(() => { const e = document.querySelector('#expTable .what-mob'); return { ws: getComputedStyle(e).whiteSpace, h: e.getBoundingClientRect().height }; });
  expect(what.ws).not.toBe('nowrap'); expect(what.h).toBeGreaterThan(20);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test('camp hub header at 390 and 360: save state shown, a failed save is a tappable bar, location menu on screen', async ({ browser }) => {
  for (const width of [390, 360]) {
    const { ctx, page } = await openCamp(browser, width);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await headerOverlap(page)).toBe(false);
    expect((await box(page, '#savePill')).w).toBeGreaterThan(0);
    await page.evaluate(() => { _pendingWeeksSave = false; setSavePill('failed', 'Save failed — tap to retry'); });
    expect(await tappable(page, '#savePill', false)).toBe(true);
    await expect(page.locator('#savePillTxt')).toBeVisible();
    await page.evaluate(() => setSavePill('saved', 'Saved'));
    for (const sel of ['details.app-switch:not(.loc-switch)', 'details.loc-switch']) {
      const m = await page.evaluate(s => { document.querySelectorAll('details').forEach(d => d.open = false); const d = document.querySelector(s); d.open = true; const r = d.querySelector('.app-switch-menu').getBoundingClientRect(); return { l: r.left, r: r.right }; }, sel);
      expect(m.l).toBeGreaterThanOrEqual(0); expect(m.r).toBeLessThanOrEqual(width);
    }
    expect(await pageWidth(page)).toBeLessThanOrEqual(width);
    // toasts drop from under the header, clear of the bottom bars
    await page.evaluate(() => toast('16 guests from the Guests file added to Camp Tab'));
    const t = await box(page, '#toast'); expect(t.t).toBeGreaterThanOrEqual(60); expect(t.b).toBeLessThan(300);
    await ctx.close();
  }
});

test('HQ Expenses at 390: rows are cards with amount and buttons on screen; More menu and drill-down fit', async ({ browser }) => {
  const { ctx, page } = await open(browser, '/hq/', { tables: { hq_invoice_categories: CATS, hq_invoices: invoices('water-movements'), hq_bank_movements: [], ledger_entries: [] }, rpc: { hq_todo: {} } });
  await openTab(page, 'invoices', '#invListBody tr[data-inv-id]');
  await page.evaluate(() => document.querySelector('#invListBody tr[data-inv-id]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  const row = await page.evaluate(() => { const tr = document.querySelector('#invListBody tr[data-inv-id]'); const r = c => tr.children[c].getBoundingClientRect(); return { amt: r(9).right, edit: tr.querySelector('button[title=Edit]').getBoundingClientRect().right, invNo: r(3).width }; });
  expect(row.amt).toBeLessThanOrEqual(390); expect(row.edit).toBeLessThanOrEqual(390); expect(row.invNo).toBe(0);
  expect(await tappable(page, '#invListBody tr[data-inv-id] button[title=Edit]')).toBe(true);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  const more = await page.evaluate(() => { const d = document.querySelector('#tab-invoices details.hq-menu'); if (!d) return null; window.scrollTo(0, 0); d.open = true; const r = d.querySelector('.hq-menu-list').getBoundingClientRect(); return { l: r.left, r: r.right }; });
  if (more) { expect(more.l).toBeGreaterThanOrEqual(0); expect(more.r).toBeLessThanOrEqual(390); }
  await ctx.close();
});

test('Suk Expenses at 390: card rows, amount on screen, no sideways page', async ({ browser }) => {
  const { ctx, page } = await open(browser, '/suk/', { tables: { hq_invoices: invoices('manjar'), hq_bank_movements: [], hq_invoice_categories: CATS } });
  await openTab(page, 'invoices', '#invTable tbody tr.click');
  const r = await page.evaluate(() => { const tr = document.querySelector('#invTable tbody tr.click'); return { amt: tr.children[8].getBoundingClientRect().right, table: document.getElementById('invTable').getBoundingClientRect().right }; });
  expect(r.amt).toBeLessThanOrEqual(390); expect(r.table).toBeLessThanOrEqual(390);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test('Partners at 390: no sideways page, Balance on screen (also with a month picked), Partners & Rates usable', async ({ browser }) => {
  const { ctx, page } = await open(browser, '/partners/', { tables: partnersTables() });
  await expect(page.locator('#partnerTableBodyCamp tr').first()).toBeVisible({ timeout: 15_000 });
  const balRight = () => page.evaluate(() => { const ths = [...document.querySelectorAll('#partnerTableHeadCamp th')].filter(th => /balance/i.test(th.innerText)); return ths[0].getBoundingClientRect().right; });
  expect(await balRight()).toBeLessThanOrEqual(390);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  await page.evaluate(() => setMonth('2026-10')); await page.waitForTimeout(400);
  expect(await balRight()).toBeLessThanOrEqual(390);
  const tbl = await page.evaluate(() => document.querySelector('#partnerTableHeadCamp').closest('table').getBoundingClientRect().right);
  expect(tbl).toBeLessThanOrEqual(390);
  // the statement (Gross / Commission links are hidden on phones) opens from the expanded row's month cards
  await page.evaluate(() => { setMonth('all'); }); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#partnerTableBodyCamp tr').click()); await page.waitForTimeout(400);
  expect(await tappable(page, '.overview-row .month-card')).toBe(true);
  await page.evaluate(() => document.querySelector('.overview-row .month-card').click());
  await expect(page.locator('#stmtModal.open')).toBeVisible();
  await page.evaluate(() => document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open')));
  await page.evaluate(() => openSettings()); await page.waitForTimeout(500);
  const row = await page.evaluate(() => [...document.querySelector('#partnerRatesList .partner-row').children].map(c => { const r = c.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; }));
  expect(row.length).toBe(7);
  for (const c of row) { expect(c.w).toBeGreaterThan(40); expect(c.l).toBeGreaterThanOrEqual(0); expect(c.r).toBeLessThanOrEqual(390); }
  await ctx.close();
});

test('Wild Close night at 390 and header at 360: no sideways page, nothing under ☰', async ({ browser }) => {
  for (const width of [390, 360]) {
    const { ctx, page } = await open(browser, '/wild/', { width });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { showPage('night'); } catch (_) {} });
    await page.waitForTimeout(500);
    expect(await pageWidth(page)).toBeLessThanOrEqual(width);
    expect(await headerOverlap(page)).toBe(false);
    await ctx.close();
  }
});

test('shared expense form at 390: Save is on screen without scrolling (HQ and Suk)', async ({ browser }) => {
  for (const app of ['hq', 'suk']) {
    const tables = { hq_invoice_categories: CATS, hq_invoices: invoices(app === 'hq' ? 'water-movements' : 'manjar'), hq_bank_movements: [], ledger_entries: [] };
    const { ctx, page } = await open(browser, `/${app}/`, { tables, rpc: { hq_todo: {} } });
    await page.waitForTimeout(2000);
    await page.evaluate(app => { if (app === 'hq') openAddExpense(); else { showPage('invoices'); document.getElementById('addInvBtn').click(); } }, app);
    await expect(page.locator('#saveInvBtn')).toBeVisible({ timeout: 10_000 });
    expect(await tappable(page, '#saveInvBtn', false)).toBe(true);
    if (app === 'hq') { // an empty Save shows its message inside the visible part of the form
      await page.locator('#saveInvBtn').click();
      await expect(page.locator('#invToast')).not.toBeEmpty();
      const v = await page.evaluate(() => { const bd = document.querySelector('.xf-bd').getBoundingClientRect(); const t = document.getElementById('invToast').getBoundingClientRect(); return t.top >= bd.top && t.bottom <= bd.bottom + 1; });
      expect(v).toBe(true);
    }
    await ctx.close();
  }
});

test('desktop 1280 keeps every column: ledger 11, HQ Expenses 11, partners 6, Partners & Rates one row', async ({ browser }) => {
  { const { ctx, page } = await openCamp(browser, 1280);
    const n = await page.evaluate(() => [...document.querySelectorAll('#expTable thead th')].filter(th => th.getBoundingClientRect().width > 0).length);
    expect(n).toBe(11);
    expect((await box(page, '#savePill')).w).toBeGreaterThan(40);
    await ctx.close(); }
  { const { ctx, page } = await open(browser, '/hq/', { width: 1280, tables: { hq_invoice_categories: CATS, hq_invoices: invoices('water-movements'), hq_bank_movements: [], ledger_entries: [] }, rpc: { hq_todo: {} } });
    await openTab(page, 'invoices', '#invListBody tr[data-inv-id]');
    const n = await page.evaluate(() => [...document.querySelectorAll('#invListBody thead th')].filter(th => th.getBoundingClientRect().width > 0).length);
    expect(n).toBe(10); // the select column is 0px until Select is on
    await ctx.close(); }
  { const { ctx, page } = await open(browser, '/partners/', { width: 1280, tables: partnersTables() });
    await expect(page.locator('#partnerTableBodyCamp tr').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => [...document.querySelectorAll('#partnerTableHeadCamp th')].filter(th => th.getBoundingClientRect().width > 0).length)).toBe(6);
    await page.evaluate(() => openSettings()); await page.waitForTimeout(400);
    const tops = await page.evaluate(() => new Set([...document.querySelector('#partnerRatesList .partner-row').children].map(c => Math.round(c.getBoundingClientRect().top / 10))).size);
    expect(tops).toBe(1);
    await ctx.close(); }
});
