// ════════════════════════════════════════════════════════════════════════════
//  Instructors · «Lessons for the day» (17 Nov 2026)
//
//  Miguel: «isto tem de ser mais fácil de usar e mobile — para conseguir meter
//  no dia… ou no dia a seguir». The 6-column grid became: Today / Yesterday /
//  Other day chips, one row per instructor who usually works with a − N + per
//  lesson type they give, the day's saved lessons pre-filled (Save updates them,
//  never adds them twice), and a sticky «Today: N lessons · €» + one Save.
//  Everything runs on stubbed data — no Supabase writes.
// ════════════════════════════════════════════════════════════════════════════
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

// Seeds `entries` / `instructorDirectory` with dates relative to the browser's
// local today (never hard-coded), and stubs every write so tests can inspect them.
async function openDay(page, { today = [], extraPeople = 0 } = {}) {
  await fakeOwnerSession(page);
  await page.goto('/instructors/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderQuickDay === 'function' && typeof window.qdPlan === 'function');
  await page.waitForTimeout(300);
  await page.evaluate(({ today, extraPeople }) => {
    const iso = (k) => { const x = new Date(); x.setDate(x.getDate() - k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const mk = (id, name, k, cat, n, price, paid = false) => ({ id, instructorId: 'x', date: iso(k), instructorName: name, lessonCategory: cat, numberOfLessons: n, paymentType: 'Recibo Verde', priceUnit: price, total: n * price, paid, notes: '' });
    entries = [
      mk('h1', 'Matilde', 3, 'Surf School', 3, 25), mk('h2', 'Matilde', 5, 'Surf School', 2, 25), mk('h3', 'Matilde', 40, 'Surf School', 1, 30),
      mk('h4', 'Romildo Ramos', 2, 'Surf Camp', 3, 30), mk('h5', 'Romildo Ramos', 60, 'Surf Camp', 1, 250),   // €250 = salary row, never a price
      mk('h6', 'Yuri Medeiros', 4, 'Kids Camp', 2, 30),
      mk('h7', 'Heitor Souza', 400, 'Junior Camp', 2, 30),   // not recent → only via «+ Add instructor»
    ];
    for (let i = 0; i < extraPeople; i++) entries.push(mk('x' + i, `Instructor ${String(i + 1).padStart(2, '0')}`, 1 + (i % 9), i % 2 ? 'Surf Camp' : 'Surf School', 1, 25));
    (today || []).forEach(r => entries.push(mk(r.id, r.name, 0, r.cat, r.n, r.price, !!r.paid)));
    instructorDirectory = [...new Set(entries.map(e => e.instructorName))].map((n, i) => ({ id: 'd' + i, name: n, rate: 30, paymentType: n === 'Yuri Medeiros' ? 'Cash' : 'Recibo Verde', vatPct: 0 }));
    loadInstructorData = async () => {};
    window.__w = { inserts: [], updates: [], deletes: [] };
    window.__orig = { u: String(updateLessonCount), d: String(deleteLessonRow) };
    window.__origFn = { updateLessonCount, deleteLessonRow };
    insertLessonEntry = async (d) => { window.__w.inserts.push(d); return { duplicate: false }; };
    updateLessonCount = async (id, patch) => { window.__w.updates.push({ id, patch }); };
    deleteLessonRow = async (id) => { window.__w.deletes.push(id); };
    render();
    document.getElementById('addLessonBtn').click();
  }, { today, extraPeople });
}
const line = (page, name, cat) => page.locator(`#qdBody [data-line="${name}|${cat}"]`);
const plus = (page, name, cat) => line(page, name, cat).locator('[data-inc]');
const minus = (page, name, cat) => line(page, name, cat).locator('[data-dec]');
const num = (page, name, cat) => line(page, name, cat).locator('input.qd-n');

test('day chips: Today by default, Yesterday one tap, Other day opens a date field — all in local time', async ({ page }) => {
  await openDay(page);
  const local = await page.evaluate(() => {
    const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const t = new Date(), y = new Date(); y.setDate(y.getDate() - 1); return { t: f(t), y: f(y) };
  });
  await expect(page.locator('#qdDays [data-day="today"]')).toHaveClass(/active/);
  expect(await page.evaluate(() => qdDay)).toBe(local.t);
  await expect(page.locator('#qdDate')).toBeHidden();
  await expect(page.locator('#qdTotal')).toContainText('Today: 0 lessons');
  await page.locator('#qdDays [data-day="yesterday"]').click();
  await expect(page.locator('#qdDays [data-day="yesterday"]')).toHaveClass(/active/);
  expect(await page.evaluate(() => qdDay)).toBe(local.y);
  await expect(page.locator('#qdTotal')).toContainText('Yesterday:');
  await page.locator('#qdDays [data-day="other"]').click();
  await expect(page.locator('#qdDate')).toBeVisible();
  await page.locator('#qdDate').fill('2026-09-08');
  await page.locator('#qdDate').dispatchEvent('change');
  expect(await page.evaluate(() => qdDay)).toBe('2026-09-08');
  // Status is not a first-screen decision: hidden under Options, default Unpaid
  await expect(page.locator('#qdPaid')).toBeHidden();
  expect(await page.locator('#qdPaid').inputValue()).toBe('false');
});

test('steppers: only the types each instructor gives, price from their history, Save inserts one row per type with the right totals', async ({ page }) => {
  await openDay(page);
  // recent people only, busiest first; Heitor (no lessons in 90 days) is behind «+ Add instructor»
  const rows = await page.locator('#qdBody [data-row]').evaluateAll(els => els.map(e => e.dataset.row));
  expect(rows).toEqual(['Matilde', 'Romildo Ramos', 'Yuri Medeiros']);   // 6, 4 and 2 lessons in the last 90 days
  await expect(page.locator('#qdBody [data-row="Heitor Souza"]')).toHaveCount(0);
  // only the types they actually give
  expect(await page.locator('#qdBody [data-row="Matilde"] .qd-line').count()).toBe(1);
  await expect(line(page, 'Matilde', 'Surf Camp')).toHaveCount(0);
  // usual price, not the one-off €30 nor the €250 salary row
  await expect(line(page, 'Matilde', 'Surf School').locator('.qd-price')).toHaveText('€25.00');
  await expect(line(page, 'Romildo Ramos', 'Surf Camp').locator('.qd-price')).toHaveText('€30.00');
  await expect(page.locator('#qdSave')).toBeDisabled();

  await plus(page, 'Matilde', 'Surf School').click();
  await plus(page, 'Matilde', 'Surf School').click();
  await plus(page, 'Matilde', 'Surf School').click();
  await minus(page, 'Matilde', 'Surf School').click();       // 2
  await plus(page, 'Romildo Ramos', 'Surf Camp').click();    // 1
  // a type outside their history via «More types»
  await page.locator('#qdBody [data-row="Yuri Medeiros"] [data-more]').click();
  await plus(page, 'Yuri Medeiros', 'Theory').click();
  // a special price through the small «price» link
  await line(page, 'Yuri Medeiros', 'Theory').locator('[data-pe]').click();
  await line(page, 'Yuri Medeiros', 'Theory').locator('.qd-price input').fill('20');
  await line(page, 'Yuri Medeiros', 'Theory').locator('.qd-price input').press('Enter');
  // someone not in the usual list
  await page.locator('#qdSearch').fill('heitor');
  await page.locator('#qdBody [data-add="Heitor Souza"]').click();
  await expect(page.locator('#qdSearch')).toHaveValue('');
  await expect(line(page, 'Heitor Souza', 'Junior Camp')).toHaveCount(1);
  await plus(page, 'Heitor Souza', 'Junior Camp').click();

  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('2');
  // 2×25 + 1×30 + 1×20 + 1×30 = 130
  await expect(page.locator('#qdTotal')).toHaveText('Today: 5 lessons · €130.00');
  await expect(page.locator('#qdBody [data-rt="Matilde"]')).toHaveText('€50.00');
  await page.locator('#qdSave').click();
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
  const w = await page.evaluate(() => ({ ...window.__w, today: (() => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })(), msg: document.getElementById('messageBox').textContent }));
  expect(w.updates).toEqual([]);
  expect(w.deletes).toEqual([]);
  const ins = Object.fromEntries(w.inserts.map(d => [`${d.instructorName}|${d.lessonCategory}`, [d.numberOfLessons, d.priceUnit, d.date, d.paid, d.paymentType]]));
  expect(ins).toEqual({
    'Matilde|Surf School': [2, 25, w.today, false, 'Recibo Verde'],
    'Romildo Ramos|Surf Camp': [1, 30, w.today, false, 'Recibo Verde'],
    'Yuri Medeiros|Theory': [1, 20, w.today, false, 'Cash'],
    'Heitor Souza|Junior Camp': [1, 30, w.today, false, 'Recibo Verde'],
  });
  expect(w.msg).toContain('5 lessons · €130.00 saved (4 new)');
});

test('re-open: the day\'s saved lessons come pre-filled; editing updates the row, 0 deletes it, paid rows are never touched — no duplicates', async ({ page }) => {
  await openDay(page, { today: [
    { id: 'm1', name: 'Matilde', cat: 'Surf School', n: 2, price: 25 },
    { id: 'r1', name: 'Romildo Ramos', cat: 'Surf Camp', n: 1, price: 30, paid: true },
    { id: 'y1', name: 'Yuri Medeiros', cat: 'Kids Camp', n: 3, price: 30 },
    { id: 't1', name: 'Tiago Novo', cat: 'Theoric', n: 1, price: 20 },    // not "recent", odd category: still shown
  ] });
  await expect(page.locator('#qdSavedNote')).toBeVisible();
  await expect(page.locator('#qdSavedNote')).toContainText('7 lessons');
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('2');
  await expect(num(page, 'Yuri Medeiros', 'Kids Camp')).toHaveValue('3');
  await expect(num(page, 'Tiago Novo', 'Theoric')).toHaveValue('1');
  // paid → locked, shown but no stepper
  await expect(line(page, 'Romildo Ramos', 'Surf Camp').locator('input.qd-n')).toHaveCount(0);
  await expect(line(page, 'Romildo Ramos', 'Surf Camp')).toContainText('Paid');
  await expect(page.locator('#qdTotal')).toHaveText('Today: 7 lessons · €190.00');   // 2×25 + 1×30 paid + 3×30 + 1×20
  await expect(page.locator('#qdState')).toHaveText('All saved');
  await expect(page.locator('#qdSave')).toBeDisabled();

  await plus(page, 'Matilde', 'Surf School').click();                // 2 → 3: update count only
  for (let i = 0; i < 3; i++) await minus(page, 'Yuri Medeiros', 'Kids Camp').click();   // 3 → 0: delete
  await expect(page.locator('#qdState')).toContainText('not saved yet');
  await expect(page.locator('#qdTotal')).toHaveText('Today: 5 lessons · €125.00');
  await page.locator('#qdSave').click();
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
  const w = await page.evaluate(() => window.__w);
  expect(w.inserts).toEqual([]);                                     // nothing saved twice
  expect(w.updates).toEqual([{ id: 'm1', patch: { num_lessons: 3 } }]);   // only the count — paid/notes/payment untouched
  expect(w.deletes).toEqual(['y1']);
  expect(w.updates.concat(w.deletes).some(x => JSON.stringify(x).includes('r1'))).toBe(false);

  // price change through the link updates the price on the same row
  await page.locator('#addLessonBtn').click();
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('2');   // stubbed loader → still the seeded 2
  await line(page, 'Matilde', 'Surf School').locator('[data-pe]').click();
  await line(page, 'Matilde', 'Surf School').locator('.qd-price input').fill('28');
  await line(page, 'Matilde', 'Surf School').locator('.qd-price input').press('Enter');
  await page.locator('#qdSave').click();
  const w2 = await page.evaluate(() => window.__w);
  expect(w2.updates[1]).toEqual({ id: 'm1', patch: { price_unit: 28 } });
  expect(w2.inserts).toEqual([]);
});

test('switching day keeps typed numbers when neither day has saved lessons, and asks before dropping them otherwise', async ({ page }) => {
  await openDay(page);
  await plus(page, 'Matilde', 'Surf School').click();
  await page.locator('#qdDays [data-day="yesterday"]').click();      // nothing saved on either day → numbers move with the day
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('1');
  await expect(page.locator('#qdTotal')).toContainText('Yesterday: 1 lesson');
  // a day with saved lessons → confirm; dismissing keeps everything as it was
  await page.evaluate(() => { entries.push({ id: 'old', instructorId: 'x', date: '2026-09-08', instructorName: 'Matilde', lessonCategory: 'Surf School', numberOfLessons: 4, paymentType: 'Recibo Verde', priceUnit: 25, total: 100, paid: false, notes: '' }); });
  page.once('dialog', d => d.dismiss());
  await page.locator('#qdDays [data-day="other"]').click();
  await page.locator('#qdDate').fill('2026-09-08');
  await page.locator('#qdDate').dispatchEvent('change');
  expect(await page.evaluate(() => qdDay)).not.toBe('2026-09-08');
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('1');
  page.once('dialog', d => d.accept());
  await page.locator('#qdDate').fill('2026-09-08');
  await page.locator('#qdDate').dispatchEvent('change');
  expect(await page.evaluate(() => qdDay)).toBe('2026-09-08');
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('4');
});

test('a write that RLS silently refuses shows the real error inside the modal and keeps the numbers', async ({ page }) => {
  await openDay(page, { today: [{ id: 'm1', name: 'Matilde', cat: 'Surf School', n: 2, price: 25 }] });
  await page.evaluate(() => {
    // the REAL updateLessonCount against a client whose update matches 0 rows (what RLS does — no error, no rows)
    updateLessonCount = window.__origFn.updateLessonCount;
    const c = { from: () => c, update: () => c, eq: () => c, select: async () => ({ data: [], error: null }) };
    supabaseClient = c;
    withRetry = async (fn) => fn();
  });
  await plus(page, 'Matilde', 'Surf School').click();
  await page.locator('#qdSave').click();
  await expect(page.locator('#qdMsg')).toBeVisible();
  await expect(page.locator('#qdMsg')).toContainText('no write permission');
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('3');
  await expect(page.locator('#qdSave')).toBeEnabled();
  // and the real functions do check the returned rows
  const src = await page.evaluate(() => window.__orig);
  expect(src.u).toMatch(/select\("id"\)/);
  expect(src.d).toMatch(/select\("id"\)/);
  expect(src.d).toMatch(/!data\|\|!data\.length/);
});

test('phone 390px: no sideways scroll anywhere in the day, big tap targets, Save always on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDay(page, { extraPeople: 12, today: [{ id: 'm1', name: 'Matilde', cat: 'Surf School', n: 2, price: 25 }] });
  await expect(page.locator('#qdBody [data-row]')).toHaveCount(15);
  const m = await page.evaluate(() => {
    const box = document.querySelector('#modal .modal');
    const over = [box, document.getElementById('quickDay'), document.getElementById('qdBody'), ...document.querySelectorAll('#qdBody .qd-line')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className || el.id);
    const r = { left: box.offsetLeft, width: box.offsetWidth };   // layout box (the open animation scales it for 200ms)
    const btns = [...document.querySelectorAll('#qdBody .qd-step button, #qdDays .pill, #qdSave')].map(b => Math.min(b.offsetWidth, b.offsetHeight));
    return { over, docW: document.documentElement.scrollWidth, boxW: r.width, boxLeft: r.left, minTap: Math.min(...btns) };
  });
  expect(m.over).toEqual([]);
  expect(m.docW).toBeLessThanOrEqual(390);
  expect(m.boxLeft).toBe(0);                      // full-screen sheet on phones
  expect(m.boxW).toBe(390);
  expect(m.minTap).toBeGreaterThanOrEqual(44);
  // Save visible without scrolling, and still visible after scrolling to the bottom of the list
  const save = page.locator('#qdSave');
  for (const where of ['top', 'bottom']) {
    if (where === 'bottom') await page.locator('#modal .modal').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const b = await save.boundingBox();
    expect(b && b.y >= 0 && b.y + b.height <= 844, `Save on screen at ${where}`).toBe(true);
  }
  await plus(page, 'Instructor 12', 'Surf Camp').click();
  await expect(save).toBeEnabled();
});

test('desktop 1280: same flow in a centred column, keyboard only — type, Enter to the next instructor, Save', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await openDay(page);
  const r = await page.locator('#modal .modal').boundingBox();
  expect(r.width).toBeLessThanOrEqual(560);
  expect(Math.abs((r.x + r.width / 2) - 640)).toBeLessThan(2);
  await num(page, 'Matilde', 'Surf School').focus();
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(num(page, 'Romildo Ramos', 'Surf Camp')).toBeFocused();
  await page.keyboard.type('2');
  await expect(page.locator('#qdTotal')).toHaveText('Today: 5 lessons · €135.00');
  // − / + stay out of the tab order (the number field is the keyboard target)
  expect(await page.locator('#qdBody .qd-step button').evaluateAll(bs => bs.every(b => b.tabIndex === -1))).toBe(true);
  await page.locator('#qdSave').click();
  const w = await page.evaluate(() => window.__w);
  expect(w.inserts.map(d => [d.instructorName, d.numberOfLessons, d.priceUnit]).sort()).toEqual([['Matilde', 3, 25], ['Romildo Ramos', 2, 30]]);
});

