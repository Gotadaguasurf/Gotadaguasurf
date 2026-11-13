// Camp hub · Week tab (Sri Lanka, 13 Nov 2026) — stubbed Supabase.
//
// Francisco's back office: the Monday Guests import (camp_week_guests) turned
// into one WhatsApp text per team and day. Full view only — Nadith's
// ?view=local keeps exactly what he has today.
// The guests are the real 7 Nov Guests file (tests/fixtures, fake phones) plus
// the four guests already in camp from an earlier file (Alexander, Alicia,
// João, Anja), so the counts are the ones of the 14 Nov staff images.
// «Now» is pinned to Tue 17 Nov 2026 10:00 Colombo (window.TRANSPORT_NOW).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const GT = require('../lib/guests-trips.js');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = '83cda02b-b63f-46fd-979a-945fd30ba5ab';
const NOW = '2026-11-17T10:00';
const FILE = 'Bookinglayer-Guests-2026-11-07 14_23.csv';
const GUESTS_CSV = path.join(__dirname, 'fixtures', FILE);
const IMPORT_NEW = '11111111-0000-4000-8000-000000000001';
const IMPORT_OLD = '11111111-0000-4000-8000-000000000000';
const D = { dilan: 'dddddddd-0000-4000-8000-000000000001', nadith: 'dddddddd-0000-4000-8000-000000000004', kitchen: 'dddddddd-0000-4000-8000-000000000005' };
const DRIVERS = [
  { id: D.dilan, location_id: LOC, name: 'Dilan', label: 'Airport van', phone: null, aliases: ['Dilan'], kinds: ['airport', 'other'], default_for: ['airport'], active: true },
  { id: D.nadith, location_id: LOC, name: 'Nadith', label: 'Camp manager', phone: '+94771234567', aliases: [], kinds: ['contact'], default_for: ['transfers_contact'], active: true },
  { id: D.kitchen, location_id: LOC, name: 'Kitchen lead', label: 'Kitchen', phone: '+94770000005', aliases: [], kinds: ['contact'], default_for: ['kitchen_contact'], active: true },
];

