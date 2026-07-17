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
