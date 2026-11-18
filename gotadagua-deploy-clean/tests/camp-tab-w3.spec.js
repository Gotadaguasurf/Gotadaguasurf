// Camp Tab — audit of 18 Nov 2026 (CT-01 / UXC-04 / SEC-08, CT-02, CT-05, CT-07).
// The real screen inside the camp hub with a stubbed Supabase (tests/camp-tab-w3-helpers.js):
// nothing leaves the machine, and camp-tab-inner.html is never opened on its own.
const { test, expect } = require('@playwright/test');
const { LOC, WEEK, uuid, catalog, BASE_CATALOG, guestRow, itemRow, openCampTab, addConsumer, cat, tap, sub, revenue } = require('./camp-tab-w3-helpers');

test.use({ timezoneId: 'Asia/Colombo', viewport: { width: 1280, height: 900 } });

// ── CT-01 / UXC-04 / SEC-08 — a name is text, never HTML ─────────────────────────────────
// Three places a name can land: HTML text, an attribute value, and a JS string inside onclick="…".
const BUMP = 'top.__xss=(top.__xss||0)+1';
const IMG = `<img src=x onerror="${BUMP}">`;          // text
const ATTR = `" onmouseover="${BUMP}" x="`;           // attribute
const JS_Q = `');${BUMP};//`;                         // JS string, plain quote
const JS_ENT = `&#39;);${BUMP};//`;                   // JS string, quote as an HTML entity
const G_NAME = `Zed ${IMG}`;
const STAFF_NAME = `Sam ${ATTR}${IMG}`;
const CLOSED_NAME = `Old ${IMG}`;
const P_QUOTES = `Rum "Old" & 'Dark'`;
const P_JS = `Gin${JS_ENT}`;
const P_JS2 = `Vodka${JS_Q}`;
const P_HTML = `Tea ${IMG}`;
const WHO = `Host ${ATTR}${IMG}`;
const LINE_CAT = `Snacks ${IMG}`;

function hostileSeed() {
  const g = uuid('9e57', 1);
  return {
    pricing_catalog: catalog([...BASE_CATALOG,
      [P_QUOTES, 'Drinks', 700, 300, 'Staff', null, `note ${IMG}`], [P_JS, 'Drinks', 800, 300, 'Staff', null], [P_JS2, 'Drinks', 900, 300, 'Staff', null],
      [P_HTML, 'Merch', 500, 250, `Offer ${ATTR}${IMG}`, 5, `desc ${IMG}`]]),
    camp_guests: [guestRow(1, G_NAME), guestRow(2, STAFF_NAME, { is_staff: true }), guestRow(3, CLOSED_NAME, { closed_at: '2026-06-09T10:00:00.000Z' })],
    camp_tab_items: [
      itemRow(1, g, P_HTML, LINE_CAT, 500, { created_by: 'u-x', updated_by: 'u-y', meta: { time: '14:05', staffNote: `note ${IMG}` } }),
      itemRow(2, g, `Free ${IMG}`, 'Drinks', 0, { price_type: 'Gift', created_by: 'u-x',
        meta: { time: '14:06', staffNote: `Free · ${IMG}`, comp_reason: 'other', comp_note: `why ${IMG}`, list_price: 600, offer_from: { p: 600, priceType: 'regular' }, comp_at: '2026-06-08T09:00:00.000Z', comp_by_name: WHO } }),
      itemRow(3, uuid('9e57', 3), `Paid ${IMG}`, 'Drinks', 600, { paid_at: '2026-06-09T09:00:00.000Z', meta: { time: '10:00', staffNote: `s ${IMG}` } }),
      itemRow(4, uuid('9e57', 2), `Staff ${IMG}`, 'Drinks', 300, { price_type: 'staff' }),
    ],
    platform_profiles: [{ id: 'u-x', full_name: WHO, email: 'x@example.com' }, { id: 'u-y', full_name: `Editor ${IMG}`, email: 'y@example.com' }],
  };
}
// Nothing ran, nothing was injected: no flag in either window, no <img src=x>, no handler attribute carrying the payload.
async function expectInert(page, frame, where) {
  expect(await page.evaluate(() => window.__xss || 0), `script ran (${where})`).toBe(0);
  expect(await frame.locator('img[src="x"]').count(), `<img> injected (${where})`).toBe(0);
  expect(await frame.locator('[onmouseover], [x=""]').count(), `attribute injected (${where})`).toBe(0);
  expect(await frame.evaluate(() => [...document.querySelectorAll('[onclick]')].filter(e => { try { new Function(e.getAttribute('onclick')); return false; } catch (_) { return true; } }).length), `broken onclick (${where})`).toBe(0);
}