let seq = 0;
const uid = (p = 'eeeeeeee') => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
function guestsFromFile() {
  return GT.guestRows(fs.readFileSync(GUESTS_CSV, 'utf8'), FILE).filter(g => GT.OK_STATUS.has(g.booking_status))
    .map((g, i) => ({ id: `99999999-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, location_id: LOC, ...g, hq_match: 'missing', import_id: IMPORT_NEW, updated_at: '2026-11-16T03:42:00Z' }));
}
function carry(o) {
  return { id: uid('88888888'), location_id: LOC, week_start: '2026-11-07', booking_ref: o.ref, guest_key: o.name.toLowerCase(), guest_name: o.name, phone: o.phone || '', check_in: '2026-11-07', check_out: o.out || '2026-11-21',
    accommodation: o.acc, bed_number: '', packages: 'Surf Camp Ahangama, Sri Lanka', activities: o.act, level: o.level || '', diet: o.diet || '', allergies: o.allergies || '', nights: 14,
    arrival_time: null, arrival_flight: '', departure_time: null, departure_flight: '', has_transfer: false, booking_status: 'paid', booking_due: 0, partner: '', hq_match: 'ok',
    raw: {}, import_id: IMPORT_OLD, updated_at: '2026-11-02T05:00:00Z' };
}
const CARRY = () => [
  carry({ ref: '2026-4100', name: 'Alexander Straub', acc: 'Marissa Shared Room (4p)', act: 'Surf Equipment, Standard Surf Course ( 5 surf lessons)', level: 'Intermediate level' }),
  carry({ ref: '2026-4101', name: 'Alicia Pohl', acc: 'Unawatuna Beach Shared Room (only girls)', act: 'Surf Equipment, Surf Coaching Lessons', level: 'Experience Beginner level', diet: 'Vegan', allergies: 'lactose' }),
  carry({ ref: '2026-4102', name: 'João Lavado', acc: 'Marissa Shared Room (4p), Ahangama Beach Standard Ensuite Room', act: 'Surf Equipment', out: '2026-11-16' }),
  carry({ ref: '2026-4103', name: 'Anja Graf', acc: 'Welligama Beach Sea View Ensuite Room', act: 'Surf Equipment, Yoga Pack, Standard Surf Course ( 5 surf lessons)', level: 'Intermediate level', diet: 'Vegan' }),
];
function trip(o) {
  return { id: o.id || uid('aaaaaaaa'), location_id: LOC, kind: 'airport_arrival', trip_date: '2026-11-14', trip_time: null, pickup_time: null, flight: null, place: 'CMB', route: 'Airport → Surfcamp', purpose: 'guests',
    tour_name: null, guest_names: 'Guest', guest_phone: null, booking_ref: null, booking_checkout: null, pax: 1, vehicle: 'Car', driver_id: D.dilan, expected_price: 21000, currency: 'LKR',
    status: 'planned', source: 'bookinglayer', charge: 'bookinglayer', import_key: null, import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null,
    created_at: '2026-11-10T08:00:00Z', ...o };
}
const TRIPS = () => [
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a001', guest_names: 'Peter Mongey, Sinéad O\'Farrell', guest_phone: '+353400000001', trip_date: '2026-11-17', trip_time: '23:40', flight: 'EK650', pax: 2, booking_ref: '2026-4357', status: 'sent', needs_resend: true, sent_snapshot: { trip_date: '2026-11-17', trip_time: '21:10', flight: 'EK650', pax: 2 } }),
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a002', guest_names: 'Emilia Faccenna', trip_date: '2026-11-17', trip_time: null, booking_ref: '2026-5074' }),
  trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a003', kind: 'airport_departure', guest_names: 'Beliz Kuyumcuoglu', trip_date: '2026-11-21', vehicle: 'Minivan', booking_ref: '2026-4070' }),
];

async function stub(page, opts = {}) {
  const st = {
    guests: opts.guests || [...guestsFromFile(), ...CARRY()], msgs: (opts.msgs || []).map(m => ({ ...m })), drivers: (opts.drivers || DRIVERS).map(d => ({ ...d })),
    trips: (opts.trips || TRIPS()).map(t => ({ ...t })), ledger: opts.ledger || [], calls: [], urls: [],
  };
  const slug = opts.slug || 'sri-lanka';
  await page.route(/api\.frankfurter\.dev/, r => r.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|storage|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const method = req.method();
    st.urls.push(method + ' ' + url);
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
    const q = k => (url.match(new RegExp(`[?&]${k}=([^&]+)`)) || [])[1];
    const idEq = (q('id') || '').replace(/^eq\./, '');
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json(slug === 'sri-lanka'
      ? { id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' }
      : { id: 'loc-ma', name: 'Morocco', slug: 'morocco', currency: 'MAD', default_fx_to_eur: 10.8, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) return json(method === 'GET' ? st.ledger : []);
    if (url.includes('/rest/v1/camp_drivers')) {
      if (method === 'GET') return json(st.drivers);
      if (method === 'PATCH') { const d = st.drivers.find(x => x.id === idEq); Object.assign(d, body); st.calls.push({ t: 'driver_update', id: idEq, body }); return json([d]); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('dddddddd'), active: true, ...r })); st.drivers.push(...rows); st.calls.push({ t: 'driver_insert', rows }); return json(rows); }
    }
    if (url.includes('/rest/v1/camp_trips')) {
      if (method === 'GET') return json(st.trips);
      if (method === 'PATCH') { const t = st.trips.find(x => x.id === idEq); Object.assign(t, body); st.calls.push({ t: 'trip_update', id: idEq, body }); return json([t]); }
    }
    if (url.includes('/rest/v1/camp_transport_payments')) return json([]);
    if (url.includes('/rest/v1/rpc/camp_transport_autolink')) return json({});
    if (url.includes('/rest/v1/rpc/camp_trips_import')) { st.calls.push({ t: 'import', body }); return json({ inserted: body.p_trips.length, updated: 0, resend: 0, cancelled: 0, missing: 0, untouched: 0, guests: body.p_guests.length }); }
    if (url.includes('/rest/v1/bookings')) return json([]);
    if (url.includes('/rest/v1/camp_week_guests')) {
      if (opts.noWeekTables) return json({ code: '42P01', message: 'relation "public.camp_week_guests" does not exist' }, 404);
      if (method === 'PATCH') { const g = st.guests.find(x => x.id === idEq); Object.assign(g, body); st.calls.push({ t: 'guest_update', id: idEq, body }); return json([g]); }
      st.calls.push({ t: 'guests_get', url });
      let rows = st.guests.filter(g => g.location_id === LOC);
      if (q('order') === 'updated_at.desc') return json(rows.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 1).map(g => ({ import_id: g.import_id, updated_at: g.updated_at })));
      const imp = (q('import_id') || '').replace(/^eq\./, ''); if (imp) return json(rows.filter(g => g.import_id === imp).map(g => ({ check_in: g.check_in })));
      const lte = (q('check_in') || '').replace(/^lte\./, ''); const gte = (q('check_out') || '').replace(/^gte\./, '');
      if (lte) rows = rows.filter(g => g.check_in <= lte); if (gte) rows = rows.filter(g => g.check_out >= gte);
      return json(rows);
    }
    if (url.includes('/rest/v1/camp_week_messages')) {
      if (opts.noMessagesTable) return json({ code: '42P01', message: 'relation "public.camp_week_messages" does not exist' }, 404);
      if (method === 'GET') { const ws = (q('week_start') || '').replace(/^eq\./, ''); return json(st.msgs.filter(m => !ws || m.week_start === ws).sort((a, b) => b.sent_at.localeCompare(a.sent_at))); }
      if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: uid('77777777'), sent_at: '2026-11-17T04:31:00Z', sent_by: 'u1', ...r })); st.msgs.push(...rows); st.calls.push({ t: 'msg_insert', rows }); return json(rows); }
      if (method === 'DELETE') { st.msgs = st.msgs.filter(m => m.id !== idEq); st.calls.push({ t: 'msg_delete', id: idEq }); return json([]); }
    }
    return json([]);
  });
  return st;
}
async function call(st, kind, n = 1) {
  await expect.poll(() => st.calls.filter(c => c.t === kind).length, { timeout: 5000 }).toBeGreaterThanOrEqual(n);
  return st.calls.filter(c => c.t === kind)[n - 1];
}
async function open(page, opts = {}) {
  const st = await stub(page, opts);
  page.on('dialog', d => d.accept());
  await page.addInitScript(([now]) => { window.TRANSPORT_NOW = now; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; };
    window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true }); } catch (_) {} }, [opts.now || NOW]);
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${opts.slug || 'sri-lanka'}${opts.query || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return st;
}
async function openWeek(page, opts = {}) {
  const st = await open(page, opts);
  await page.waitForFunction(() => window.WeekUI && WeekUI._state.metaLoaded && window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('week'));
  await expect(page.locator('#weekRoot .wk-teams')).toBeVisible();
  return st;
}
const msgText = page => page.locator('#wkMsg').innerText();
const pick = async (page, team, day) => {
  await page.click(`#weekRoot .wk-teams .pill:has-text("${team}")`);
  await page.click(`#weekRoot .wk-days .pill[data-day="${day}"]`);
};
function fnv(t) { let x = 0x811c9dc5; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); }
const visiblePrimary = page => page.locator('#weekRoot .btn-p:visible').count();

// ── Access ─────────────────────────────────────────────────────────────────
test('week: tab for full Sri Lanka users only — not in local view (no request either), camp-tab-only or Morocco', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  await open(page);
  expect(await page.locator('.ntab-m[data-page="week"]').evaluate(el => el.style.display)).toBe('');
  expect(errors).toEqual([]);
  for (const [query, slug] of [['&view=local', 'sri-lanka'], ['&view=camp-tab-only', 'sri-lanka'], ['', 'morocco']]) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const st = await open(p, { query, slug });
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const shown = [...document.querySelectorAll('[data-page="week"]')].some(b => b.style.display !== 'none');
      showPage('week');
      return { shown, active: activePage, html: document.getElementById('weekRoot').innerHTML };
    });
    expect(r.shown, `${slug}${query}`).toBe(false);
    if (slug === 'sri-lanka') expect(r.active, `${slug}${query}`).not.toBe('week');   // local / camp-tab-only views refuse the page
    expect(r.html).toBe('');
    expect(st.urls.filter(u => /camp_week_/.test(u)), `${slug}${query}`).toEqual([]);
    const chips = await p.evaluate(() => (window.CAMP_CHECKS || []).filter(c => c.id.startsWith('week-')).map(c => c.run({ ledger: [], location: 'sri-lanka', isLocal: true, today: '2026-11-17' })));
    expect(chips.every(x => x == null)).toBe(true);
    await p.close();
  }
});

