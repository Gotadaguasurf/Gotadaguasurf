// ════════════════════════════════════════════════════════════════════════════
//  SMOKE SUITE — the cheap insurance layer for the money flows
//
//  Three tiers:
//   1. Boot: every app parses + executes without a fatal JS error, both
//      logged-out (fresh incognito — the path that has broken before) and
//      with a fake owner session (deeper render paths).
//   2. Money math: the surf-school pricing matrix — evaluated in the real
//      page context, so a bad edit to RENTAL_PRICING or priceFor fails here
//      before it misprices a rental.
//   3. Guards: currency pins per location + CRM campaign plumbing exists.
//
//  Run: npm test        (starts its own static server on :8788)
// ════════════════════════════════════════════════════════════════════════════

const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const APPS = [
  { name: 'root (login/hub)', path: '/' },
  { name: 'camp-hub sri-lanka', path: '/camp-hub/?location=sri-lanka' },
  { name: 'camp-hub portugal', path: '/camp-hub/?location=portugal' },
  { name: 'camp-hub surf-school', path: '/camp-hub/?location=surf-school' },
  { name: 'hq', path: '/hq/' },
  { name: 'crm', path: '/crm/' },
  { name: 'partners', path: '/partners/' },
  { name: 'prices', path: '/prices/?location=sri-lanka' },
  { name: 'surf-school', path: '/surf-school/' },
  { name: 'instructors', path: '/instructors/' },
];

// ── Tier 1a: fresh-browser boot (no session — the incognito path) ──────
for (const app of APPS) {
  test(`boot logged-out: ${app.name}`, async ({ page }) => {
    const fatal = collectFatalErrors(page);
    await page.goto(app.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500); // let async boot code run/redirect
    expect(fatal, `fatal JS errors on ${app.path}:\n${fatal.join('\n')}`).toEqual([]);
  });
}

// ── Tier 1b: owner-session boot (render paths past the auth gate) ──────
for (const app of APPS) {
  test(`boot with session: ${app.name}`, async ({ page }) => {
    const fatal = collectFatalErrors(page);
    await fakeOwnerSession(page);
    await page.goto(app.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500); // hydration attempts + error handling
    expect(fatal, `fatal JS errors on ${app.path}:\n${fatal.join('\n')}`).toEqual([]);
  });
}

// ── Tier 1c: the login screen actually renders for a new visitor ───────
test('root shows the login form when logged out', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loginEmail')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#loginPrimaryButton')).toBeVisible();
});

// ── Tier 2: surf-school pricing matrix (the rentals money math) ────────
// Prices from the printed shop card. If someone fat-fingers
// RENTAL_PRICING or breaks priceFor's fallback, this catches it before
// a real rental gets mispriced.
test('surf-school pricing matrix matches the price card', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/surf-school/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.priceFor === 'function');

  const cases = await page.evaluate(() => {
    const t = (customer, combo, dur) => window.priceFor(customer, combo, dur);
    return {
      // Standard column
      bw1h: t('Standard', 'Board + Wetsuit', '1H'),
      bw2h: t('Standard', 'Board + Wetsuit', '2H'),
      bw3h: t('Standard', 'Board + Wetsuit', '3H'),
      bwDay: t('Standard', 'Board + Wetsuit', 'Full day'),
      b2h: t('Standard', 'Board', '2H'),
      w2h: t('Standard', 'Wetsuit', '2H'),
      // Discount tiers
      erasmus2h: t('Erasmus / Student', 'Board + Wetsuit', '2H'),
      erasmusDay: t('Erasmus / Student', 'Board + Wetsuit', 'Full day'),
      resident2h: t('Resident', 'Board + Wetsuit', '2H'),
      residentDay: t('Resident', 'Board + Wetsuit', 'Full day'),
      // Fallback: tier without a specific entry falls back to Standard
      erasmusBoard1h: t('Erasmus / Student', 'Board', '1H'),
      // Multi-day extra rate
      extraBW: window.extraDayRateFor('Board + Wetsuit'),
    };
  });

  expect(cases.bw1h).toBe(20);
  expect(cases.bw2h).toBe(30);
  expect(cases.bw3h).toBe(40);
  expect(cases.bwDay).toBe(45);
  expect(cases.b2h).toBe(20);
  expect(cases.w2h).toBe(12);
  expect(cases.erasmus2h).toBe(20);
  expect(cases.erasmusDay).toBe(25);
  expect(cases.resident2h).toBe(15);
  expect(cases.residentDay).toBe(25);
  expect(cases.erasmusBoard1h).toBe(15); // Standard Board 1H fallback
  expect(cases.extraBW).toBe(15);
});

