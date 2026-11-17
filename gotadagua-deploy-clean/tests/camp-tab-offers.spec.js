// Camp Tab offers (17 Nov 2026). Stubbed Supabase, the camp tab always inside the camp hub
// (never camp-tab-inner.html on its own).
//
// 1. «Make it an offer»: a line already on the tab with a price becomes free afterwards — a
//    comp reason is required, the line stays (stock / counts), price 0, who and when are kept,
//    «Undo offer» puts the price back. A paid line is refused until «Mark unpaid».
// 2. Staff plus (Sri Lanka only): the first 7 drinks of a Sat–Fri week of a «Staff plus» person
//    are free on their own («Staff plus allowance (k/7)»), from the 8th the staff price.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');

test.use({ timezoneId: 'Asia/Colombo', viewport: { width: 1280, height: 900 } });

const SHOTS = process.env.OFFER_SHOTS || path.join(__dirname, '..', 'test-results', 'offer-shots');
const CAMPS = {
  'sri-lanka': { id: '83cda02b-b63f-46fd-979a-945fd30ba5ab', name: 'Sri Lanka', currency: 'LKR', fx: 340 },
  morocco: { id: '45aba3b6-de7f-4f94-ae31-43880e23b1b7', name: 'Morocco', currency: 'MAD', fx: 10.8 },
  portugal: { id: '6f1d1a4e-1f1e-4c4c-9f55-0d7b3c2a9e10', name: 'Portugal', currency: 'EUR', fx: 1 },
};
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
const ROWS = {
  'sri-lanka': [
    ['Soft Drink', 'Drinks', 400, 200, 'Staff', null], ['Lion Lager', 'Drinks', 600, 300, 'Staff', 50], ['Cocktail', 'Drinks', 2000, 1000, 'Staff', null],
    ['T-Shirt M', 'Merch', 9000, 3000, 'Staff', 54], ['River Safari', 'Tour', 6000, null, null, null],
  ],
  morocco: [
    ['T-Shirt M', 'Merch', 300, 120, 'Staff', 20], ['Hoodie L', 'Merch', 450, null, null, 10], ['Paradise Valley', 'Tour', 250, null, null, null],
  ],
  portugal: [
    ['T-Shirt M', 'Merch', 25, 15, 'Staff', 20], ['Sintra Tour', 'Tour', 45, null, null, null],
  ],
};
const catalog = (slug) => ROWS[slug].map(([name, category, sell, alt, altLabel, stock], i) => ({
  id: `0000c0e9-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: CAMPS[slug].id, name, category, audience: 'general',
  sell_price: sell, sell_currency: CAMPS[slug].currency, currency: CAMPS[slug].currency, cost_per_guest: 0,
  alt_price: alt, alt_label: altLabel, stock_qty: stock, show_in_camp_tab: true, show_in_transport_picker: false, active: true, sort_order: (i + 1) * 100,
}));

// Small in-memory PostgREST (same as comps.spec.js).
async function stub(page, slug, tables) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, writes: [], dialogs: [] };
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
    if (t === 'platform_profiles') return json([{ id: '00000000-0000-4000-8000-000000000001', full_name: 'Miguel', email: 'miguel@gotadaguasurf.com' }]);
    const rows = T[t] || (T[t] = []);
    if (method !== 'GET') ctl.writes.push([method, t]);
    if (method === 'GET') {
      const out = rows.filter(r => match(r, url));
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

async function openCampTab(page, slug = 'sri-lanka', extra = {}, query = '') {
  const c = CAMPS[slug];
  const ctl = await stub(page, slug, {
    pricing_catalog: catalog(slug), ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: c.id, start_date: '2026-06-07', end_date: null, status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [], ...extra,
  });
  page.on('dialog', d => { ctl.dialogs.push(d.message()); d.accept(); });
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${slug}${query}`, { waitUntil: 'domcontentloaded' });
  return { ctl, frame: await campFrame(page, slug) };
}
async function campFrame(page, slug) {
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  const probe = slug === 'sri-lanka' ? ['Drinks', 'Lion Lager'] : ['Merch', 'T-Shirt M'];
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
const tap = (frame, name) => frame.locator(`#itemGrid button:has(.ci-name:text-is("${name}"))`).first().click();
const chip = (frame, reason) => frame.locator(`#compReasonModal .comp-chip[data-reason="${reason}"]`).click();
const lines = (frame) => frame.evaluate(() => (findConsumer(AG, currentRoster)?.items || []).map(i => ({
  id: i.id, n: i.n, p: i.p, priceType: i.priceType || '', s: i.s || '', reason: i.compReason || '', note: i.compNote || '', list: i.listPrice ?? null,
  from: i.offerFrom || null, at: i.compAt || '', by: i.compBy || '', byName: i.compByName || '', paid: !!i.paidAt,
})));
const row = (frame, id) => frame.locator(`#tabList .c-tab-row[data-item="${id}"]`);
const rev = (ctl) => (ctl.T.ledger_entries || []).filter(r => /^camp_tab_per_(item|guest)$/.test(r.source_kind) && r.type === 'revenue');
const dbItem = (ctl, id) => (ctl.T.camp_tab_items || []).find(r => r.id === id);

test('offers: «Make it an offer» after the line was added — reason required, price 0 as a comp, who/when kept, stays on the tab; «Undo offer» puts the price back; both survive a reload', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  await tap(frame, 'Lion Lager');
  await tap(frame, 'Cocktail');
  let [beer, cocktail] = await lines(frame);
  expect([beer.p, cocktail.p]).toEqual([600, 2000]);
  await expect(row(frame, cocktail.id).locator('.ct-make-offer')).toHaveText('Make it an offer');
  // the reason step opens; closing it changes nothing
  await row(frame, cocktail.id).locator('.ct-make-offer').click();
  await expect(frame.locator('#compReasonModal')).toBeVisible();
  await expect(frame.locator('#compReasonModal')).toContainText('Make it an offer');
  await expect(frame.locator('#compReasonModal .comp-chip')).toHaveCount(5);   // the manual reasons only, never «Staff plus»
  await frame.locator('#compReasonClose').click();
  expect((await lines(frame)).map(l => l.p)).toEqual([600, 2000]);
  // «Other» needs its note
  await row(frame, cocktail.id).locator('.ct-make-offer').click();
  await chip(frame, 'other');
  await frame.locator('#compOtherAdd').click();
  await expect(frame.locator('#compOtherNote')).toHaveClass(/comp-err/);
  await frame.locator('#compOtherNote').fill('Wrong cocktail made');
  await frame.locator('#compOtherAdd').click();
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  [beer, cocktail] = await lines(frame);
  expect([cocktail.n, cocktail.p, cocktail.priceType, cocktail.s, cocktail.reason, cocktail.note, cocktail.list]).toEqual(['Cocktail', 0, 'Gift', 'Free · Other', 'other', 'Wrong cocktail made', 2000]);
  expect(cocktail.from).toEqual({ p: 2000, priceType: 'regular' });
  expect(cocktail.by).toBe('00000000-0000-4000-8000-000000000001');
  expect(cocktail.byName).toBeTruthy();
  expect(cocktail.at.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  expect(beer.p).toBe(600);
  await expect(frame.locator('#tabTotal')).toHaveText('LKR 600');
  await expect(row(frame, cocktail.id).locator('.ct-undo-offer')).toHaveText('Undo offer');
  // the stock / counts keep the line: still 2 drinks on the tab
  expect(await frame.evaluate(() => allConsumers(S.activeWeek).flatMap(g => g.items).filter(i => i.c === 'Drinks').length)).toBe(2);
  // saved on camp_tab_items.meta
  await expect.poll(() => dbItem(ctl, cocktail.id)?.meta?.comp_reason, { timeout: 10000 }).toBe('other');
  const m = dbItem(ctl, cocktail.id);
  expect([Number(m.price_local), m.price_type, m.meta.offer_from, m.meta.comp_by, m.meta.list_price]).toEqual([0, 'Gift', { p: 2000, priceType: 'regular' }, '00000000-0000-4000-8000-000000000001', 2000]);
  // the Comps view shows it, with «made an offer, was …»
  await frame.locator('.snav-btn[data-sub="sellers"]').click();
  await expect(frame.locator('#cpCount')).toHaveText('1');
  await expect(frame.locator('#cpLines')).toContainText('Other — Wrong cocktail made');
  await expect(frame.locator('#cpLines')).toContainText('made an offer, was LKR 2,000');
  // reload: hydrated as an offer, nothing rewritten
  await page.reload({ waitUntil: 'domcontentloaded' });
  let f2 = await campFrame(page, 'sri-lanka');
  const back = await f2.evaluate((id) => { const i = allConsumers(S.activeWeek).flatMap(g => g.items).find(x => x.id === id); return [i.p, i.compReason, i.offerFrom, i.listPrice]; }, cocktail.id);
  expect(back).toEqual([0, 'other', { p: 2000, priceType: 'regular' }, 2000]);
  ctl.writes.length = 0;
  await page.waitForTimeout(1500);
  expect(ctl.writes.filter(([, t]) => t === 'camp_tab_items' || t === 'camp_guests')).toEqual([]);
  // Undo offer → back to 2000, reason gone; after a reload it stays 2000 (not healed back to a gift)
  await f2.evaluate(() => { AG = allConsumers(S.activeWeek).find(g => g.name === 'Marie').id; renderAllCampTabViews(); });
  await f2.locator(`#tabList .c-tab-row[data-item="${cocktail.id}"] .ct-undo-offer`).click();
  const undone = (await lines(f2)).find(l => l.id === cocktail.id);
  expect([undone.p, undone.priceType, undone.s, undone.reason, undone.note, undone.list, undone.from, undone.at]).toEqual([2000, 'regular', '', '', '', null, null, '']);
  await expect(f2.locator('#tabTotal')).toHaveText('LKR 2,600');
  await expect.poll(() => Number(dbItem(ctl, cocktail.id)?.price_local), { timeout: 10000 }).toBe(2000);
  expect(dbItem(ctl, cocktail.id).meta.comp_reason).toBeUndefined();
  await page.reload({ waitUntil: 'domcontentloaded' });
  f2 = await campFrame(page, 'sri-lanka');
  expect(await f2.evaluate((id) => allConsumers(S.activeWeek).flatMap(g => g.items).find(x => x.id === id).p, cocktail.id)).toBe(2000);
});

test('offers: a paid line is refused («Mark unpaid» first); after Mark unpaid it can be an offer and Pay writes no revenue for it', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Drinks');
  await tap(frame, 'Lion Lager');
  const [beer] = await lines(frame);
  await frame.locator('#payBtn').click();
  await expect.poll(() => rev(ctl).length).toBe(1);
  expect(Number(rev(ctl)[0].amount_local)).toBe(600);
  // paid: the action explains and changes nothing
  await row(frame, beer.id).locator('.ct-make-offer').click();
  await expect(frame.locator('#compReasonModal')).toHaveCount(0);
  expect(ctl.dialogs.at(-1)).toContain('already paid');
  expect(ctl.dialogs.at(-1)).toContain('Mark unpaid');
  expect((await lines(frame))[0]).toMatchObject({ p: 600, paid: true, reason: '' });
  expect(rev(ctl).length).toBe(1);
  // a direct call is refused too
  expect(await frame.evaluate((id) => applyOffer('guests', AG, id, { reason: 'gift', note: '' }), beer.id)).toBe(false);
  // Mark unpaid → the revenue row goes; then it can be an offer
  await row(frame, beer.id).locator('.ct-unpay').click();
  await expect.poll(() => rev(ctl).length).toBe(0);
  await row(frame, beer.id).locator('.ct-make-offer').click();
  await chip(frame, 'compensation');
  expect((await lines(frame))[0]).toMatchObject({ p: 0, paid: false, reason: 'compensation', list: 600 });
  // nothing left to pay: the guest is settled, no revenue row comes back
  await expect(frame.locator('#payState')).toBeVisible();
  await page.waitForTimeout(800);
  expect(rev(ctl).length).toBe(0);
});

test('offers: ledger / Weekly P&L — Pay all writes revenue only for the charged lines; the offer is in the Comps line of the week, not revenue', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Drinks');
  await tap(frame, 'Lion Lager');
  await tap(frame, 'Lion Lager');
  await tap(frame, 'Cocktail');
  const cocktail = (await lines(frame))[2];
  await row(frame, cocktail.id).locator('.ct-make-offer').click();
  await chip(frame, 'gift');
  await expect(frame.locator('#payBtn')).toHaveText('Pay all (2)');
  await frame.locator('#payBtn').click();
  await expect.poll(() => rev(ctl).length).toBe(1);
  expect(rev(ctl).map(r => [r.description, Number(r.amount_local), r.category])).toEqual([['Camp Tab · Anna · Drinks: Lion Lager ×2', 1200, 'Drinks']]);
  // the hub's Weekly P&L: revenue = the ledger row; the cocktail is in the Comps card
  await page.evaluate(() => showPage('weekly'));
  await expect(page.locator('#wplComps')).toBeVisible();
  await expect(page.locator('#wplCompsTotal')).toContainText('LKR 2,000');
  await expect(page.locator('#wplCompsList')).toContainText('Cocktail → Anna');
  await expect(page.locator('#wplCompsList')).toContainText('made an offer after it was charged');
  const hubRevenue = await page.evaluate(() => S.ledger.filter(r => r.type === 'income' && /^camp_tab/.test(r.sourceKind || '')).reduce((s, r) => s + Number(r.amountLocal || 0), 0));
  expect(hubRevenue).toBe(1200);
});