// ── Templates (B1), from the real 14 Nov images ─────────────────────────────
test('kitchen: day and week messages are the B1 templates, numbers of the 14 Nov image', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page);
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Sat 14 Nov – Fri 20 Nov');
  await expect(page.locator('#weekRoot .wk-count')).toHaveText('22 guests');
  await pick(page, 'Kitchen', '2026-11-17');
  expect(await msgText(page)).toBe([
    'Kitchen – Tue 17 Nov', '', 'Dinner: 21 people', 'Breakfast Wed 18: 21 people', '',
    'Vegan: 3 – Alicia Pohl, Anja Graf, Lilly Krüger', 'Allergies: Alicia Pohl – lactose', '', 'Staff not included'].join('\n'));
  await pick(page, 'Kitchen', 'week');
  expect(await msgText(page)).toBe([
    'Kitchen – week Sat 14 – Sat 21 Nov', '', 'Dinner (breakfast next morning = same number)',
    'Sat 14: 19', 'Sun 15: 19', 'Mon 16: 20', 'Tue 17: 21', 'Wed 18: 21', 'Thu 19: 21', 'Fri 20: 19', 'Sat 21: breakfast 19, then everyone leaves', '',
    'Vegan (all week): Alicia Pohl, Anja Graf, Lilly Krüger', 'Allergies: Alicia Pohl – lactose', '',
    'Staff not included. Ask diets at the welcome dinner Sat 14.'].join('\n'));
  expect(await visiblePrimary(page)).toBe(1);
  await expect(page.locator('#wkSend')).toHaveText(/Send to Kitchen lead/);
  expect(errors).toEqual([]);
});

