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

test('morocco week: the import audit = the oracle (38 rows = 32 guests + 6 left out, each with its reason)', () => {
  const a = H.GT.guestAudit(fs.readFileSync(H.CSV(H.FILE), 'utf8'), H.FILE, H.CC.MA);
  const o = oracle(H.FILE);
  expect(a.rows).toBe(o.rows);
  expect(a.guests).toBe(o.guests.length);
  expect(a.left.map(x => [x.line, x.name, x.kind === 'other_camp' ? 'other_camp' : x.kind])).toEqual(o.left_out.map(x => [x.line, x.name, x.reason]));
});

test('morocco week: Overview and the Cleaning message of Sat 14 — two parts: rooms left, rooms to prepare (Floriane\'s template), no emoji in any team message', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await H.openWeek(page);
  await expect(page.locator('#weekRoot .wk-week')).toContainText('Week 46');
  // Since 14 Nov the Morocco Cleaning message is sent in Darija (tests/morocco-darija.spec.js); this is its English twin, shown beside it.
  // 16 Nov (Floriane): part 1 = one line per room being left; part 2 = the rooms to prepare — private room, one person →
  // «double bed/1 person», two → «double or twin?» unless the room name says (9 is a triple), shared room → «<n> beds»;
  // staying on in the same room is not a room to prepare (Tom Baker, 8), a new bed is (Clara Schmidt, 13); a room move
  // counts in the new room (Pieter de Vries → 6, Rui Alves → 13). Ben Clarke has no room: not in the cleaning day.
  const clean = await page.evaluate(() => WeekUI.bodyOf('cleaning', '2026-11-14', 'en'));
  expect(clean).toBe([
    '*CHECK OUT - SAT 14 NOV*', '',
    'Room 8: 1 person leaving',
    'Room 11: 1 person leaving',
    'Room 13: 1 person leaving, 1 changing bed', '',
    '*CHECK IN - SAT 14 NOV*', '',
    'Hello! Could you please prepare the following:',
    'Room 1: double bed/1 person',
    'Room 2: double bed/1 person',
    'Room 4: double or twin?/2 people',
    'Room 5: 1 bed',
    'Room 6: 3 people',
    'Room 8: 1 bed',
    'Room 9: 3 beds/3 people',
    'Room 13: 3 beds',
    'Thank you!',
  ].join('\n'));
  // A day with arrivals only: one part, with the date; a private room with «twin» in its name says so.
  expect(await page.evaluate(() => WeekUI.bodyOf('cleaning', '2026-11-15', 'en'))).toBe(['*CHECK IN - SUN 15 NOV*', '', 'Hello! Could you please prepare the following:', 'Room 5: 1 bed', 'Room 7: double bed/1 person', 'Room 13: 2 beds', 'Thank you!'].join('\n'));
  const twin = await page.evaluate(() => { const e = WeekUI._state.cache['2026-11-14']; const keep = e.rows;
    e.rows = keep.map(g => g.booking_ref === 'MA-1001' ? { ...g, accommodation: '4 - Crocro Twin Private Room' } : g);
    try { return WeekUI.bodyOf('cleaning', '2026-11-14', 'en'); } finally { e.rows = keep; } });
  expect(twin).toContain('Room 4: twin beds/2 people');
  // The week message keeps the guests by room (unchanged).
  expect((await page.evaluate(() => WeekUI.bodyOf('cleaning', 'week', 'en'))).split('\n')[0]).toBe('*ROOMS - 14 TO 21 NOV*');
  // Every team message, every day and the week: no emoji (wa.me shows some as «?»).
  const all = await page.evaluate(() => { const out = []; ['cleaning', 'kitchen', 'surf', 'guests'].forEach(t => ['week', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].forEach(d => out.push(WeekUI.bodyOf(t, d)))); return out.join('\n'); });
  expect(H.EMOJI.test(all)).toBe(false);
  expect(errors).toEqual([]);
});

test('morocco week: To check names the Morocco gaps — room not in the list, guest without a room, private room with two bookings, room moves, phones fixed', async ({ page }) => {
  await H.openWeek(page);
  const items = await page.evaluate(() => WeekUI.toCheck().map(i => `${i.tab}: ${i.text} — ${i.who || (i.guests || []).map(g => g.guest_name).join(', ')}`));
  const has = re => expect(items.some(x => re.test(x)), `${re} in\n${items.join('\n')}`).toBe(true);
  has(/^rooms: 1 guest in a room the app does not know yet.*Sara Ali \(10 - Mirleft Private Room\)/);
  has(/^rooms: 1 guest without a room in the file.*Ben Clarke/);
  has(/^rooms: 1 private room with two bookings on the same night.*6 - Safi/);
  has(/^rooms: 2 room moves taken on the Saturday.*Pieter de Vries.*Rui Alves/);
  has(/^guests: .*phones? had a wrong 0.*\+212661000019/);
});