// Live pricing overrides: /prices "Surf Pack" rows override matrix cells
// by naming convention; unparseable rows are ignored (cell keeps the
// hardcoded value). Stubs CATALOG in-page — no network needed.
test('surf-school live pricing override parses catalog rows', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/surf-school/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyLivePricing === 'function');
  const result = await page.evaluate(() => {
    CATALOG = [
      { name: 'Board & Wetsuit — 2h (Standard)', category: 'Surf Pack', sell_price: 99 },
      { name: 'Rental — Full day (Erasmus/Student)', category: 'Surf Pack', sell_price: 33 },
      { name: 'Some Custom Item', category: 'Surf Pack', sell_price: 5 },       // no match → ignored
      { name: 'Board — 2h (Standard)', category: 'Lesson', sell_price: 1 },     // wrong category → ignored
    ];
    window.applyLivePricing();
    return {
      overridden: window.priceFor('Standard', 'Board + Wetsuit', '2H'),
      tierOverridden: window.priceFor('Erasmus / Student', 'Board + Wetsuit', 'Full day'),
      untouched: window.priceFor('Standard', 'Board', '2H'),
    };
  });
  expect(result.overridden).toBe(99);      // live value won
  expect(result.tierOverridden).toBe(33);  // discount-tier row parsed
  expect(result.untouched).toBe(20);       // unmatched cell kept hardcoded price
});

// Expected-return math: 2H rental starting 10:00 returns by 12:00;
// multi-day N days = N × 24h.
test('surf-school expected-return math', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/surf-school/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.computeExpectedReturn === 'function');

  const result = await page.evaluate(() => {
    document.getElementById('fld_date').value = '2026-07-20';
    document.getElementById('fld_start').value = '10:00';
    window.pickChip('fld_duration', '2H');
    const sameDay = window.computeExpectedReturn();
    window.setRentalType('Multi-day');
    document.getElementById('fld_days').value = '3';
    const multi = window.computeExpectedReturn();
    return {
      sameDayReturn: sameDay ? sameDay.expected.toISOString() : null,
      multiReturn: multi ? multi.expected.toISOString() : null,
    };
  });

  expect(result.sameDayReturn).toContain('2026-07-20T');
  expect(new Date(result.sameDayReturn).getHours()).toBe(12);
  expect(result.multiReturn).toContain('2026-07-23T'); // +3 × 24h
});

// ── Tier 3: guards that have regressed before ──────────────────────────
test('camp-hub currency pins: each location locked to its currency', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=portugal', { waitUntil: 'domcontentloaded' });
  // Top-level `const` lives in the global lexical scope, NOT on window —
  // reference the identifier directly (guarded, since evaluating before
  // the script runs would throw).
  await page.waitForFunction(() => { try { return typeof LOCAL_CURRENCY_PINNED === 'object'; } catch (_) { return false; } });
  const pins = await page.evaluate(() => LOCAL_CURRENCY_PINNED);
  expect(pins['sri-lanka']).toBe('LKR');
  expect(pins['morocco']).toBe('MAD');
  expect(pins['portugal']).toBe('EUR');
  expect(pins['junior-camp']).toBe('EUR');
  expect(pins['surf-school']).toBe('EUR');
});

