// Camp hub · Week for Morocco (14 Nov 2026) — stubbed Supabase, synthetic guests.
//
// The acceptance rule (Miguel: «who sleeps where, arrives, leaves is the most important
// thing in the camp»): the app's nights, arrivals, departures, everyone who leaves a room
// or a bed, breakfast and dinner must equal an independent oracle (ma_week/oracle/oracle.py,
// stdlib Python written from the business rules only, never from this code) on the same
// file — tests/fixtures/ma-guests-2026-11-14.oracle.json is its output.
// «Now» = Sat 14 Nov 2026 10:00 Casablanca.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');
const { dumpWeeks, diff } = require('./ma-dump');

const SHOTS = path.join(__dirname, '..', 'test-results', 'morocco-shots');
const oracle = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name.replace('.csv', '.oracle.json')), 'utf8'));
const rawMsg = (page, team, day) => page.evaluate(([t, d]) => WeekUI.bodyOf(t, d), [team, day]);

test('morocco week: the tab shows for the full view (Floriane = location manager), not in ?view=local or camp-tab-only', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  await H.openWeek(page);
  expect(await page.locator('.ntab-m[data-page="week"]').evaluate(el => el.style.display)).toBe('');
  expect(await page.locator('#weekRoot .section-title').first().innerText()).toBe('Week');
  expect(errors).toEqual([]);
  for (const query of ['&view=local', '&view=camp-tab-only']) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const st = await H.open(p, { query });
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => ({ shown: [...document.querySelectorAll('[data-page="week"]')].some(b => b.style.display !== 'none'), html: document.getElementById('weekRoot').innerHTML }));
    expect(r.shown, query).toBe(false);
    expect(r.html).toBe('');
    expect(st.urls.filter(u => /camp_week_/.test(u)), query).toEqual([]);
    await p.close();
  }
});

for (const [file, importAt] of [[H.FILE, '2026-11-14T08:00:00Z'], [H.FILE2, '2026-11-15T08:00:00Z']]) {
  test(`morocco week = oracle: nights, beds, arrivals, departures, room and bed changes, meals (${file})`, async ({ page }) => {
    const errors = collectFatalErrors(page);
    await H.openWeek(page, { guests: H.guestsFromFile(file, '22222222-0000-4000-8000-000000000009', importAt) });
    const app = await dumpWeeks(page, ['2026-11-07', '2026-11-14', '2026-11-21']);
    const o = oracle(file);
    expect(diff(app, o)).toEqual([]);
    // and the oracle's own guest list = the app's (nobody lost, nobody extra)
    const names = await page.evaluate(() => Object.values(WeekUI._state.cache).flatMap(e => e.rows).map(g => g.guest_name));
    expect([...new Set(names)].sort()).toEqual([...new Set(o.guests.map(g => g.name))].sort());
    expect(errors).toEqual([]);
  });
}

test('morocco week: the import audit = the oracle (27 rows = 22 guests + 5 left out, each with its reason)', () => {
  const a = H.GT.guestAudit(fs.readFileSync(H.CSV(H.FILE), 'utf8'), H.FILE, H.CC.MA);
  const o = oracle(H.FILE);
  expect(a.rows).toBe(o.rows);
  expect(a.guests).toBe(o.guests.length);
  expect(a.left.map(x => [x.line, x.name, x.kind === 'other_camp' ? 'other_camp' : x.kind])).toEqual(o.left_out.map(x => [x.line, x.name, x.reason]));
});

test('morocco week: Overview and the Cleaning message of Sat 14 — every room and bed freed, room numbers, «Outside of camp», no emoji in any team message', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await H.openWeek(page);
  await expect(page.locator('#weekRoot .wk-week')).toContainText('Week 46');
  const clean = await rawMsg(page, 'cleaning', '2026-11-14');
  expect(clean).toBe([
    '*CHECK OUT - SAT 14 NOV*', '',
    '*8 - Banana Point*', '- Rui Alves _(stays 4 more nights, in 13 - Anchor Point)_', '',
    '*11 - Tifnit*', '- Yuki Tanaka', '',
    '*13 - Anchor Point*', '- Clara Schmidt _(stays, moves to bed 5)_', '- Pieter de Vries _(stays 5 more nights, in 6 - Safi)_', '',
    '*CHECK IN - SAT 14 NOV*', '',
    '*2 - Boilers*', '- Lucas Dubois', '',
    '*4 - Crocro*', '- Lena Hoffmann', '- Jonas Weber', '',
    '*5 - Panorama Point*', '- Ines Costa', '',
    '*6 - Safi*', '- Nina Larsen', '- Guest without name (booking MA-1010)', '- Pieter de Vries _(from 13 - Anchor Point, 5 nights)_', '',
    '*8 - Banana Point*', '- Sophie Martin', '- Tom Baker _(from last week, 6 more nights)_', '',
    '*13 - Anchor Point*', '- Karl Nilsson', '- Clara Schmidt _(from last week, one more week with us, now in bed 5)_', '- Rui Alves _(from 8 - Banana Point, 4 nights)_', '',
    '*Outside of camp* _(also guests coming for breakfast and dinner)_', '- Ben Clarke',
  ].join('\n'));
  // Every team message, every day and the week: no emoji (wa.me shows some as «?»).
  const all = await page.evaluate(() => { const out = []; ['cleaning', 'kitchen', 'surf', 'guests'].forEach(t => ['week', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].forEach(d => out.push(WeekUI.bodyOf(t, d)))); return out.join('\n'); });
  expect(H.EMOJI.test(all)).toBe(false);
  expect(errors).toEqual([]);
});

