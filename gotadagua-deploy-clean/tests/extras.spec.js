// Camp hub — Sri Lanka extras (Phase 2, 13 Nov 2026): camp-hub/extras.js
//
//   B3  the Camp Tab gets this week's guests from the Guests import
//       (camp_week_guests) — never a duplicate, never a delete — and the
//       «Leaving today/tomorrow with open tab» chips above it;
//   B4  salary and «Money from HQ needed» chips (read-only);
//   B6  the «This week» card on the Weekly P&L;
//   B9  «Tour sold this week with no cost».
//
// Everything is stubbed (in-memory PostgREST): nothing reaches Supabase, and
// the Camp Tab only ever runs inside the hub. Phone width (390) throughout.
// Clock: the browser runs in Lisbon, the camp in Colombo — dates must never
// shift through UTC or the browser's zone.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');
const SHOTS = process.env.EXTRAS_SHOTS || 'test-results';   // screenshots for the review

test.use({ timezoneId: 'Europe/Lisbon', viewport: { width: 390, height: 844 } });

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
const MON_16_NOV = '2026-11-16T04:30:00Z';   // Mon 16 Nov 10:00 Colombo (week Sat 14 – Fri 20 Nov)

let seq = 0;
const uuid = (p = '00000000') => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
function L(type, method, amount, date, description, extra = {}) {
  return {
    id: uuid('0000e0e0'), location_id: LOC, week_id: null, type, category: extra.category || 'Salary',
    linked_item: extra.linked || null, description, payment_method: method, qty: 1,
    amount_local: amount, currency: 'LKR', entry_date: date, business_area: extra.area || null, fx_rate: 372,
    amount_eur: Number((amount / 372).toFixed(2)), recurring_source_id: null, recurring_month: null,
    source_kind: extra.sourceKind || 'manual', is_comp: false, zone_id: null, paid_from: 'sri-lanka', attributed_location: 'sri-lanka',
    created_at: extra.createdAt || `${date}T08:00:00Z`,
  };
}