test('CT-01: guest, staff, product, category and note text is shown as text everywhere — no markup, no script, every button still works', async ({ page }) => {
  test.setTimeout(90_000);
  const { ctl, frame } = await openCampTab(page, hostileSeed());
  const g1 = uuid('9e57', 1);

  // Charge: guest list, category pills, product cards, the tab
  await expectInert(page, frame, 'guest list');
  await expect(frame.locator('#glist .c-guest-name').first()).toHaveText(G_NAME);
  await frame.evaluate((id) => selGuest(id), g1);
  await expect(frame.locator('#tabList .ctr-name', { hasText: 'Tea' })).toHaveText(P_HTML);
  await expect(frame.locator('#tabList .ctr-time').last()).toContainText(LINE_CAT);
  await cat(frame, 'Drinks');
  await expectInert(page, frame, 'drinks');
  // a product named with quotes (and one that tries to close the onclick string) is still added by one tap, name intact
  for (const p of [P_QUOTES, P_JS, P_JS2]) {
    await tap(frame, p);
    await expect.poll(() => frame.evaluate(() => findConsumer(AG, 'guests').items.map(i => i.n))).toContain(p);
    await expect(frame.locator('#tabList .ctr-name').filter({ hasText: p.slice(0, 3) }).first()).toHaveText(p);
  }
  await expectInert(page, frame, 'after taps');
  // the «%» button of the quoted product opens its modal with the same name
  await frame.locator('#itemGrid .c-item').filter({ has: frame.locator('.ci-name', { hasText: 'Rum' }) }).locator('button[title^="Give"]').click();
  await expect(frame.locator('#discountModal')).toContainText(P_QUOTES);
  await frame.locator('#discountClose').click();
  await cat(frame, 'Merch');
  await expect(frame.locator('#itemGrid .ci-name', { hasText: 'Tea' })).toHaveText(P_HTML);
  await expect(frame.locator('#itemGrid .ci-desc', { hasText: 'desc' })).toHaveText(`desc ${IMG}`);
  await expectInert(page, frame, 'merch (alt label, description)');
  // a category that carries markup (location_menus is editable by the location's staff)
  await frame.evaluate((c) => { MENU[c] = [{ id: 'x1', n: 'Crisps', p: 100 }]; renderAllCampTabViews(); }, LINE_CAT);
  await expect(frame.locator('#catTabs button').last()).toHaveText(LINE_CAT);
  await frame.locator('#catTabs button').last().click();
  await expect(frame.locator('#itemGrid .ci-name')).toHaveText('Crisps');
  await expectInert(page, frame, 'category pill');
  // Bill
  await frame.locator('.c-btn-bill').click();
  await expect(frame.locator('#billBody')).toContainText(P_HTML);
  await expectInert(page, frame, 'bill');
  await frame.evaluate(() => closeOv('billOv'));
  // Staff roster
  await frame.locator('#rosterStaffBtn').click();
  await expect(frame.locator('#glist .c-guest-name').first()).toHaveText(STAFF_NAME);
  await frame.locator('#glist .c-guest').first().click();
  await expectInert(page, frame, 'staff');
  await frame.locator('#rosterGuestsBtn').click();
  // This week (expanded card: lines, notes, who added it in the title)
  await sub(frame, 'week');
  await frame.evaluate((id) => toggleTwExpand(id), g1);
  await expect(frame.locator('#twList .tw-card-name').first()).toHaveText(G_NAME);
  expect(await frame.locator(`#twList .tw-item-row[data-item="${uuid('17e3', 1)}"]`).getAttribute('title')).toContain(`Added by ${WHO} · `);
  expect(await frame.locator(`#twList .tw-item-row[data-item="${uuid('17e3', 2)}"] .ct-undo-offer`).getAttribute('title')).toContain(` by ${WHO}`);
  await expectInert(page, frame, 'this week');
  await frame.locator('#twSearch').fill(`"><img src=x onerror="${BUMP}">`);
  await expectInert(page, frame, 'this week search');
  await frame.locator('#twSearch').fill('');
  // History (closed guest, expanded)
  await sub(frame, 'history');
  await frame.evaluate((id) => toggleHistPerGuest(id), uuid('9e57', 3));
  await expect(frame.locator('#histList .hw-title').first()).toHaveText(CLOSED_NAME);
  await expect(frame.locator('#histList .hw-item-line').first()).toContainText(`Paid ${IMG}`);
  await frame.locator('#histList input.search').fill(`"><img src=x onerror="${BUMP}">`);
  await expectInert(page, frame, 'history');
  // Top sellers + Given free
  await sub(frame, 'sellers');
  await expect(frame.locator('#tsBody .ts-name').filter({ hasText: 'Tea' })).toHaveText(P_HTML);
  await frame.evaluate(() => setCompsPeriod('all'));
  await expect(frame.locator('#cpLines')).toContainText(`why ${IMG}`);
  await expectInert(page, frame, 'top sellers / given free');
  // Activity (who, item, guest, category, the two filters)
  await sub(frame, 'activity');
  await frame.locator('#acPeriod').selectOption('all');
  await expect(frame.locator('#acBody .ac-what').first()).toContainText('added');
  await expect(frame.locator('#acBody')).toContainText(WHO);
  await expect(frame.locator('#acCat option').last()).toHaveText(LINE_CAT);
  await expectInert(page, frame, 'activity');
  // Menu settings
  await frame.evaluate(() => openMenuSettings());
  await frame.evaluate(() => pickMenuCategory('Merch'));
  await expect(frame.locator('#menuItemList .menu-item-name').filter({ hasText: 'Tea' })).toContainText(P_HTML);
  await expectInert(page, frame, 'menu settings');
  await frame.evaluate(() => closeOv('menuOv'));

  // What is stored stays the name as typed (the ledger matches lines by name): escaping is for the screen only.
  await sub(frame, 'charge');
  await addConsumer(frame, 'Ana <b>B</b> & "Co"');
  await expect(frame.locator('#chargeGuestName')).toHaveText('Ana <b>B</b> & "Co"');
  await expect.poll(() => ctl.T.camp_guests.map(r => r.name)).toContain('Ana <b>B</b> & "Co"');
  await expect.poll(() => ctl.T.camp_tab_items.map(r => r.item_name)).toEqual(expect.arrayContaining([P_QUOTES, P_JS, P_JS2]));
  await expectInert(page, frame, 'end');
});