test('cleaning: check-out / check-in / room moves per day, rooms and beds for the week', async ({ page }) => {
  await openWeek(page);
  await pick(page, 'Cleaning', '2026-11-16');
  expect(await msgText(page)).toBe([
    'Cleaning – Mon 16 Nov', '', 'Check-out (clean + new sheets)', 'Ahangama Ensuite – João Lavado', '',
    'Check-in (2)', 'Ahangama Ensuite – Peter Mongey + Sinéad O\'Farrell', '', 'In camp tonight: 20 guests'].join('\n'));
  await pick(page, 'Cleaning', '2026-11-14');
  const sat = await msgText(page);
  expect(sat).toContain('Check-in (15)');
  expect(sat).toContain('Marissa bed 1 – Simon Krenn');                  // the 7 Nov file has the Bed number column
  expect(sat).toContain('Hiriketeya Ensuite – Lanny Karine + Patrick Baggary');
  expect(sat).toContain('Room moves\nJoão Lavado: Marissa → Ahangama Ensuite (check day)');
  expect(sat).toMatch(/In camp tonight: 19 guests$/);
  await pick(page, 'Cleaning', 'week');
  const wk = await msgText(page);
  expect(wk.split('\n')[0]).toBe('Cleaning – week Sat 14 – Sat 21 Nov (22 guests)');
  expect(wk).toContain('SHARED ROOMS\nMarissa (4 beds)');
  expect(wk).toContain('- Alexander Straub: here → Sat 21');
  expect(wk).toContain('Unawatuna (girls)');
  expect(wk).toContain('Ahangama Ensuite – João Lavado: here → Mon 16; Peter Mongey + Sinéad O\'Farrell: Mon 16 → Fri 20');
  expect(wk).toContain('Welligama Sea View Ensuite – Anja Graf: here → Sat 21');
  expect(wk).toMatch(/Mon 16: João out, Peter \+ Sinéad in · Tue 17: Emilia in · Fri 20: Peter \+ Sinéad out · Sat 21: everyone out$/);
});

test('surf: students per day by course and level, intensive group, yoga line (B8)', async ({ page }) => {
  await openWeek(page);
  await pick(page, 'Surf', '2026-11-17');
  const day = await msgText(page);
  expect(day.split('\n').slice(0, 4)).toEqual(['Surf – Tue 17 Nov', '', 'Morning: 20 students', 'Standard 13 · Intensive 4 · Coaching 3']);
  expect(day).toMatch(/Beginner \(3\): .*Lorena Marie Glas/);
  expect(day).toMatch(/Experienced beginner \(8\): /);
  expect(day).toMatch(/Intermediate \(6\): /);
  expect(day).toMatch(/Level not set \(3\): .*Lanny Karine/);
  expect(day).toContain('Intensive afternoon group (3 afternoons, head coach picks): ');
  expect(day).toMatch(/Yoga 08:00: 13$/);
  await expect(page.locator('.wk-yoga')).toHaveText('Yoga this week: 13 guests · paid 0');
  await pick(page, 'Surf', 'week');
  const wk = await msgText(page);
  expect(wk.split('\n')[0]).toBe('Surf – week Sat 14 – Sat 21 Nov (20 students)');
  expect(wk).toContain('Tue 17: 20 (13 / 4 / 3)');
  expect(wk).toContain('Sinéad O\'Farrell (coaching, Mon 16 → Fri 20)');
  expect(wk).toContain('No lessons: João Lavado (until Mon 16), Emilia Faccenna (from Tue 17)');
  expect(wk).toMatch(/Yoga 08:00: 13 guests$/);
});

