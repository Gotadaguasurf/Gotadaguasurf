// Camp Tab comps — «why is it free?» (15 Nov 2026). Stubbed Supabase, the camp tab
// always inside the camp hub (never camp-tab-inner.html on its own).
//
// Miguel: «Quando se oferece qualquer coisa no POS, bebida ou t-shirt ou tour, saber
// qual o motivo (para sabermos a razão).» A line at price 0 needs a reason (Staff ·
// Gift to guest · Compensation · Marketing / influencer · Other + note) before it is
// added; the reason, the note and the list price live on camp_tab_items.meta; the
// Camp Tab «Comps» sub-tab and the hub's Weekly P&L «Comps» line show them.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');

test.use({ timezoneId: 'Asia/Colombo', viewport: { width: 1280, height: 900 } });

const SHOTS = process.env.COMP_SHOTS || path.join(__dirname, '..', 'test-results', 'comp-shots');
const CAMPS = {
  'sri-lanka': { id: '83cda02b-b63f-46fd-979a-945fd30ba5ab', name: 'Sri Lanka', currency: 'LKR', fx: 340, tz: 'Asia/Colombo' },
  // the browser runs in Asia/Colombo for every test, so «today» is taken there for Morocco too
  morocco: { id: '45aba3b6-de7f-4f94-ae31-43880e23b1b7', name: 'Morocco', currency: 'MAD', fx: 10.8, tz: 'Asia/Colombo' },
};
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
// name, category, sell_price, alt_price, alt_label, stock_qty — like pricing_catalog
const ROWS = {
  'sri-lanka': [
    ['Soft Drink', 'Drinks', 400, 200, 'Staff', null], ['Lion Lager', 'Drinks', 600, 300, 'Staff', 50], ['Cocktail', 'Drinks', 2000, 1000, 'Staff', null],
    ['T-Shirt M', 'Merch', 9000, 3000, 'Staff', 54], ['River Safari', 'Tour', 6000, null, null, null],
    ['Core Black 28', 'Diploria', 55, null, null, 3],
  ],
  morocco: [
    ['T-Shirt M', 'Merch', 300, 120, 'Staff', 20], ['Hoodie L', 'Merch', 450, null, null, 10], ['Paradise Valley', 'Tour', 250, null, null, null],
  ],
};
const catalog = (slug) => ROWS[slug].map(([name, category, sell, alt, altLabel, stock], i) => ({
  id: `0000c0e9-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: CAMPS[slug].id, name, category, audience: 'general',
  sell_price: sell, sell_currency: category === 'Diploria' ? 'EUR' : CAMPS[slug].currency, currency: CAMPS[slug].currency, cost_per_guest: 0,
  alt_price: alt, alt_label: altLabel, stock_qty: stock, show_in_camp_tab: true, show_in_transport_picker: false, active: true, sort_order: (i + 1) * 100,
}));

// The camp's date (YYYY-MM-DD) n days from today, and the Saturday of its Sat–Fri week.
const campDay = (tz, n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + n * 86400e3));
const satOf = (ymd) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); };

// Small in-memory PostgREST (same as camp-tab.spec.js): GET eq/is/in, POST upsert, PATCH, DELETE.
async function stub(page, slug, tables) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, writes: [] };
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
    const t = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1]; if (!t) return json([]);
    const c = CAMPS[slug];
    if (t === 'locations') return json({ id: c.id, name: c.name, slug, currency: c.currency, default_fx_to_eur: c.fx, camp_tab_mode: 'per_guest' });
    if (t === 'platform_profiles') return json([{ id: 'u-francisco', full_name: 'Francisco', email: 'f@example.com' }]);
    const rows = T[t] || (T[t] = []);
    if (method !== 'GET') ctl.writes.push([method, t]);
    if (method === 'GET') {
      let out = rows.filter(r => match(r, url));
      if (t === 'camp_tab_items' && /camp_guests\(/.test(new URL(url).searchParams.get('select') || '')) out = out.map(r => ({ ...r, camp_guests: (T.camp_guests || []).find(g => g.id === r.guest_id) || null }));
      if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out.length ? json(out[0]) : json({ code: 'PGRST116' }, 406);
      return json(out);
    }
    if (method === 'POST') {
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      const key = (new URL(url).searchParams.get('on_conflict') || 'id').split(',');
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = rows.findIndex(x => key.every(k => String(x[k]) === String(r[k]))); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') { T[t] = rows.filter(r => !match(r, url)); return json([]); }
    return json([]);
  });
  return ctl;
}

async function openCampTab(page, slug = 'sri-lanka', extra = {}) {
  const c = CAMPS[slug];
  const ctl = await stub(page, slug, {
    pricing_catalog: catalog(slug), ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: c.id, start_date: satOf(campDay(c.tz)), end_date: null, status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [], ...extra,
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${slug}`, { waitUntil: 'domcontentloaded' });
  return { ctl, frame: await campFrame(page, slug) };
}
async function campFrame(page, slug) {
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  const probe = slug === 'morocco' ? ['Merch', 'T-Shirt M'] : ['Drinks', 'Lion Lager'];
  await frame.waitForFunction(([c, n]) => { try { return campTabBootstrapped === true && !!S.activeWeek && (MENU[c] || []).some(i => i.n === n); } catch (_) { return false; } }, probe, { timeout: 20000 });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(600);
  return frame;
}
async function addConsumer(frame, name) {
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill(name);
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
}
const cat = (frame, label) => frame.locator('#catTabs button', { hasText: label }).first().click();
const discount = (frame, name) => frame.locator(`#itemGrid .c-item:has(.ci-name:text-is("${name}")) button[title^="Give"]`).first().click();
const freeBtn = (frame) => frame.locator('#discountModal button[data-price="0"]').click();
const chip = (frame, reason) => frame.locator(`#compReasonModal .comp-chip[data-reason="${reason}"]`).click();
const lines = (frame) => frame.evaluate(() => (findConsumer(AG, currentRoster)?.items || []).map(i => ({ n: i.n, p: i.p, priceType: i.priceType, s: i.s || '', reason: i.compReason || '', note: i.compNote || '', list: i.listPrice ?? null })));
const dbItems = (ctl) => (ctl.T.camp_tab_items || []).map(r => ({ n: r.item_name, p: Number(r.price_local), reason: r.meta?.comp_reason || '', note: r.meta?.comp_note || '', list: r.meta?.list_price ?? null, s: r.meta?.staffNote || '' }));

test('comps: «Free» without a reason is blocked — the «Why is it free?» step opens, closing it adds nothing (modal, custom 0, any direct call)', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  await discount(frame, 'Lion Lager');
  await freeBtn(frame);
  await expect(frame.locator('#compReasonModal')).toBeVisible();
  await expect(frame.locator('#compReasonModal .comp-chip')).toHaveText([/Staff/, /Gift to guest/, /Compensation.*something went wrong/s, /Marketing \/ influencer/, /Other/]);
  await frame.locator('#compReasonClose').click();
  expect(await lines(frame)).toEqual([]);
  // custom price 0 → same step
  await discount(frame, 'Lion Lager');
  await frame.locator('#discountCustomPrice').fill('0');
  await frame.locator('#discountCustomApply').click();
  await expect(frame.locator('#compReasonModal')).toBeVisible();
  await frame.locator('#compReasonModal').click({ position: { x: 5, y: 5 } }); // tap outside = cancel
  expect(await lines(frame)).toEqual([]);
  // any code path at price 0 without a reason (or «other» without a note) is refused too
  const n = await frame.evaluate(() => {
    const beer = MENU.Drinks.find(i => i.n === 'Lion Lager');
    addItemAtCustomPrice(beer.id, beer.n, 0, 'Gift', null);
    document.getElementById('compReasonModal')?.remove();
    addItemAtCustomPrice(beer.id, beer.n, 0, 'Gift', null, { reason: 'other', note: '   ' });
    document.getElementById('compReasonModal')?.remove();
    addResolvedItem({ ...beer, p: 0, sp: 0, _altUsed: true, _compReason: 'because' });
    document.getElementById('compReasonModal')?.remove();
    return findConsumer(AG, currentRoster).items.length;
  });
  expect(n).toBe(0);
  // a normal tap is untouched (no modal, full price)
  await frame.locator('#itemGrid button:has(.ci-name:text-is("Soft Drink"))').first().click();
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  expect((await lines(frame)).map(l => [l.n, l.p, l.reason])).toEqual([['Soft Drink', 400, '']]);
});