test('offers: Morocco — the same «Make it an offer» / «Undo offer» on a guest line; no Staff plus there (staff price as before)', async ({ page }) => {
  const { frame } = await openCampTab(page, 'morocco');
  await addConsumer(frame, 'Youssef');
  await cat(frame, 'Merch');
  await tap(frame, 'Hoodie L');
  const [hoodie] = await lines(frame);
  await row(frame, hoodie.id).locator('.ct-make-offer').click();
  await chip(frame, 'marketing');
  expect((await lines(frame))[0]).toMatchObject({ p: 0, reason: 'marketing', list: 450, from: { p: 450, priceType: 'regular' } });
  await row(frame, hoodie.id).locator('.ct-undo-offer').click();
  expect((await lines(frame))[0]).toMatchObject({ p: 450, reason: '', from: null });
  // staff roster: no Staff plus switch, T-shirt at the staff price
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Othmane');
  await expect(frame.locator('#staffPlusBar')).toBeHidden();
  await expect(frame.locator('#spOnBtn')).toHaveCount(0);
  await cat(frame, 'Merch');
  await tap(frame, 'T-Shirt M');
  expect((await lines(frame)).map(l => [l.n, l.p, l.reason])).toEqual([['T-Shirt M', 120, '']]);
  expect(await frame.evaluate(() => [CampComps.staffPlusConfig('morocco'), CampComps.staffPlusConfig('portugal'), CampComps.staffPlusConfig('sri-lanka')])).toEqual([null, null, { perWeek: 7, categories: ['Drinks'] }]);
});

