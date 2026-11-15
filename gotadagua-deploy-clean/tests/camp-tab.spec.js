// Camp Tab (Sri Lanka, per_guest) — the bar/activities POS the social host
// uses every day. Audit 12 Nov 2026: each test drives the real screen inside
// the camp hub with a stubbed Supabase (nothing leaves the machine) and the
// real Sri Lanka catalog rows, then checks the tab, the totals and the
// ledger rows the hub writes.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

test.use({ timezoneId: 'Asia/Colombo', viewport: { width: 1280, height: 900 } });

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const WEEK = 'c2289c05-527b-4079-a810-b71cd00733ec';
// name, category, sell_price, alt_price, alt_label, stock_qty — as stored in pricing_catalog (12 Nov 2026)
const CATALOG = [
  ['Soft Drink', 'Drinks', 400, 200, 'Staff', null], ['Cocktail', 'Drinks', 2000, 1000, 'Staff', null],
  ['Lion Lager', 'Drinks', 600, 300, 'Staff', 50], ['Shot', 'Drinks', 1000, 500, 'Staff', null],
  ['T-Shirt M', 'Merch', 9000, 3000, 'Staff', 54], ['T-Shirt 2XL', 'Merch', 9000, 3000, 'Staff', 19],
  ['Zink Stick', 'Merch', 6000, null, null, 38], ['River Safari', 'Tour', 6000, null, null, null],
  ['Dr House Transfer', 'Tour', 3000, 3000, 'Staff', null],
].map(([name, category, sell, alt, altLabel, stock], i) => ({
  id: `0000c47a-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: LOC, name, category, audience: 'general',
  sell_price: sell, sell_currency: 'LKR', currency: 'LKR', cost_per_guest: 0, alt_price: alt, alt_label: altLabel, stock_qty: stock,
  show_in_camp_tab: true, show_in_transport_picker: false, active: true, sort_order: (i + 1) * 100,
}));

// Small in-memory PostgREST: GET filters eq/is/in, POST upserts by id, PATCH, DELETE.
async function stub(page, tables, location = null) {
  const T = {}; Object.entries(tables).forEach(([k, v]) => { T[k] = v.map(r => ({ ...r })); });
  const ctl = { T, fail: null, writes: [] };
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
    if (t === 'locations') return json(location || { id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' });
    if (ctl.fail && ctl.fail(t, method)) return json({ message: 'stub failure', code: '500' }, 500);
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
      (Array.isArray(body) ? body : [body]).forEach(r => { const i = rows.findIndex(x => key.every(c => String(x[c]) === String(r[c]))); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r }); });
      return json([], 201);
    }
    if (method === 'PATCH') { let b = {}; try { b = JSON.parse(req.postData() || '{}'); } catch (_) {} rows.forEach((r, i) => { if (match(r, url)) rows[i] = { ...r, ...b }; }); return json([]); }
    if (method === 'DELETE') { T[t] = rows.filter(r => !match(r, url)); return json([]); }
    return json([]);
  });
  return ctl;
}

async function openCampTab(page, extra = {}, location = null) {
  const ctl = await stub(page, {
    pricing_catalog: CATALOG, ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: LOC, start_date: '2026-06-07', end_date: '2026-06-13', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [], ...extra,
  }, location);
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${location ? location.slug : 'sri-lanka'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  await frame.waitForFunction(() => { try { return campTabBootstrapped === true && !!S.activeWeek && (MENU.Drinks || []).some(i => i.n === 'Lion Lager'); } catch (_) { return false; } }, null, { timeout: 20000 });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(800);
  return { ctl, frame };
}
// Camp Tab revenue rows: one per guest × day × product group since 15 Nov 2026
// (camp_tab_per_guest); camp_tab_per_item = the rows written before.
const revenue = (ctl) => (ctl.T.ledger_entries || []).filter(r => ['camp_tab_per_item', 'camp_tab_per_guest'].includes(r.source_kind));
const lines = (ctl) => revenue(ctl).map(r => [r.description, Number(r.amount_local), Number(r.qty)]).sort();
async function addConsumer(frame, name) {
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill(name);
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
}
const cat = (frame, label) => frame.locator('#catTabs button', { hasText: label }).first().click();
const tap = (frame, name) => frame.locator(`#itemGrid button:has(.ci-name:text-is("${name}"))`).first().click();
const discount = (frame, name) => frame.locator(`#itemGrid .c-item:has(.ci-name:text-is("${name}")) button[title^="Give"]`).first().click();
const row = (frame, name) => frame.locator(`#tabList .c-tab-row:has(.ctr-name:text-is("${name}"))`);

test('camp tab: un-paying one of two identical beers takes ONE beer off the checkout line, not both', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks'); await tap(frame, 'Soft Drink'); await tap(frame, 'Soft Drink');
  await frame.locator('#payBtn').click(); // «Pay all (2)» → ONE line, qty 2
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Marie · Drinks: Soft Drink ×2', 800, 2]]);
  const id = revenue(ctl)[0].id;
  await row(frame, 'Soft Drink').first().locator('button', { hasText: 'Mark unpaid' }).click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Marie · Drinks: Soft Drink', 400, 1]]);
  // the same row (same id), rewritten — never a second one
  expect(revenue(ctl).map(r => r.id)).toEqual([id]);
  const stillPaid = await frame.evaluate(() => findConsumer(AG, 'guests').items.filter(i => i.paidAt).map(i => i.id));
  expect(stillPaid.length).toBe(1);
  // un-paying the last one removes the row
  await row(frame, 'Soft Drink').locator('button', { hasText: 'Mark unpaid' }).first().click();
  await expect.poll(() => revenue(ctl).length).toBe(0);
});

test('camp tab: deleting a closed guest from History removes only HIS rows, not those of another guest with the same name', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Jules');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager');
  await frame.locator('#payBtn').click();
  await expect.poll(() => revenue(ctl).length).toBe(1);
  await frame.locator('#closeGuestBtn').click();
  await addConsumer(frame, 'Jules'); // he comes back next week
  await cat(frame, 'Drinks'); await tap(frame, 'Cocktail');
  await frame.locator('#payBtn').click();
  await expect.poll(() => revenue(ctl).length).toBe(2);
  await frame.locator('.snav-btn[data-sub="history"]').click();
  await frame.locator('#histList button', { hasText: 'Delete' }).first().click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Jules · Drinks: Cocktail', 2000, 1]]);
});