// The real Sri Lanka salary rows of September and October 2026 (descriptions as in the ledger).
const SEP = [
  ['HQ Paid', 1550, '2026-09-01', 'shenal de almeida — Ordenado Agosto — 05244847 · paid by HQ', { sourceKind: 'hq_invoice' }],
  ['Cash', 30000, '2026-09-18', 'Yoga'],
  ['Cash', 30000, '2026-09-25', 'Yoga Teacher'],
  ['Bank Transfer', 155697.5, '2026-09-30', 'Ceylon Securities · salary of the 2 security guards Setembro (bank, paid 4 Oct)'],
  ['Bank Transfer', 30000, '2026-09-30', 'Surf instructor — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 100000, '2026-09-30', 'Nadith (manager) — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 60000, '2026-09-30', 'Chinthaka Ramanayaka (chef assistant) — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 110000, '2026-09-30', 'Michael Sampath (chef) — September salary (bank, paid 1 Oct)'],
  ['Cash', 50000, '2026-09-30', 'Kavindu — September salary, paid in cash on 3 Oct'],
  ['Bank Transfer', 60000, '2026-09-30', 'Dilip Kumara (house keeper) — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 120000, '2026-09-30', 'Surf instructor — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 120000, '2026-09-30', 'Surf instructor — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 35000, '2026-09-30', 'Shenal de Almeida — local salary September (bank, «SEPTEMBER SALARY ALMEIDA» 5 Out)'],
  ['Bank Transfer', 60000, '2026-09-30', 'Jude Rohan (bar) — September salary (bank, paid 1 Oct)'],
  ['Bank Transfer', 155000, '2026-09-30', 'Francisco Guimarães — local salary September (bank, «SEPTEMBER SALARY GUIMARAES» 5 Out)'],
  ['HQ Paid', 955.27, '2026-09-29', 'francisco duarte — Salario liquido Setembro (recibo geral) · paid by HQ', { sourceKind: 'hq_invoice' }],
];
const OCT = [
  ['Cash', 20000, '2026-10-02', 'Sithum (Salary For Two Weeks-New Kitchen Helper)'],
  ['Bank Transfer', 150675, '2026-10-04', 'Ceylon Securities · salary of the 2 security guards Outubro (bank, paid 4 Oct)'],
  ['Cash', 223000, '2026-10-17', 'Salary For Federico'],
  ['Bank Transfer', 60000, '2026-10-28', 'Chinthaka Ramanayaka (chef assistant) — October salary (bank, paid 28 Oct)'],
  ['Bank Transfer', 110000, '2026-10-28', 'Michael Sampath (chef) — October salary (bank, paid 28 Oct)'],
  ['Bank Transfer', 120000, '2026-10-28', 'Surf instructor — October salary (bank, paid 28 Oct, 120.000 · 2)'],
  ['Bank Transfer', 60000, '2026-10-28', 'Surf instructor — October salary (bank, paid 28 Oct, 60.000)'],
  ['Bank Transfer', 60000, '2026-10-28', 'Dilip Kumara (house keeper) — October salary (bank, paid 28 Oct)'],
  ['Bank Transfer', 120000, '2026-10-28', 'Surf instructor — October salary (bank, paid 28 Oct, 120.000 · 1)'],
  ['Bank Transfer', 100000, '2026-10-28', 'Nadith (manager) — October salary (bank, paid 28 Oct)'],
  ['Cash', 50000, '2026-10-28', 'Kavindu (house keeper) — October salary (paid in cash: the transfer of 28 Oct came back on 30 Oct)'],
  ['Bank Transfer', 60000, '2026-10-28', 'Jude Rohan (bar) — October salary (bank, paid 28 Oct)'],
  ['Bank Transfer', 155000, '2026-10-31', 'Francisco Guimarães — local salary October (bank, «OCT SALARY - F GUIMARAES» paid 6 Nov)'],
  ['Bank Transfer', 35000, '2026-10-31', 'Shenal de Almeida — local salary October (bank, «OCT SALARY - S DE ALMEIDA» 29 Out)'],
  ['Cash', 325000, '2026-10-31', "David's Salary"],
  ['Cash', 50000, '2026-10-31', 'Salary For Sithum (Month Of October)'],
];
// October bank-paid payroll = 1,030,675.
function ledgerRows({ withoutKavindu = false, bank = 217830 } = {}) {
  seq = 0;
  const rows = [
    // Bank: an HQ transfer in and nothing else touching it but the salaries below.
    L('money_sent', 'HQ Transfer', 0, '2026-09-01', 'Money from HQ', { category: 'Cash Float' }),
    L('money_sent', 'Cash', 500000, '2026-10-01', 'Opening cash', { category: 'Cash Float' }),
    ...SEP.map(([m, a, d, desc, x]) => L('expense', m, a, d, desc, x || {})),
    ...OCT.filter(r => !(withoutKavindu && /^Kavindu/.test(r[3]))).map(([m, a, d, desc, x]) => L('expense', m, a, d, desc, x || {})),
    // This week (Sat 14 – Fri 20 Nov): bar sales, tours, a cost.
    L('revenue', 'Cash', 1200, '2026-11-14', 'Camp Tab · Julia · Lion Lager', { category: 'Drinks', area: 'Bar', sourceKind: 'camp_tab_per_item' }),
    L('revenue', 'Cash', 6000, '2026-11-15', 'Camp Tab · Julia · Cooking Class', { category: 'Tours', linked: 'Cooking Class', area: 'Tours', sourceKind: 'camp_tab_per_item' }),
    L('revenue', 'Cash', 6000, '2026-11-15', 'Camp Tab · Anna · Cooking Class', { category: 'Tours', linked: 'Cooking Class', area: 'Tours', sourceKind: 'camp_tab_per_item' }),
    L('revenue', 'Cash', 6000, '2026-11-15', 'Camp Tab · Anna · River Safari', { category: 'Tours', linked: 'River Safari', area: 'Tours', sourceKind: 'camp_tab_per_item' }),
    L('expense', 'Cash', 8000, '2026-11-15', 'Damantha', { category: 'Tours & activities', linked: 'River Safari' }),
    L('expense', 'Card', 4500, '2026-11-15', 'Keells', { category: 'Food' }),
    // A cost of Cooking Class LAST month never covers this week's sales.
    L('expense', 'Cash', 50000, '2026-11-06', '25/9-2guest, 08/10-2guest, 30/10-6guest', { category: 'Tours & activities', linked: 'Cooking Class' }),
  ];
  // Size the HQ transfer so the bank ends at `bank`.
  const out = rows.filter(r => ['Bank Transfer', 'Card'].includes(r.payment_method) && r.type === 'expense').reduce((s, r) => s + r.amount_local, 0);
  rows[0].amount_local = bank + out; rows[0].amount_eur = Number((rows[0].amount_local / 372).toFixed(2));
  return rows;
}

function weekGuests() {
  const g = (ref, name, ci, co, status = 'confirmed', updated = '2026-11-16T03:00:00Z') => ({
    id: uuid('0000a0a0'), location_id: LOC, week_start: '2026-11-14', booking_ref: ref, guest_key: name.toLowerCase(), guest_name: name,
    check_in: ci, check_out: co, booking_status: status, updated_at: updated,
  });
  return [
    g('2026-4660', 'Julia Schmidt', '2026-11-14', '2026-11-21'),    // the host typed «Julia»
    g('2026-4701', 'Anna Müller', '2026-11-15', '2026-11-18'),
    g('2026-4701', 'Tom Müller', '2026-11-15', '2026-11-17'),       // same booking, his own line
    g('2026-4590', 'Gonçalo Pina', '2026-11-08', '2026-11-16'),     // typed by the host, leaves today
    g('2026-4800', 'Maximilian Ehrler', '2026-11-14', '2026-11-21', 'cancelled'),
    g('2026-4500', 'Old Guest', '2026-11-07', '2026-11-14'),        // left on Saturday
    g('2026-4999', 'Next Week', '2026-11-21', '2026-11-28'),        // next week
  ];
}
const campGuest = (id, name, extra = {}) => ({ id, location_id: LOC, week_id: WEEK, name, booking_ref: null, is_staff: false, paid: false, paid_at: null, closed_at: null, checkin: null, checkout: null, pax: 1, sort_order: 0, meta: {}, ...extra });
const tabItem = (guestId, name, price, extra = {}) => ({ id: uuid('0000b0b0'), location_id: LOC, guest_id: guestId, week_id: WEEK, category: 'Drinks', item_name: name, price_local: price, price_type: 'normal', added_at: '2026-11-15T15:00:00Z', paid_at: null, sort_order: 0, meta: {}, ...extra });
const G_JULIA = '0000c0c0-0000-4000-8000-000000000001', G_GONCALO = '0000c0c0-0000-4000-8000-000000000002', G_YANNECK = '0000c0c0-0000-4000-8000-000000000003';

// In-memory PostgREST: GET filters eq/is/in, POST upserts by id/on_conflict, PATCH, DELETE.
async function stub(page, tables) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, gets: [] };
  const match = (row, url) => [...new URL(url).searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) return true;
    const m = v.match(/^(eq|is|in)\.(.*)$/s); if (!m) return true;
    if (m[1] === 'eq') return String(row[k]) === m[2];
    if (m[1] === 'is') return m[2] === 'null' ? row[k] == null : String(row[k]) === m[2];
    return m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(row[k]));
  });
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/auth/v1/')) return json({});
    if (url.includes('/rest/v1/rpc/')) return json(null);
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]; if (!t) return json([]);
    if (t === 'locations') return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 372, camp_tab_mode: 'per_guest' });
    const rows = T[t] || (T[t] = []);
    if (method === 'GET') {
      ctl.gets.push(t);
      const out = rows.filter(r => match(r, url));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
      return json(out);
    }
    if (method === 'POST') {
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      const key = (new URL(url).searchParams.get('on_conflict') || 'id').split(',');
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = rows.findIndex(x => key.every(c => String(x[c]) === String(r[c]))); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') { T[t] = rows.filter(r => !match(r, url)); return json([]); }
    return json([]);
  });
  return ctl;
}