test('staff plus: Portugal unaffected — no switch on the Staff roster (no Drinks tab there: the bar is The Suk), merch at the staff price', async ({ page }) => {
  const { frame } = await openCampTab(page, 'portugal');
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Lianne');
  await expect(frame.locator('#spOnBtn')).toHaveCount(0);
  await expect(frame.locator('#staffPlusBar')).toBeHidden();
  await cat(frame, 'Merch');
  await tap(frame, 'T-Shirt M');
  await tap(frame, 'T-Shirt M');
  expect((await lines(frame)).map(l => [l.n, l.p, l.reason])).toEqual([['T-Shirt M', 15, ''], ['T-Shirt M', 15, '']]);
  // even a Drinks line forced on a flagged Portugal staff tab is never an allowance line
  const forced = await frame.evaluate(() => { const g = findConsumer(AG, 'staff'); g.staffPlus = true; AC = 'Drinks'; addResolvedItem({ n: 'Coffee', p: 2, sp: 1, c: 'Drinks' }); AC = 'Merch'; return findConsumer(AG, 'staff').items.at(-1); });
  expect([forced.p, forced.compReason || '']).toEqual([1, '']);
});

test('staff plus: Sri Lanka — the first 7 drinks of the week free («Staff plus allowance (k/7)»), the 8th at the staff price; merch never counts; «N of 7 left» on the tab; saved on the staff row', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Jude');
  await expect(frame.locator('#spOnBtn')).toHaveText('Make Staff plus');
  await expect(frame.locator('#staffPlusBar')).toContainText('7 free drinks a week');
  // regular staff: staff price
  await cat(frame, 'Drinks');
  await tap(frame, 'Lion Lager');
  expect((await lines(frame)).map(l => l.p)).toEqual([300]);
  await frame.locator('#tabList .ctr-del').first().click();
  await frame.locator('#spOnBtn').click();
  await expect(frame.locator('#spLeftCharge')).toHaveText('7 of 7 free drinks left this week');
  await expect(frame.locator('#spTabLeft')).toContainText('7 of 7 free drinks left this week');
  await expect.poll(() => (ctl.T.camp_guests || []).find(g => g.name === 'Jude')?.meta?.staffPlus, { timeout: 10000 }).toBe(true);
  for (let i = 0; i < 3; i++) await tap(frame, i === 1 ? 'Soft Drink' : 'Lion Lager');
  await expect(frame.locator('#spLeftCharge')).toHaveText('4 of 7 free drinks left this week');
  for (let i = 0; i < 5; i++) await tap(frame, 'Lion Lager');
  // merch is not a drink: staff price, allowance untouched
  await cat(frame, 'Merch');
  await tap(frame, 'T-Shirt M');
  const got = await lines(frame);
  expect(got.map(l => [l.n, l.p, l.reason, l.note])).toEqual([
    ['Lion Lager', 0, 'staff_plus', '1/7'], ['Soft Drink', 0, 'staff_plus', '2/7'], ['Lion Lager', 0, 'staff_plus', '3/7'],
    ['Lion Lager', 0, 'staff_plus', '4/7'], ['Lion Lager', 0, 'staff_plus', '5/7'], ['Lion Lager', 0, 'staff_plus', '6/7'], ['Lion Lager', 0, 'staff_plus', '7/7'],
    ['Lion Lager', 300, '', ''], ['T-Shirt M', 3000, '', ''],
  ]);
  expect(got[0]).toMatchObject({ s: 'Free · Staff plus 1/7', list: 600, from: { p: 300, priceType: 'staff' }, priceType: 'Gift' });
  expect(got[1]).toMatchObject({ list: 400, from: { p: 200, priceType: 'staff' } });
  await expect(frame.locator('#spLeftCharge')).toHaveText('0 of 7 free drinks left this week');
  await expect(frame.locator('#tabTotal')).toHaveText('LKR 3,300');
  await expect(frame.locator('#glist')).toContainText('Staff plus, 0 free left');
  // Comps view: «Staff plus allowance (k/7)»
  await frame.locator('.snav-btn[data-sub="sellers"]').click();
  await expect(frame.locator('#cpCount')).toHaveText('7');
  await expect(frame.locator('#cpByReason .cp-row[data-reason="staff_plus"]')).toContainText('Staff plus allowance');
  await expect(frame.locator('#cpLines')).toContainText('Staff plus allowance (7/7)');
  // Pay all: only the charged lines reach the ledger
  await frame.locator('.snav-btn[data-sub="charge"]').click();
  await frame.locator('#payBtn').click();
  await expect.poll(() => rev(ctl).length).toBe(2);
  expect(rev(ctl).map(r => Number(r.amount_local)).sort((a, b) => a - b)).toEqual([300, 3000]);
  // saved on camp_tab_items.meta, survives a reload with the allowance intact
  await expect.poll(() => (ctl.T.camp_tab_items || []).filter(r => r.meta?.comp_reason === 'staff_plus').length, { timeout: 10000 }).toBe(7);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const f2 = await campFrame(page, 'sri-lanka');
  await f2.locator('#rosterStaffBtn').click();
  await f2.locator('#glist .c-guest', { hasText: 'Jude' }).click();
  await expect(f2.locator('#spLeftCharge')).toHaveText('0 of 7 free drinks left this week');
  // a re-added (closed) staff tab with the same name is the same person: keeps Staff plus and the count
  await f2.evaluate(() => { const g = findConsumer(AG, 'staff'); g.closedAt = new Date().toISOString(); AG = null; save(); renderAllCampTabViews(); });
  await addConsumer(f2, 'Jude');
  await expect(f2.locator('#spLeftCharge')).toHaveText('0 of 7 free drinks left this week');
  await cat(f2, 'Drinks');
  await tap(f2, 'Cocktail');
  expect((await lines(f2)).map(l => [l.p, l.reason])).toEqual([[1000, '']]);
});

