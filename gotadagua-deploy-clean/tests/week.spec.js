// Camp hub · Week tab (Sri Lanka, 13 Nov 2026) — stubbed Supabase.
//
// Francisco's overview of the week: the Monday Guests import (camp_week_guests)
// shown in six tabs (Overview, Rooms, Kitchen, Surf, Transfers, Guests), each
// team tab ending with its WhatsApp message. Full view only — Nadith's
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
    trips: (opts.trips || TRIPS()).map(t => ({ ...t })), ledger: opts.ledger || [], calls: [], urls: [], group: opts.group || null,
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
    if (url.includes('/rest/v1/location_state_store') && url.includes('week_group_v1') && method === 'GET') return json(st.group ? [{ state_json: st.group }] : []);
    if (url.includes('/rest/v1/location_state_store') && method === 'POST' && body && body.state_key === 'week_group_v1') { st.group = body.state_json; st.calls.push({ t: 'group_save', body }); return json([]); }
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
  await expect(page.locator('#weekRoot .wk-tabs')).toBeVisible();
  return st;
}
const msgText = page => page.locator('#wkMsg').innerText();
// The message of a team sits at the bottom of its tab (Cleaning → Rooms).
const TAB = { Cleaning: 'rooms', Kitchen: 'kitchen', Surf: 'surf', Transfers: 'transfers', Guests: 'guests' };
const tab = (page, k) => page.click(`#weekRoot .wk-tabs .pill[data-tab="${k}"]`);
const pick = async (page, team, day) => {
  await tab(page, TAB[team]);
  await page.click(`#weekRoot .wk-days .pill[data-day="${day}"]`);
};
function fnv(t) { let x = 0x811c9dc5; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); }
const visiblePrimary = page => page.locator('#weekRoot .btn-p:visible').count();

// ── Access ─────────────────────────────────────────────────────────────────
// The preview renders WhatsApp's *bold* and _notes_; the raw text is what Copy and Send use.
const rawMsg = (page, team, day) => page.evaluate(([t, d]) => WeekUI.bodyOf(t, d), [team, day]);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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

// ── Overview: the week at a glance ─────────────────────────────────────────
test('overview: tiles, guests per night, and arrivals / departures / transfers / meals / surf per day (closing Saturday included)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page);
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 14 · 14–20 Nov');
  await expect(page.locator('#weekRoot .wk-count')).toHaveText('22 guests');
  await expect(page.locator('#weekRoot .wk-tabs .pill')).toHaveText([/Overview/, /Rooms/, /Kitchen/, /Surf/, /Transfers/, /Guests/]);
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Overview/);
  const kpi = l => page.locator('#weekRoot .wk-kpis .kpi', { hasText: l }).locator('.kpi-value');
  await expect(kpi('Guests this week')).toHaveText('22');
  await expect(kpi('Arrivals')).toHaveText('18');
  await expect(kpi('Departures')).toHaveText('3');
  await expect(page.locator('#weekRoot .wk-kpis .kpi', { hasText: 'Departures' })).toContainText('then 19 on Sat 21');
  await expect(kpi('Most in camp')).toHaveText('21');
  // guests per night, drawn to scale: 21 is the full bar, 19 is 19/21 of it
  await expect(page.locator('.wk-strip .wk-sc')).toHaveCount(8);
  expect(await page.locator('.wk-strip .wk-sv').allTextContents()).toEqual(['19', '19', '20', '21', '21', '21', '19']);
  const hgt = await page.locator('.wk-strip .wk-sfill').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
  expect(hgt[3]).toBeGreaterThan(60);
  expect(Math.abs(hgt[0] / hgt[3] - 19 / 21)).toBeLessThan(0.02);
  expect(await page.locator('.wk-strip .wk-sc').nth(2).locator('.wk-sio').innerText()).toMatch(/\+2\s*−1/);
  // the day board
  const day = d => page.locator(`#wkDay-${d}`);
  await expect(day('2026-11-14').locator('.wk-bc.arr')).toContainText('+15');
  await expect(day('2026-11-14').locator('.wk-bc.arr')).toContainText('HiriketeyaLanny Karine, Patrick Baggary');
  await expect(day('2026-11-14').locator('.wk-bc.arr')).toContainText('Lanny Karine, Patrick Baggary');
  await expect(day('2026-11-14').locator('.wk-bc.arr')).toContainText('Room move: João Lavado → Ahangama room');
  await expect(day('2026-11-14').locator('.wk-bc.dep')).toContainText('None');
  await expect(day('2026-11-16').locator('.wk-bc.arr')).toContainText('+2');
  await expect(day('2026-11-16').locator('.wk-bc.dep')).toContainText('−1');
  await expect(day('2026-11-16').locator('.wk-bc.dep')).toContainText('João Lavado');
  await expect(day('2026-11-17')).toContainText('Today');
  await expect(day('2026-11-17').locator('.wk-bday')).toContainText('21 in camp tonight');
  await expect(day('2026-11-17').locator('.wk-bc.trf')).toContainText('23:40');
  await expect(day('2026-11-17').locator('.wk-bc.trf')).toContainText('Time changed');
  await expect(day('2026-11-17').locator('.wk-bc.meal')).toHaveText(/20\s*breakfast\s*21\s*dinner/);
  await expect(day('2026-11-17').locator('.wk-bc.srf')).toContainText('20 students');
  await expect(day('2026-11-17').locator('.wk-bc.srf')).toContainText('Standard 13 · Intensive 4 · Coaching 3 · Yoga 13');
  await expect(day('2026-11-21').locator('.wk-bday')).toContainText('Check-out day');
  await expect(day('2026-11-21').locator('.wk-bc.dep')).toContainText('−19');
  await expect(day('2026-11-21').locator('.wk-bc.meal')).toHaveText(/19\s*breakfast/);
  // one model for the page and the messages: Tuesday's dinner is the Kitchen message's number
  const m = await page.evaluate(() => WeekUI.model().days.find(x => x.d === '2026-11-17'));
  expect(m.dinner).toBe(21);
  expect(await rawMsg(page, 'kitchen', '2026-11-17')).toContain(`*Dinner:* ${m.dinner} people`);
  expect(await visiblePrimary(page)).toBe(0);            // Overview is for reading: no blue button
  // team messages: a state per team, and the door to its tab
  await expect(page.locator('.wk-team')).toHaveCount(4);
  await page.click('.wk-team:has-text("Kitchen")');
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Kitchen/);
  await expect(page.locator('#wkMessage')).toBeVisible();
  expect(errors).toEqual([]);
});