test('camp tab: a gift does not keep the tab «Unpaid»; This week counts Collected / Outstanding line by line', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager'); await tap(frame, 'Cocktail');
  await discount(frame, 'Shot');
  await frame.locator('#discountModal button', { hasText: 'Gift' }).click();
  // pay one line (Sri Lanka has no per-line Pay button since 12 Nov 2026 — the function still exists)
  await frame.evaluate(() => { const g = findConsumer(AG, currentRoster); payItem(g.items.findIndex(i => i.n === 'Lion Lager' && !i.paidAt)); });
  await expect.poll(() => revenue(ctl).length).toBe(1);
  await frame.locator('.snav-btn[data-sub="week"]').click();
  let head = (await frame.locator('#twHeader .tw-header-row').innerText()).replace(/[^\S\n]/g, ' ');
  expect(head).toContain('LKR 600\nCOLLECTED');
  expect(head).toContain('LKR 2,000\nOUTSTANDING');
  await frame.locator('.snav-btn[data-sub="charge"]').click();
  await frame.locator('#payBtn').click(); // pays the Cocktail; the gift has no price
  // same guest, same day, same category → the Cocktail joins the beer's line
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Anna · Drinks: Lion Lager, Cocktail', 2600, 2]]);
  await expect(frame.locator('#payState')).toBeVisible();
  await expect(frame.locator('#glist .c-guest .c-gpaid')).toHaveCount(1);
  await frame.locator('.snav-btn[data-sub="week"]').click();
  head = (await frame.locator('#twHeader .tw-header-row').innerText()).replace(/[^\S\n]/g, ' ');
  expect(head).toContain('LKR 2,600\nCOLLECTED');
  expect(head).not.toContain('OUTSTANDING');
  await expect(frame.locator('#twList .tw-card .badge').first()).toHaveText('Paid');
  // the gift wrote nothing (not on the line, not a row of its own)
  expect(lines(ctl)).toEqual([['Camp Tab · Anna · Drinks: Lion Lager, Cocktail', 2600, 2]]);
});