async function openHub(page, { query = '', at = MON_16_NOV, ledger = ledgerRows(), tables = {}, waitFrame = true } = {}) {
  await page.clock.setFixedTime(new Date(at));
  const ctl = await stub(page, {
    ledger_entries: ledger, pricing_catalog: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: LOC, start_date: '2026-06-07', end_date: '2026-06-13', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [
      campGuest(G_JULIA, 'Julia'), campGuest(G_GONCALO, 'Gonçalo Pina'),
      campGuest(G_YANNECK, 'Yanneck Kumli', { closed_at: '2026-11-10T09:00:00Z' }),
    ],
    camp_tab_items: [tabItem(G_JULIA, 'Lion Lager', 1200, { paid_at: '2026-11-14T16:00:00Z' }), tabItem(G_GONCALO, 'Lion Lager', 600), tabItem(G_GONCALO, 'Cocktail', 2000)],
    camp_week_guests: weekGuests(), camp_cash_counts: [], camp_trips: [], camp_drivers: [], camp_transport_payments: [], bookings: [],
    ...tables,
  });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.TRIPS_GO_LIVE_OVERRIDE = '2026-11-01'; });
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=sri-lanka${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  let frame = null;
  if (waitFrame) {
    const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
    frame = await fh.contentFrame();
    await frame.waitForFunction(() => { try { return campTabStateReady === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  }
  return { ctl, frame };
}
const roster = (frame) => frame.evaluate(() => rosterRows(S.activeWeek, 'guests').map(g => ({ id: g.id, name: g.name, ref: g.bookingRef || '', ci: g.bookingCi ? isoLocal(new Date(g.bookingCi)) : '', co: g.bookingCo ? isoLocal(new Date(g.bookingCo)) : '', closed: !!g.closedAt })));
const chipTexts = (page, host) => page.locator(`#${host} .health-chip`).allTextContents();
async function noWiderThanPhone(page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(390);
}

// ── B3 · Camp Tab prefill ────────────────────────────────────────────────────
test('camp tab prefill: this week\'s guests, one per guest, matched by name — no duplicates on a second run, a deleted guest stays deleted', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { ctl, frame } = await openHub(page);
  await expect.poll(async () => (await roster(frame)).map(g => g.name).sort(), { timeout: 15000 })
    .toEqual(['Anna Müller', 'Gonçalo Pina', 'Julia', 'Tom Müller', 'Yanneck Kumli']);
  const R = Object.fromEntries((await roster(frame)).map(g => [g.name, g]));
  // «Julia» typed by the host = Julia Schmidt (unique first name): her tab keeps its name and id.
  expect(R.Julia).toMatchObject({ id: G_JULIA, ref: '2026-4660', ci: '2026-11-14', co: '2026-11-21' });
  expect(R['Gonçalo Pina']).toMatchObject({ id: G_GONCALO, ref: '2026-4590', co: '2026-11-16' });
  expect(R['Anna Müller']).toMatchObject({ ref: '2026-4701', ci: '2026-11-15', co: '2026-11-18' });
  expect(R['Tom Müller']).toMatchObject({ ref: '2026-4701', co: '2026-11-17' });
  expect(R['Yanneck Kumli']).toMatchObject({ closed: true, ref: '' });             // closed guest untouched
  // Saved to camp_guests with the Colombo dates of the file (Lisbon browser, no shift).
  await expect.poll(() => (ctl.T.camp_guests.find(g => g.name === 'Anna Müller') || {}).checkout).toBe('2026-11-18');
  const anna = ctl.T.camp_guests.find(g => g.name === 'Anna Müller');
  expect(anna).toMatchObject({ booking_ref: '2026-4701', checkin: '2026-11-15' });
  expect(ctl.T.camp_guests.find(g => g.id === G_JULIA)).toMatchObject({ booking_ref: '2026-4660', checkout: '2026-11-21' });
  // Not sent: cancelled, already left, next week.
  expect(ctl.T.camp_guests.map(g => g.name)).not.toEqual(expect.arrayContaining(['Maximilian Ehrler']));
  expect(ctl.T.camp_guests.some(g => /Old Guest|Next Week|Maximilian/.test(g.name))).toBe(false);

  // A second run (another computer / a re-import) adds nothing.
  await page.evaluate(() => CampExtras.prefillCampTab(true));
  await page.waitForTimeout(800);
  expect((await roster(frame)).length).toBe(5);
  expect(ctl.T.camp_guests.length).toBe(5);

  // The host deletes Tom (didn't come): the next prefill from this browser does not bring him back.
  await frame.evaluate(() => { const wk = S.activeWeek; wk.guests = wk.guests.filter(g => g.name !== 'Tom Müller'); save(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => CampExtras.prefillCampTab(true));
  await page.waitForTimeout(800);
  expect((await roster(frame)).map(g => g.name)).not.toContain('Tom Müller');
  expect(errors).toEqual([]);
});

test('camp tab prefill: refused until the Camp Tab has loaded its guests; two «Julia»s in the file never merge into one tab', async ({ page }) => {
  const { frame } = await openHub(page, { tables: { camp_week_guests: [] } });
  const r = await frame.evaluate(async () => {
    campTabStateReady = false;
    const a = await applyIncomingBookingsToCampTab({ bookings: [{ ref: 'X1', name: 'Someone', key: 'X1|someone', ci: 1, co: 2 }] });
    campTabStateReady = true;
    const ms = (d) => new Date(d + 'T00:00:00').getTime();
    const b = await applyIncomingBookingsToCampTab({ bookings: [
      { ref: 'J1', name: 'Julia Rossi', key: 'J1|julia rossi', ci: ms('2026-11-14'), co: ms('2026-11-21') },
      { ref: 'J2', name: 'Julia Weber', key: 'J2|julia weber', ci: ms('2026-11-14'), co: ms('2026-11-21') },
    ] });
    return { a, b, julias: rosterRows(S.activeWeek, 'guests').filter(g => /^julia/i.test(g.name)).map(g => [g.name, g.bookingRef || '']) };
  });
  expect(r.a).toMatchObject({ ok: false, reason: 'not-ready' });
  expect(r.b).toMatchObject({ ok: true, added: 0, skipped: 2 });
  expect(r.julias).toEqual([['Julia', '']]);
});

test('camp tab: nothing new in ?view=local — no prefill read, no leaving chips', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { ctl } = await openHub(page, { query: '&view=local' });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(1500);
  expect(ctl.gets).not.toContain('camp_week_guests');
  await expect(page.locator('#exLeaving')).toHaveCount(0);
  // His checks strip: none of the new chips.
  await page.evaluate(() => showPage('expenses'));
  const chips = await chipTexts(page, 'expChecks');
  expect(chips.filter(c => /salaries|Money from HQ|Tour sold/.test(c))).toEqual([]);
  expect(errors).toEqual([]);
});

// ── B3 · Leaving chips ───────────────────────────────────────────────────────
test('leaving chips above the Camp Tab: today and tomorrow with open tab, list on tap; the Camp Tab still fits the phone', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { frame } = await openHub(page);
  await expect.poll(async () => (await roster(frame)).length, { timeout: 15000 }).toBe(5);
  // Tom leaves tomorrow: give him a beer.
  await frame.evaluate(() => { const g = rosterRows(S.activeWeek, 'guests').find(x => x.name === 'Tom Müller'); g.items.push({ id: makeUuid(), n: 'Shot', p: 1000, cat: 'Drinks' }); save(); });
  await page.evaluate(() => showPage('pos'));
  await expect(page.locator('#exLeaving .health-chip')).toHaveText(['Leaving today with open tab: 1 · LKR 2,600', 'Leaving tomorrow with open tab: 1 · LKR 1,000']);
  await page.locator('#exLeaving .health-chip').first().click();
  await expect(page.locator('#exLeaveList')).toContainText('Gonçalo Pina');
  await expect(page.locator('#exLeaveList')).toContainText('LKR 2,600');
  // The frame is pushed down, not off the screen.
  const box = await page.locator('#campTabFrame').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(845);
  await noWiderThanPhone(page);
  // Paying Gonçalo's lines removes him from the chip.
  await frame.evaluate(() => { const g = rosterRows(S.activeWeek, 'guests').find(x => x.name === 'Gonçalo Pina'); g.items.forEach(i => { i.paidAt = '2026-11-16'; }); save(); });
  await expect(page.locator('#exLeaving .health-chip')).toHaveText(['Leaving tomorrow with open tab: 1 · LKR 1,000']);
  await page.screenshot({ path: `${SHOTS}/extras-leaving.png` });
  expect(errors).toEqual([]);
});

test('leaving chips in camp-tab-only (the bar tablet): dates come from the saved guests; no prefill there', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { ctl } = await openHub(page, {
    query: '&view=camp-tab-only',
    tables: { camp_guests: [campGuest(G_GONCALO, 'Gonçalo Pina', { booking_ref: '2026-4590', checkin: '2026-11-08', checkout: '2026-11-17' }), campGuest(G_JULIA, 'Julia')] },
  });
  await expect(page.locator('#exLeaving .health-chip')).toHaveText(['Leaving tomorrow with open tab: 1 · LKR 2,600']);
  expect(ctl.gets).not.toContain('camp_week_guests');
  const box = await page.locator('#campTabFrame').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(845);
  await noWiderThanPhone(page);
  expect(errors).toEqual([]);
});

// ── B4 · Salaries + money ────────────────────────────────────────────────────
test('salary chip: September as the expected list, October complete → no chip; Kavindu missing → chip, «Not expected anymore» removes it', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openHub(page, { waitFrame: false });
  const full = await page.evaluate(() => { const s = CampExtras.salaryStatus(S.ledger, '2026-11-16'); return { target: s.target, have: s.have, total: s.total, missing: s.missing.map(m => m.label) }; });
  expect(full).toEqual({ target: '2026-10', have: 12, total: 12, missing: [] });
  await page.evaluate(() => showPage('expenses'));
  expect((await chipTexts(page, 'expChecks')).filter(c => /salaries/.test(c))).toEqual([]);

  const p2 = await page.context().newPage();
  await openHub(p2, { waitFrame: false, ledger: ledgerRows({ withoutKavindu: true }) });
  await p2.evaluate(() => showPage('expenses'));
  const chip = p2.locator('#expChecks .health-chip', { hasText: 'salaries' });
  await expect(chip).toHaveText('October salaries: 11 of 12 in the ledger – missing Kavindu');
  await chip.click();
  await expect(p2.locator('#exSalOv.open .mhdr-title')).toHaveText('October salaries');
  await noWiderThanPhone(p2);
  await p2.screenshot({ path: `${SHOTS}/extras-salaries-modal.png` });
  await p2.locator('#exSalOv [data-not-expected]').click();
  await expect(p2.locator('#exSalOv')).toContainText('Expected again');
  await p2.locator('#exSalOv [data-ex-close]').click();
  await expect(p2.locator('#expChecks .health-chip', { hasText: 'salaries' })).toHaveCount(0);
  // The 28th: November is checked now, against October.
  const nov = await p2.evaluate(() => { const s = CampExtras.salaryStatus(S.ledger, '2026-11-28'); return [s.target, s.have, s.total]; });
  expect(nov[0]).toBe('2026-11');
  expect(nov[1]).toBe(0);
  expect(errors).toEqual([]);
});