test('line by line stays for exceptions, one blue button per view', async ({ page }) => {
  await openDay(page);
  await page.locator('#modeLine').click();
  await expect(page.locator('#lineMode')).toBeVisible();
  await expect(page.locator('#qdBar')).toBeHidden();
  await expect(page.locator('#fNotes')).toBeVisible();
  await page.locator('#modeQuick').click();
  await expect(page.locator('#quickDay')).toBeVisible();
  await expect(page.locator('#qdBar')).toBeVisible();
  expect(await page.locator('#modal .btn-p:visible').count()).toBe(1);
});

test('a price typed for one day never sticks: the next day / next open starts from the usual price again', async ({ page }) => {
  await openDay(page);
  await plus(page, 'Matilde', 'Surf School').click();
  await line(page, 'Matilde', 'Surf School').locator('[data-pe]').click();
  await line(page, 'Matilde', 'Surf School').locator('.qd-price input').fill('40');
  await line(page, 'Matilde', 'Surf School').locator('.qd-price input').press('Enter');
  await page.locator('#qdSave').click();
  expect((await page.evaluate(() => window.__w.inserts))[0].priceUnit).toBe(40);
  await page.locator('#addLessonBtn').click();
  await expect(line(page, 'Matilde', 'Surf School').locator('.qd-price')).toHaveText('€25.00');
  await page.locator('#qdDays [data-day="yesterday"]').click();
  await expect(line(page, 'Matilde', 'Surf School').locator('.qd-price')).toHaveText('€25.00');
});