test('comps: each reason is saved on the line and on camp_tab_items.meta (comp_reason, list_price), and survives a reload', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  for (const r of ['staff', 'gift', 'compensation', 'marketing']) {
    await discount(frame, 'Lion Lager'); await freeBtn(frame); await chip(frame, r);
    await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  }
  // reason picked first in the discount modal → «Free» adds straight away (2 taps)
  await discount(frame, 'Cocktail');
  await frame.locator('#discountModal .comp-pill[data-reason="gift"]').click();
  await freeBtn(frame);
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  const got = await lines(frame);
  expect(got.map(l => [l.n, l.p, l.priceType, l.reason, l.list, l.s])).toEqual([
    ['Lion Lager', 0, 'Gift', 'staff', 600, 'Free · Staff'],
    ['Lion Lager', 0, 'Gift', 'gift', 600, 'Free · Gift'],
    ['Lion Lager', 0, 'Gift', 'compensation', 600, 'Free · Compensation'],
    ['Lion Lager', 0, 'Gift', 'marketing', 600, 'Free · Marketing'],
    ['Cocktail', 0, 'Gift', 'gift', 2000, 'Free · Gift'],
  ]);
  // the tab line shows why
  await expect(frame.locator('#tabList')).toContainText('Free · Staff');
  await expect.poll(() => dbItems(ctl).length, { timeout: 10000 }).toBe(5);
  expect(dbItems(ctl).map(r => [r.n, r.p, r.reason, r.list])).toEqual(got.map(l => [l.n, 0, l.reason, l.list]));
  // reload: hydrated from the rows, reasons intact, and nothing is rewritten (dirty-sync baseline holds)
  await page.reload({ waitUntil: 'domcontentloaded' });
  const f2 = await campFrame(page, 'sri-lanka');
  const back = await f2.evaluate(() => allConsumers(S.activeWeek).flatMap(g => g.items).map(i => [i.n, i.compReason, i.listPrice]));
  expect(back).toEqual(got.map(l => [l.n, l.reason, l.list]));
  ctl.writes.length = 0;
  await page.waitForTimeout(1500);
  const same = await f2.evaluate(() => { const a = JSON.stringify(buildCampTabSyncRows('x').itemRows); return a === JSON.stringify(buildCampTabSyncRows('x').itemRows); });
  expect(same).toBe(true);
  expect(ctl.writes.filter(([m, t]) => t === 'camp_tab_items')).toEqual([]);
});

