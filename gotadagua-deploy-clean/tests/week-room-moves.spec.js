// Camp hub · Week — room moves against the camp report's dated room lines (audit 18 Nov 2026, WEEK-04) — stubbed Supabase.
//
// The camp report gives every room line with its dates and bed (camp_week_guests.raw.segments). Week still takes a move on
// the changeover Saturday (its rule from the Guests-export days); «To check» used to say «the file has no move date» for
// every move, which is false for report rows. Now:
//   · a move Week shows exactly as the report has it (Sam, Saturday 28) → no question;
//   · a move the report dates on another day (Mia, Wednesday 25) → «1 room move to check», with Bookinglayer's dates;
//   · a row of the old Guests export keeps «taken on the Saturday – the file has no move date».
// «Now» = Thu 19 Nov 2026 10:00 Casablanca; the week shown is Sat 21 – Fri 27 Nov.
const { test, expect } = require('@playwright/test');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');
const F = require('./week-way-fixtures');

async function nextWeek(page, guests) {
  const st = await H.openWeek(page, { now: '2026-11-19T10:00', guests, trips: [] });
  await page.evaluate(() => WeekUI.shiftWeek(7));
  await expect.poll(() => page.evaluate(() => WeekUI._state.week)).toBe('2026-11-21');
  await expect(page.locator('#wkDay-2026-11-21')).toBeVisible();   // the week's rows are loaded
  return st;
}
const roomItems = page => page.evaluate(() => WeekUI.toCheck().filter(c => c.tab === 'rooms' && /room move/.test(c.short)).map(c => ({ short: c.short, text: c.text, who: c.who })));

test('room moves: the report\'s own move date is no question; another date than Week\'s is, with Bookinglayer\'s dates', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await nextWeek(page, [...F.guests(), F.midweekMover()]);
  expect(await roomItems(page)).toEqual([{ short: '1 room move to check',
    text: "1 room move shown on another day or bed than Bookinglayer's – follow Bookinglayer, check the Day Planner",
    who: 'Mia Midweek (Bookinglayer: 8 - Banana Point bed 4 Sat 21 → 7 - Anza Wed 25)' }]);
  // the chip is in the To check strip
  await expect(page.locator('.wk-tocheck')).toContainText('1 room move to check');
  expect(await H.noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('room moves: another bed in a shared room than the report\'s is a question too', async ({ page }) => {
  const g = F.guest({ ref: '2026-9007', name: 'Ben Beds', ci: '2026-11-21', co: '2026-12-05', legs: [],
    segs: [{ room: F.BANANA, from: '2026-11-21', to: '2026-11-28', bed: '2' }, { room: F.ANCHOR, from: '2026-11-28', to: '2026-12-05', bed: '5' }] });
  // Week reads the beds «2, 5» in the order of the field; Bookinglayer's lines say 5 in Banana Point, 2 in Anchor Point
  const swapped = { ...g, raw: { ...g.raw, segments: [{ ...g.raw.segments[0], bed: '5' }, { ...g.raw.segments[1], bed: '2' }] } };
  await nextWeek(page, [...F.guests(), swapped]);
  const items = await roomItems(page);
  expect(items.map(i => i.short)).toEqual(['1 room move to check']);
  expect(items[0].who).toBe('Ben Beds (Bookinglayer: 8 - Banana Point bed 5 Sat 21 → 13 - Anchor Point bed 2 Sat 28)');
});

test('room moves: a row of the old Guests export (no dated room lines) keeps «taken on the Saturday»', async ({ page }) => {
  const old = { ...F.midweekMover(), raw: {} };
  await nextWeek(page, [...F.guests(), old]);
  const items = await roomItems(page);
  expect(items.map(i => i.short)).toEqual(['1 room move to confirm']);
  expect(items[0].text).toBe('1 room move taken on the Saturday – the file has no move date, check the Day Planner');
});