test('layout: no horizontal scroll in any tab at 390px and at 1280px; the tab row scrolls inside itself', async ({ page }) => {
  await openWeek(page);
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const k of ['overview', 'rooms', 'kitchen', 'surf', 'transfers', 'guests']) {
      await tab(page, k);
      expect(await noOverflow(page), `${k} at ${w}px`).toBe(true);
      const cut = await page.locator('#weekRoot .wk-view').evaluate(el => [...el.querySelectorAll('.card, .wk-check, .kpi')].filter(c => c.getBoundingClientRect().right > window.innerWidth + 0.5).length);
      expect(cut, `${k} at ${w}px: cards inside the screen`).toBe(0);
    }
  }
});

// ── Messages: the camp's own WhatsApp style (bold title, a block per room, «- Name», notes in brackets) ──
test('kitchen: day and week messages, plain; the numbers of the 14 Nov image', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page);
  await pick(page, 'Kitchen', '2026-11-17');
  expect(await rawMsg(page, 'kitchen', '2026-11-17')).toBe([
    '*KITCHEN - TUE 17 NOV*', '', '*Dinner:* 21 people', '*Breakfast Wed 18:* 21 people', '',
    '*Vegan*', '- Alicia Pohl', '- Anja Graf', '- Lilly Krüger', '', '*Allergies*', '- Alicia Pohl _(lactose)_'].join('\n'));
  // the preview shows the formatting (bold, no asterisks) and «TODAY» because Tue 17 is today
  expect((await msgText(page)).split('\n').slice(0, 3)).toEqual(['KITCHEN TODAY - 17 NOV', '', 'Dinner: 21 people']);
  expect(await page.locator('#wkMsg b').allTextContents()).toEqual(['KITCHEN TODAY - 17 NOV', 'Dinner:', 'Breakfast Wed 18:', 'Vegan', 'Allergies']);
  await pick(page, 'Kitchen', 'week');
  expect(await rawMsg(page, 'kitchen', 'week')).toBe([
    '*KITCHEN - 14 TO 21 NOV*', '', '*Dinner*', '_(breakfast next morning is the same number)_',
    '- Sat 14: 19', '- Sun 15: 19', '- Mon 16: 20', '- Tue 17: 21', '- Wed 18: 21', '- Thu 19: 21', '- Fri 20: 19', '- Sat 21: breakfast only', '',
    '*Vegan*', '- Alicia Pohl', '- Anja Graf', '- Lilly Krüger', '', '*Allergies*', '- Alicia Pohl _(lactose)_'].join('\n'));
  expect(await visiblePrimary(page)).toBe(1);
  await expect(page.locator('#wkSend')).toHaveText(/Send to Kitchen lead/);
  // the tab itself: allergies first (safety), then diets, then the meals chart to scale
  await expect(page.locator('.wk-allergy')).toContainText('Alicia Pohl');
  await expect(page.locator('.wk-allergy .badge-red').last()).toHaveText('lactose');
  await expect(page.locator('.wk-view-kitchen .card-title').first()).toHaveText(/Allergies and intolerances/);
  expect(await page.locator('.wk-view-kitchen .wk-chart .wk-vb.sk-d .wk-sv').allTextContents()).toEqual(['19', '19', '20', '21', '21', '21', '19']);
  expect(await page.locator('.wk-view-kitchen .wk-chart .wk-vb.sk-b .wk-sv').allTextContents()).toEqual(['4', '19', '19', '20', '21', '21', '21', '19']);
  expect(errors).toEqual([]);
});