test('money chip: from the 15th, bank below the payroll still due → Money from HQ needed (LKR and €); not before the 15th', async ({ page }) => {
  await openHub(page, { waitFrame: false });
  await page.evaluate(() => showPage('expenses'));
  // October bank salaries 1,030,675; bank 217,830 → 812,845 ≈ € 2,185 at 372.
  await expect(page.locator('#expChecks .health-chip', { hasText: 'Money from HQ' }))
    .toHaveText('Bank LKR 217,830 · payroll ~1,030,675 due ~28th → Money from HQ needed ≈ LKR 812,845 (≈ € 2,185)');
  const bankTile = await page.evaluate(() => Math.round(ledgerDrawerBalances(S.ledger).bankLocal));
  expect(bankTile).toBe(217830);
  const p2 = await page.context().newPage();
  await openHub(p2, { waitFrame: false, at: '2026-11-13T04:30:00Z' });
  await p2.evaluate(() => showPage('expenses'));
  await p2.waitForTimeout(500);
  expect((await chipTexts(p2, 'expChecks')).filter(c => /Money from HQ/.test(c))).toEqual([]);
  // Enough in the bank → no chip.
  const p3 = await page.context().newPage();
  await openHub(p3, { waitFrame: false, ledger: ledgerRows({ bank: 1200000 }) });
  await p3.evaluate(() => showPage('expenses'));
  await p3.waitForTimeout(500);
  expect((await chipTexts(p3, 'expChecks')).filter(c => /Money from HQ/.test(c))).toEqual([]);
});