test('someone else saved the same day meanwhile → nothing is written, the day reloads with what is saved', async ({ page }) => {
  await openDay(page, { today: [{ id: 'm1', name: 'Matilde', cat: 'Surf School', n: 2, price: 25 }] });
  await plus(page, 'Matilde', 'Surf School').click();
  // another phone saves Romildo for the same day (realtime refreshed `entries`)
  await page.evaluate(() => { const x = new Date(); const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    entries.push({ id: 'other', instructorId: 'x', date: iso, instructorName: 'Romildo Ramos', lessonCategory: 'Surf Camp', numberOfLessons: 2, paymentType: 'Recibo Verde', priceUnit: 30, total: 60, paid: false, notes: '' }); });
  await page.locator('#qdSave').click();
  const w = await page.evaluate(() => window.__w);
  expect(w.inserts.length + w.updates.length + w.deletes.length).toBe(0);
  await expect(page.locator('#qdMsg')).toContainText('Someone else changed this day');
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('2');
  await expect(num(page, 'Romildo Ramos', 'Surf Camp')).toHaveValue('2');
  // saving again now works from the fresh numbers
  await plus(page, 'Matilde', 'Surf School').click();
  await page.locator('#qdSave').click();
  expect((await page.evaluate(() => window.__w.updates))).toEqual([{ id: 'm1', patch: { num_lessons: 3 } }]);
});