// ── To check ───────────────────────────────────────────────────────────────
test('to check: one compact list — no level, no diet, no flight time, still here?, fixed phones', async ({ page }) => {
  const guests = [...guestsFromFile(), ...CARRY()];
  const st = await openWeek(page, { guests });
  await expect(page.locator('.wk-check-hd')).toHaveText(/To check \(\d\)/);
  await expect(page.locator('.wk-check-list')).toHaveCount(0);           // collapsed
  await page.click('.wk-check-hd');
  const list = page.locator('.wk-check-list');
  await expect(list).toContainText('3 surf students without level – ask at check-in');
  await expect(list).toContainText("didn't answer diet – ask at the welcome dinner");
  await expect(list).toContainText('1 transfer without flight time – ask the guest');
  await expect(list).toContainText('4 guests in camp are not in the latest Guests file – still here?');
  await expect(list).toContainText('5 phones had a wrong 0 after the country code – fixed, check before sending');   // +44 07…, +41 07…, +33 06… in the real file
  await expect(list).toContainText('1 room move without a date – check the Day Planner');
  // «Not here» takes João out of every list (booking_status), «Still here» adopts Alexander into the latest import
  const joao = list.locator('.wk-ci-g', { hasText: 'João Lavado' });
  await joao.locator('button:has-text("Not here")').click();
  expect((await call(st, 'guest_update')).body).toEqual({ booking_status: 'not_here' });
  await expect(page.locator('#weekRoot .wk-count')).toHaveText('21 guests');
  await list.locator('.wk-ci-g', { hasText: 'Alexander Straub' }).locator('button:has-text("Still here")').click();
  expect((await call(st, 'guest_update', 2)).body.raw).toEqual({ _kept: IMPORT_NEW });
  await expect(list).toContainText('2 guests in camp are not in the latest Guests file');
  // after a reload the answers hold and the file's range is unchanged: 21 counted, 2 still to answer
  await page.evaluate(() => WeekUI.loadAll(true));
  await expect(page.locator('#weekRoot .wk-count')).toHaveText('21 guests');
  await expect(page.locator('.wk-check-list')).toContainText('2 guests in camp are not in the latest Guests file');
  await expect(page.locator('.wk-check-list')).not.toContainText('dropped');
});

test('dropped from the latest file (cancelled?) is not counted and shows in To check', async ({ page }) => {
  const guests = [...guestsFromFile(), ...CARRY()];
  const z = guests.find(g => g.guest_name === 'Zara Palmer'); z.import_id = IMPORT_OLD; z.updated_at = '2026-11-09T05:00:00Z';
  await openWeek(page, { guests });
  await expect(page.locator('#weekRoot .wk-count')).toHaveText('21 guests');
  await page.click('.wk-check-hd');
  await expect(page.locator('.wk-check-list')).toContainText('1 guest dropped out of the latest Guests file – cancelled? Not counted');
});

// ── Send, Copy, Undo, changed since sent ───────────────────────────────────
test('send: wa.me to the team contact, the message is remembered (hash), Undo for 5 s; no phone → wa.me/?text=', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openWeek(page);
  await pick(page, 'Kitchen', '2026-11-17');
  await expect(page.locator('.wk-state')).toHaveText('Not sent');
  const text = await msgText(page);
  await page.click('#wkSend');
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith('https://wa.me/94770000005?text=')).toBe(true);
  expect(decodeURIComponent(url.split('?text=')[1])).toBe(text);
  const ins = (await call(st, 'msg_insert')).rows[0];
  expect(ins).toMatchObject({ location_id: LOC, week_start: '2026-11-14', team: 'kitchen', day: '2026-11-17', text });
  expect(ins.hash).toBe(await page.evaluate(t => WeekUI.hash(t), text));
  await expect(page.locator('.wk-state')).toContainText('Sent Tue 17 10:01');
  await page.click('.wk-undo');
  expect((await call(st, 'msg_delete')).id).toBe(ins.id);
  await expect(page.locator('.wk-state')).toContainText('Not sent');
  // Cleaning has no contact row yet → WhatsApp opens to pick the contact; «add phone» is offered
  await pick(page, 'Cleaning', '2026-11-17');
  await expect(page.locator('#wkSend')).toHaveText(/Send to Cleaning lead/);
  await expect(page.locator('.wk-state')).toContainText('add phone');
  await page.click('#wkSend');
  expect(await page.evaluate(() => window.__opened[1])).toMatch(/^https:\/\/wa\.me\/\?text=Cleaning%20%E2%80%93%20Tue%2017%20Nov/);
  // Copy also marks it sent
  await pick(page, 'Surf', 'week');
  await page.click('#weekRoot .wk-foot button:has-text("Copy")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  expect((await call(st, 'msg_insert', 3)).rows[0]).toMatchObject({ team: 'surf', day: 'week' });
  expect(errors).toEqual([]);
});

