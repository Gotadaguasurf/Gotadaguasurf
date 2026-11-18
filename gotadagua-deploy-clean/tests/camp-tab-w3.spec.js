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

// ── CT-02 — the search boxes keep the keyboard ───────────────────────────────────────────
// History and This week rebuilt their own <input> on every keystroke (and on every save or
// realtime update), so the box lost focus after one letter. Typed letter by letter here:
// fill() would pass on the broken code.
test('CT-02: History and This week search keep focus while typing — same input node, also across a re-render', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const guests = []; const items = [];
  for (let i = 1; i <= 12; i++) guests.push(guestRow(i, `Guest ${i}`));
  for (let i = 1; i <= 12; i++) guests.push(guestRow(20 + i, `Closed ${i}`, { closed_at: `2026-06-09T10:${String(i).padStart(2, '0')}:00.000Z` }));
  items.push(itemRow(1, uuid('9e57', 2), 'Lion Lager', 'Drinks', 600));
  const { frame } = await openCampTab(page, { camp_guests: guests, camp_tab_items: items });
  const typeInto = async (sel, text) => {
    const box = frame.locator(sel);
    await box.click();
    await box.evaluate((el) => { el.__kept = true; });
    await box.pressSequentially(text, { delay: 30 });
    return box;
  };
  const kept = (sel) => frame.evaluate((s) => { const el = document.querySelector(s); return { same: el.__kept === true, focused: document.activeElement === el, value: el.value }; }, sel);

  await sub(frame, 'week');
  await typeInto('#twSearch', 'Guest 2');
  expect(await kept('#twSearch')).toEqual({ same: true, focused: true, value: 'Guest 2' });
  await expect(frame.locator('#twList .tw-card-name')).toHaveText(['Guest 2']);
  // a save / realtime update while typing redraws the page: the box and what was typed stay
  await frame.evaluate(() => renderAllCampTabViews());
  expect(await kept('#twSearch')).toEqual({ same: true, focused: true, value: 'Guest 2' });
  // the rest of the header still follows the data: roster switch and the Collected / Outstanding figures
  await expect(frame.locator('#twHeader .tw-stat-label')).toHaveText(['Collected', 'Outstanding']);
  await frame.locator('#twHeader button', { hasText: 'Staff' }).click();
  await expect(frame.locator('#twSearch')).toHaveAttribute('placeholder', 'Search staff...');
  await expect(frame.locator('#twHeader button', { hasText: 'Staff' })).toHaveClass(/active/);
  await frame.locator('#twHeader button', { hasText: 'Guests' }).click();
  await frame.locator('#twSearch').fill('');
  await expect(frame.locator('#twList .tw-card-name')).toHaveCount(12);

  await sub(frame, 'history');
  await typeInto('#histSearch', 'Closed 1');
  expect(await kept('#histSearch')).toEqual({ same: true, focused: true, value: 'Closed 1' });
  await expect(frame.locator('#histList .hw-title')).toHaveText(['Closed 12', 'Closed 11', 'Closed 10', 'Closed 1']);   // newest closed first
  await frame.evaluate(() => renderAllCampTabViews());
  expect(await kept('#histSearch')).toEqual({ same: true, focused: true, value: 'Closed 1' });
  await frame.locator('#histSearch').pressSequentially('2');
  await expect(frame.locator('#histList .hw-title')).toHaveText(['Closed 12']);
  await expect(frame.locator('#histList .tw-stat-val').last()).toHaveText('12');   // the counters next to the box are still there
  // a row of the filtered list still opens
  await frame.locator('#histList .hw-title').click();
  await expect(frame.locator('#histList .hist-week-body')).toBeVisible();
  expect((await kept('#histSearch')).value).toBe('Closed 12');
  // nothing matches → the message, and the box is still there to correct the search
  await frame.locator('#histSearch').press('End');
  await frame.locator('#histSearch').pressSequentially('zz');
  await expect(frame.locator('#histList')).toContainText('No closed guests match your search.');
  expect(await kept('#histSearch')).toEqual({ same: true, focused: true, value: 'Closed 12zz' });
});