test('camp tab: Bill shows what is still to pay, and its «Mark paid» pays every line into the ledger', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Bill Guest');
  await cat(frame, 'Drinks'); await tap(frame, 'Cocktail'); await tap(frame, 'Soft Drink');
  await frame.evaluate(() => { const g = findConsumer(AG, currentRoster); payItem(g.items.findIndex(i => i.n === 'Soft Drink' && !i.paidAt)); });
  await expect.poll(() => revenue(ctl).length).toBe(1);
  await frame.locator('.c-btn-bill').click();
  await expect(frame.locator('#billOv .bill-total-box')).toContainText('LKR 2,000');
  await frame.locator('#billPayBtn').click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Bill Guest · Drinks: Cocktail, Soft Drink', 2400, 2]]);
  const items = await frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => !!i.paidAt));
  expect(items).toEqual([true, true]);
});

test('camp tab: if the ledger row cannot be saved, the line goes back to unpaid (no money lost silently)', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Flaky');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager');
  ctl.fail = (t, method) => t === 'ledger_entries' && method === 'POST';
  await frame.locator('#payBtn').click();
  await expect.poll(() => frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => !!i.paidAt))).toEqual([false]);
  expect(revenue(ctl)).toEqual([]);
  ctl.fail = null;
  await frame.locator('#payBtn').click();
  await expect.poll(() => revenue(ctl).length).toBe(1);
});

test('camp tab: «Dr House Transfer» is Transport revenue; staff buy at the staff price; tours stay Tours', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Tours'); await tap(frame, 'Dr House Transfer'); await tap(frame, 'River Safari');
  await frame.locator('#payBtn').click();
  await expect.poll(() => revenue(ctl).length).toBe(2);
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Jude');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager');
  await frame.locator('#payBtn').click();
  await expect.poll(() => revenue(ctl).length).toBe(3);
  const rows = revenue(ctl).map(r => [r.description, Number(r.amount_local), r.category, r.business_area, r.linked_item || '', r.payment_method, r.type]).sort();
  expect(rows).toEqual([
    ['Camp Tab · Anna · Dr House Transfer', 3000, 'Transport', 'Transport', 'Dr House Transfer', 'Cash', 'revenue'],
    ['Camp Tab · Anna · River Safari', 6000, 'Tours', 'Tours', 'River Safari', 'Cash', 'revenue'],
    ['Camp Tab · Jude · Drinks: Lion Lager', 300, 'Drinks', 'Bar', '', 'Cash', 'revenue'],
  ]);
});

test('camp tab: a custom price is labelled in LKR, never «€»', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Drinks');
  await discount(frame, 'Cocktail');
  await frame.locator('#discountCustomPrice').fill('777');
  await frame.locator('#discountCustomApply').click();
  const meta = (await row(frame, 'Cocktail').locator('.ctr-time').innerText()).replace(/\s/g, ' ');
  expect(meta).toContain('LKR 777');
  expect(meta).not.toContain('€');
});

test('camp tab: History lists closed staff too, and they can be re-opened', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await frame.locator('#rosterStaffBtn').click();
  await addConsumer(frame, 'Jude');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager');
  await frame.locator('#payBtn').click();
  await frame.locator('#closeGuestBtn').click();
  await frame.locator('.snav-btn[data-sub="history"]').click();
  await expect(frame.locator('#histList')).toContainText('Jude');
  await expect(frame.locator('#histList')).toContainText('LKR 300');
  await frame.locator('#histList button', { hasText: 'Re-open' }).click();
  await frame.locator('.snav-btn[data-sub="charge"]').click();
  await expect(frame.locator('#glist')).toContainText('Jude');
});

test('camp tab: merch stock counts down for «T-Shirt 2XL» and «Zink Stick» like the other T-shirts', async ({ page }) => {
  const { frame } = await openCampTab(page);
  await addConsumer(frame, 'Anna');
  await cat(frame, 'Merch');
  const card = (n) => frame.locator(`#itemGrid .c-item:has(.ci-name:text-is("${n}"))`);
  await expect(card('T-Shirt 2XL')).toContainText('19 left');
  await expect(card('Zink Stick')).toContainText('38 left');
  await tap(frame, 'T-Shirt 2XL'); await tap(frame, 'Zink Stick');
  await expect(card('T-Shirt 2XL')).toContainText('18 left');
  await expect(card('Zink Stick')).toContainText('37 left');
  await expect(card('T-Shirt M')).toContainText('54 left'); // 2XL does not borrow from M or XL
});