test('morocco week: Kitchen and Surf messages (diets, allergies, levels); the Transfers message (in Transport) in the camp\'s format', async ({ page }) => {
  const st = await H.openWeek(page, { trips: H.tripsFromFile() });
  const k = await rawMsg(page, 'kitchen', '2026-11-15');
  expect(k).toContain('*KITCHEN - SUN 15 NOV*');
  expect(k).toContain('*Dinner:* 21 people');   // = the oracle's dinner of Sun 15
  expect(k).toContain('*Allergies*\n- Marta Rossi _(nuts)_');
  expect(k).toContain('*Vegetarian*');
  const s = await rawMsg(page, 'surf', '2026-11-16');
  expect(s).toContain('*SURF - MON 16 NOV*');
  expect(s).toMatch(/\*Advanced\*\n- Oliver Smith _\(coaching\)_/);
  const t = await page.evaluate(() => TransportUI.dayMessage('2026-11-16'));   // Transport's «Send the whole day» since 15 Nov 2026
  // Floriane's driver format (16 Nov 2026): every line labelled, the airport by its city, Date dd.mm.yyyy, «small car».
  expect(t).toBe(['*TRANSFERS - MON 16 NOV*', '', 'Marrakech airport to Surfcamp', 'Number of people: 1', 'Name: Ana Ruiz', 'Contact WhatsApp: +34600000028', 'Flight number: RK3033', 'Arrival time: 09:30', 'Date: 16.11.2026', 'Car: small car', '',
    'Marrakech airport to Surfcamp', 'Number of people: 1', 'Name: Oliver Smith', 'Contact WhatsApp: +447700900007', 'Flight number: TO3226', 'Arrival time: 22:10', 'Date: 16.11.2026', 'Car: small car'].join('\n'));
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
  expect(now).not.toContain('بيت 5:');                 // her room (5) has nothing to prepare any more
  expect(now).not.toMatch(/UPDATE|^[+–] /m);
  expect(sent.rows[0].text).toContain('بيت 5: ناموسية وحدة');
});