test('comps: «Other» needs a short note — blocked without it, saved with it', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  await discount(frame, 'Lion Lager'); await freeBtn(frame); await chip(frame, 'other');
  await expect(frame.locator('#compOtherNote')).toBeVisible();
  await frame.locator('#compOtherAdd').click();
  await expect(frame.locator('#compOtherNote')).toHaveClass(/comp-err/);
  expect(await lines(frame)).toEqual([]);
  await frame.locator('#compOtherNote').fill('Birthday of the guest');
  await frame.locator('#compOtherAdd').click();
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  expect((await lines(frame)).map(l => [l.p, l.reason, l.note])).toEqual([[0, 'other', 'Birthday of the guest']]);
  // in the discount modal: «Other» picked, no note → the price tap is refused
  await discount(frame, 'Cocktail');
  await frame.locator('#discountModal .comp-pill[data-reason="other"]').click();
  await freeBtn(frame);
  await expect(frame.locator('#discOtherNote')).toHaveClass(/comp-err/);
  await frame.locator('#discOtherNote').fill('DJ night');
  await freeBtn(frame);
  expect((await lines(frame)).map(l => [l.n, l.reason, l.note])).toEqual([['Lion Lager', 'other', 'Birthday of the guest'], ['Cocktail', 'other', 'DJ night']]);
  await expect.poll(() => dbItems(ctl).map(r => r.note).sort(), { timeout: 10000 }).toEqual(['Birthday of the guest', 'DJ night']);
});