test('camp tab: a phone without crypto.randomUUID still gives every guest added at once its own id', async ({ page }) => {
  await page.addInitScript(() => { try { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }); } catch (_) {} });
  const { ctl, frame } = await openCampTab(page);
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill('Ana\nBea\nCarla');
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
  const ids = await frame.evaluate(() => visibleRoster(currentWeek(), 'guests').map(g => g.id));
  expect(ids.length).toBe(3);
  expect(new Set(ids).size).toBe(3);
  await expect.poll(() => (ctl.T.camp_guests || []).map(g => g.name).sort()).toEqual(['Ana', 'Bea', 'Carla']);
});

test('camp tab: Activity reads the time an item was added as Sri Lanka time («2h ago», not «just now»)', async ({ page }) => {
  const guest = { id: '0000c47a-0000-4000-8000-0000000000a1', week_id: WEEK, location_id: LOC, name: 'Old Timer', is_staff: false, paid: false, paid_at: null, closed_at: null, pax: 1, sort_order: 10, meta: {} };
  // added 2 hours ago, written the way buildCampTabSyncRows writes it: the
  // Sri Lanka wall-clock date + time followed by «Z»
  const colombo = new Date(Date.now() - 2 * 3600e3 + 5.5 * 3600e3);
  const addedAt = `${colombo.toISOString().slice(0, 16)}:00.000Z`;
  const item = { id: '0000c47a-0000-4000-8000-0000000000b1', guest_id: guest.id, week_id: WEEK, location_id: LOC, category: 'Drinks', item_name: 'Lion Lager', qty: 1, price_local: 600, currency: 'LKR', added_at: addedAt, price_type: 'regular', sort_order: 10, meta: { time: addedAt.slice(11, 16) }, paid_at: null };
  const { frame } = await openCampTab(page, { camp_guests: [guest], camp_tab_items: [item] });
  await frame.locator('.snav-btn[data-sub="activity"]').click();
  await expect(frame.locator('#acBody')).toContainText('Lion Lager');
  await expect(frame.locator('#acBody')).toContainText('2h ago');
});

test('camp tab: opening the hub never deletes the staff list, and an unchanged menu is not deleted and rewritten', async ({ page }) => {
  const staffRow = { id: '0000c47a-0000-4000-8000-0000000000c1', location_id: LOC, name: 'Jude', active: true, sort_order: 10 };
  const { ctl, frame } = await openCampTab(page, { camp_staff_directory: [staffRow] });
  await page.waitForTimeout(2500);
  expect(ctl.writes.filter(([m, t]) => m === 'DELETE' && t === 'camp_staff_directory')).toEqual([]);
  expect(ctl.T.camp_staff_directory.map(r => r.name)).toEqual(['Jude']);
  // second boot: location_menus already holds this exact menu → no DELETE-all
  ctl.writes.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
  const f2 = await fh.contentFrame();
  await f2.waitForFunction(() => { try { return campTabBootstrapped === true && (MENU.Drinks || []).some(i => i.n === 'Lion Lager'); } catch (_) { return false; } }, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  expect(ctl.writes.filter(([m, t]) => m === 'DELETE' && ['location_menus', 'camp_staff_directory'].includes(t))).toEqual([]);
  expect(ctl.T.location_menus.some(r => r.item_name === 'Lion Lager' && Number(r.price_local) === 600)).toBe(true);
  void frame;
});

test('camp tab: the menu copy (location_menus) keeps the Staff price and «no stock count» — a tablet that loads the copy still sells to staff (15 Nov 2026)', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await frame.evaluate(async () => { _menuRowsKey = null; await syncCampTabMenuToSupabase(); });
  const pick = n => { const r = (ctl.T.location_menus || []).find(x => x.item_name === n); return r && [r.stock_qty, r.staff_price_local]; };
  expect(pick('Soft Drink')).toEqual([null, 200]);   // unlimited stays unlimited (was 0 → «Out of stock»)
  expect(pick('Lion Lager')).toEqual([50, 300]);
  expect(pick('Cocktail')).toEqual([null, 1000]);
  expect(pick('Zink Stick')).toEqual([38, null]);    // no Staff alt → no staff price
  // a device that boots from the copy alone: Staff tab still lists the drinks, guests can buy a Soft Drink
  const fromCopy = await frame.evaluate(rows => { const m = menuRowsToState(rows);
    // the Staff tab's own rule (renderItemGrid): an item shows when it has a Staff alt or an sp
    const staff = (m.Drinks || []).filter(i => isStaffAltLabel(i) || (i?.sp != null && Number.isFinite(Number(i?.sp)))).map(i => i.n);
    return { staff, soft: (m.Drinks || []).find(i => i.n === 'Soft Drink') }; }, ctl.T.location_menus);
  expect(fromCopy.staff).toEqual(expect.arrayContaining(['Soft Drink', 'Lion Lager', 'Cocktail', 'Shot']));
  expect(fromCopy.soft.stk).toBeUndefined();
  expect(fromCopy.soft.sp).toBe(200);
});

