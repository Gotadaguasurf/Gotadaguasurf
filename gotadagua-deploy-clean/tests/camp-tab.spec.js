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
async function stub(page, tables) {
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
    if (t === 'locations') return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' });
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

async function openCampTab(page, extra = {}) {
  const ctl = await stub(page, {
    pricing_catalog: CATALOG, ledger_entries: [], location_state_store: [], location_menus: [], camp_staff_directory: [],
    camp_weeks: [{ id: WEEK, location_id: LOC, start_date: '2026-06-07', end_date: '2026-06-13', status: 'open', closed_at: null, draft_kind: null, meta: { label: null, source: null } }],
    camp_guests: [], camp_tab_items: [], ...extra,
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 20000 });
  const fh = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 20000 });
  const frame = await fh.contentFrame();
  await frame.waitForFunction(() => { try { return campTabBootstrapped === true && !!S.activeWeek && (MENU.Drinks || []).some(i => i.n === 'Lion Lager'); } catch (_) { return false; } }, null, { timeout: 20000 });
  await page.evaluate(() => showPage('pos'));
  await page.waitForTimeout(800);
  return { ctl, frame };
}
const revenue = (ctl) => (ctl.T.ledger_entries || []).filter(r => r.source_kind === 'camp_tab_per_item');
async function addConsumer(frame, name) {
  await frame.locator('#addConsumerBtn').click();
  await frame.locator('#newGuestName').fill(name);
  await frame.locator('#addGuestOv button', { hasText: 'Add' }).last().click();
}
const cat = (frame, label) => frame.locator('#catTabs button', { hasText: label }).first().click();
const tap = (frame, name) => frame.locator(`#itemGrid button:has(.ci-name:text-is("${name}"))`).first().click();
const discount = (frame, name) => frame.locator(`#itemGrid .c-item:has(.ci-name:text-is("${name}")) button[title^="Give"]`).first().click();
const row = (frame, name) => frame.locator(`#tabList .c-tab-row:has(.ctr-name:text-is("${name}"))`);

test('camp tab: un-paying one of two identical beers removes ONE ledger row, not both', async ({ page }) => {
  const { ctl, frame } = await openCampTab(page);
  await addConsumer(frame, 'Marie');
  await cat(frame, 'Drinks'); await tap(frame, 'Soft Drink'); await tap(frame, 'Soft Drink');
  await frame.locator('#payBtn').click(); // «Pay all (2)»
  await expect.poll(() => revenue(ctl).length).toBe(2);
  await row(frame, 'Soft Drink').first().locator('button', { hasText: 'Mark unpaid' }).click();
  await page.waitForTimeout(1200);
  expect(revenue(ctl).map(r => [r.description, Number(r.amount_local)])).toEqual([['Camp Tab · Marie · Soft Drink', 400]]);
  // the line still paid keeps its own row
  const stillPaid = await frame.evaluate(() => findConsumer(AG, 'guests').items.filter(i => i.paidAt).map(i => i.id));
  expect(stillPaid.length).toBe(1);
  expect(revenue(ctl)[0].description).toBe('Camp Tab · Marie · Soft Drink');
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
  await page.waitForTimeout(1200);
  expect(revenue(ctl).map(r => [r.description, Number(r.amount_local)])).toEqual([['Camp Tab · Jules · Cocktail', 2000]]);
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
  await expect.poll(() => revenue(ctl).length).toBe(2);
  await expect(frame.locator('#payState')).toBeVisible();
  await expect(frame.locator('#glist .c-guest .c-gpaid')).toHaveCount(1);
  await frame.locator('.snav-btn[data-sub="week"]').click();
  head = (await frame.locator('#twHeader .tw-header-row').innerText()).replace(/[^\S\n]/g, ' ');
  expect(head).toContain('LKR 2,600\nCOLLECTED');
  expect(head).not.toContain('OUTSTANDING');
  await expect(frame.locator('#twList .tw-card .badge').first()).toHaveText('Paid');
  // the gift wrote no revenue row
  expect(revenue(ctl).map(r => r.description).sort()).toEqual(['Camp Tab · Anna · Cocktail', 'Camp Tab · Anna · Lion Lager']);
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
  await expect.poll(() => revenue(ctl).length).toBe(2);
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
    ['Camp Tab · Jude · Lion Lager', 300, 'Drinks', 'Bar', '', 'Cash', 'revenue'],
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