// ── B9 · Tours ───────────────────────────────────────────────────────────────
test('tour chip: Cooking Class sold twice this week with no cost (last month\'s cost does not count); River Safari has its boat', async ({ page }) => {
  await openHub(page, { waitFrame: false });
  await page.evaluate(() => showPage('expenses'));
  await expect(page.locator('#expChecks .health-chip', { hasText: 'Tour sold' })).toHaveText('Tour sold this week with no cost: Cooking Class ×2');
  await page.screenshot({ path: `${SHOTS}/extras-chips.png`, fullPage: false });
});

// ── B6 · This week card ──────────────────────────────────────────────────────
test('weekly P&L: «This week» card — guests, bar sales, spent, cash vs last count, transfers, Guests file age', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const trip = (id, date, time, extra = {}) => ({ id, location_id: LOC, kind: 'airport_arrival', trip_date: date, trip_time: time, status: 'planned', source: 'bookinglayer', expected_price: 9000, payment_entry_id: null, last_export_date: '2026-11-15', guest_names: 'Anna Müller', pax: 2, ...extra });
  await openHub(page, {
    waitFrame: false,
    tables: {
      camp_trips: [trip('t1', '2026-11-16', '08:00'), trip('t2', '2026-11-18', '09:30', { kind: 'airport_departure' }), trip('t3', '2026-11-15', '07:00', { status: 'cancelled' })],
      camp_cash_counts: [{ id: 'c1', location_id: LOC, count_date: '2026-11-15', bar_box: 100000, pocket: 395000, declared_unloaded_withdrawals: 0, statement_through: null, status: 'open', created_at: '2026-11-15T13:00:00Z' }],
    },
  });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded && window.CampCash && CampCash.state.loaded, null, { timeout: 15000 });
  await page.evaluate(() => showPage('weekly'));
  const card = page.locator('#exWeekCard');
  await expect(card.locator('.card-title')).toHaveText('This week · 14–20 Nov');
  await expect(card).toContainText('Guests');
  await expect(card.locator('.ex-wk-row').nth(0)).toContainText('4');           // Julia, Anna, Tom, Gonçalo (Guests file)
  await expect(card.locator('.ex-wk-row').nth(1)).toContainText('LKR 19,200');  // Camp Tab: 1,200 + 3 × 6,000
  await expect(card.locator('.ex-wk-row').nth(2)).toContainText('cash LKR 8,000 · bank LKR 4,500');
  await expect(card.locator('.ex-wk-row').nth(3)).toContainText('last count 15 Nov: counted 495,000');
  await expect(card.locator('.ex-wk-row').nth(4)).toContainText('2 booked · 1 done · 0 paid');
  await expect(card.locator('.ex-wk-row').nth(4)).toContainText('owed to drivers LKR 9,000');
  await expect(card.locator('.ex-wk-row').nth(5)).toContainText('exported 15 Nov');
  await expect(card.locator('.ex-wk-row').nth(5)).toContainText('1 day old');
  await noWiderThanPhone(page);
  await card.screenshot({ path: `${SHOTS}/extras-week-card.png` });
  expect(errors).toEqual([]);
});

test('weekly P&L card and new chips stay out of Morocco', async ({ page }) => {
  await page.clock.setFixedTime(new Date(MON_16_NOV));
  await stub(page, { ledger_entries: ledgerRows() });
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=morocco', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  await page.evaluate(() => showPage('weekly'));
  await expect(page.locator('#exWeekCard')).toHaveCount(0);
  const res = await page.evaluate(() => CAMP_CHECKS.filter(c => ['salaries-missing', 'money-from-hq-needed', 'tour-without-cost'].includes(c.id)).map(c => c.run({ ledger: S.ledger, location: 'morocco', isLocal: false, today: '2026-11-16' })));
  expect(res).toEqual([null, null, null]);
});