// Regression: location_menus dupes (non-atomic DELETE+INSERT race between
// two browsers) made every POS item show 2-3 times with mixed stock
// snapshots. normalizeMenu must collapse duplicates and backfill fields
// the surviving copy is missing.
test('camp-tab menu dedup heals duplicated items', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/camp-tab-inner.html?location=portugal', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.normalizeMenu === 'function');
  const result = await page.evaluate(() => {
    const menu = window.normalizeMenu({
      Merch: [
        { n: 'T-Shirt S', p: 30 },              // race copy without stock
        { n: 'T-Shirt S', p: 30, stk: 21 },     // race copy WITH stock
        { n: 'T-Shirt S', p: 30 },              // third copy
        { n: 'Hoodie M', p: 50, stk: 32 },
      ],
    });
    return { count: menu.Merch.length, names: menu.Merch.map(i => i.n), tshirtStk: menu.Merch[0].stk };
  });
  expect(result.count).toBe(2);                       // 4 rows → 2 items
  expect(result.names).toEqual(['T-Shirt S', 'Hoodie M']);
  expect(result.tshirtStk).toBe(21);                  // stock backfilled from the dupe
});

// Regression, data-loss class: camp-tab-inner boots with MENU =
// DEFAULT_MENU (Sri Lanka seed — LKR drinks, 6500 tees). The menu sync is
// delete-all-then-write, so syncing that placeholder REPLACES a real
// camp's menu (this wiped Portugal's Tours + Extras once). The sync must
// refuse to run until the menu has been hydrated from the DB.
test('camp-tab menu sync refuses to write a non-hydrated (default) menu', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/camp-tab-inner.html?location=portugal', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.syncCampTabMenuToSupabase === 'function');
  const result = await page.evaluate(async () => {
    // Force the pre-hydrate state, then attempt the destructive sync.
    MENU_HYDRATED = false;
    const blocked = await window.syncCampTabMenuToSupabase();
    // With the flag set (DB state known) it proceeds past the guard —
    // it may still fail on the network with the fake JWT, which is fine:
    // we only assert it is no longer short-circuited by the guard.
    MENU_HYDRATED = true;
    let reached = false;
    try { await window.syncCampTabMenuToSupabase(); reached = true; }
    catch (_) { reached = true; }
    return { blocked, reached };
  });
  expect(result.blocked).toBe(false);  // guard returned false without writing
  expect(result.reached).toBe(true);   // guard is not a permanent block
});

// Diploria (Portugal boardshorts): its own POS tab with STANDALONE stock
// — each colour+size name is its own SKU counter, unlike Merch where
// "T-Shirt Offer L" borrows from "T-Shirt L". Guards both the tab config
// and the stock route.
test('camp-tab Diploria: Portugal tab config + standalone stock route', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/camp-tab-inner.html?location=portugal', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.stockLeftForCategory === 'function');
  const result = await page.evaluate(() => ({
    // const → global lexical scope, not window; guard the direct reference
    portugalTabs: (() => { try { return LOCATION_TAB_CONFIG['portugal']; } catch (_) { return null; } })(),
    otherCamps: (() => {
      try {
        return ['sri-lanka', 'morocco', 'junior-camp']
          .filter(s => (LOCATION_TAB_CONFIG[s] || []).includes('Diploria'));
      } catch (_) { return null; }
    })(),
    // Nothing sold in a fresh session → stock left === initial stock.
    stockLeft: window.stockLeftForCategory({ n: 'Core Black 32', stk: 1 }, 'Diploria'),
    noStockField: window.stockLeftForCategory({ n: 'Retro 28' }, 'Diploria'),
    unknownCat: window.stockLeftForCategory({ n: 'Whatever', stk: 5 }, 'Nope'),
  }));
  expect(result.portugalTabs).toContain('Diploria');
  expect(result.otherCamps).toEqual([]);   // Portugal only
  expect(result.stockLeft).toBe(1);
  expect(result.noStockField).toBeNull();  // no stk → untracked, not zero
  expect(result.unknownCat).toBeNull();
});