test('comps: a partial discount takes the reason only if picked (optional); the list price is kept either way', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  await discount(frame, 'Cocktail');
  await frame.locator('#discountModal button[data-note="-25%"]').click();
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  await discount(frame, 'Cocktail');
  await frame.locator('#discountModal .comp-pill[data-reason="compensation"]').click();
  await frame.locator('#discountModal button[data-note="-50%"]').click();
  expect((await lines(frame)).map(l => [l.p, l.priceType, l.reason, l.list, l.s])).toEqual([
    [1500, '-25%', '', 2000, '-25%'],
    [1000, '-50%', 'compensation', 2000, '-50% · Compensation'],
  ]);
});

test('comps: Pay / Pay all / Close guest / History with a comp on the tab — no revenue row for the comp, the reason shows in History', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Drinks');
  await frame.locator('#itemGrid button:has(.ci-name:text-is("Lion Lager"))').first().click();
  await discount(frame, 'Cocktail'); await freeBtn(frame); await chip(frame, 'compensation');
  // the guest's bill says «Free» but not why
  await frame.locator('.c-btn-bill').click();
  await expect(frame.locator('#billOv')).toContainText('Free');
  await expect(frame.locator('#billOv')).not.toContainText('Compensation');
  await frame.locator('#billOv').evaluate(el => el.classList.remove('open'));
  await frame.locator('#payBtn').click();
  // since 15 Nov 2026 a paid checkout is one grouped line per product group (camp_tab_per_guest)
  const rev = () => (ctl.T.ledger_entries || []).filter(r => /^camp_tab_per_(item|guest)$/.test(r.source_kind) && r.type === 'revenue');
  await expect.poll(() => rev().length).toBe(1);
  expect(rev().map(r => [r.description, Number(r.amount_local)])).toEqual([['Camp Tab · Anna · Drinks: Lion Lager', 600]]);
  await expect(frame.locator('#payState')).toBeVisible();
  await frame.locator('#closeGuestBtn').click();
  await frame.locator('.snav-btn[data-sub="history"]').click();
  await expect(frame.locator('#histList')).toContainText('Anna');
  await frame.locator('#histList .hist-week-head').first().click();
  await expect(frame.locator('#histList')).toContainText('Free · Compensation');
  // the closed guest's comp is still in the Comps view
  await frame.locator('.snav-btn[data-sub="sellers"]').click();
  await expect(frame.locator('#cpCount')).toHaveText('1');
  await expect(frame.locator('#cpByReason')).toContainText('Compensation');
  expect(rev().length).toBe(1);
});