// ── Grouped checkout lines (Miguel, 15 Nov 2026: «nos checkouts gera muitas
// linhas… 1 cerveja em cada linha») ─────────────────────────────────────────
test('checkout lines: Pay all writes ONE line per product group — drinks itemised, tours / merch per product with qty', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Max');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager'); await tap(frame, 'Lion Lager'); await tap(frame, 'Cocktail');
  await cat(frame, 'Tours'); await tap(frame, 'River Safari'); await tap(frame, 'River Safari');
  await cat(frame, 'Merch'); await tap(frame, 'T-Shirt M'); await tap(frame, 'T-Shirt M');
  const posts = () => ctl.writes.filter(([m, t]) => m === 'POST' && t === 'ledger_entries').length;
  const before = posts();
  await frame.locator('#payBtn').click(); // «Pay all (7)»
  await expect.poll(() => lines(ctl)).toEqual([
    ['Camp Tab · Max · Drinks: Lion Lager ×2, Cocktail', 3200, 3],
    ['Camp Tab · Max · River Safari ×2', 12000, 2],
    ['Camp Tab · Max · T-Shirt M ×2', 18000, 2],
  ]);
  // 7 paid lines → one batch write, not 7
  expect(posts() - before).toBe(1);
  const meta = revenue(ctl).map(r => [r.category, r.business_area, r.linked_item || '', r.source_kind, r.currency]).sort();
  expect(meta).toEqual([
    ['Drinks', 'Bar', '', 'camp_tab_per_guest', 'LKR'],
    ['Merchandise', 'Merch', 'T-Shirt M', 'camp_tab_per_guest', 'LKR'],
    ['Tours', 'Tours', 'River Safari', 'camp_tab_per_guest', 'LKR'],
  ]);
  // the id is the deterministic guest × day × group key
  const expected = await page.evaluate(() => {
    const g = findCampTabStateGuest({ name: 'Max', id: campTabStateConsumers().find(x => x.name === 'Max').id });
    const day = String(g.items[0].paidAt).slice(0, 10);
    return g.items.map(i => campTabCheckoutId(campTabGuestKey(g), day, campTabCheckoutGroup(i)));
  });
  expect([...new Set(expected)].sort()).toEqual(revenue(ctl).map(r => r.id).sort());
  // per-item analytics still have every line in camp_tab_items
  await expect.poll(() => (ctl.T.camp_tab_items || []).filter(r => r.paid_at).length).toBe(7);
});