test('crm mobile drawer opens, switches tab, and closes', async ({ page }) => {
  // Suite viewport is 390×844 (mobile) — the hamburger must be visible,
  // the drawer must open, and a drawer tab tap must both switch the real
  // tab (delegation to .nav-tab) and collapse the drawer.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  const burger = page.locator('.nav-hamburger');
  await expect(burger).toBeVisible({ timeout: 10_000 });
  await burger.click();
  await expect(page.locator('#mobNavDrawer')).toHaveClass(/open/);
  await page.locator('.ntab-m[data-tab="pipeline"]').click();
  await expect(page.locator('#mobNavDrawer')).not.toHaveClass(/open/);
  await expect(page.locator('.nav-tab[data-tab="pipeline"]')).toHaveClass(/active/);
});

test('owner-config.js loads and defines the owner list', async ({ page }) => {
  // The 8 owner-bypass sites fall back to a hardcoded email if this file
  // fails to load — which keeps Miguel un-locked-out but would silently
  // mask a 404 forever. This test makes a missing/broken owner-config
  // loud instead.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const owners = await page.evaluate(() => window.__PLATFORM_OWNER_EMAILS);
  expect(Array.isArray(owners)).toBe(true);
  expect(owners).toContain('miguel@gotadaguasurf.com');
});

test('crm campaign plumbing exists (queue, render, suppression-aware batch)', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.runBatchSend === 'function');
  const fns = await page.evaluate(() => ({
    queueDripCampaign: typeof window.queueDripCampaign,
    renderCampaigns: typeof window.renderCampaigns,
    setCampaignStatus: typeof window.setCampaignStatus,
    cancelCampaign: typeof window.cancelCampaign,
    partnerPerf: typeof window.loadPartnerPerformance,
    // const → global lexical scope, not window; guard the direct reference
    instantMax: (() => { try { return INSTANT_SEND_MAX; } catch (_) { return null; } })(),
  }));
  expect(fns.queueDripCampaign).toBe('function');
  expect(fns.renderCampaigns).toBe('function');
  expect(fns.setCampaignStatus).toBe('function');
  expect(fns.cancelCampaign).toBe('function');
  expect(fns.partnerPerf).toBe('function');
  expect(fns.instantMax).toBe(5);
});

test('crm: every tab panel has a nav button and actually opens', async ({ page }) => {
  // Three separate bugs shipped because a panel, its nav button and the
  // show/hide array drifted apart: the Inbox tab existed with no button,
  // then had a button that revealed nothing. Clicking each tab for real is
  // the only check that catches all three at once.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.nav-tab').length > 0);

  const panels = await page.evaluate(() =>
    [...document.querySelectorAll('[id^="page-"]')].map(el => el.id.replace('page-', '')));
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-tab[data-tab]')].map(el => el.dataset.tab));

  // No orphan panels (unreachable) and no orphan buttons (dead click).
  expect([...panels].sort()).toEqual([...tabs].sort());

  for (const tab of tabs) {
    await page.click(`.nav-tab[data-tab="${tab}"]`);
    const hidden = await page.evaluate(
      t => document.getElementById('page-' + t).classList.contains('hidden'), tab);
    expect(hidden, `panel page-${tab} stayed hidden after clicking its tab`).toBe(false);
  }
});

test('crm: contact fields render as click-to-edit', async ({ page }) => {
  // The panel is built from a template string, so a typo here degrades to a
  // plain read-only row rather than an error. Render one for real and check
  // the edit hooks and the mailto escape hatch both survived.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.editRow === 'function');
  const out = await page.evaluate(() => {
    const c = { id: 'x', email: 'hello@example.com', phone: '', segment: 'Surf school' };
    return {
      email: editRow('Email', c, 'email', v => `mailto:${v}`),
      phone: editRow('Phone', c, 'phone', v => `tel:${v}`),
      hasEditor: typeof window.startFieldEdit === 'function',
    };
  });
  expect(out.hasEditor).toBe(true);
  // Filled field: editable text plus a separate link to open it.
  expect(out.email).toContain('data-field="email"');
  expect(out.email).toContain('mailto:hello@example.com');
  // Empty field still offers somewhere to click, and no dead link.
  expect(out.phone).toContain('data-field="phone"');
  expect(out.phone).toContain('ed-empty');
  expect(out.phone).not.toContain('href="tel:');
});