// Old comps (no reason, no list price) + new ones, this week and last week, a closed guest and a staff member.
function seeded(slug) {
  const c = CAMPS[slug]; const today = campDay(c.tz); const ws = satOf(today);
  const prevWeek = new Date(ws + 'T00:00:00Z'); prevWeek.setUTCDate(prevWeek.getUTCDate() - 3); const old = prevWeek.toISOString().slice(0, 10);
  const g = (id, name, isStaff, closed) => ({ id: `0000c0e9-0000-4000-8000-0000000000${id}`, week_id: WEEK, location_id: c.id, name, is_staff: isStaff, paid: false, paid_at: null, closed_at: closed ? `${today}T09:00:00Z` : null, pax: 1, sort_order: 10, meta: {} });
  let n = 0;
  const it = (guest, name, category, day, time, meta, price = 0) => ({ id: `0000c0e9-0000-4000-8000-0000000001${String(++n).padStart(2, '0')}`, guest_id: guest.id, week_id: WEEK, location_id: c.id, category, item_name: name, qty: 1, price_local: price, currency: c.currency,
    added_at: `${day}T${time}:00.000Z`, price_type: price ? 'regular' : 'Gift', sort_order: n * 10, meta: { time, staffNote: price ? null : 'Gift', ...meta }, paid_at: null, created_by: 'u-francisco' });
  const anna = g('a1', 'Anna', false, true), jude = g('a2', 'Jude', true, false);
  // one real cost this week (food, 10 EUR) so the Weekly P&L has data; comps must not change it
  const ledger = [{ id: '0000c0e9-0000-4000-8000-000000000201', location_id: c.id, week_id: null, type: 'expense', category: 'Food', linked_item: null, description: 'Market', payment_method: 'Cash', qty: 1,
    amount_local: 10 * c.fx, currency: c.currency, entry_date: today, business_area: null, fx_rate: c.fx, amount_eur: 10, recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: slug, attributed_location: slug, created_at: `${today}T08:00:00Z` }];
  return { today, ws, old, ledger, guests: [anna, jude], items: slug === 'morocco' ? [
    it(anna, 'T-Shirt M', 'Merch', today, '10:00', { comp_reason: 'compensation', list_price: 300, staffNote: 'Free · Compensation' }),
    it(jude, 'Hoodie L', 'Merch', today, '11:00', { comp_reason: 'staff', list_price: 450, staffNote: 'Free · Staff' }),
    it(anna, 'T-Shirt M', 'Merch', old, '12:00', {}),                       // before 15 Nov: no reason, priced from the catalog (300)
  ] : [
    it(anna, 'Lion Lager', 'Drinks', today, '18:00', { comp_reason: 'gift', list_price: 600, staffNote: 'Free · Gift' }),
    it(jude, 'Lion Lager', 'Drinks', today, '19:00', { comp_reason: 'staff', list_price: 600, staffNote: 'Free · Staff' }),
    it(jude, 'Soft Drink', 'Drinks', today, '19:30', { comp_reason: 'staff', list_price: 400, staffNote: 'Free · Staff' }),
    it(anna, 'Cocktail', 'Drinks', today, '20:00', { comp_reason: 'other', comp_note: 'Guest birthday', list_price: 2000, staffNote: 'Free · Other' }),
    it(anna, 'Lion Lager', 'Drinks', old, '18:00', {}),                     // before 15 Nov: no reason, priced from the catalog (600)
    it(anna, 'Cocktail', 'Drinks', today, '21:00', {}, 2000),               // a paid-for line: never a comp
  ] };
}