test('staff plus: week rollover — 7 free on Friday, the 8th charged; on Saturday the allowance starts again (Sat–Fri week)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-20T14:30:00Z') });   // Fri 20 Nov 2026, 20:00 in Sri Lanka
  const { frame } = await openCampTab(page);
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Kelly');
  await frame.locator('#spOnBtn').click();
  await cat(frame, 'Drinks');
  for (let i = 0; i < 8; i++) await tap(frame, 'Lion Lager');
  expect((await lines(frame)).map(l => l.p)).toEqual([0, 0, 0, 0, 0, 0, 0, 300]);
  await expect(frame.locator('#spLeftCharge')).toHaveText('0 of 7 free drinks left this week');
  await page.clock.setSystemTime(new Date('2026-11-21T04:30:00Z'));       // Sat 21 Nov, 10:00 in Sri Lanka
  await frame.evaluate(() => renderAllCampTabViews());
  await expect(frame.locator('#spLeftCharge')).toHaveText('7 of 7 free drinks left this week');
  await tap(frame, 'Lion Lager');
  const got = await lines(frame);
  expect(got.at(-1)).toMatchObject({ p: 0, reason: 'staff_plus', note: '1/7' });
  expect(got.slice(0, 7).map(l => l.note)).toEqual(['1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']);   // last week's lines keep theirs
  await expect(frame.locator('#spLeftCharge')).toHaveText('6 of 7 free drinks left this week');
});