test('checkout lines: a re-sync never duplicates — old one-row-per-item lines stay as they are and stay out of the group', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Lea');
  await cat(frame, 'Drinks'); await tap(frame, 'Lion Lager');
  // A beer paid BEFORE this change: its own campitem_ row, written the old way.
  const old = await frame.evaluate(() => { const g = findConsumer(AG, currentRoster); const it = g.items[0]; it.paidAt = new Date().toISOString(); save();
    return { guest: { id: g.id, name: g.name }, item: { id: it.id, c: it.c, n: it.n, p: Number(it.p) }, date: it.paidAt.slice(0, 10) }; });
  await page.evaluate(async (o) => { await upsertClosedWeekIncome([buildPaidItemRevenueEntry(o.guest, o.item, { date: o.date })]); }, old);
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Lea · Lion Lager', 600, 1]]);
  // A second beer today, paid now → grouped line with ONLY the new beer.
  await tap(frame, 'Lion Lager');
  await frame.locator('#payBtn').click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Lea · Drinks: Lion Lager', 600, 1], ['Camp Tab · Lea · Lion Lager', 600, 1]]);
  const ids = revenue(ctl).map(r => r.id).sort();
  // Re-sync: every paid message sent again, twice.
  await frame.evaluate(() => { const g = findConsumer(AG, currentRoster);
    for (let k = 0; k < 2; k++) g.items.forEach(it => window.parent.postMessage({ type: 'camp-tab-item-paid', guest: { id: g.id, name: g.name }, item: { id: it.id, c: it.c, n: it.n, p: Number(it.p) }, date: String(it.paidAt).slice(0, 10) }, '*')); });
  await page.waitForTimeout(1200);
  expect(lines(ctl)).toEqual([['Camp Tab · Lea · Drinks: Lion Lager', 600, 1], ['Camp Tab · Lea · Lion Lager', 600, 1]]);
  expect(revenue(ctl).map(r => r.id).sort()).toEqual(ids);
  // Un-paying the OLD beer removes its own row; the grouped line is untouched.
  await frame.evaluate(() => { window.confirm = () => true; const g = findConsumer(AG, currentRoster); unpayItemOnGuest(g, 0); });
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Lea · Drinks: Lion Lager', 600, 1]]);
});

test('checkout lines: deleting a grouped line in the Operations Ledger takes «Paid» back on every line it carried', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Zoe');
  await cat(frame, 'Drinks'); await tap(frame, 'Soft Drink'); await tap(frame, 'Cocktail');
  await frame.locator('#payBtn').click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Zoe · Drinks: Soft Drink, Cocktail', 2400, 2]]);
  const id = revenue(ctl)[0].id;
  await page.evaluate((x) => delLedger(x), id);
  await expect.poll(() => frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => !!i.paidAt))).toEqual([false, false]);
  await page.waitForTimeout(800);
  expect(revenue(ctl)).toEqual([]); // and nothing brings it back
});

test('checkout lines (Morocco, MAD — no bar tab): tours per product with qty, merch per product', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page, {}, { id: LOC, name: 'Morocco', slug: 'morocco', currency: 'MAD', default_fx_to_eur: 10.8, camp_tab_mode: 'per_guest' });
  await addConsumer(frame, 'Omar');
  await cat(frame, 'Tours'); await tap(frame, 'River Safari'); await tap(frame, 'River Safari');
  await cat(frame, 'Merch'); await tap(frame, 'T-Shirt M');
  await frame.locator('#payBtn').click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Omar · River Safari ×2', 12000, 2], ['Camp Tab · Omar · T-Shirt M', 9000, 1]]);
  expect([...new Set(revenue(ctl).map(r => r.currency))]).toEqual(['MAD']);
});

test('checkout lines: deleting a paid line (This week card) rebuilds the group without it, even though the message comes before the delete', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Ines');
  await cat(frame, 'Drinks'); await tap(frame, 'Soft Drink'); await tap(frame, 'Cocktail'); await tap(frame, 'Cocktail');
  await frame.locator('#payBtn').click();
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Ines · Drinks: Soft Drink, Cocktail ×2', 4400, 3]]);
  await frame.evaluate(() => { const g = findConsumer(AG, currentRoster); deleteGuestItem(g.id, g.items.findIndex(i => i.n === 'Cocktail')); });
  await expect.poll(() => lines(ctl)).toEqual([['Camp Tab · Ines · Drinks: Soft Drink, Cocktail', 2400, 2]]);
  // a whole guest deleted from the week: the line goes, by guest id
  await frame.evaluate(() => { window.confirm = () => true; deleteGuest(findConsumer(AG, currentRoster).id); });
  await expect.poll(() => revenue(ctl).length).toBe(0);
});
