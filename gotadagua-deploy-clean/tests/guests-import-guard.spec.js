// HQ «Import bookings» refuses a Bookinglayer Guests export (13 Nov 2026).
//
// The bookings parser would read a Guests file as one booking per guest with
// total 0 and upsert it over the real booking (revenue gone). The modal must
// say where the file goes instead and never send a request to /bookings.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const GUESTS_CSV = path.join(__dirname, 'fixtures', 'Bookinglayer-Guests-2026-11-07 14_23.csv');

test('HQ import: a Guests export is refused and nothing is written to bookings', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const bookingCalls = [];
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const url = route.request().url();
    if (url.includes('/rest/v1/bookings') || url.includes('/rest/v1/partners')) bookingCalls.push(route.request().method() + ' ' + url);
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await fakeOwnerSession(page);
  await page.goto('/?openImport=1', { waitUntil: 'domcontentloaded' });
  const input = page.locator('#csvTabUpload input[type=file]');
  await expect(input).toHaveCount(1);
  bookingCalls.length = 0;
  await input.setInputFiles(GUESTS_CSV);
  await expect(page.locator('#globalCsvSummary')).toContainText('This is a Guests export. Import it in the camp hub → Transport → Next week.');
  await page.waitForTimeout(500);
  expect(bookingCalls).toEqual([]);
  expect(errors).toEqual([]);
});