// ── CT-05 — lines taken off a tab are visible ────────────────────────────────────────────
// A removed line is deleted from camp_tab_items; the delete trigger keeps a copy in audit_log
// (the stub does the same). Activity shows it next to the lines added, with who and when.
test('CT-05: Activity shows lines removed from a tab (who, what, guest, when, price struck), a deleted guest as one event, and filters apply', async ({ page }) => {
  test.setTimeout(90_000);
  const g1 = uuid('9e57', 1); const g2 = uuid('9e57', 2); const gone = uuid('9e57', 9);
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const del = (n, at, row, table = 'camp_tab_items', actor = 'u-host') => ({ id: `seed-${n}`, at, actor_id: actor, actor_email: 'x@example.com', table_name: table, action: 'DELETE', row_id: String(row.id), deleted_row: row });
  const audit_log = [
    del(1, ago(10), itemRow(51, g2, 'Cocktail', 'Drinks', 2000, { added_at: '2026-06-08T21:40:00.000Z' })),
    del(2, ago(60), itemRow(52, gone, 'Shot', 'Drinks', 1000)),
    del(3, ago(60), itemRow(53, gone, 'T-Shirt M', 'Merch', 9000)),
    del(4, ago(60), guestRow(9, `Gone ${IMG}`), 'camp_guests'),
    del(5, ago(30), itemRow(54, g1, `Paid ${IMG}`, 'Drinks', 600, { paid_at: '2026-06-08T10:00:00.000Z' }), 'camp_tab_items', 'u-other'),
    del(6, ago(5), itemRow(55, g1, 'Other camp', 'Drinks', 700, { location_id: '00000000-0000-4000-8000-00000000abcd' })),
  ];
  const { ctl, frame } = await openCampTab(page, {
    camp_guests: [guestRow(1, 'Guest 1'), guestRow(2, 'Guest 2')],
    camp_tab_items: [itemRow(1, g1, 'Lion Lager', 'Drinks', 600, { created_by: 'u-host' })],
    audit_log,
    platform_profiles: [{ id: 'u-host', full_name: 'Sample Host', email: 'h@example.com' }, { id: 'u-other', full_name: `Other ${IMG}`, email: 'o@example.com' }, { id: 'u1', full_name: 'Owner Test', email: 'u1@example.com' }],
  });
  await sub(frame, 'activity');
  await frame.locator('#acPeriod').selectOption('all');
  const removed = frame.locator('#acBody .ac-row-removed');
  await expect(removed).toHaveCount(3);
  await expect(removed.nth(0)).toContainText('Sample Host removed Cocktail from Guest 2');
  await expect(removed.nth(0)).toContainText('Drinks · removed 10 min ago · added 8 Jun, 21:40');
  await expect(removed.nth(0).locator('s')).toHaveText('LKR 2000');
  await expect(removed.nth(1)).toContainText(`Other ${IMG} removed Paid ${IMG} from Guest 1`);
  await expect(removed.nth(1)).toContainText('was paid');
  await expect(removed.nth(2)).toContainText(`Sample Host deleted guest Gone ${IMG} with 2 lines`);
  await expect(removed.nth(2)).toContainText('Shot, T-Shirt M');
  await expect(removed.nth(2).locator('s')).toHaveText('LKR 10000');
  await expect(frame.locator('#acBody')).not.toContainText('Other camp');
  // the live figures keep meaning the lines on the tabs; removed lines are counted apart
  await expect(frame.locator('#acBody .ac-row:not(.ac-row-removed)')).toHaveCount(1);
  await expect(frame.locator('#acBody')).toContainText('1 items');
  await expect(frame.locator('#acRemovedSum')).toHaveText('4 removed (LKR 12,600)');
  await expectInert(page, frame, 'activity removed');
  // filters: category, then staff
  await frame.locator('#acCat').selectOption('Merch');
  await expect(removed).toHaveCount(1);
  await expect(frame.locator('#acRemovedSum')).toHaveText('1 removed (LKR 9,000)');
  await frame.locator('#acCat').selectOption('all');
  await frame.locator('#acStaff').selectOption('u-other');
  await expect(removed).toHaveCount(1);
  await expect(removed.first()).toContainText('was paid');
  await frame.locator('#acStaff').selectOption('all');

  // a line removed now with the × on Charge shows up after Refresh
  await sub(frame, 'charge');
  await frame.evaluate((id) => selGuest(id), g1);
  await frame.locator('#tabList .ctr-del').first().click();
  await expect.poll(() => (ctl.T.audit_log || []).filter(r => r.deleted_row?.item_name === 'Lion Lager').length).toBe(1);
  await sub(frame, 'activity');
  await frame.locator('#sub-activity button', { hasText: 'Refresh' }).click();
  await expect(removed.first()).toContainText('Owner Test removed Lion Lager from Guest 1');
  await expect(removed.first()).toContainText('removed just now');
});

test('CT-05: without access to removed lines (or on an error) Activity still shows the lines added', async ({ page }) => {
  const g1 = uuid('9e57', 1);
  const { ctl, frame } = await openCampTab(page, {
    camp_guests: [guestRow(1, 'Guest 1')],
    camp_tab_items: [itemRow(1, g1, 'Lion Lager', 'Drinks', 600)],
  });
  ctl.fail = (t, m) => t === 'audit_log' && m === 'GET';
  await sub(frame, 'activity');
  await frame.locator('#acPeriod').selectOption('all');
  await expect(frame.locator('#acBody .ac-what')).toHaveText(['Unknown added Lion Lager to Guest 1']);
  await expect(frame.locator('#acRemovedSum')).toHaveCount(0);
});