test('morocco week: screenshots at 390 and 1280 — no horizontal overflow on any tab', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = collectFatalErrors(page);
  await H.openWeek(page, { trips: H.tripsFromFile() });
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const t of ['overview', 'rooms', 'kitchen', 'surf', 'guests']) {
      await page.click(`#weekRoot .wk-tabs .pill[data-tab="${t}"]`);
      await page.waitForTimeout(150);
      expect(await H.noOverflow(page), `${t} at ${w}`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `week-${t}-${w}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test('morocco rooms: the 13 real room strings (spacing around «-» as in Bookinglayer), the two Anza rooms stay apart, Imsouane room ≠ Imsouane van run', async ({ page }) => {
  const C = H.CC;
  const real = ['0 - Tamri Private Room', '1 - Imsouane Private Room', '2 - Boilers Private Room', '3 - La Source Private Room', '4 - Crocro Private Room',
    '5 - Panorama Point Female shared room (6pax)', '6 - Safi Family Private Room', '7 - Anza Private Room', '8 - Banana Point mixed shared room (4pax)',
    '9- Anza Triple Room Ensuite', '11 -Tifnit Private Room', '12 - Douira Private Room', '13 - Anchor Point mixed shared room (8pax)'];
  expect(real.map(n => { const r = C.maRoomParse(n); const k = C.MA.rooms.find(x => C.maRoomMatch(r, x)); return k ? `${k.n} ${k.name}` : 'unknown'; }))
    .toEqual(['0 Tamri', '1 Imsouane', '2 Boilers', '3 La Source', '4 Crocro', '5 Panorama Point', '6 Safi', '7 Anza', '8 Banana Point', '9 Anza', '11 Tifnit', '12 Douira', '13 Anchor Point']);
  expect(real.every(n => C.maRoomKnown(n))).toBe(true);
  expect(C.maRoomKnown('10 - Anza Private Room')).toBe(false);                 // a name alone is not room 7 or 9
  expect(C.maRoomKnown('13 - Castelo surf house shared room')).toBe(false);
  await H.openWeek(page);
  const P = await page.evaluate(() => WeekUI.roomPlan().rooms.map(r => ({ label: r.label, shared: r.shared, beds: r.beds, people: [...new Set(r.stays.map(s => s.g.guest_name))].sort() })));
  const room = l => P.find(r => r.label === l);
  expect(room('7 - Anza').people).toEqual(['Hugo Leroy']);
  expect(room('9 - Anza').people).toEqual(['Lea Duval', 'Max Duval', 'Theo Duval']);
  expect(room('5 - Panorama Point')).toMatchObject({ shared: true, beds: 6 });
  expect(room('1 - Imsouane').people).toEqual(['Noah Weiss']);
  expect(P.map(r => r.label)).toEqual(['0 - Tamri', '1 - Imsouane', '2 - Boilers', '3 - La Source', '4 - Crocro', '5 - Panorama Point', '6 - Safi', '7 - Anza', '8 - Banana Point', '9 - Anza', '10 - Mirleft', '11 - Tifnit', '12 - Douira', '13 - Anchor Point', 'Outside of camp']);
  // The 3 Duvals fit their triple room: no «over its beds» for 9 - Anza.
  const items = await page.evaluate(() => WeekUI.toCheck().map(i => i.who || '').join(' | '));
  expect(items).not.toMatch(/9 - Anza: \d guests for/);
  // The van run to Imsouane is a van destination, not the room: a run never lands in Rooms.
  expect(H.CC.MA.vanRates.some(r => r.route === 'Imsouane')).toBe(true);
});

test('morocco transfers: the airport of every leg = the oracle (product «(Marrakesh)» / «(Agadir)», location, flight field)', () => {
  for (const f of [H.FILE, H.FILE2]) {
    const o = oracle(f);
    const trips = H.GT.parse(fs.readFileSync(H.CSV(f), 'utf8'), f, null, H.CC.MA).trips;
    const want = new Map(o.transfers.flatMap(x => [[`${x.booking}|${x.name}|arr`, x.arrival_airport], [`${x.booking}|${x.name}|dep`, x.departure_airport]]));
    // One trip per booking and direction (guests travel together): its airport is the one of its guests;
    // guests of one trip with different airports in the file → the trip says so (flag), never silently.
    const bad = [];
    trips.forEach(t => {
      const aps = [...new Set(t.guests.map(g => want.get(`${t.booking_ref}|${g}|${t.kind === 'airport_departure' ? 'dep' : 'arr'}`)))];
      if (!aps.includes(t.place)) bad.push(`${t.key}: app ${t.place} / oracle ${aps.join(',')}`);
      if (aps.length > 1 && !t.flags.some(x => /different airports/.test(x))) bad.push(`${t.key}: guests with airports ${aps.join(', ')} and no flag`);
    });
    expect(bad, f).toEqual([]);
    expect(trips.length).toBeGreaterThan(20);
  }
});

test('morocco «Send the whole week» (Transport, was Week → Send to Let Us Tours): the week in house style, Saturday departures in, sent ones marked, the count line', async ({ page }) => {
  const trips = H.tripsFromFile().map(t => t.import_key === 'bl:MA-1002:arr' ? { ...t, status: 'sent' } : t);
  await H.openWeek(page, { trips, now: '2026-11-16T12:00' });
  await page.evaluate(() => WeekUI.toTransport());
  const week = await page.evaluate(() => TransportUI.weekMessage('2026-11-14'));
  const lines = week.split('\n');
  expect(lines[0]).toBe('*TRANSFERS - 14 TO 21 NOV*');
  const heads = lines.filter(l => /^\*[A-Z]{3} \d+ [A-Z]{3}\*$/.test(l));
  expect(heads).toEqual(['*MON 16 NOV*', '*TUE 17 NOV*', '*WED 18 NOV*', '*FRI 20 NOV*', '*SAT 21 NOV*']);   // Sat 14 / Sun 15 have passed (now Mon 16 12:00)
  expect(week).not.toContain('Ana Ruiz');                                    // Mon 16 09:30: passed
  expect(week).toContain('Marrakech airport to Surfcamp\nNumber of people: 1\nName: Oliver Smith');   // Mon 16 22:10: still to come
  const sat = week.slice(week.indexOf('*SAT 21 NOV*'));
  expect(sat).toContain('Surfcamp to Agadir airport:\nNumber of people: 1\nName: Sophie Martin');   // a Saturday departure (03:30)
  expect((sat.match(/^Surfcamp to \w+ airport:/gm) || []).length).toBeGreaterThanOrEqual(6);
  expect(sat).not.toMatch(/airport to Surfcamp/);                              // next week's Saturday arrivals stay out
  expect(H.EMOJI.test(week)).toBe(false);
  await expect(page.locator('#transportRoot [data-send-week]')).toHaveAttribute('title', /Let Us Tours/);
  await page.click('#transportRoot [data-send-week]');
  const sent = await page.evaluate(() => decodeURIComponent(window.__opened.pop()));
  expect(sent.startsWith('https://wa.me/212600000101?text=*TRANSFERS - 14 TO 21 NOV*')).toBe(true);
  expect(sent.split('?text=')[1]).toBe(week);
  // the week's arrivals / departures in one line = the Airport tile's count
  const c = await page.evaluate(() => TransportUI.weekCount(TransportUI._state.trips.filter(t => TransportUI.inWeek(t, '2026-11-14'))));
  await expect(page.locator('#transportRoot [data-week-count]')).toContainText(`Arrivals ${c.arr.n} · ${c.arr.pax} persons`);
  await expect(page.locator('#transportRoot [data-week-count]')).toContainText(`Departures ${c.dep.n} · ${c.dep.pax} persons`);
  expect(await page.locator('#transportRoot [data-total]').count()).toBe(0);   // the week-total tiles are gone (16 Nov 2026)
  // phone: the first trip on the first screen (the week totals sit under the day list)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.querySelector('#transportRoot .tr-day .tr-row').getBoundingClientRect().top)).toBeLessThan(844);
  await page.setViewportSize({ width: 1280, height: 900 });
  fs.mkdirSync(path.join(__dirname, '..', 'test-results', 'transfers-message-shots'), { recursive: true });
  for (const [w, hgt] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(150);
    expect(await H.noOverflow(page)).toBe(true);
    await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'transfers-message-shots', `ma-transport-week-${w}.png`), fullPage: true });
  }
});

// ── Golden: the team messages (Darija + English twin) and the transfers message to Let Us Tours ──
// Captured once from main before the transfers moved to Transport (15 Nov 2026), see tests/week-golden.js.
// The whole-week message to Let Us Tours with its three airports (Agadir, Marrakech, Essaouira) must be
// the bytes Week → Transfers sent; Rooms, Kitchen, Surf and Guests must not change at all.
// 16 Nov 2026 (Floriane's feedback, on purpose): the Morocco Cleaning DAY messages (two parts: rooms left, rooms to
// prepare) and the driver blocks (her labelled format) were re-captured with GOLDEN_WRITE=1 — only the keys
// cleaning|<day>, cleaning-en|<day> and transfers|… changed; the week message, Kitchen, Surf, Guests, To check,
// the people check and the day model kept their hashes. 16 Nov 2026 (QA): a departure without a pick-up time says «TBC (flight 09:30)» —
// only the transfers|… keys with such a departure were re-captured.
const WG = require('./week-golden');
const MA_TRANSFERS_TEXT = (day, ws) => (TransportUI.weekMessage ? (day === 'week' ? TransportUI.weekMessage(ws) : TransportUI.dayMessage(day))
  : WeekUI.dress(WeekUI.bodyOf('transfers', day), TransportUI.colomboNow().slice(0, 10)));
for (const [kase, mk] of [
  ['file1-mon16', () => ({ trips: H.tripsFromFile().map(t => t.import_key === 'bl:MA-1002:arr' ? { ...t, status: 'sent' } : t), now: '2026-11-16T12:00' })],
  ['file1-sat14-0600', () => ({ trips: H.tripsFromFile().map(t => t.import_key === 'bl:MA-1001:arr' ? { ...t, status: 'confirmed' } : t.import_key === 'bl:MA-1007:arr' ? { ...t, status: 'sent', needs_resend: true } : t), now: '2026-11-14T06:00' })],
  ['file2', () => ({ guests: H.guestsFromFile(H.FILE2, '22222222-0000-4000-8000-000000000009', '2026-11-15T08:00:00Z'), trips: H.tripsFromFile(H.FILE2) })],
]) {
  test(`morocco golden (${kase}): Cleaning (Darija + English), Kitchen, Surf, Guests byte-identical; the transfers message to Let Us Tours = the one Week sent`, async ({ page }) => {
    const opts = mk();
    await H.openWeek(page, opts);
    expect(WG.check('ma', kase, await WG.teamMessages(page, { darija: true }))).toEqual([]);
    const tr = await WG.transfersMessages(page, MA_TRANSFERS_TEXT);
    expect(WG.check('ma', kase, tr)).toEqual([]);
    if (kase === 'file1-sat14-0600') {
      // the three airports are in this week's message (sanity of the fixture, not of the format)
      const places = await page.evaluate(() => [...new Set(TransportUI._state.trips.filter(t => GuestsTrips.transfersTrips(TransportUI._state.trips, { day: 'week', ws: '2026-11-14', now: TransportUI.colomboNow() }).includes(t)).map(t => t.place))].sort());
      expect(places).toEqual(expect.arrayContaining(['AGA', 'ESU', 'RAK']));   // (+ CMN: the fixture's flagged non-Morocco airport)
    }
    if (process.env.GOLDEN_WRITE !== '1') expect(WG.covered('ma', kase, 'transfers|')).toBe(9);
  });
}