test('cleaning (Rooms tab): check-out and check-in by room, room move in brackets, stay-overs on the Saturday', async ({ page }) => {
  await openWeek(page);
  await tab(page, 'rooms');
  expect(await rawMsg(page, 'cleaning', '2026-11-16')).toBe([
    '*CHECK OUT - MON 16 NOV*', '', '*Ahangama room*', '- João Lavado', '',
    '*CHECK IN - MON 16 NOV*', '', '*Ahangama room*', '- Peter Mongey _(4 nights)_', '- Sinéad O\'Farrell _(4 nights)_'].join('\n'));
  const sat = await rawMsg(page, 'cleaning', '2026-11-14');
  expect(sat.split('\n').slice(0, 4)).toEqual(['*CHECK OUT - SAT 14 NOV*', '', '*Mirissa room*', '- João Lavado _(stays 2 more nights, in Ahangama room)_']);
  expect(sat).toContain('*CHECK IN - SAT 14 NOV*\n\n*Mirissa room*\n- Simon Krenn\n- Riley Denning\n- Yanneck Kumli\n- Alexander Straub _(from last week, one more week with us)_');
  expect(sat).toContain('*Hiriketeya room*\n- Lanny Karine\n- Patrick Baggary');
  expect(sat).toContain('*Ahangama room*\n- João Lavado _(from Mirissa room, 2 nights)_');
  expect(sat).toContain('*Weligama room*\n- Anja Graf _(from last week, one more week with us)_');
  expect(sat).not.toMatch(/\d{4}-\d{4}|bed \d|guests\b/);            // no booking refs, bed codes or counts
  expect(await rawMsg(page, 'cleaning', '2026-11-15')).toBe('*ROOMS - SUN 15 NOV*\n\nNo check-in or check-out');
  const wk = await rawMsg(page, 'cleaning', 'week');
  expect(wk.split('\n')[0]).toBe('*ROOMS - 14 TO 21 NOV*');
  expect(wk).toContain('*Unawatuna room*\n- Laurine Corneille\n- Frederique Rietema\n- Lorena Marie Glas\n- Lea Brennig\n- Emilia Faccenna _(from Tue 17)_\n- Alicia Pohl _(from last week)_');
  expect(wk).toContain('*Ahangama room*\n- Peter Mongey _(Mon 16 to Fri 20)_\n- Sinéad O\'Farrell _(Mon 16 to Fri 20)_\n- João Lavado _(from Mirissa room, until Mon 16)_');
  // «TOMORROW» when the day is tomorrow, «TODAY» when it is today, the weekday otherwise
  const dressed = await page.evaluate(() => ['2026-11-13', '2026-11-14', '2026-11-10'].map(t => WeekUI.dress(WeekUI.bodyOf('cleaning', '2026-11-14'), t).split('\n')[0]));
  expect(dressed).toEqual(['*CHECK OUT TOMORROW - 14 NOV*', '*CHECK OUT TODAY - 14 NOV*', '*CHECK OUT - SAT 14 NOV*']);
  await pick(page, 'Cleaning', '2026-11-18');
  expect((await msgText(page)).split('\n')[0]).toBe('ROOMS TOMORROW - 18 NOV');
});