test('comps: the Comps view — totals by reason and by item, who and when; This week vs All time; old ones «No reason (before 15 Nov)»', async ({ page }) => {
  const D = seeded('sri-lanka');
  const { frame } = await openCampTab(page, 'sri-lanka', { camp_guests: D.guests, camp_tab_items: D.items, ledger_entries: D.ledger });
  await frame.locator('.snav-btn[data-sub="sellers"]').click();
  await expect(frame.locator('#cpPeriodRow .pill.active')).toHaveText('This week');
  await expect(frame.locator('#cpCount')).toHaveText('4');
  await expect(frame.locator('#cpValue')).toHaveText('LKR 3,600');
  const byReason = await frame.locator('#cpByReason .cp-row').evaluateAll(rs => rs.map(r => [r.dataset.reason, r.innerText.replace(/\s+/g, ' ').trim()]));
  expect(byReason).toEqual([
    ['staff', 'Staff ×2LKR 1,000'], ['gift', 'Gift to guest ×1LKR 600'], ['other', 'Other ×1LKR 2,000'],
  ]);
  const byItem = await frame.locator('#cpByItem .cp-row').evaluateAll(rs => rs.map(r => (r.dataset.item + ' ' + r.querySelector('.num').innerText).replace(/\s+/g, ' ')));
  expect(byItem).toEqual(['Cocktail LKR 2,000', 'Lion Lager LKR 1,200', 'Soft Drink LKR 400']);
  const first = (await frame.locator('#cpLines .cp-line').first().innerText()).replace(/\s+/g, ' ');
  expect(first).toContain('Cocktail → Anna');
  expect(first).toContain('Other — Guest birthday');
  await expect(frame.locator('#cpLines')).toContainText('by Francisco');          // created_by resolved
  await expect(frame.locator('#cpLines .cp-line').nth(1)).toContainText('Staff');  // Jude is on the Staff roster
  // week by week (Miguel 15 Nov: «para eu saber por semana»): ‹ goes to last week, › back
  await expect(frame.locator('#cpNextWeek')).toBeDisabled();
  await frame.locator('#cpPrevWeek').click();
  await expect(frame.locator('#cpPeriodRow .pill.active')).toHaveText('Last week');
  await expect(frame.locator('#cpCount')).toHaveText('1');
  await expect(frame.locator('#cpLines')).toContainText('No reason (before 15 Nov)');
  await frame.locator('#cpPrevWeek').click();
  await expect(frame.locator('#cpPeriodRow .pill.active')).toHaveText(/^\d{1,2} \w{3} – \d{1,2} \w{3}$/);
  await frame.locator('#cpNextWeek').click();
  await frame.locator('#cpNextWeek').click();
  await expect(frame.locator('#cpPeriodRow .pill.active')).toHaveText('This week');
  await expect(frame.locator('#cpCount')).toHaveText('4');
  await frame.locator('#cpPeriodRow .pill[data-period="all"]').click();
  await expect(frame.locator('#cpCount')).toHaveText('5');
  await expect(frame.locator('#cpValue')).toHaveText('≈ LKR 4,200');
  expect((await frame.locator('#cpByReason .cp-row[data-reason="none"]').innerText()).replace(/\s+/g, ' ').trim()).toBe('No reason (before 15 Nov) ×1LKR 600');
});