test('line by line opens on the day picked above', async ({ page }) => {
  await openDay(page);
  await page.locator('#qdDays [data-day="yesterday"]').click();
  await page.locator('#modeLine').click();
  expect(await page.locator('#fDate').inputValue()).toBe(await page.evaluate(() => qdYesterdayIso()));
});

test('search: filters the list, ignores accents, finds active instructors outside the 90 days, × clears, Enter on one result goes to its stepper', async ({ page }) => {
  await openDay(page);
  await page.evaluate(() => { instructorDirectory.push({ id: 'dc', name: 'Cauê Flores', rate: 30, paymentType: 'Recibo Verde', vatPct: 0 }); });
  const rows = () => page.locator('#qdBody [data-row]').evaluateAll(els => els.map(e => e.dataset.row));
  // filter the usual list
  await page.locator('#qdSearch').fill('MAT');
  expect(await rows()).toEqual(['Matilde']);
  await expect(page.locator('#qdSearchClear')).toBeVisible();
  // typed numbers survive filtering
  await plus(page, 'Matilde', 'Surf School').click();
  await page.locator('#qdSearchClear').click();
  await expect(page.locator('#qdSearch')).toHaveValue('');
  await expect(page.locator('#qdSearchClear')).toBeHidden();
  expect(await rows()).toEqual(['Matilde', 'Romildo Ramos', 'Yuri Medeiros']);
  await expect(num(page, 'Matilde', 'Surf School')).toHaveValue('1');
  // accent-insensitive, and someone not in the 90-day list (no lessons at all) shows as «tap to add»
  await page.locator('#qdSearch').fill('caue');
  expect(await rows()).toEqual([]);
  await expect(page.locator('#qdBody [data-add]')).toHaveText(['Cauê Flores']);
  // Enter on the single result adds them and lands on their first stepper
  await page.locator('#qdSearch').press('Enter');
  await expect(page.locator('#qdSearch')).toHaveValue('');
  await expect(page.locator('#qdBody [data-row="Cauê Flores"] input.qd-n').first()).toBeFocused();
  await page.keyboard.type('2');
  // Enter on a single match already in the list focuses it too
  await page.locator('#qdSearch').fill('yuri');
  await page.locator('#qdSearch').press('Enter');
  await expect(num(page, 'Yuri Medeiros', 'Kids Camp')).toBeFocused();
  // nothing found says so; Escape clears
  await page.locator('#qdSearch').fill('zzz');
  await expect(page.locator('#qdBody .qd-nomatch')).toContainText('No instructor matches');
  await page.locator('#qdSearch').press('Escape');
  await expect(page.locator('#qdSearch')).toHaveValue('');
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await page.locator('#qdSave').click();
  const ins = await page.evaluate(() => window.__w.inserts.map(d => [d.instructorName, d.lessonCategory, d.numberOfLessons]));
  expect(ins.sort()).toEqual([['Cauê Flores', 'Surf School', 2], ['Matilde', 'Surf School', 1]]);   // no history → the school's top type
});