test('morocco week: To check names the Morocco gaps — room not in the list, guest without a room, private room with two bookings, room moves, phones fixed', async ({ page }) => {
  await H.openWeek(page);
  const items = await page.evaluate(() => WeekUI.toCheck().map(i => `${i.tab}: ${i.text} — ${i.who || (i.guests || []).map(g => g.guest_name).join(', ')}`));
  const has = re => expect(items.some(x => re.test(x)), `${re} in\n${items.join('\n')}`).toBe(true);
  has(/^rooms: 1 guest in a room the app does not know yet.*Sara Ali \(9 - Mirleft Private Room\)/);
  has(/^rooms: 1 guest without a room in the file.*Ben Clarke/);
  has(/^rooms: 1 private room with two bookings on the same night.*6 - Safi/);
  has(/^rooms: 2 room moves taken on the Saturday.*Pieter de Vries.*Rui Alves/);
  has(/^guests: .*phones? had a wrong 0.*\+212661000019/);
});

test('morocco week: Kitchen and Surf messages (diets, allergies, levels) and the Transfers message in the camp\'s format', async ({ page }) => {
  const st = await H.openWeek(page, { trips: H.tripsFromFile() });
  const k = await rawMsg(page, 'kitchen', '2026-11-15');
  expect(k).toContain('*KITCHEN - SUN 15 NOV*');
  expect(k).toContain('*Dinner:* 16 people');
  expect(k).toContain('*Allergies*\n- Marta Rossi _(nuts)_');
  expect(k).toContain('*Vegetarian*');
  const s = await rawMsg(page, 'surf', '2026-11-16');
  expect(s).toContain('*SURF - MON 16 NOV*');
  expect(s).toMatch(/\*Advanced\*\n- Oliver Smith _\(coaching\)_/);
  const t = await rawMsg(page, 'transfers', '2026-11-16');
  expect(t).toBe(['Airport to Camp', 'Oliver Smith', '+447700900007', '1 person', 'Flight Number: TO3226', 'Time: 22:10', 'Date: 16 Nov', 'Car'].join('\n'));
  expect(st.calls.filter(c => c.t === 'import')).toEqual([]);
});

test('morocco week: the WhatsApp week group — name, contacts «Name - Week 46», Moroccan phone fixed, description without emoji', async ({ page }) => {
  await H.openWeek(page);
  expect(await page.evaluate(() => WeekUI.groupName())).toBe('Gota Dagua Morocco - week 46');
  const vcf = await page.evaluate(() => WeekUI.vcf());
  expect(vcf).toContain('FN:Ines Costa - Week 46');
  expect(vcf).toContain('TEL;TYPE=CELL:+212661000019');
  expect(vcf).toContain('TEL;TYPE=CELL:+33600000009');      // «+33 06 …» fixed
  const desc = await page.evaluate(() => WeekUI.groupDescription());
  expect(desc.startsWith('YOUR WEEKLY SCHEDULE - WEEK 46 (14–21 Nov)')).toBe(true);
  expect(H.EMOJI.test(desc)).toBe(false);
});

test('morocco week: «Changed since sent» resends the real full message, never a diff', async ({ page }) => {
  const st = await H.openWeek(page);
  await page.click('#weekRoot .wk-tabs .pill[data-tab="rooms"]');
  await page.click('#weekRoot .wk-days .pill[data-day="2026-11-14"]');
  await page.click('#wkSend');
  const sent = await H.call(st, 'msg_insert');
  // A later file: Ines Costa is gone → the Sat 14 check-in changes.
  await page.evaluate(() => { const e = WeekUI._state.cache['2026-11-14']; e.rows = e.rows.filter(g => g.guest_name !== 'Ines Costa'); WeekUI.render(); });
  await expect(page.locator('#weekRoot .wk-changed')).toContainText('Cleaning (Sat)');
  const now = await page.evaluate(() => WeekUI.bodyOf('cleaning', '2026-11-14'));
  expect(now).not.toContain('Ines Costa');
  expect(now).not.toMatch(/UPDATE|^[+–] /m);
  expect(sent.rows[0].text).toContain('Ines Costa');
});

test('morocco week: screenshots at 390 and 1280 — no horizontal overflow on any tab', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = collectFatalErrors(page);
  await H.openWeek(page, { trips: H.tripsFromFile() });
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const t of ['overview', 'rooms', 'kitchen', 'surf', 'transfers', 'guests']) {
      await page.click(`#weekRoot .wk-tabs .pill[data-tab="${t}"]`);
      await page.waitForTimeout(150);
      expect(await H.noOverflow(page), `${t} at ${w}`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `week-${t}-${w}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
