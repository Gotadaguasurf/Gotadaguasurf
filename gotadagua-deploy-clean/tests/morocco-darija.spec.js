// Camp hub · Morocco Cleaning messages in Moroccan Darija (14 Nov 2026) — stubbed Supabase, synthetic guests.
//
// Miguel: «limpeza só, a cozinha é em inglês por agora… e quando é arábico era bom ver ao lado a tradução».
// The Cleaning team of Morocco reads Darija in Arabic script: the Cleaning messages (day and week) are
// built in Darija (what Copy / Send / the stored text use) and, from the same parts, in English shown
// beside each line (never sent). Guest and room names stay Latin; day numbers Western digits; no emoji.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');

const SHOTS = path.join(__dirname, '..', 'test-results', 'morocco-darija-shots');
const msg = (page, team, day, lang) => page.evaluate(([t, d, l]) => WeekUI.bodyOf(t, d, l), [team, day, lang]);
const ARABIC = /[؀-ۿ]/;

const DAYS = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', 'week'];

test('morocco cleaning in Darija: Sat 14 word for word — two parts (rooms left, rooms to prepare), «بيت N», Western digits, *bold* kept', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await H.openWeek(page);
  // Floriane, 16 Nov 2026: part 1 the rooms being left, part 2 the rooms to prepare for the day's arrivals.
  expect(await msg(page, 'cleaning', '2026-11-14')).toBe([
    '*الخروج - السبت 14 نونبر*', '',
    'بيت 8: شخص واحد خارج',
    'بيت 11: شخص واحد خارج',
    'بيت 13: شخص واحد خارج، واحد كيبدل الناموسية', '',
    '*الدخول - السبت 14 نونبر*', '',
    'السلام! عافاك وجدي هادشي:',
    'بيت 1: ناموسية كبيرة/شخص واحد',
    'بيت 2: ناموسية كبيرة/شخص واحد',
    'بيت 4: ناموسية كبيرة ولا جوج صغار؟/2 أشخاص',
    'بيت 5: ناموسية وحدة',
    'بيت 6: 3 أشخاص',
    'بيت 8: ناموسية وحدة',
    'بيت 9: 3 ناموسيات/3 أشخاص',
    'بيت 13: 3 ناموسيات',
    'شكرا!',
  ].join('\n'));
  const week = await msg(page, 'cleaning', 'week');
  expect(week.split('\n')[0]).toBe('*البيوت - من 14 حتى 21 نونبر*');
  expect(week).toContain('- Oliver Smith _(من الثنين 16 حتى الجمعة 20)_');
  expect(week).toContain('- Tom Baker _(من السيمانة اللي فاتت، حتى الجمعة 20)_');
  expect(week).toContain('- Pieter de Vries _(من 13 - Anchor Point، حتى الخميس 19)_');
  expect(week).toContain('- Clara Schmidt _(من السيمانة اللي فاتت)_');
  expect(await msg(page, 'cleaning', '2026-11-23')).toMatch(/^\*الخروج - الثنين 23 نونبر\*/);
  expect(await msg(page, 'cleaning', '2026-11-15')).toBe(['*الدخول - الحد 15 نونبر*', '', 'السلام! عافاك وجدي هادشي:', 'بيت 5: ناموسية وحدة', 'بيت 7: ناموسية كبيرة/شخص واحد', 'بيت 13: 2 ناموسيات', 'شكرا!'].join('\n'));
  expect(errors).toEqual([]);
});

for (const file of [H.FILE, H.FILE2]) {
  test(`morocco cleaning: every day and the week — Darija and its English twin line for line, no emoji, nothing English left in the Darija (${file})`, async ({ page }) => {
    await H.openWeek(page, { guests: H.guestsFromFile(file) });
    for (const d of DAYS) {
      const ar = (await msg(page, 'cleaning', d)).split('\n'), en = (await msg(page, 'cleaning', d, 'en')).split('\n');
      expect(ar.length, d).toBe(en.length);
      ar.forEach((x, i) => {
        if (x.startsWith('*') && !/^\*\d/.test(x)) expect(ARABIC.test(x), `${d} title/header «${x}»`).toBe(true);          // every title is Darija
        if (x.startsWith('- ')) expect(x.split(' _(')[0], d).toBe(en[i].split(' _(')[0]);                                  // the same guest on the same line
        expect(/\b(stays|from|until|nights?|bed|week|outside|CHECK|ROOMS|TO)\b/.test(x.replace(/\(booking [^)]*\)/, '')), `${d}: «${x}»`).toBe(false);
        expect(H.EMOJI.test(x) || /[٠-٩]/.test(x), `${d}: emoji or Arabic digits in «${x}»`).toBe(false);
      });
    }
  });
}