test('search at 390px: sticky with the day chips, no sideways scroll, results are big tap targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDay(page, { extraPeople: 12 });
  await page.evaluate(() => { for (let i = 0; i < 6; i++) instructorDirectory.push({ id: 'n' + i, name: `Novo Instrutor Com Um Nome Bastante Comprido ${i}`, rate: 30, paymentType: 'Cash', vatPct: 0 }); });
  await page.locator('#qdSearch').fill('novo');
  await expect(page.locator('#qdBody [data-add]')).toHaveCount(6);
  const m = await page.evaluate(() => {
    const box = document.querySelector('#modal .modal');
    const over = [box, document.getElementById('quickDay'), document.getElementById('qdHead'), document.getElementById('qdBody'), ...document.querySelectorAll('#qdBody .qd-result')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className || el.id);
    return { over, docW: document.documentElement.scrollWidth, tap: Math.min(...[...document.querySelectorAll('#qdBody .qd-result, #qdSearch')].map(b => b.offsetHeight)) };
  });
  expect(m.over).toEqual([]);
  expect(m.docW).toBeLessThanOrEqual(390);
  expect(m.tap).toBeGreaterThanOrEqual(44);
  // scroll the list: chips + search stay pinned under the modal title
  await page.locator('#qdSearch').fill('');
  await page.locator('#modal .modal').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(250);
  const head = await page.locator('#qdHead').boundingBox(), title = await page.locator('#modal .mhdr').boundingBox(), search = await page.locator('#qdSearch').boundingBox();
  expect(Math.abs(head.y - (title.y + title.height))).toBeLessThan(2);
  expect(search.y).toBeGreaterThan(0);
  await expect(page.locator('#qdDays [data-day="yesterday"]')).toBeInViewport();
  const save = await page.locator('#qdSave').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(844);
});