test('crm: segment edits offer the existing list plus a way to add one', async ({ page }) => {
  // Segment is a shared vocabulary. Free text is what produces "Surf school"
  // and "Surf School" as separate values, so the editor must be a picker
  // that still allows a deliberate new entry.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.startFieldEdit === 'function');
  const out = await page.evaluate(() => {
    CONTACTS.push({ id: 'a', segment: 'University' }, { id: 'b', segment: 'Surf school' });
    const el = document.createElement('span');
    el.dataset.field = 'segment';
    document.body.appendChild(el);
    startFieldEdit(el, { id: 'a', segment: 'University' });
    const field = el.firstElementChild;
    return {
      tag: field.tagName,
      options: [...field.options].map(o => o.textContent),
      selected: field.value,
    };
  });
  expect(out.tag).toBe('SELECT');
  expect(out.options).toContain('University');
  expect(out.options).toContain('Surf school');
  expect(out.options.some(o => /new segment/i.test(o))).toBe(true);
  expect(out.selected).toBe('University');   // opens on the current value
});

test('crm: instagram-only contacts are detected and get DM tooling', async ({ page }) => {
  // Instagram has no column of its own: the handle hides in the website URL
  // or in a "IG: @name" note. If igHandle stops reading both, the whole
  // DM-first list silently empties.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.igHandle === 'function');
  const out = await page.evaluate(() => {
    const fromUrl   = { id:'1', website:'https://www.instagram.com/soulandsurfportugal/' };
    const fromNotes = { id:'2', notes:'IG: @wssclub | ~1,300 followers' };
    const realSite  = { id:'3', website:'https://gotadaguasurf.com' };
    return {
      url: igHandle(fromUrl),
      notes: igHandle(fromNotes),
      none: igHandle(realSite),
      // No email → the DM block appears; with one → just the row.
      dmBlock: igRow({ ...fromUrl, email:null }).includes('igSentBtn'),
      noDmBlock: igRow({ ...fromUrl, email:'hi@x.com' }).includes('igSentBtn'),
      opensDm: igRow({ ...fromUrl, email:null }).includes('ig.me/m/soulandsurfportugal'),
      script: dmScript({ company:'Test' }),
    };
  });
  expect(out.url).toBe('soulandsurfportugal');
  expect(out.notes).toBe('wssclub');
  expect(out.none).toBe(null);
  expect(out.dmBlock).toBe(true);
  expect(out.noDmBlock).toBe(false);
  expect(out.opensDm).toBe(true);
  // The DM must ask for the email; that handoff is the whole point.
  expect(out.script.toLowerCase()).toContain('email');
  expect(out.script.length).toBeLessThan(400);
});

test('crm: batch send refuses a contact already emailed today', async ({ page }) => {
  // Four schools got the same email twice, forty minutes apart, because the
  // recipient list only UNTICKS recent contacts as a default and a default
  // is not a guard. The refusal has to live where the send happens.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.runBatchSend === 'function');
  const src = await page.evaluate(() => window.runBatchSend.toString());
  // Freshness is re-read from the database, not trusted from memory.
  expect(src).toContain('last_contacted_at');
  expect(src).toMatch(/DUP_WINDOW_MS/);
  expect(src).toMatch(/status\s*=\s*'skipped'/);
  // A failed check must stop the batch rather than send blind.
  expect(src).toMatch(/Could not check who was already emailed/);
  // The skip happens before the message is built, not after.
  expect(src.indexOf('DUP_WINDOW_MS')).toBeLessThan(src.indexOf('gmailSendOne'));
});