test('changed since sent: a re-import that changes Tuesday dinner → chip, amber dot, UPDATE header with the diff, «Send update»', async ({ page }) => {
  const old = 'Kitchen – Tue 17 Nov\n\nDinner: 20 people\nBreakfast Wed 18: 20 people\n\nVegan: 3 – Alicia Pohl, Anja Graf, Lilly Krüger\nAllergies: Alicia Pohl – lactose\n\nStaff not included';
  const st = await openWeek(page, { msgs: [{ id: 'm1', location_id: LOC, week_start: '2026-11-14', team: 'kitchen', day: '2026-11-17', text: old, hash: fnv(old), sent_at: '2026-11-16T08:00:00Z' }] });
  await expect(page.locator('.wk-changed')).toContainText('Kitchen (Tue)');
  await expect(page.locator('.wk-changed')).toContainText('Transfers (Tue)');          // Peter + Sinéad's flight time changed after sending
  await expect(page.locator('.wk-teams .pill:has-text("Kitchen") .wk-dot')).toHaveCount(1);
  await page.click('.wk-changed .health-chip:has-text("Kitchen (Tue)")');
  await expect(page.locator('.wk-days .pill[data-day="2026-11-17"] .wk-dot')).toHaveCount(1);
  const msg = await msgText(page);
  expect(msg.split('\n').slice(0, 5)).toEqual(['UPDATE – Tue 17 Nov', '– Dinner: 20 people', '– Breakfast Wed 18: 20 people', '+ Dinner: 21 people', '+ Breakfast Wed 18: 21 people']);
  expect(msg).toContain('\n\nKitchen – Tue 17 Nov\n\nDinner: 21 people');
  await expect(page.locator('#wkSend')).toHaveText(/Send update/);
  await page.click('#wkSend');
  const ins = (await call(st, 'msg_insert')).rows[0];
  expect(ins.text.startsWith('Kitchen – Tue 17 Nov')).toBe(true);   // the stored body never carries the UPDATE header
  await expect(page.locator('.wk-changed')).not.toContainText('Kitchen (Tue)');
});

test('no camp_week_messages yet (SQL not run): lists, Copy and Send still work, a soft line says it is not remembered', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page, { noMessagesTable: true });
  await expect(page.locator('.wk-soft')).toContainText('supabase/camp-week.sql');
  await pick(page, 'Kitchen', '2026-11-17');
  await page.click('#wkSend');
  expect(await page.evaluate(() => window.__opened.length)).toBe(1);
  await expect(page.locator('.wk-state')).toHaveText('Not sent');
  expect(errors).toEqual([]);
});

// ── Transfers + Guests ─────────────────────────────────────────────────────
test('transfers: the trips of Transport in Miguel\'s format, Send to Nadith, Mark sent ✓ ticks the trips', async ({ page }) => {
  const st = await openWeek(page);
  await pick(page, 'Transfers', '2026-11-17');
  const msg = await msgText(page);
  expect(msg.split('\n')[0]).toBe('UPDATE – Tue 17 Nov');
  expect(msg).toContain('Peter Mongey, Sinéad O\'Farrell: time 21:10 → 23:40');
  expect(msg).toContain('Airport to Camp\nPeter Mongey, Sinéad O\'Farrell\n+353400000001\n2 persons\nFlight Number: EK650\nTime: 23:40\nDate: 17 Nov\nSmall Car');
  await expect(page.locator('#wkSend')).toHaveText(/Send update/);
  await page.click('#wkSend');
  expect(await page.evaluate(() => window.__opened[0])).toMatch(/^https:\/\/wa\.me\/94771234567\?text=UPDATE/);
  expect(st.calls.filter(c => c.t === 'msg_insert')).toHaveLength(0);   // transfers keep their sent state on the trips
  await page.click('.wk-state button:has-text("Mark sent")');
  await call(st, 'trip_update', 2);
  await expect(page.locator('.wk-state')).toContainText('All marked sent');
  expect(await visiblePrimary(page)).toBe(1);
});