test('rooms tab: by room first (in / out), then the beds × nights grid with free beds and the room move', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page);
  await tab(page, 'rooms');
  await expect(page.locator('.wk-view-rooms .card-title')).toHaveText(['By room', 'Beds and nights', 'Message']);
  const room = n => page.locator('.wk-byroom .wk-broom', { has: page.locator('.wk-brh', { hasText: n }) });
  await expect(room('Mirissa room').locator('.wk-br')).toHaveCount(4);           // João left this room on Saturday
  await expect(room('Mirissa room').locator('.wk-br', { hasText: 'Alexander Straub' })).toHaveText(/here\s*Sat 21/);
  await expect(room('Ahangama room').locator('.wk-br', { hasText: 'João Lavado' })).toHaveText(/from Mirissa room\s*Sat 14\s*Mon 16/);
  await expect(room('Ahangama room').locator('.wk-br', { hasText: 'Peter Mongey' })).toHaveText(/Mon 16\s*Fri 20/);
  await expect(room('Unawatuna room').locator('.wk-br', { hasText: 'Emilia Faccenna' })).toContainText('bed 6');
  // the grid: Mirissa has 4 beds; João's bed is free again from Saturday night (he moved)
  const plan = await page.evaluate(() => { const P = WeekUI.roomPlan(); return { rooms: P.rooms.map(r => [r.label, r.lanes.length]), freeBeds: P.freeBeds, freeRooms: P.freeRooms }; });
  expect(plan.rooms).toEqual([['Mirissa room', 4], ['Kabalana room', 4], ['Unawatuna room', 6], ['Hiriketeya room', 1], ['Ahangama room', 1], ['Madiha room', 1], ['Midigama room', 1], ['Weligama room', 1]]);
  expect(plan.freeBeds).toEqual([1, 1, 1, 0, 0, 0, 0]);       // Unawatuna bed 6 until Emilia arrives on Tue
  expect(plan.freeRooms).toEqual([0, 0, 0, 0, 0, 0, 1]);      // Ahangama on Friday night
  await expect(page.locator('.wk-grid .wk-bar')).toHaveCount(20);          // 22 guests; the two couples share a bar
  await expect(page.locator('.wk-grid .wk-bar', { hasText: 'João Lavado' }).locator('.wk-dot')).toHaveCount(1);
  await expect(page.locator('.wk-grid .wk-bar.before')).toHaveCount(3);          // Alexander, Alicia, Anja were here before
  await expect(page.locator('.wk-gfree').first().locator('.wk-fc')).toHaveText(['1', '1', '1', '0', '0', '0', '0']);
  // to check for this tab only, always open
  await expect(page.locator('.wk-view-rooms .wk-check')).toContainText('1 room move taken on the Saturday');
  expect(await visiblePrimary(page)).toBe(1);
  // a bar opens the guest
  await page.locator('.wk-grid .wk-bar', { hasText: 'Anja Graf' }).click();
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Guests/);
  await expect(page.locator('#weekRoot .wk-grow:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('continuing guests, short stays and guests outside of camp (Miguel\'s rules, 13 Nov)', async ({ page }) => {
  const guests = [...guestsFromFile(), ...CARRY()];
  const y = guests.find(g => g.guest_name === 'Yanneck Kumli');
  // the same person on a booking that ends the day the next one starts: one stay, no check-out
  guests.push(carry({ ref: '2026-4999', name: 'YANNECK  Kümli'.replace('  ', ' '), acc: y.accommodation, act: 'Surf Equipment', out: '2026-11-14' }));
  // back to back in another room: leaves one room, comes into the other
  guests.push(carry({ ref: '2026-4998', name: 'Riley Denning', acc: 'Kabalana Beach Shared Room (4p)', act: 'Surf Equipment', out: '2026-11-14' }));
  // no accommodation in the file: eats in camp, sleeps outside
  const out = { ...guests.find(g => g.guest_name === 'Zara Palmer'), id: uid('99999998'), booking_ref: '2026-9140', guest_name: 'Mila Outside', guest_key: 'mila outside', accommodation: '', bed_number: '' };
  guests.push(out);
  await openWeek(page, { guests });
  const sat = await rawMsg(page, 'cleaning', '2026-11-14');
  expect(sat).not.toMatch(/CHECK OUT[\s\S]*Yanneck[\s\S]*CHECK IN/);                      // not on the check-out list
  expect(sat).toContain('*Kabalana room*\n- Riley Denning _(stays 7 more nights, in Mirissa room)_');
  expect(sat).toContain('- Riley Denning _(from Kabalana room, one more week with us)_');
  expect(sat).toContain('- Yanneck Kumli _(from last week, one more week with us)_');
  expect(sat).toMatch(/\*Outside of camp\* _\(also guests coming for breakfast and dinner\)_\n- Mila Outside$/);
  // meals count the outside guest, the beds do not
  const m = await page.evaluate(() => { const x = WeekUI.model().days[0]; return { sleep: x.sleep, outside: x.outside, dinner: x.dinner, arr: x.arrivals.length, dep: x.departures.length, stay: x.staying.length }; });
  expect(m).toEqual({ sleep: 19, outside: 1, dinner: 20, arr: 14, dep: 0, stay: 2 });
  expect(await rawMsg(page, 'kitchen', '2026-11-14')).toContain('*Dinner:* 20 people');
  await expect(page.locator('#wkDay-2026-11-14 .wk-bday')).toContainText('+ 1 outside, for meals');
  await expect(page.locator('#wkDay-2026-11-14 .wk-bc.arr')).toContainText('Staying on (new booking): Riley Denning, Yanneck Kumli');
  await expect(page.locator('#wkDay-2026-11-14 .wk-bc.arr .wk-rl', { hasText: 'Outside of camp' })).toContainText('Mila Outside');
  await tab(page, 'guests');
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Mila Outside' })).toContainText('Outside of camp');
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Yanneck Kumli' })).toContainText('stays on');
  await tab(page, 'rooms');
  await expect(page.locator('.wk-byroom .wk-broom', { hasText: 'Outside of camp' })).toContainText('Mila Outside');
  await expect(page.locator('.wk-view-rooms .wk-check')).toContainText('1 guest without a room in the file');
});

test('surf: groups by level with the course in brackets; the tab charts students per day by course; yoga line (B8)', async ({ page }) => {
  await openWeek(page);
  await pick(page, 'Surf', '2026-11-17');
  const day = await rawMsg(page, 'surf', '2026-11-17');
  expect(day.split('\n').slice(0, 6)).toEqual(['*SURF - TUE 17 NOV*', '', '*Beginner*', '- Lorena Marie Glas', '- Zara Palmer', '- Sinéad O\'Farrell _(coaching)_']);
  expect(day).toContain('*Experienced beginner*\n- Alicia Pohl _(coaching)_\n- Laurine Corneille _(intensive)_');
  expect(day).toContain('*Level not set*\n- Lanny Karine\n- Patrick Baggary\n- Frederique Rietema');
  expect(day).toMatch(/\*Yoga 08:00:\* 13 guests$/);
  const wk = await rawMsg(page, 'surf', 'week');
  expect(wk.split('\n')[0]).toBe('*SURF - 14 TO 21 NOV*');
  expect(wk).toContain('- Sinéad O\'Farrell _(coaching, Mon 16 to Fri 20)_');
  expect(wk).toContain('*No lessons*\n- João Lavado _(until Mon 16)_\n- Emilia Faccenna _(from Tue 17)_');
  // the tab
  await expect(page.locator('.wk-yoga')).toHaveText('Yoga this week: 13 guests · paid 0');
  expect(await page.locator('.wk-view-surf .wk-chart .wk-sv').allTextContents()).toEqual(['18', '18', '20', '20', '20', '20', '18']);
  expect(await page.locator('.wk-view-surf .wk-chart .wk-sub').nth(3).innerText()).toBe('13·4·3');
  const parts = await page.locator('.wk-view-surf .wk-chart .wk-col').nth(3).locator('.wk-vstack i').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  expect(parts[2] / parts[1]).toBeGreaterThan(3);              // 13 Standard against 4 Intensive, to scale
  await expect(page.locator('.wk-lvl', { hasText: 'Beginner · 3' }).first()).toContainText('Sinéad O\'Farrell');
  await expect(page.locator('.wk-lvl', { hasText: 'Level not set · 3' })).toContainText('Lanny Karine');
  await expect(page.locator('.wk-view-surf .wk-check')).toContainText('3 surf students without level');
  // «Experience Intermediate level» is its own group, not Experienced beginner
  expect(await page.evaluate(() => [WeekUI.levelOf({ level: 'Experience Intermediate level' }), WeekUI.levelOf({ level: 'Experience Beginner level' })])).toEqual(['Experienced intermediate', 'Experienced beginner']);
});

test('message spacing: a blank line after the title and between blocks, never two in a row, none at the end', async ({ page }) => {
  await openWeek(page);
  const all = await page.evaluate(() => { const out = []; const ws = WeekUI._state.week;
    for (const team of ['cleaning', 'kitchen', 'surf']) for (const day of ['week', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-20'])
      out.push([team + ' ' + day, WeekUI.dress(WeekUI.bodyOf(team, day), '2026-11-13')]);
    return out; });
  for (const [k, text] of all) {
    expect(text, k).not.toMatch(/\n\n\n/);
    expect(text, k).toBe(text.trim());
    const lines = text.split('\n');
    expect(lines[0], k).toMatch(/^\*[A-Z0-9 -]+\*$/);          // bold upper-case title
    expect(lines[1], k).toBe('');
    lines.forEach((l, i) => { if (i > 0 && /^\*[^*]+\*( _\(.*\)_)?$/.test(l)) expect(lines[i - 1], `${k}: «${l}» after a blank line`).toBe(''); });
    lines.forEach(l => { if (l.startsWith('-')) expect(l, k).toMatch(/^- \S.*?( _\(.+\)_)?$/); });
  }
  expect(all.find(x => x[0] === 'cleaning 2026-11-14')[1].split('\n')[0]).toBe('*CHECK OUT TOMORROW - 14 NOV*');
});

// ── To check ───────────────────────────────────────────────────────────────
test('to check: a count on the tab it concerns, a compact list inside the tab, chips on Overview', async ({ page }) => {
  const guests = [...guestsFromFile(), ...CARRY()];
  const st = await openWeek(page, { guests });
  const n = k => page.locator(`#weekRoot .wk-tabs .pill[data-tab="${k}"] .wk-n`);
  await expect(n('rooms')).toHaveText('1');
  await expect(n('kitchen')).toHaveText('1');
  await expect(n('surf')).toHaveText('1');
  await expect(n('transfers')).toHaveText('1');
  await expect(n('guests')).toHaveText('3');
  await expect(n('overview')).toHaveCount(0);
  await expect(page.locator('.wk-tocheck .health-chip')).toHaveText(['3 without level', '16 without diet answer', '1 transfer without time', '4 still here?', '5 phones fixed', '10 without a phone', '1 room move to confirm']);
  await page.click('.wk-tocheck .health-chip:has-text("without level")');
  await expect(page.locator('.wk-view-surf .wk-check')).toContainText('3 surf students without level – ask at check-in');
  await tab(page, 'kitchen');
  await expect(page.locator('.wk-view-kitchen .wk-check')).toContainText("didn't answer diet – ask at the welcome dinner");
  await tab(page, 'transfers');
  await expect(page.locator('.wk-view-transfers .wk-check')).toContainText('1 transfer without flight time – ask the guest');
  await tab(page, 'guests');
  const list = page.locator('.wk-view-guests .wk-check');
  await expect(list).toContainText('4 guests in camp are not in the latest Guests file – still here?');
  await expect(list).toContainText('5 phones had a wrong 0 after the country code – fixed, check before sending');   // +44 07…, +41 07…, +33 06… in the real file
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
  await expect(page.locator('.wk-view-guests .wk-check')).toContainText('2 guests in camp are not in the latest Guests file');
  await expect(page.locator('.wk-view-guests .wk-check')).not.toContainText('dropped');
});

test('dropped from the latest file (cancelled?) is not counted and shows in To check', async ({ page }) => {
  const guests = [...guestsFromFile(), ...CARRY()];
  const z = guests.find(g => g.guest_name === 'Zara Palmer'); z.import_id = IMPORT_OLD; z.updated_at = '2026-11-09T05:00:00Z';
  await openWeek(page, { guests });
  await expect(page.locator('#weekRoot .wk-count')).toHaveText('21 guests');
  await tab(page, 'guests');
  await expect(page.locator('.wk-view-guests .wk-check')).toContainText('1 guest dropped out of the latest Guests file – cancelled? Not counted');
});

// ── Send, Copy, Undo, changed since sent ───────────────────────────────────
test('send: wa.me to the team contact with the WhatsApp formatting, remembered (hash), Undo for 5 s; no phone → wa.me/?text=', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openWeek(page);
  await pick(page, 'Kitchen', '2026-11-17');
  await expect(page.locator('.wk-state')).toHaveText('Not sent');
  const text = await rawMsg(page, 'kitchen', '2026-11-17');
  await page.click('#wkSend');
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith('https://wa.me/94770000005?text=')).toBe(true);
  // the encoded text keeps the asterisks (bold) and underscores (notes); the title says TODAY
  expect(url).toContain('?text=*KITCHEN%20TODAY%20-%2017%20NOV*%0A%0A*Dinner%3A*%2021%20people');
  expect(url).toContain('_(lactose)_');
  expect(decodeURIComponent(url.split('?text=')[1])).toBe(text.replace('*KITCHEN - TUE 17 NOV*', '*KITCHEN TODAY - 17 NOV*'));
  // what is stored and compared is the neutral text, so tomorrow it is not «changed»
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
  expect(await page.evaluate(() => window.__opened[1])).toMatch(/^https:\/\/wa\.me\/\?text=\*CHECK%20IN%20TODAY%20-%2017%20NOV\*/);
  // Copy also marks it sent, and copies the raw text
  await pick(page, 'Surf', 'week');
  await page.click('#weekRoot .wk-foot button:has-text("Copy")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  expect(await page.evaluate(() => window.__copied[0])).toContain('*SURF - 14 TO 21 NOV*\n\n*Beginner*\n- Lorena Marie Glas');
  expect((await call(st, 'msg_insert', 3)).rows[0]).toMatchObject({ team: 'surf', day: 'week' });
  expect(errors).toEqual([]);
});

test('changed since sent: a re-import that changes Tuesday dinner → chip, amber dot, UPDATE header with the diff, «Send update»', async ({ page }) => {
  const old = '*KITCHEN - TUE 17 NOV*\n\n*Dinner:* 20 people\n*Breakfast Wed 18:* 20 people\n\n*Vegan*\n- Alicia Pohl\n- Anja Graf\n- Lilly Krüger\n\n*Allergies*\n- Alicia Pohl _(lactose)_';
  const st = await openWeek(page, { msgs: [{ id: 'm1', location_id: LOC, week_start: '2026-11-14', team: 'kitchen', day: '2026-11-17', text: old, hash: fnv(old), sent_at: '2026-11-16T08:00:00Z' }] });
  await expect(page.locator('.wk-changed')).toContainText('Kitchen (Tue)');
  await expect(page.locator('.wk-changed')).toContainText('Transfers (Tue)');          // Peter + Sinéad's flight time changed after sending
  await expect(page.locator('.wk-tabs .pill[data-tab="kitchen"] .wk-dot')).toHaveCount(1);
  await expect(page.locator('.wk-team', { hasText: 'Kitchen' })).toContainText('Changed since sent');
  await page.click('.wk-changed .health-chip:has-text("Kitchen (Tue)")');
  await expect(page.locator('.wk-days .pill[data-day="2026-11-17"] .wk-dot')).toHaveCount(1);
  const msg = await msgText(page);
  expect(msg.split('\n').slice(0, 5)).toEqual(['UPDATE – Tue 17 Nov', '– Dinner: 20 people', '– Breakfast Wed 18: 20 people', '+ Dinner: 21 people', '+ Breakfast Wed 18: 21 people']);
  expect(msg).toContain('\n\nKITCHEN TODAY - 17 NOV\n\nDinner: 21 people');
  await expect(page.locator('#wkSend')).toHaveText(/Send update/);
  await page.click('#wkSend');
  const ins = (await call(st, 'msg_insert')).rows[0];
  expect(ins.text.startsWith('*KITCHEN - TUE 17 NOV*')).toBe(true);   // the stored body never carries the UPDATE header or TODAY
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
test('transfers: a timeline per day with the status of each trip; the message is Miguel\'s format, Send to Nadith, Mark sent ✓', async ({ page }) => {
  const st = await openWeek(page);
  await pick(page, 'Transfers', '2026-11-17');
  await expect(page.locator('#wkTr-2026-11-17 .wk-trip')).toHaveCount(2);
  await expect(page.locator('#wkTr-2026-11-17 .wk-trip').last()).toContainText('time?');
  await expect(page.locator('#wkTr-2026-11-17 .wk-trip', { hasText: 'Peter Mongey' })).toContainText('23:40');
  await expect(page.locator('#wkTr-2026-11-17 .wk-trip', { hasText: 'Peter Mongey' }).locator('.badge').last()).toHaveText('Time changed');
  await expect(page.locator('#wkTr-2026-11-17 .wk-trip', { hasText: 'Emilia Faccenna' }).locator('.badge').last()).toHaveText('Planned');
  await expect(page.locator('#wkTr-2026-11-21 .wk-trip')).toContainText('Departure');
  await expect(page.locator('#wkTr-2026-11-16 .wk-trip.own')).toHaveCount(2);            // Peter + Sinéad come on their own on Monday
  await expect(page.locator('#wkTr-2026-11-14 .wk-untimed')).toContainText('On their own, no arrival time given');
  await expect(page.locator('#wkTr-2026-11-21 .wk-trip.own')).toHaveCount(0);            // next week's arrivals are not this week's business
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

test('transfers: a trip already done (time passed), paid or a no-show stays on the timeline with its status, but not in the message', async ({ page }) => {
  const trips = [...TRIPS(),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a009', guest_names: 'Early Bird', trip_date: '2026-11-17', trip_time: '06:30', flight: 'UL504' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a010', guest_names: 'Paid Already', trip_date: '2026-11-17', trip_time: '22:00', payment_entry_id: 'pay-1' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a011', guest_names: 'Never Came', trip_date: '2026-11-16', trip_time: '09:00', status: 'no_show' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a012', guest_names: 'All Set', trip_date: '2026-11-19', trip_time: '09:00', status: 'confirmed' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a013', guest_names: 'Was Told', trip_date: '2026-11-19', trip_time: '10:00', status: 'sent' })];
  await openWeek(page, { trips });
  await pick(page, 'Transfers', '2026-11-17');
  const msg = await msgText(page);
  expect(msg).not.toContain('Early Bird');
  expect(msg).not.toContain('Paid Already');
  const badge = n => page.locator('.wk-view-transfers .wk-trip', { hasText: n }).locator('.badge').last();
  await expect(badge('Early Bird')).toHaveText('Done');
  await expect(badge('Paid Already')).toHaveText('Paid');
  await expect(badge('Never Came')).toHaveText('No-show');
  await expect(badge('All Set')).toHaveText('Confirmed');
  await expect(badge('Was Told')).toHaveText('Sent');
  await expect(page.locator('#wkTr-2026-11-17 .wk-trip')).toHaveCount(4);
  await expect(page.locator('.wk-state')).toContainText('2 transfers not marked sent');
});

test('guests: a searchable list with stay, room, course, diet, phone and partner; Copy list', async ({ page }) => {
  await openWeek(page);
  await pick(page, 'Guests', 'week');
  await expect(page.locator('#weekRoot .wk-grow')).toHaveCount(22);
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Lanny Karine' })).toContainText("partner – don't charge");
  const alicia = page.locator('#weekRoot .wk-grow', { hasText: 'Alicia Pohl' });
  await expect(alicia.locator('[data-l="Surf"]')).toHaveText(/Coaching\s*Experienced beginner/);
  await expect(alicia.locator('[data-l="Stay"]')).toHaveText(/here → Sat 21\s*14 nights/);
  await expect(alicia.locator('[data-l="Room"]')).toContainText('Unawatuna room');
  await expect(alicia.locator('[data-l="Diet"]')).toContainText('allergies: lactose');
  await page.fill('#wkSearch', 'hiriketeya');
  await expect(page.locator('#weekRoot .wk-grow:visible')).toHaveCount(2);
  await expect(page.locator('#wkGuestN')).toHaveText('2');
  await page.fill('#wkSearch', 'vegan');
  await expect(page.locator('#weekRoot .wk-grow:visible')).toHaveCount(3);
  await page.fill('#wkSearch', 'zzz');
  await expect(page.locator('.wk-noguests')).toBeVisible();
  await page.fill('#wkSearch', '');
  expect(await visiblePrimary(page)).toBe(1);                 // the one blue button of the tab is «Download contacts»
  await page.click('#weekRoot button:has-text("Copy list")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  const copied = await page.evaluate(() => window.__copied[0]);
  expect(copied.split('\n')[0]).toBe('Guests – week Sat 14 – Sat 21 Nov (22)');
  await page.click('#weekRoot .wk-days .pill[data-day="2026-11-16"]');
  await expect(page.locator('#weekRoot .wk-grow')).toHaveCount(21);          // in camp or leaving on Monday
});

// ── Week group (WhatsApp) ──────────────────────────────────────────────────
test('week group: name, phones as E.164, contacts .vcf, all numbers, and a one-tap invite per guest once the link is pasted', async ({ page }) => {
  const guests = [...guestsFromFile(), ...CARRY()];
  const set = (name, phone) => { guests.find(g => g.guest_name === name).phone = phone; };
  set('Simon Krenn', '+43 660 000 0101'); set('Riley Denning', '0061 400-000-102'); set('Dan Thomas', '+44 07000 000103'); set('Lilly Krüger', '12345');
  // Yanneck on two bookings back to back = one contact; an outside-of-camp guest can be left out
  const y = guests.find(g => g.guest_name === 'Yanneck Kumli');
  guests.push({ ...y, id: uid('99999997'), booking_ref: '2026-4999', check_in: '2026-11-07', check_out: '2026-11-14', phone: '' });
  guests.push({ ...guests.find(g => g.guest_name === 'Zara Palmer'), id: uid('99999996'), booking_ref: '2026-9140', guest_name: 'Mila Outside', guest_key: 'mila outside', accommodation: '', bed_number: '', phone: '+31600000105' });
  const st = await openWeek(page, { guests });
  expect(await page.evaluate(() => ['+44 07000 000103', '0061 400-000-102', '+43 (660) 000.0101', '+351 900 000 104', '12345', '', 'no phone', '+49'].map(WeekUI.e164)))
    .toEqual(['+447000000103', '+61400000102', '+436600000101', '+351900000104', '', '', '', '']);
  await tab(page, 'guests');
  await expect(page.locator('#wkGroupName')).toHaveText('Gota Dagua Sri Lanka - week 14');
  expect(await visiblePrimary(page)).toBe(1);
  await expect(page.locator('#weekRoot .btn-p')).toHaveText(/Download contacts \(\.vcf\)/);
  await page.click('.wk-group button:has-text("Copy name")');
  await expect.poll(() => page.evaluate(() => window.__copied[0])).toBe('Gota Dagua Sri Lanka - week 14');
  const people = await page.evaluate(() => WeekUI.groupPeople().map(x => [x.g.guest_name, x.phone, x.outside]));
  expect(people.filter(p => p[0] === 'Yanneck Kumli')).toHaveLength(1);                       // once
  expect(people.find(p => p[0] === 'Dan Thomas')[1]).toBe('+447000000103');
  expect(people.find(p => p[0] === 'Lilly Krüger')[1]).toBe('');
  expect(people.find(p => p[0] === 'Mila Outside')).toEqual(['Mila Outside', '+31600000105', true]);
  await expect(page.locator('.wk-view-guests .wk-check')).toContainText('without a valid phone – not in the week group contacts');
  await expect(page.locator('.wk-view-guests .wk-check')).toContainText('Lilly Krüger (12345)');
  // the .vcf: one vCard 3.0 per guest with a phone, named as the camp saves them («<Full name> - Week 14»)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wkVcf')]);
  expect(dl.suggestedFilename()).toBe('gota-dagua-week-14.vcf');
  const vcf = fs.readFileSync(await dl.path(), 'utf8');
  const cards = vcf.trim().split('BEGIN:VCARD').filter(Boolean);
  expect(cards).toHaveLength(people.filter(p => p[1]).length);
  expect(vcf).toContain('BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Simon Krenn - Week 14;;;\r\nFN:Simon Krenn - Week 14\r\nTEL;TYPE=CELL:+436600000101\r\nEND:VCARD\r\n');
  expect(vcf).toContain('FN:Mila Outside - Week 14');
  expect(vcf).not.toContain('Lilly Krüger');
  expect(cards.every(c => /TEL;TYPE=CELL:\+[1-9]\d{7,14}\r\n/.test(c))).toBe(true);
  // without the outside-of-camp guests
  await page.uncheck('#wkGroupOutside');
  expect(await page.evaluate(() => WeekUI.vcf())).not.toContain('Mila Outside');
  await page.click('.wk-group button:has-text("Copy all numbers")');
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(2);
  const nums = (await page.evaluate(() => window.__copied[1])).split('\n');
  expect(nums).toHaveLength(people.filter(p => p[1] && !p[2]).length);
  expect(nums.every(n => /^\+[1-9]\d{7,14}$/.test(n))).toBe(true);
  // the invite: only with a WhatsApp group link; one tap opens wa.me for that guest and leaves a tick (kept per week, in this browser)
  await expect(page.locator('#weekRoot .wk-grow button:has-text("Send invite")')).toHaveCount(0);
  await page.fill('#wkInvite', 'https://example.com/x'); await page.locator('#wkInvite').blur();
  await expect(page.locator('.wk-glink .hint')).toContainText('does not look like a WhatsApp group link');
  await page.fill('#wkInvite', 'https://chat.whatsapp.com/AbCdEf123'); await page.locator('#wkInvite').blur();
  const simon = page.locator('#weekRoot .wk-grow', { hasText: 'Simon Krenn' });
  await simon.locator('button:has-text("Send invite")').click();
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url.startsWith('https://wa.me/436600000101?text=')).toBe(true);
  expect(decodeURIComponent(url.split('?text=')[1])).toBe('Hi Simon, welcome to Gota Dagua Sri Lanka! Join the group for your week: https://chat.whatsapp.com/AbCdEf123');
  await expect(simon.locator('.wk-invited')).toHaveText(/Invited/);
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Lilly Krüger' }).locator('.wk-ginv')).toHaveText('no phone');
  await expect(page.locator('.wk-glink .hint')).toContainText('1 of');
  // kept per week in location_state_store (key week_group_v1), so the laptop and the phone agree
  const saved = st.calls.filter(c => c.t === 'group_save').pop().body;
  expect(saved).toMatchObject({ location_id: LOC, state_key: 'week_group_v1' });
  expect(saved.state_json.weeks['2026-11-14'].link).toBe('https://chat.whatsapp.com/AbCdEf123');
  expect(Object.keys(saved.state_json.weeks['2026-11-14'].invited)).toEqual(['simon krenn']);
  await page.evaluate(() => WeekUI.loadAll(true));
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Simon Krenn' }).locator('.wk-invited')).toHaveCount(1);
  expect(await noOverflow(page)).toBe(true);
});

test('week group: the season week number (week 1 starts on a Saturday, a setting) names the group, the contacts and the week header; description template', async ({ page }) => {
  const st = await openWeek(page);
  // default: week 1 = Sat 15 Aug 2026 → 14 Nov is week 14, 21 Nov is week 15
  expect(await page.evaluate(() => ['2026-08-15', '2026-08-22', '2026-11-14', '2026-11-21'].map(WeekUI.weekNo))).toEqual([1, 2, 14, 15]);
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 14 · 14–20 Nov');
  await page.evaluate(() => WeekUI.shiftWeek(7));
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 15 · 21–27 Nov');
  await page.evaluate(() => WeekUI.shiftWeek(-7));
  await tab(page, 'guests');
  await expect(page.locator('.wk-gstat')).toContainText('saved as «Name - Week 14»');
  // the description: an editable template, kept in the app, with the week filled in on Copy
  await expect(page.locator('#wkDesc')).toHaveValue(/YOUR WEEKLY SCHEDULE - WEEK \{week\} \(\{dates\}\)[\s\S]*Edit me/);
  await page.fill('#wkDesc', '📅 YOUR WEEKLY SCHEDULE - week {week}, {dates}\nSat: welcome dinner 19:30'); await page.locator('#wkDesc').blur();
  expect((await call(st, 'group_save')).body.state_json.description).toContain('welcome dinner 19:30');
  await page.click('.wk-group button:has-text("Copy description")');
  await expect.poll(() => page.evaluate(() => window.__copied[0])).toBe('📅 YOUR WEEKLY SCHEDULE - week 14, 14–21 Nov\nSat: welcome dinner 19:30');
  // the setting: any date snaps to its Saturday; a season starting Sat 7 Nov makes this week 2
  await page.fill('#wkSeason', '2026-11-10'); await page.locator('#wkSeason').blur();
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 2 · 14–20 Nov');
  await expect(page.locator('#wkGroupName')).toHaveText('Gota Dagua Sri Lanka - week 2');
  expect(st.group.season_start).toBe('2026-11-07');
  expect(await page.evaluate(() => WeekUI.vcf())).toContain('FN:Simon Krenn - Week 2');
  // and it comes back from the store on the next load
  await page.evaluate(() => WeekUI.loadAll(true));
  await expect(page.locator('#wkDesc')).toHaveValue(/welcome dinner 19:30/);
  await expect(page.locator('#wkGroupName')).toHaveText('Gota Dagua Sri Lanka - week 2');
});

// ── Import inside Week (same code as Transport → Next week) ────────────────
test('import: Week shows the Transport import (one copy of the inputs, one blue button); after saving, «See the week» lands on Overview, every tab filled', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openWeek(page);
  await tab(page, 'surf');
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
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Overview/);
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 14 · 14–20 Nov');
  await expect(page.locator('#wkDay-2026-11-14 .wk-bc.arr')).toContainText('+15');
  // Transport still renders its own page afterwards, with a single copy of the inputs
  await page.evaluate(() => { showPage('transport'); TransportUI.setView('next'); });
  expect(await page.locator('#trGuestsFile').count()).toBe(1);
  expect(errors).toEqual([]);
});

test('import on a Friday: the file also holds the guests in camp, the week shown is the coming one (first check-in from today on)', async ({ page }) => {
  await openWeek(page, { now: '2026-11-13T18:00' });
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 13 · 7–13 Nov');     // the running week
  await page.click('#weekRoot button:has-text("Import Guests file")');
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await page.click('#trImportSave');
  await page.click('#weekRoot button:has-text("See the week")');
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 14 · 14–20 Nov');
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Overview/);
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
  await expect(page.locator('.wk-team', { hasText: 'Cleaning' })).toContainText('Kumari');
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