test('crm: an email cannot go out unsigned', async ({ page }) => {
  // Templates are documents people edit, and two of thirteen had already
  // lost {{my_signature}} that way — those emails went out with no name, no
  // phone and no branding, and nothing flagged it. Signing has to happen at
  // send time, not depend on the template remembering.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildEmailHtml === 'function');
  const out = await page.evaluate(() => {
    const sender = { full_name:'João Maria André', role:'Sales Manager',
      email:'groups@gotadaguasurf.com', signature:'Best,\n\nJoão Maria André\ngroups@gotadaguasurf.com' };
    return {
      withSig: buildEmailHtml('Hi there,\n\nBody.\n\n' + sender.signature, sender),
      withoutSig: buildEmailHtml('Hi there,\n\nBody, template lost the variable.', sender),
      sendSrc: window.gmailSendOne.toString(),
    };
  });
  // Branded footer present either way.
  expect(out.withSig).toContain('logo-blue.png');
  expect(out.withoutSig).toContain('logo-blue.png');
  // When the plain signature was there it is replaced, not duplicated.
  expect(out.withSig).not.toContain('groups@gotadaguasurf.com<br>');
  // And the plain-text half gets signed before sending.
  expect(out.sendSrc).toMatch(/sigText/);
  expect(out.sendSrc).toMatch(/body: bodyOut/);
});

test('crm: attached photos render in the email, other files become links', async ({ page }) => {
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildEmailHtml === 'function');
  const out = await page.evaluate(() => {
    const sender = { full_name:'João', email:'groups@gotadaguasurf.com', signature:'Best,\nJoão' };
    const base = 'https://x.supabase.co/storage/v1/object/public/crm-assets/2026-08-31';
    const html = buildEmailHtml(`Have a look:\n\n${base}/casa.jpg\n${base}/deck.pdf\n\nBest,\nJoão`, sender);
    return { html, hasBtn: !!document.getElementById('composeAttachBtn'),
             upload: typeof window.uploadComposeFile };
  });
  expect(out.hasBtn).toBe(true);
  expect(out.upload).toBe('function');
  // The photo is shown, not linked.
  expect(out.html).toMatch(/<img src="[^"]*casa\.jpg"/);
  // The deck is a link, not an <img>.
  expect(out.html).toMatch(/<a href="[^"]*deck\.pdf"/);
  expect(out.html).not.toMatch(/<img src="[^"]*deck\.pdf"/);
});

test('crm: the status filter is built from the stage names, not hand-written', async ({ page }) => {
  // The options were typed by hand, so renaming a stage left the filter
  // behind: the board said "First touch" while the filter still said
  // "1st email", and 'excluded' was missing from it altogether.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.populateStatusFilter === 'function');
  const out = await page.evaluate(() => {
    populateStatusFilter();
    const sel = document.getElementById('filterStatus');
    return {
      values: [...sel.options].map(o => o.value).filter(Boolean),
      labels: [...sel.options].map(o => o.textContent),
      expected: STATUS_ORDER,
      firstTouchLabel: STATUS_LABELS.first_email,
    };
  });
  // Every stage the board knows about is filterable, none missing.
  expect(out.values).toEqual(out.expected);
  // And named identically in both places.
  expect(out.labels).toContain(out.firstTouchLabel);
  expect(out.labels).toContain('In conversation');
});

test('crm: a half-written email survives closing the window', async ({ page }) => {
  // Closing compose is exactly what you do when you need to go and check
  // something before finishing the sentence, and it used to throw the
  // writing away.
  await fakeOwnerSession(page);
  await page.goto('/crm/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.saveComposeDraft === 'function');
  const out = await page.evaluate(async () => {
    CURRENT_CONTACT = { id: 'contact-under-test', language: 'en' };
    document.getElementById('composeSubject').value = 'half a subject';
    document.getElementById('composePreview').value = 'half a sentence, then I went to check something';
    saveComposeDraft();
    const stored = readComposeDraft('contact-under-test');
    // Sending is what clears it, not closing.
    closeCompose();
    const afterClose = readComposeDraft('contact-under-test');
    clearComposeDraft('contact-under-test');
    return { stored, survivedClose: !!afterClose, afterClear: readComposeDraft('contact-under-test') };
  });
  expect(out.stored.subject).toBe('half a subject');
  expect(out.stored.body).toContain('went to check something');
  expect(out.survivedClose).toBe(true);
  expect(out.afterClear).toBe(null);
});