test('staff plus: a counted drink deleted or undone frees a slot — the next drink is free again, labels renumber; a drink already charged stays charged', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Gustav');
  await frame.locator('#spOnBtn').click();
  await cat(frame, 'Drinks');
  for (let i = 0; i < 8; i++) await tap(frame, 'Lion Lager');
  let got = await lines(frame);
  // delete the 2nd free one (× on its row)
  await row(frame, got[1].id).locator('.ctr-del').click();
  got = await lines(frame);
  expect(got.map(l => [l.p, l.note])).toEqual([[0, '1/7'], [0, '2/7'], [0, '3/7'], [0, '4/7'], [0, '5/7'], [0, '6/7'], [300, '']]);
  expect(got[1].s).toBe('Free · Staff plus 2/7');
  await expect(frame.locator('#spLeftCharge')).toHaveText('1 of 7 free drinks left this week');
  // the next one is free again (7/7), then charged
  await tap(frame, 'Lion Lager');
  await tap(frame, 'Lion Lager');
  got = await lines(frame);
  expect(got.slice(-2).map(l => [l.p, l.note])).toEqual([[0, '7/7'], [300, '']]);
  // «Undo offer» on an allowance line: back to the staff price, slot freed, labels renumber
  await row(frame, got[0].id).locator('.ct-undo-offer').click();
  got = await lines(frame);
  expect(got[0]).toMatchObject({ p: 300, reason: '', priceType: 'staff' });
  expect(got.filter(l => l.reason === 'staff_plus').map(l => l.note)).toEqual(['1/7', '2/7', '3/7', '4/7', '5/7', '6/7']);
  await expect(frame.locator('#spLeftCharge')).toHaveText('1 of 7 free drinks left this week');
  // Turn off: no more free drinks (the free ones stay as they are)
  await frame.locator('#spOffBtn').click();
  await expect(frame.locator('#spOnBtn')).toBeVisible();
  await tap(frame, 'Lion Lager');
  expect((await lines(frame)).at(-1)).toMatchObject({ p: 300, reason: '' });
  expect((await lines(frame)).filter(l => l.reason === 'staff_plus')).toHaveLength(6);
});