test('transfers: a trip already done (time passed) or paid is not in the message, and not «to mark sent»', async ({ page }) => {
  const trips = [...TRIPS(),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a009', guest_names: 'Early Bird', trip_date: '2026-11-17', trip_time: '06:30', flight: 'UL504' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a010', guest_names: 'Paid Already', trip_date: '2026-11-17', trip_time: '22:00', payment_entry_id: 'pay-1' })];
  await openWeek(page, { trips });
  await pick(page, 'Transfers', '2026-11-17');
  const msg = await msgText(page);
  expect(msg).not.toContain('Early Bird');
  expect(msg).not.toContain('Paid Already');
  await expect(page.locator('#weekRoot .wk-g')).toHaveCount(2);
  await expect(page.locator('.wk-state')).toContainText('2 transfers not marked sent');
});

test('guests: one line per guest with room, dates, course, diet and partner; Copy list is the one blue button', async ({ page }) => {
  await openWeek(page);
  await pick(page, 'Guests', 'week');
  await expect(page.locator('#weekRoot .wk-g')).toHaveCount(22);
  await expect(page.locator('#weekRoot .wk-g', { hasText: 'Lanny Karine' })).toContainText("partner – don't charge");
  await expect(page.locator('#weekRoot .wk-g', { hasText: 'Alicia Pohl' })).toContainText('Coaching · Experienced beginner');
  expect(await visiblePrimary(page)).toBe(1);
  await page.click('#weekRoot .btn-p:has-text("Copy list")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  const copied = await page.evaluate(() => window.__copied[0]);
  expect(copied.split('\n')[0]).toBe('Guests – week Sat 14 – Sat 21 Nov (22)');
});

// ── Import inside Week (same code as Transport → Next week) ────────────────
test('import: Week shows the Transport import (one copy of the inputs, one blue button), saving reloads the lists', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openWeek(page);
  await page.evaluate(() => { showPage('transport'); TransportUI.setView('next'); showPage('week'); });
  await page.click('#weekRoot button:has-text("Import Guests file")');
  await expect(page.locator('#weekRoot .wk-import')).toContainText('Choose Guests file');
  await expect(page.locator('#weekRoot .wk-import .card-title').first()).toHaveText('Guests file');
  expect(await page.locator('#trGuestsFile').count()).toBe(1);
  expect(await visiblePrimary(page)).toBe(1);
  const before = st.calls.filter(c => c.t === 'guests_get').length;
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 4');
  expect(await visiblePrimary(page)).toBe(1);
  await page.click('#trImportSave');
  await expect(page.locator('#weekRoot .status-msg.status-ok')).toContainText('Saved: 4 new');
  expect((await call(st, 'import')).body.p_guests.length).toBe(18);
  await expect.poll(() => st.calls.filter(c => c.t === 'guests_get').length).toBeGreaterThan(before);
  await page.click('#weekRoot button:has-text("See the week")');
  await expect(page.locator('#weekRoot .wk-teams')).toBeVisible();
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Sat 14 Nov – Fri 20 Nov');
  // Transport still renders its own page afterwards, with a single copy of the inputs
  await page.evaluate(() => { showPage('transport'); TransportUI.setView('next'); });
  expect(await page.locator('#trGuestsFile').count()).toBe(1);
  expect(errors).toEqual([]);
});