test('comps: the Weekly P&L «Comps» line — this week at list price by reason, not a cost; follows the selected week', async ({ page }) => {
  const D = seeded('sri-lanka');
  await openCampTab(page, 'sri-lanka', { camp_guests: D.guests, camp_tab_items: D.items, ledger_entries: D.ledger });
  await page.evaluate(() => showPage('weekly'));
  await expect(page.locator('#wplComps')).toBeVisible();
  await expect(page.locator('#wplCompsTotal')).toHaveText('LKR 3,600 · €11 at list price · 4 items');
  const by = await page.locator('#wplComps .wpl-comps-r').evaluateAll(rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  expect(by).toEqual(['Staff LKR 1,000 · €3 ×2', 'Gift to guest LKR 600 · €2', 'Other LKR 2,000 · €6']);
  await expect(page.locator('#wplComps')).toContainText('Not a cost line');
  // the week's list: what, to whom, why
  const list = await page.locator('#wplCompsList .wpl-comps-line').evaluateAll(rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  expect(list).toHaveLength(4);
  expect(list[0]).toContain('Cocktail → Anna');
  expect(list[0]).toContain('Other — Guest birthday');
  expect(list.filter(l => l.includes('(staff)'))).toHaveLength(2);
  // the week before: only the old comp, without a reason
  await page.evaluate((ws) => wplSelect(addDays(ws, -7)), D.ws);
  await expect(page.locator('#wplCompsTotal')).toHaveText('≈ LKR 600 · €2 at list price · 1 item');
  await expect(page.locator('#wplComps .wpl-comps-r')).toHaveText(['No reason (before 15 Nov) LKR 600 · €2']);
  // costs are not touched by comps: the week's cost KPI is the one food row (€10)
  await page.evaluate((ws) => wplSelect(ws), D.ws);
  await expect(page.locator('#wplWeek .wpl-kpi').nth(1).locator('.kpi-value')).toHaveText('€10');
});

test('comps: Morocco — a free T-shirt asks why, the reason is saved; Comps view and Weekly P&L line in MAD', async ({ page }) => {
  const D = seeded('morocco');
  const { ctl, frame } = await openCampTab(page, 'morocco', { camp_guests: D.guests, camp_tab_items: D.items, ledger_entries: D.ledger });
  await addConsumer(frame, 'Youssef');
  await cat(frame, 'Merch');
  await discount(frame, 'T-Shirt M'); await freeBtn(frame); await chip(frame, 'marketing');
  expect((await lines(frame)).map(l => [l.n, l.p, l.reason, l.list])).toEqual([['T-Shirt M', 0, 'marketing', 300]]);
  // a free tour too (Tours now have the gift/discount button)
  await cat(frame, 'Tours');
  await discount(frame, 'Paradise Valley'); await freeBtn(frame); await chip(frame, 'gift');
  expect((await lines(frame)).map(l => [l.n, l.p, l.reason, l.list])).toEqual([['T-Shirt M', 0, 'marketing', 300], ['Paradise Valley', 0, 'gift', 250]]);
  await expect.poll(() => dbItems(ctl).filter(r => r.reason === 'marketing').length, { timeout: 10000 }).toBe(1);
  await frame.locator('.snav-btn[data-sub="sellers"]').click();
  await expect(frame.locator('#cpCount')).toHaveText('4');
  await expect(frame.locator('#cpValue')).toHaveText('MAD 1,300');
  await page.evaluate(() => showPage('weekly'));
  await expect(page.locator('#wplCompsTotal')).toHaveText('MAD 1,300 · €120 at list price · 4 items');
});

test('comps: Sri Lanka Dipløria (pass-through) is not affected — no reason asked, never a comp, nothing in the Comps view', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Dipløria');
  await frame.locator('#dipModels .dip-model[data-model="Core Black"]').click();
  await frame.locator('#dipSizes .dip-size[data-size="28"]').click();
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  expect((await lines(frame)).map(l => [l.n, l.p, l.reason])).toEqual([['Core Black 28', 55, '']]);
  const out = await frame.evaluate(() => ({
    pass: CampComps.isFreeLine({ n: 'Core Black 28', p: 0, c: 'Diploria' }, isPassThrough),
    bar: CampComps.isFreeLine({ n: 'Beer', p: 0, c: 'Bar' }),
    comps: CampComps.lines(S, MENU, { isPass: isPassThrough }).length,
  }));
  expect(out).toEqual({ pass: false, bar: false, comps: 0 });
  await frame.locator('.snav-btn[data-sub="sellers"]').click();
  await expect(frame.locator('#compsBody')).toContainText('Nothing given free');
});

test('comps: screenshots at 390 and 1280 — «Why is it free?», the discount modal, the Comps view, the Weekly P&L line; no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const D = seeded('sri-lanka');
  const { frame } = await openCampTab(page, 'sri-lanka', { camp_guests: D.guests, camp_tab_items: D.items, ledger_entries: D.ledger });
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await frame.locator('.snav-btn[data-sub="charge"]').click();
    await discount(frame, 'Lion Lager');
    await frame.locator('#discountModal .comp-pill[data-reason="other"]').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `discount-modal-${w}.png`) });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await frame.locator('#discountModal .comp-pill[data-reason="other"]').click();
    await freeBtn(frame);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `why-free-${w}.png`) });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await chip(frame, 'staff');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `tab-with-comp-${w}.png`) });
    await frame.locator('.snav-btn[data-sub="sellers"]').click();
    await frame.locator('#cpPeriodRow .pill[data-period="all"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `comps-view-${w}.png`) });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.evaluate(() => showPage('weekly'));
    await expect(page.locator('#wplComps')).toBeVisible();
    await page.locator('#wplComps').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `weekly-pl-comps-${w}.png`) });
    await page.locator('#wplComps').screenshot({ path: path.join(SHOTS, `weekly-pl-comps-line-${w}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.evaluate(() => showPage('pos'));
    await page.waitForTimeout(300);
  }
});