test('morocco cleaning: TODAY / TOMORROW in Darija (اليوم / غدا), sent with the day title dressed; the stored text keeps the neutral title', async ({ page }) => {
  const st = await H.openWeek(page);   // now = Sat 14 Nov
  const r = await page.evaluate(() => ({
    today: WeekUI.dress(WeekUI.bodyOf('cleaning', '2026-11-14'), '2026-11-14').split('\n').filter(l => /^\*(الخروج|الدخول)/.test(l)),
    tomorrow: WeekUI.dress(WeekUI.bodyOf('cleaning', '2026-11-15'), '2026-11-14').split('\n')[0],
    later: WeekUI.dress(WeekUI.bodyOf('cleaning', '2026-11-18'), '2026-11-14').split('\n')[0],
    en: WeekUI.dress('*CHECK OUT - SAT 14 NOV*', '2026-11-14'),
  }));
  expect(r.today).toEqual(['*الخروج اليوم - 14 نونبر*', '*الدخول اليوم - 14 نونبر*']);
  expect(r.tomorrow).toMatch(/^\*(الخروج|الدخول) غدا - 15 نونبر\*$/);
  expect(r.later).toBe('*الخروج - الربع 18 نونبر*');
  expect(r.en).toBe('*CHECK OUT TODAY - 14 NOV*');
  await page.click('#weekRoot .wk-tabs .pill[data-tab="rooms"]');
  await page.click('#weekRoot .wk-days .pill[data-day="2026-11-14"]');
  await page.click('#wkSend');
  const url = decodeURIComponent(await page.evaluate(() => window.__opened[window.__opened.length - 1]));
  expect(url).toContain('*الخروج اليوم - 14 نونبر*');
  expect(url).not.toContain('CHECK OUT');                       // the English beside it is never sent
  const rec = await H.call(st, 'msg_insert');
  expect(rec.rows[0].text.split('\n')[0]).toBe('*الخروج - السبت 14 نونبر*');
});

test('morocco cleaning: Copy takes the Darija only; «Changed since sent» resends the full Darija message, never a diff', async ({ page }) => {
  const st = await H.openWeek(page);
  await page.click('#weekRoot .wk-tabs .pill[data-tab="rooms"]');
  await page.click('#weekRoot .wk-days .pill[data-day="week"]');
  await expect(page.locator('#wkMsg .wk-bi-en').first()).toHaveText('English — to check, not sent');
  await page.click('#wkMessage button:has-text("Copy")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  const copied = await page.evaluate(() => window.__copied[0]);
  expect(copied).toBe(await msg(page, 'cleaning', 'week'));
  expect(copied).not.toMatch(/ROOMS|from last week/);
  const sent = (await H.call(st, 'msg_insert')).rows[0];
  expect(sent.text).toBe(copied);
  await page.evaluate(() => { const e = WeekUI._state.cache['2026-11-14']; e.rows = e.rows.filter(g => g.guest_name !== 'Ines Costa'); WeekUI.render(); });
  await expect(page.locator('#weekRoot .wk-changed')).toContainText('Cleaning (Week)');
  await page.click('#wkMessage button:has-text("Copy")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(2);
  const again = await page.evaluate(() => window.__copied[1]);
  expect(again).toBe(await msg(page, 'cleaning', 'week'));          // the real, current, full message
  expect(again.split('\n')[0]).toBe('*البيوت - من 14 حتى 21 نونبر*');
  expect(again).not.toContain('Ines Costa');
  expect(again).not.toMatch(/UPDATE|^[+–] /m);
});

test('morocco: Kitchen, Surf and Guests stay in English; the bilingual card only on Rooms', async ({ page }) => {
  await H.openWeek(page);
  for (const t of ['kitchen', 'surf', 'guests']) for (const d of ['2026-11-15', 'week']) expect(ARABIC.test(await msg(page, t, d)), `${t} ${d}`).toBe(false);
  expect(await msg(page, 'kitchen', '2026-11-15')).toMatch(/^\*KITCHEN - SUN 15 NOV\*/);
  await page.click('#weekRoot .wk-tabs .pill[data-tab="kitchen"]');
  await expect(page.locator('#wkMsg.wk-bi')).toHaveCount(0);
  await page.click('#weekRoot .wk-tabs .pill[data-tab="rooms"]');
  await expect(page.locator('#wkMsg.wk-bi')).toHaveCount(1);
  await expect(page.locator('#wkMsg .wk-bi-r:not(.wk-bi-hd) .wk-bi-ar').first()).toHaveAttribute('dir', 'rtl');
});

test('morocco cleaning card: screenshots at 390 and 1280 — Darija right-to-left with the English beside / under it, no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await H.openWeek(page);
  await page.click('#weekRoot .wk-tabs .pill[data-tab="rooms"]');
  for (const [w, h, d] of [[1280, 900, '2026-11-14'], [390, 844, '2026-11-14'], [1280, 900, 'week'], [390, 844, 'week']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.click(`#weekRoot .wk-days .pill[data-day="${d}"]`);
    await page.waitForTimeout(150);
    expect(await H.noOverflow(page), `${d} at ${w}`).toBe(true);
    const card = page.locator('#wkMessage');
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(SHOTS, `cleaning-${d}-${w}.png`) });
    const cols = await page.evaluate(() => { const r = document.querySelector('#wkMsg .wk-bi-r:not(.wk-bi-hd)'); const a = r.children[0].getBoundingClientRect(), e = r.children[1].getBoundingClientRect(); return { side: Math.abs(a.top - e.top) < 4, under: e.top >= a.bottom - 2 }; });
    if (w === 1280) expect(cols.side).toBe(true); else expect(cols.under).toBe(true);
  }
});