// ── Contacts ───────────────────────────────────────────────────────────────
test('contacts: four rows; a phone is checked (E.164); the cleaning contact is created on first save', async ({ page }) => {
  const st = await openWeek(page);
  await page.click('#weekRoot button:has-text("Contacts")');
  await expect(page.locator('#wkOv .wk-contact')).toHaveCount(4);
  const clean = page.locator('#wkOv .wk-contact[data-team="cleaning"]');
  await clean.locator('[data-f="name"]').fill('Kumari');
  await clean.locator('[data-f="phone"]').fill('0771234567');
  await page.click('#wkContactsSave');
  await expect(page.locator('#wkOv')).toHaveClass(/open/);                 // refused: not +94…
  await clean.locator('[data-f="phone"]').fill('+94 77 123 4567');
  await page.click('#wkContactsSave');
  const ins = (await call(st, 'driver_insert')).rows[0];
  expect(ins).toMatchObject({ location_id: LOC, name: 'Kumari', phone: '+94771234567', kinds: ['contact'], default_for: ['cleaning_contact'] });
  await pick(page, 'Cleaning', '2026-11-17');
  await expect(page.locator('#wkSend')).toHaveText(/Send to Kumari/);
  // Transport → Drivers lists drivers only: the team contacts are edited here
  await page.evaluate(() => { showPage('transport'); TransportUI.openDrivers(); });
  await expect(page.locator('#trOv .tr-driver')).toHaveCount(2);                   // Dilan + Nadith
  await expect(page.locator('#dv_contact option')).toHaveText([/Dilan/, /Nadith/]);
  await page.evaluate(() => { TransportUI.closeModal(); showPage('week'); });
  // the transfers contact's name is Transport's choice: read-only here
  await page.click('#weekRoot button:has-text("Contacts")');
  await expect(page.locator('#wkOv .wk-contact[data-team="transfers"] [data-f="name"]')).toBeDisabled();
});

// ── Chips (shared registry) ────────────────────────────────────────────────
test('chips: «Guests file is N days old» after 3 days; yoga paid/unpaid from the ledger, read-only', async ({ page }) => {
  // latest import Fri 13 Nov 13:30 Colombo (08:00 UTC) → 4 days old on Tue 17
  const guests = [...guestsFromFile(), ...CARRY()].map(g => g.import_id === IMPORT_NEW ? { ...g, updated_at: '2026-11-13T08:00:00Z' } : g);
  await page.clock.setFixedTime(new Date('2026-11-17T04:30:00Z'));   // the shared strip reads the real clock: Tue 17 10:00 Colombo
  await openWeek(page, { guests });
  const run = () => page.evaluate(() => { const ctx = { ledger: S.ledger, location: 'sri-lanka', isLocal: false, today: '2026-11-17' };
    return { file: WeekUI.checks.file.run(ctx), yoga: WeekUI.checks.yoga.run(ctx) }; });
  let r = await run();
  expect(r.file.text).toBe('Guests file is 4 days old – import again');
  // last week (7–13 Nov) had Anja with Yoga Pack and no yoga payment
  expect(r.yoga.map(x => x.text)).toEqual(['Yoga students last week (1) but no Yoga payment']);
  await page.evaluate(() => showPage('overview'));
  await expect(page.locator('#ovChecks')).toContainText('Guests file is 4 days old – import again');
  // a yoga payment in the ledger (Salary, «Yoga teacher») clears it
  await page.evaluate(() => { S.ledger.push({ id: 'y1', type: 'expense', category: 'Salary', description: 'Yoga teacher week 46', date: '2026-11-15', amountLocal: 30000, paymentMethod: 'Cash' }); });
  r = await run();
  expect(r.yoga).toBeNull();
  // Fri 20: this week's 13 yoga students, the 15 Nov payment counts → no chip; without it → chip
  const fri = await page.evaluate(() => WeekUI.checks.yoga.run({ ledger: [], location: 'sri-lanka', isLocal: false, today: '2026-11-20' }));
  expect(fri.map(x => x.text)).toContain('Yoga students this week (13) but no Yoga payment');
  expect(await page.evaluate(() => WeekUI.checks.yoga.run({ ledger: S.ledger, location: 'sri-lanka', isLocal: false, today: '2026-11-20' }))).toBeNull();
});

test('chips: a fresh Guests file shows no age chip; a missing table shows a set-up line, not an error', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page);   // imported Mon 16 → 1 day old
  expect(await page.evaluate(() => WeekUI.checks.file.run({ ledger: [], location: 'sri-lanka', isLocal: false, today: '2026-11-17' }))).toBeNull();
  const p2 = await page.context().newPage();
  await open(p2, { noWeekTables: true });
  await p2.waitForFunction(() => window.WeekUI && WeekUI._state.metaLoaded, null, { timeout: 10000 });
  await p2.evaluate(() => showPage('week'));
  await expect(p2.locator('#weekRoot .status-msg')).toContainText('Week is not set up yet');
  expect(await p2.evaluate(() => WeekUI.checks.file.run({ ledger: [], location: 'sri-lanka', isLocal: false, today: '2026-11-17' }))).toBeNull();
  expect(errors).toEqual([]);
});