test('offers + staff plus: the local manager view (?view=local) has both', async ({ page }) => {
  const { frame } = await openCampTab(page, 'sri-lanka', {}, '&view=local');
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  await tap(frame, 'Lion Lager');
  const [beer] = await lines(frame);
  await row(frame, beer.id).locator('.ct-make-offer').click();
  await chip(frame, 'gift');
  expect((await lines(frame))[0]).toMatchObject({ p: 0, reason: 'gift' });
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Dilip');
  await frame.locator('#spOnBtn').click();
  await tap(frame, 'Lion Lager');
  expect((await lines(frame))[0]).toMatchObject({ p: 0, reason: 'staff_plus', note: '1/7' });
});

test('offers + staff plus: screenshots at 390 and 1280; no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks');
  await tap(frame, 'Lion Lager');
  await tap(frame, 'Cocktail');
  const [, cocktail] = await lines(frame);
  await row(frame, cocktail.id).locator('.ct-make-offer').click();
  await chip(frame, 'compensation');
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Jude');
  await frame.locator('#spOnBtn').click();
  for (let i = 0; i < 3; i++) await tap(frame, 'Lion Lager');
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await frame.locator('.snav-btn[data-sub="charge"]').click();
    await frame.locator('#rosterGuestsBtn').click();
    await frame.locator('#glist .c-guest', { hasText: 'Marie' }).click();
    await page.waitForTimeout(250);
    await frame.locator('.c-right').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `offer-guest-tab-${w}.png`), fullPage: w === 390 });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const lion = (await lines(frame))[0];
    await row(frame, lion.id).locator('.ct-make-offer').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `offer-reason-modal-${w}.png`) });
    await frame.locator('#compReasonClose').click();
    await frame.locator('#rosterStaffBtn').click();
    await frame.locator('#glist .c-guest', { hasText: 'Jude' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, `staff-plus-${w}.png`), fullPage: w === 390 });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await frame.locator('.snav-btn[data-sub="week"]').click();
    await frame.evaluate(() => { twExpanded = findConsumer('Jude', 'staff').id; renderThisWeek(); });
    await expect(frame.locator('.tw-sp-toggle')).toHaveText('Turn off Staff plus');
    await expect(frame.locator('.tw-card-body .ct-undo-offer')).toHaveCount(3);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `staff-plus-this-week-${w}.png`), fullPage: w === 390 });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});
