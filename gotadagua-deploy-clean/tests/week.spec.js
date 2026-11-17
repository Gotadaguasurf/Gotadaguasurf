// Camp hub · Week tab (Sri Lanka, 13 Nov 2026) — stubbed Supabase.
//
// Francisco's overview of the week: the Monday Guests import (camp_week_guests)
// shown in five tabs (Overview, Rooms, Kitchen, Surf, Guests), each team tab
// ending with its WhatsApp message. Since 15 Nov 2026 the airport transfers live in
// Transport only («Week = guests and camp teams, Transport = drivers and money»): the
// Overview shows them read-only and a tap opens Transport on the same week and day. Full view only — Nadith's
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
    // The import refuses to save transfers at price 0 (13 Nov): the stub serves the airport prices of /prices.
    if (url.includes('/rest/v1/pricing_catalog')) return json(slug === 'sri-lanka' && url.includes('category=eq.Transport') ? [['Airport → Surfcamp — Car', 21000, 3], ['Airport → Surfcamp — Minivan', 26500, 8], ['Surfcamp → Airport — Car', 20000, 3], ['Surfcamp → Airport — Minivan', 25000, 8]]
      .map(([name, cost, capacity], i) => ({ id: `cat-${i}`, name, cost_per_guest: cost, currency: 'LKR', capacity, notes: '', linked_transport_preset_id: `p-${name.split(' — ')[0]}`, linked_camp_tab_id: null, picker_tab: 'airport', sort_order: i })) : []);
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
const TAB = { Cleaning: 'rooms', Kitchen: 'kitchen', Surf: 'surf', Guests: 'guests' };
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

test('week: tab for full users only — not in local view (no request either) or camp-tab-only (Morocco now has it: tests/morocco-week.spec.js)', async ({ page, browser }) => {
  const errors = collectFatalErrors(page);
  await open(page);
  expect(await page.locator('.ntab-m[data-page="week"]').evaluate(el => el.style.display)).toBe('');
  expect(errors).toEqual([]);
  for (const [query, slug] of [['&view=local', 'sri-lanka'], ['&view=camp-tab-only', 'sri-lanka']]) {   // Morocco removed 14 Nov: it has the tab now
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
  await expect(page.locator('#weekRoot .wk-tabs .pill')).toHaveText([/Overview/, /Rooms/, /Kitchen/, /Surf/, /Guests/]);
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
  await expect(day('2026-11-14').locator('.wk-bc.dep')).toContainText('−1');          // nobody leaves the camp, one bed is freed
  await expect(day('2026-11-14').locator('.wk-bc.dep')).toContainText('MirissaJoão Lavado (stays 2 more nights, in Ahangama room)');
  await expect(page.locator('#weekRoot .wk-people')).toHaveText(/People check: 22 guests in the Guests file for this week, all on the lists/);
  await expect(day('2026-11-16').locator('.wk-bc.arr')).toContainText('+2');
  await expect(day('2026-11-16').locator('.wk-bc.dep')).toContainText('−1');
  await expect(day('2026-11-16').locator('.wk-bc.dep')).toContainText('João Lavado');
  await expect(day('2026-11-17')).toContainText('Today');
  await expect(day('2026-11-17').locator('.wk-bday')).toContainText('21 in camp tonight');
  await expect(day('2026-11-17').locator('.wk-bc.trf')).toContainText('23:40');
  await expect(day('2026-11-17').locator('.wk-bc.trf .badge')).toHaveCount(0);           // read-only, no status: «Done» / «Owed» never disagree
  await expect(day('2026-11-17').locator('.wk-bc.trf .wk-trgo')).toContainText('Transport');
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
  // team messages: a state per team, and the door to its tab (Transfers: the state, the door is Transport)
  await expect(page.locator('.wk-team')).toHaveCount(4);
  await expect(page.locator('.wk-team[data-team="transfers"]')).toContainText('Nadith · in Transport');
  await expect(page.locator('.wk-team[data-team="transfers"] .badge')).toHaveText('3 to send');
  await page.click('.wk-team:has-text("Kitchen")');
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Kitchen/);
  await expect(page.locator('#wkMessage')).toBeVisible();
  expect(errors).toEqual([]);
});

test('layout: no horizontal scroll in any tab at 390px and at 1280px; at 390 the tab row wraps, every tab on screen', async ({ page }) => {
  await openWeek(page);
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    const tabsFit = await page.locator('#weekRoot .wk-tabs').evaluate(el => el.scrollWidth <= el.clientWidth + 0.5 && [...el.querySelectorAll('.pill')].every(p => p.getBoundingClientRect().right <= window.innerWidth));
    expect(tabsFit, `every tab on screen at ${w}px`).toBe(true);
    for (const k of ['overview', 'rooms', 'kitchen', 'surf', 'guests']) {
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
  await expect(n('rooms')).toHaveText('2');
  await expect(n('kitchen')).toHaveText('1');
  await expect(n('surf')).toHaveText('1');
  await expect(n('guests')).toHaveText('3');
  await expect(n('overview')).toHaveCount(0);
  await expect(page.locator('.wk-tocheck .health-chip')).toHaveText(['3 without level', '16 without diet answer', '2 without a bed', '4 still here?', '5 phones fixed', '10 without a phone', '1 room move to confirm']);
  // the two guests carried from the earlier file sit in a shared room with no bed number
  expect((await page.evaluate(() => WeekUI.toCheck())).find(c => /without a bed number/.test(c.text)).who).toBe('Alexander Straub, Alicia Pohl');
  await page.click('.wk-tocheck .health-chip:has-text("without level")');
  await expect(page.locator('.wk-view-surf .wk-check')).toContainText('3 surf students without level – ask at check-in');
  await tab(page, 'kitchen');
  await expect(page.locator('.wk-view-kitchen .wk-check')).toContainText("didn't answer diet – ask at the welcome dinner");
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

test('«N missing info» in Transport (was «N without time», 16 Nov 2026 UX pass: the same rule as the red row): a To do chip, its filter lists exactly those transfers (Beliz\'s Saturday departure counts); «Edit» is one tap away', async ({ page }) => {
  await openWeek(page);
  expect((await page.evaluate(() => WeekUI.toCheck())).some(c => /without (flight )?time/.test(c.text))).toBe(false);
  await page.evaluate(() => showPage('transport'));
  await expect(page.locator('#transportRoot .tr-strip .health-lbl')).toHaveText('To do');
  const chip = page.locator('#transportRoot .tr-strip [data-chip="noinfo"]');
  await expect(chip).toHaveText('2 missing info');
  await chip.click();
  await expect(page.locator('#transportRoot [data-showing="noinfo"]')).toContainText('Showing only: missing info · 2 trips');
  const rows = page.locator('#transportRoot .tr-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Emilia Faccenna');
  await expect(rows.nth(1)).toContainText('Beliz Kuyumcuoglu');
  await expect(rows.nth(0).locator('button:has-text("Ask guest for flight & time")')).toHaveCount(1);
  await rows.nth(0).locator('[data-edit-info]').click();                          // «Edit» on the red step: the answer is typed in the trip sheet
  await expect(page.locator('#trOv')).toHaveClass(/open/);
  await expect(page.locator('#trOv .mhdr-title')).toHaveText(/^Edit arrival · /);
  await page.evaluate(() => TransportUI.closeModal());
  await page.click('#transportRoot [data-show-all]');                             // back to the whole week
  await expect(page.locator('#transportRoot [data-showing]')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-tabs .pill.active')).toHaveText('All');
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

test('changed since sent: a re-import that changes Tuesday dinner → chip, amber dot; Send sends the real current message (no UPDATE, no diff)', async ({ page }) => {
  const old = '*KITCHEN - TUE 17 NOV*\n\n*Dinner:* 20 people\n*Breakfast Wed 18:* 20 people\n\n*Vegan*\n- Alicia Pohl\n- Anja Graf\n- Lilly Krüger\n\n*Allergies*\n- Alicia Pohl _(lactose)_';
  const st = await openWeek(page, { msgs: [{ id: 'm1', location_id: LOC, week_start: '2026-11-14', team: 'kitchen', day: '2026-11-17', text: old, hash: fnv(old), sent_at: '2026-11-16T08:00:00Z' }] });
  await expect(page.locator('.wk-changed')).toContainText('Kitchen (Tue)');
  await expect(page.locator('.wk-changed')).not.toContainText('Transfers');           // a changed flight time is Transport's chip «time changed — resend»
  await expect(page.locator('.wk-tabs .pill[data-tab="kitchen"] .wk-dot')).toHaveCount(1);
  await expect(page.locator('.wk-team', { hasText: 'Kitchen' })).toContainText('Changed since sent');
  await page.click('.wk-changed .health-chip:has-text("Kitchen (Tue)")');
  await expect(page.locator('.wk-days .pill[data-day="2026-11-17"] .wk-dot')).toHaveCount(1);
  const msg = await msgText(page);
  expect(msg).not.toContain('UPDATE');
  expect(msg).not.toMatch(/^[–+] /m);
  expect(msg.startsWith('KITCHEN TODAY - 17 NOV\n\nDinner: 21 people')).toBe(true);
  await expect(page.locator('#wkSend')).toHaveText(/Send to/);
  await page.click('#wkSend');
  const ins = (await call(st, 'msg_insert')).rows[0];
  expect(ins.text.startsWith('*KITCHEN - TUE 17 NOV*')).toBe(true);   // the stored body never carries the UPDATE header or TODAY
  await expect(page.locator('.wk-changed')).toHaveCount(0);            // nothing else changed (the transfers are not in this strip any more)
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

// ── Transfers (in Transport since 15 Nov 2026) + Guests ────────────────────
test('transfers: a tap on the Week Overview opens Transport on the same week and day; the day card has each trip with its status; «Send the whole day» in Miguel\'s format; Mark all sent ✓', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openWeek(page);
  // who comes on their own is people information: it sits with the arrivals in Week
  await expect(page.locator('#wkDay-2026-11-16 .wk-bc.arr .wk-own')).toContainText('On their own:');   // Peter + Sinéad come on their own on Monday (times given)
  await expect(page.locator('#wkDay-2026-11-14 .wk-bc.arr .wk-untimed')).toContainText('On their own, no arrival time given');
  await expect(page.locator('#wkDay-2026-11-21 .wk-bc.arr')).not.toContainText('On their own');       // next week's arrivals are not this week's business
  await expect(page.locator('#wkDay-2026-11-16 .wk-bc.trf')).not.toContainText('On their own');
  // a mid-week day
  await page.locator('#wkDay-2026-11-17 .wk-bc.trf .wk-trlink').click();
  expect(await page.evaluate(() => activePage)).toBe('transport');
  await expect(page.locator('#transportRoot .tr-week')).toHaveText('14–20 Nov');
  await expect(page.locator('#transportRoot .tr-tripview')).toBeVisible();   // one view since 16 Nov 2026 (no Reconcile pill)
  const day = page.locator('#trDay-2026-11-17');
  await expect(day).toBeInViewport();
  const navClear = () => page.evaluate(() => document.getElementById('trDay-2026-11-17').getBoundingClientRect().top >= document.querySelector('.app-nav').getBoundingClientRect().bottom);
  // (the hub scrolls smoothly) once settled, the card's date sits just under the sticky nav, not behind it
  await expect.poll(navClear, { timeout: 3000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('trDay-2026-11-17').getBoundingClientRect().top)), { timeout: 3000 }).toBeLessThan(120);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);                              // scrolled to the day, not the top of the page
  await expect(day.locator('.tr-row')).toHaveCount(2);
  const row = n => day.locator('.tr-row', { hasText: n });
  await expect(row('Emilia Faccenna').locator('.tr-time .badge-amber')).toHaveText('time?');
  await expect(row('Emilia Faccenna').locator('[data-status-sel]')).toHaveValue('planned');
  await expect(row('Peter Mongey')).toContainText('23:40');
  await expect(row('Peter Mongey')).toContainText('Time changed, resend');
  await expect(page.locator('#trDay-2026-11-21 .tr-row')).toContainText('Departure');
  await day.locator('button:has-text("Send the whole day")').click();
  expect(await page.evaluate(() => decodeURIComponent(window.__opened.pop()))).toMatch(/^https:\/\/wa\.me\/94771234567\?text=\*TRANSFERS TODAY - 17 NOV\*\n\nAirport to Camp _\(changed\)_\nPeter Mongey, Sinéad O'Farrell\n\+353400000001\n2 persons\nFlight Number: EK650\nTime: 23:40\nDate: 17 Nov\nSmall Car/);
  expect(st.calls.filter(c => c.t === 'msg_insert')).toHaveLength(0);   // transfers keep their sent state on the trips
  await day.locator('button:has-text("Mark all sent ✓")').click();
  await call(st, 'trip_update', 2);
  expect(st.calls.filter(c => c.t === 'trip_update').map(c => c.id).sort()).toEqual(['aaaaaaaa-0000-4000-8000-00000000a001', 'aaaaaaaa-0000-4000-8000-00000000a002']);
  expect(await page.locator('#transportRoot .btn-p:visible').count()).toBe(1);                          // one blue button: «Send the whole week» on All
  expect(errors).toEqual([]);
});

test('transfers: the closing Saturday\'s departure and another week land on that week and that day in Transport (setWeek); the Team messages row opens the week', async ({ page }) => {
  await openWeek(page);
  await page.locator('#wkDay-2026-11-21 .wk-bc.trf .wk-trlink').click();
  await expect(page.locator('#transportRoot .tr-week')).toHaveText('14–20 Nov');                          // Sat 21 departures belong to the week that ends
  await expect(page.locator('#trDay-2026-11-21')).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.getElementById('trDay-2026-11-21').getBoundingClientRect().top >= document.querySelector('.app-nav').getBoundingClientRect().bottom), { timeout: 3000 }).toBe(true);
  await expect(page.locator('#trDay-2026-11-21 .tr-row')).toContainText('Beliz Kuyumcuoglu');
  // the Transport week is moved away, then Week → Team messages → Transfers brings it back to Week's week
  await page.evaluate(() => TransportUI.shiftWeek(14));
  await expect(page.locator('#transportRoot .tr-week')).toHaveText('28 Nov – 4 Dec');
  await page.evaluate(() => showPage('week'));
  await page.click('.wk-team[data-team="transfers"]');
  expect(await page.evaluate(() => activePage)).toBe('transport');
  await expect(page.locator('#transportRoot .tr-week')).toHaveText('14–20 Nov');
  // another week in Week (the week before) → the same week in Transport
  await page.evaluate(() => { showPage('week'); WeekUI.shiftWeek(-7); });
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 13 · 7–13 Nov');
  await page.evaluate(() => WeekUI.toTransport('2026-11-10'));
  await expect(page.locator('#transportRoot .tr-week')).toHaveText('7–13 Nov');
  expect(await page.evaluate(() => TransportUI._state.week)).toBe('2026-11-07');
});

test('transfers in Transport: a trip already done (time passed) or a no-show stays on the day list with its status, but not in the message; paid ahead, confirmed and sent ones are in it (marked)', async ({ page }) => {
  const trips = [...TRIPS(),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a009', guest_names: 'Early Bird', trip_date: '2026-11-17', trip_time: '06:30', flight: 'UL504' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a010', guest_names: 'Paid Already', trip_date: '2026-11-17', trip_time: '22:00', payment_entry_id: 'pay-1' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a011', guest_names: 'Never Came', trip_date: '2026-11-16', trip_time: '09:00', status: 'no_show' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a012', guest_names: 'All Set', trip_date: '2026-11-19', trip_time: '09:00', status: 'confirmed' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a013', guest_names: 'Was Told', trip_date: '2026-11-19', trip_time: '10:00', status: 'sent' })];
  await openWeek(page, { trips });
  await page.evaluate(() => WeekUI.toTransport('2026-11-17'));
  const msg = await page.evaluate(() => TransportUI.dayMessage('2026-11-17'));
  expect(msg).not.toContain('Early Bird');
  expect(msg).toContain('Airport to Camp\nPaid Already');            // paid ahead (15 Nov): still to be driven, so in the message
  const pay = n => page.locator('#transportRoot .tr-row', { hasText: n }).locator('[data-pay]');
  await expect(pay('Early Bird')).toHaveText('Owed');                  // one vocabulary now: done, not paid
  await expect(pay('Paid Already')).toHaveText('Paid');
  await expect(pay('Never Came')).toHaveText('No-show');
  // Still to come: the status select says where it stands (16 Nov 2026, no Planned / Sent / Confirmed badge beside it).
  const step = n => page.locator('#transportRoot .tr-row', { hasText: n }).locator('[data-status-sel]');
  await expect(step('All Set')).toHaveValue('confirmed');
  await expect(step('Was Told')).toHaveValue('sent');
  await expect(page.locator('#trDay-2026-11-17 .tr-row')).toHaveCount(4);
  await expect(page.locator('#transportRoot [data-week-count]')).toContainText('3 not marked sent');   // Peter (changed), Emilia, Beliz
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

// ── Import inside Week (the only door since 15 Nov 2026) ───────────────────
test('import: Week shows the import (one copy of the inputs, one blue button); after saving, «See the week» (blue) lands on Overview, every tab filled', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openWeek(page);
  await tab(page, 'surf');
  await page.evaluate(() => { showPage('transport'); showPage('week'); });
  await page.click('#weekRoot button:has-text("Import Guests file")');
  await expect(page.locator('#weekRoot .wk-import')).toContainText('Choose Guests file');
  await expect(page.locator('#weekRoot .wk-import .card-title').first()).toHaveText('Guests file');
  expect(await page.locator('#trGuestsFile').count()).toBe(1);
  expect(await visiblePrimary(page)).toBe(1);
  const before = st.calls.filter(c => c.t === 'guests_get').length;
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 6');
  expect(await visiblePrimary(page)).toBe(1);
  await page.click('#trImportSave');
  await expect(page.locator('#weekRoot .status-msg.status-ok')).toContainText('Saved: 6 new');
  expect(await visiblePrimary(page)).toBe(1);                                           // «See the week»; «Choose Guests file» turns secondary
  await expect(page.locator('#weekRoot .wk-after .btn-p')).toHaveText(/See the week/);
  await expect(page.locator('#weekRoot .wk-after .btn-s')).toHaveText(/Send transfers in Transport/);
  // the next steps sit right under the «Saved» line, above the list of the file (one screen on a phone)
  expect(await page.evaluate(() => { const ok = document.querySelector('#weekRoot .status-ok'); return ok.nextElementSibling && ok.nextElementSibling.classList.contains('wk-after'); })).toBe(true);
  expect((await call(st, 'import')).body.p_guests.length).toBe(18);
  await expect.poll(() => st.calls.filter(c => c.t === 'guests_get').length).toBeGreaterThan(before);
  await page.click('#weekRoot button:has-text("See the week")');
  await expect(page.locator('#weekRoot .wk-tabs .pill.active')).toHaveText(/Overview/);
  await expect(page.locator('#weekRoot .wk-week')).toHaveText('Week 14 · 14–20 Nov');
  await expect(page.locator('#wkDay-2026-11-14 .wk-bc.arr')).toContainText('+15');
  // Transport has no import of its own any more: one view (16 Nov 2026: Reconcile is gone), no inputs; an old «next» view opens the Week import
  await page.evaluate(() => showPage('transport'));
  expect(await page.locator('#transportRoot .tr-views').count()).toBe(0);
  expect(await page.locator('#trGuestsFile').count()).toBe(0);
  await page.evaluate(() => TransportUI.setView('next'));
  await expect(page.locator('#weekRoot .wk-import')).toBeVisible();
  expect(await page.evaluate(() => activePage)).toBe('week');
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

test('import: «Send transfers in Transport» after saving opens Transport → Trips on the week of the file (Friday: the coming week)', async ({ page }) => {
  await openWeek(page, { now: '2026-11-13T18:00' });
  await page.click('#weekRoot button:has-text("Import Guests file")');
  await page.setInputFiles('#trGuestsFile', GUESTS_CSV);
  await page.click('#trImportSave');
  await page.click('#weekRoot button:has-text("Send transfers in Transport")');
  expect(await page.evaluate(() => activePage)).toBe('transport');
  await expect(page.locator('#transportRoot .tr-week')).toHaveText('14–20 Nov');
  await expect(page.locator('#transportRoot .tr-tripview')).toBeVisible();
});

// ── Contacts ───────────────────────────────────────────────────────────────
test('contacts: three rows (the camp teams); a phone is checked (E.164); the cleaning contact is created on first save', async ({ page }) => {
  const st = await openWeek(page);
  await page.click('#weekRoot button:has-text("Contacts")');
  await expect(page.locator('#wkOv .wk-contact')).toHaveCount(3);
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
  // the transfers contact lives in Transport → Drivers only (15 Nov 2026): not listed here
  await page.click('#weekRoot button:has-text("Contacts")');
  await expect(page.locator('#wkOv .wk-contact')).toHaveText([/Cleaning/, /Kitchen/, /Surf/]);
  await expect(page.locator('#wkOv .wk-contact[data-team="transfers"]')).toHaveCount(0);
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

// ── Audit of 13 Nov 2026: nobody lost ──────────────────────────────────────
// Invented guests shaped like the real case of Sat 14 Nov: three people leave the Mirissa
// room that day — one leaves the camp, one stays on a new booking in another bed, one moves
// to a private room — and the +1 of a private booking has no room in the file.
const MIR = 'Marissa Shared Room (4p)', KAB = 'Kabalana Beach Shared Room (4p)', UNA = 'Unawatuna Beach Shared Room (only girls)';
const AHA = 'Ahangama Beach Standard Ensuite Room', HIR = 'Hiriketeya Beach Superior Ensuite Room', MAD = 'Madiha Beach Standard Ensuite Room';
function gRow(o) {
  return { ...carry({ ref: o.ref, name: o.name, acc: o.acc || '', act: o.act || 'Surf Equipment', out: o.out || '2026-11-21' }), check_in: o.in || '2026-11-14', bed_number: o.bed || '',
    week_start: GT.weekStart(o.in || '2026-11-14'), raw: o.raw || {}, import_id: IMPORT_NEW, updated_at: '2026-11-13T12:00:00Z' };
}
const CHANGEOVER = () => [
  gRow({ ref: '2026-9001', name: 'Falk Hansen', acc: MIR, bed: '2', in: '2026-11-07', out: '2026-11-14' }),
  gRow({ ref: '2026-9002', name: 'Yorick Keller', acc: MIR, bed: '1', in: '2026-11-07', out: '2026-11-14' }),
  gRow({ ref: '2026-9003', name: 'Yorick Keller', acc: MIR, bed: '4', in: '2026-11-14', out: '2026-11-21' }),
  gRow({ ref: '2026-9004', name: 'Joel Lima', acc: `${MIR}, ${AHA}`, bed: '1, 4', in: '2026-11-08', out: '2026-11-16' }),   // Bookinglayer lists the beds in number order
  gRow({ ref: '2026-9005', name: 'Axel Sturm', acc: MIR, bed: '3', in: '2026-11-07', out: '2026-11-21' }),
  gRow({ ref: '2026-9006', name: 'Sven Kraus', acc: MIR, bed: '1', in: '2026-11-14', out: '2026-11-21' }),
  gRow({ ref: '2026-9007', name: 'Kai Kopp', acc: HIR, bed: '1', in: '2026-11-06', out: '2026-11-14' }),
  gRow({ ref: '2026-9007', name: 'Sira Hart', acc: '', bed: '', in: '2026-11-06', out: '2026-11-14' }),
];

test('departures: everyone who leaves a room or a bed is listed — leaving the camp, room move, bed change, and the guest with no room', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page, { guests: CHANGEOVER(), trips: [] });
  // Overview · Departures of Sat 14: the three who leave the Mirissa room, one per line, with a short note
  const dep = page.locator('#wkDay-2026-11-14 .wk-bc.dep');
  await expect(dep).toContainText('−5');
  await expect(dep.locator('.wk-rl', { hasText: 'Mirissa' }).locator('.wk-out1')).toHaveText(['Yorick Keller (stays, moves to bed 4)', 'Falk Hansen', 'Joel Lima (stays 2 more nights, in Ahangama room)']);
  await expect(dep.locator('.wk-rl', { hasText: 'Hiriketeya' })).toContainText('Kai Kopp');
  await expect(dep.locator('.wk-rl', { hasText: 'Outside of camp' })).toContainText('Sira Hart');
  // the count of people leaving the camp stays its own number (tile and strip)
  const d0 = await page.evaluate(() => { const x = WeekUI.model().days[0]; return { dep: x.departures.map(g => g.guest_name).sort(), arr: x.arrivals.map(g => g.guest_name), stay: x.staying.map(g => g.guest_name), sleep: x.sleep }; });
  expect(d0).toEqual({ dep: ['Falk Hansen', 'Kai Kopp', 'Sira Hart'], arr: ['Sven Kraus'], stay: ['Yorick Keller'], sleep: 4 });
  // the beds of the two-room booking: «1, 4» is Mirissa bed 4 (bed 1 is Yorick's, Ahangama has two beds), then Ahangama bed 1
  const segs = await page.evaluate(() => { const g = WeekUI.classify(WeekUI._state.cache['2026-11-14'].rows, WeekUI._state.meta).find(x => x.guest_name === 'Joel Lima');
    return WeekUI.segments(g).map(s => [s.r.label, s.bed, s.from, s.to]); });
  expect(segs).toEqual([['Mirissa room', '4', '2026-11-08', '2026-11-14'], ['Ahangama room', '1', '2026-11-14', '2026-11-16']]);
  // the Cleaning message: every bed freed is on CHECK OUT, the guest with no room too
  expect(await rawMsg(page, 'cleaning', '2026-11-14')).toBe([
    '*CHECK OUT - SAT 14 NOV*', '', '*Mirissa room*', '- Yorick Keller _(stays, moves to bed 4)_', '- Falk Hansen', '- Joel Lima _(stays 2 more nights, in Ahangama room)_', '',
    '*Hiriketeya room*', '- Kai Kopp', '', '*Outside of camp* _(also guests coming for breakfast and dinner)_', '- Sira Hart', '',
    '*CHECK IN - SAT 14 NOV*', '', '*Mirissa room*', '- Sven Kraus', '- Axel Sturm _(from last week, one more week with us)_', '- Yorick Keller _(from last week, one more week with us, now in bed 4)_', '',
    '*Ahangama room*', '- Joel Lima _(from Mirissa room, 2 nights)_'].join('\n'));
  expect(await rawMsg(page, 'cleaning', '2026-11-16')).toBe('*CHECK OUT - MON 16 NOV*\n\n*Ahangama room*\n- Joel Lima');
  // the week before: the grid has Joel in bed 4 and Yorick in bed 1 (no bar pushed to another bed)
  await page.evaluate(() => WeekUI.shiftWeek(-7));
  await expect(page.locator('#weekRoot .wk-week')).toContainText('7–13 Nov');
  const lanes = await page.evaluate(() => WeekUI.roomPlan().rooms.find(r => r.label === 'Mirissa room').lanes.map(l => [l.bed, l.items.map(it => it.gs[0].guest_name).join('+')]));
  expect(lanes).toEqual([[1, 'Yorick Keller'], [2, 'Falk Hansen'], [3, 'Axel Sturm'], [4, 'Joel Lima']]);
  // Guests, Copy list and Kitchen name the room he sleeps in that week, not the room he moves to later
  expect((await rawMsg(page, 'guests', 'week')).split('\n').find(l => l.startsWith('Joel Lima'))).toContain('Joel Lima · Mirissa room bed 4 (then Ahangama room, Sat 14) · Sun 8 → Mon 16');
  expect((await rawMsg(page, 'guests', '2026-11-13')).split('\n').find(l => l.startsWith('Joel Lima'))).toContain('Mirissa room bed 4');
  await tab(page, 'guests');
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Joel Lima' }).locator('[data-l="Room"]')).toHaveText(/Mirissa room · bed 4\s*then Ahangama room, Sat 14/);
  // the +1 with no room: on To check with the room of her booking; the people check adds up
  await tab(page, 'rooms');
  await expect(page.locator('.wk-view-rooms .wk-check')).toContainText('Sira Hart (same booking as Kai Kopp, Hiriketeya room)');
  expect((await page.evaluate(() => WeekUI.people())).ok).toBe(true);
  // back in the week of the 14th he is listed in the room he moved to
  await page.evaluate(() => WeekUI.shiftWeek(7));
  await tab(page, 'guests');
  await expect(page.locator('#weekRoot .wk-grow', { hasText: 'Joel Lima' }).locator('[data-l="Room"]')).toHaveText(/Ahangama room\s*from Mirissa room, Sat 14/);
  expect(errors).toEqual([]);
});

test('to check · nobody lost: two guests in a bed, a room over its beds, a private room with two bookings, no bed, unclear beds, a gap between two bookings, other arrival dates', async ({ page }) => {
  const guests = [
    gRow({ ref: '2026-9101', name: 'Ana Abel', acc: KAB, bed: '2' }), gRow({ ref: '2026-9102', name: 'Bea Bauer', acc: KAB, bed: '2', in: '2026-11-16' }),      // same bed from Mon 16
    gRow({ ref: '2026-9103', name: 'Cas Claes', acc: KAB, bed: '1' }), gRow({ ref: '2026-9104', name: 'Dov Dahl', acc: KAB, bed: '3' }), gRow({ ref: '2026-9105', name: 'Eli Eck', acc: KAB, bed: '4' }),   // 5 guests for 4 beds
    gRow({ ref: '2026-9106', name: 'Finn Falk', acc: MAD, bed: '1' }), gRow({ ref: '2026-9107', name: 'Gus Gall', acc: MAD, bed: '1', in: '2026-11-18' }),       // two bookings in one private room
    gRow({ ref: '2026-9108', name: 'Hana Holm', acc: UNA, bed: '' }),                                                                                           // shared room, no bed number
    gRow({ ref: '2026-9109', name: 'Ines Iber', acc: `${MIR}, ${UNA}`, bed: '2, 3', in: '2026-11-10', out: '2026-11-20' }),                                     // either order fits: not clear
    gRow({ ref: '2026-9110', name: 'Jan Jost', acc: MIR, bed: '1', in: '2026-11-07', out: '2026-11-14' }), gRow({ ref: '2026-9111', name: 'Jan Jost', acc: MIR, bed: '1', in: '2026-11-21', out: '2026-11-28' }),   // out 14, back 21
    gRow({ ref: '2026-9112', name: 'Kim Kahl', acc: MIR, bed: '4', raw: { 'Arrives on': 'Mon 16 Nov 2026', 'Departure date': 'Sat 21 Nov 2026' } }),              // bed from Sat 14, arrives Mon 16
  ];
  await openWeek(page, { guests, trips: [] });
  const checks = await page.evaluate(() => WeekUI.toCheck().map(c => [c.tab, c.text, c.who]));
  const has = (text, who) => expect(checks.find(c => c[1].includes(text)) || [text, 'MISSING']).toEqual([expect.any(String), expect.stringContaining(text), who]);
  has('1 bed with two guests on the same night', 'Kabalana room bed 2: Ana Abel, Bea Bauer (Mon 16)');
  has('1 room with more guests than beds', 'Kabalana room: 5 guests for 4 beds (Mon 16)');
  has('1 private room with two bookings on the same night', 'Madiha room: Finn Falk, Gus Gall (Wed 18)');
  has('2 guests in a shared room without a bed number', 'Hana Holm, Ines Iber (beds «2, 3» for Mirissa room → Unawatuna room: not clear which is which)');
  has('1 guest with two bookings and nights with no booking in between', 'Jan Jost (out Sat 14 Nov, back Sat 21 Nov)');
  has('1 guest with arrival or departure dates that differ from the room dates', 'Kim Kahl (room from Sat 14, arrives Mon 16)');
  expect(checks.some(c => c[1].includes('people count'))).toBe(false);
  await expect(page.locator('#weekRoot .wk-people')).toContainText('People check: 10 guests in the Guests file for this week, all on the lists');
  await tab(page, 'rooms');
  await expect(page.locator('.wk-view-rooms .wk-check .wk-ci')).toHaveCount(5);     // bed, private room, over, no bed, room move
  // Jan is not «staying on»: he leaves on Sat 14 (Departures) — the To check line asks which it is
  await tab(page, 'overview');
  await expect(page.locator('#wkDay-2026-11-14 .wk-bc.dep')).toContainText('Jan Jost');
});

test('people check: a row the lists cannot place turns the line red and adds a To check chip — never silent', async ({ page }) => {
  const guests = [gRow({ ref: '2026-9201', name: 'Ola Okay', acc: KAB, bed: '1' }),
    gRow({ ref: '2026-9202', name: 'Uwe Upside', acc: KAB, bed: '2', in: '2026-11-18', out: '2026-11-15' })];   // check-out before check-in
  await openWeek(page, { guests, trips: [] });
  await expect(page.locator('#weekRoot .wk-people.bad')).toContainText('The people count does not add up — tell Miguel before sending any list.');
  await expect(page.locator('#weekRoot .wk-people.bad')).toContainText('check-out is not after check-in: Uwe Upside');
  await expect(page.locator('.wk-tocheck .health-chip')).toContainText(['People count does not add up']);
  const pc = await page.evaluate(() => WeekUI.people());
  expect(pc.ok).toBe(false);
  expect(pc.nights).toEqual([1, 1, 1, 1, 1, 1, 1]);
});

test('transfers: «Transfers booked» is now one line in Transport — arrivals and departures with persons; the Airport pill lists them', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openWeek(page);
  await page.evaluate(() => WeekUI.toTransport());
  const line = page.locator('#transportRoot [data-week-count]');
  await expect(line).toContainText('Arrivals 2 · 3 persons');
  await expect(line).toContainText('Departures 1 · 1 person');            // Beliz leaves on the closing Saturday
  const c = await page.evaluate(() => TransportUI.weekCount(TransportUI._state.trips.filter(t => TransportUI.inWeek(t, TransportUI._state.week))));
  expect(c.arr.n + c.dep.n).toBe(3);
  expect(await page.locator('#transportRoot [data-total]').count()).toBe(0);   // the week-total tiles are gone (16 Nov 2026)
  await page.click('#transportRoot .tr-tabs .pill:has-text("Airport")');
  await expect(page.locator('#transportRoot .tr-row')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('transfers in Transport: a transfer with flight, time and phone has «Confirm with guest» and shows Guest told ✓ / Guest confirmed ✓', async ({ page }) => {
  const trips = [
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a021', guest_names: 'Callum Downes', guest_phone: '+447000000003', trip_date: '2026-11-17', trip_time: '23:10', flight: 'UL504', booking_ref: '2026-4360' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a022', guest_names: 'Emilia Faccenna', guest_phone: '+390000000001', trip_date: '2026-11-17', trip_time: null, booking_ref: '2026-5074' }),
    trip({ id: 'aaaaaaaa-0000-4000-8000-00000000a023', guest_names: 'Told Already', guest_phone: '+390000000002', trip_date: '2026-11-18', trip_time: '10:00', flight: 'QR1', guest_notified_at: '2026-11-12T10:00:00Z',
      guest_told_snapshot: { trip_date: '2026-11-18', trip_time: '08:00', flight: 'QR1', pickup_time: null, pax: 1 } }),
  ];
  const st = await openWeek(page, { trips });
  await page.evaluate(() => WeekUI.toTransport('2026-11-17'));
  const row = n => page.locator('#transportRoot .tr-row', { hasText: n }).first();
  await expect(row('Emilia Faccenna').locator('.tr-resend button')).toHaveText('Ask guest for flight & time');   // missing flight: ask, not confirm
  await expect(row('Emilia Faccenna').locator('[data-guest-send]')).toHaveCount(0);
  await row('Callum Downes').locator('[data-guest-send]').click();
  const url = await page.evaluate(() => window.__opened[window.__opened.length - 1]);
  expect(url.startsWith('https://wa.me/447000000003?text=')).toBe(true);
  expect(decodeURIComponent(url)).toContain('holding a *sign with your name*');
  expect((await call(st, 'trip_update')).body.guest_notified_at).toBeTruthy();
  await expect(row('Callum Downes').locator('[data-guest="told"] .badge')).toHaveText('Guest told ✓');
  await row('Callum Downes').locator('[data-guest-ok]').click();
  await expect(row('Callum Downes').locator('[data-guest="confirmed"] .badge')).toHaveText('Guest confirmed ✓');
  await expect(row('Told Already').locator('[data-guest="changed"] .badge')).toHaveText('Changed — tell guest again');   // told 08:00, now 10:00
});

// Miguel, 15 Nov: «a mensagem tem de estar mais fixe como nos outros… os departures? Deviam sempre aparecer todos».
test('«Send the whole week» (Transport): every transfer still to come — sent, confirmed and guest-told ones marked, the closing Saturday departure in, a passed one out — by day, sorted by time, house style', async ({ page }) => {
  const T2 = id => `aaaaaaaa-0000-4000-8000-0000000b${String(id).padStart(4, '0')}`;
  const trips = [
    trip({ id: T2(1), guest_names: 'Gone This Morning', trip_date: '2026-11-17', trip_time: '06:30', flight: 'UL504' }),                                  // today, time passed → out
    trip({ id: T2(2), kind: 'airport_departure', guest_names: 'Last Week Guest', trip_date: '2026-11-14', trip_time: '15:00', flight: 'QR651' }),          // opening Saturday departure → last week's
    trip({ id: T2(3), guest_names: 'Sent Already', guest_phone: '+491700000003', trip_date: '2026-11-18', trip_time: '14:10', flight: 'QR654', status: 'sent', sent_snapshot: { trip_date: '2026-11-18', trip_time: '14:10', flight: 'QR654', pax: 1 } }),
    trip({ id: T2(4), kind: 'airport_departure', guest_names: 'Confirmed Guest', guest_phone: '+491700000004', trip_date: '2026-11-18', trip_time: '09:05', flight: 'EK651', status: 'confirmed', vehicle: 'Minivan', pax: 3 }),
    trip({ id: T2(5), guest_names: 'Told Guest', guest_phone: '+491700000005', trip_date: '2026-11-19', trip_time: '11:00', flight: 'QR658', guest_notified_at: '2026-11-16T10:00:00Z', guest_told_snapshot: { trip_date: '2026-11-19', trip_time: '11:00', flight: 'QR658', pickup_time: null, pax: 1 } }),
    trip({ id: T2(6), kind: 'airport_departure', guest_names: 'Beliz Kuyumcuoglu', guest_phone: '+905300000006', trip_date: '2026-11-21', trip_time: '15:00', flight: 'QR655', vehicle: 'Minivan', guest_notified_at: '2026-11-16T10:00:00Z', guest_told_snapshot: { trip_date: '2026-11-21', trip_time: '15:00', flight: 'QR655', pickup_time: null, pax: 1 } }),
    trip({ id: T2(7), guest_names: 'Next Week Arrival', trip_date: '2026-11-21', trip_time: '10:00', flight: 'QR660' }),                                  // closing Saturday arrival → next week's
    trip({ id: T2(8), guest_names: 'Cancelled Guest', trip_date: '2026-11-19', trip_time: '12:00', status: 'cancelled' }),
  ];
  const st = await openWeek(page, { trips });
  await page.evaluate(() => WeekUI.toTransport());
  const week = await page.evaluate(() => TransportUI.weekMessage('2026-11-14'));
  const block = (dir, name, phone, pax, fl, time, date, car, mark) => [`${dir}${mark ? ` _(${mark})_` : ''}`, name, phone, `${pax} ${pax === 1 ? 'person' : 'persons'}`, `Flight Number: ${fl}`, `Time: ${time}`, `Date: ${date}`, car].join('\n');
  expect(week).toBe([
    '*TRANSFERS - 14 TO 21 NOV*', '',
    '*WED 18 NOV*', '',
    block('Camp to Airport', 'Confirmed Guest', '+491700000004', 3, 'EK651', '09:05', '18 Nov', 'Minivan', 'already sent'), '',
    block('Airport to Camp', 'Sent Already', '+491700000003', 1, 'QR654', '14:10', '18 Nov', 'Small Car', 'already sent'), '',
    '*THU 19 NOV*', '',
    block('Airport to Camp', 'Told Guest', '+491700000005', 1, 'QR658', '11:00', '19 Nov', 'Small Car', ''), '',
    '*SAT 21 NOV*', '',
    block('Camp to Airport', 'Beliz Kuyumcuoglu', '+905300000006', 1, 'QR655', '15:00', '21 Nov', 'Minivan', ''),
  ].join('\n'));
  // «Send the whole week» sends the whole organised message; «Mark all sent ✓» ticks exactly its unsent trips (not next week's Saturday arrival).
  await expect(page.locator('#transportRoot [data-week-count]')).toContainText('2 not marked sent');
  await page.click('#transportRoot [data-send-week]');
  expect(await page.evaluate(() => decodeURIComponent(window.__opened.pop()).split('?text=')[1])).toBe(week);
  expect(await page.evaluate(() => decodeURIComponent(window.__opened.length))).toBe('0');
  await page.click('#transportRoot [data-week-tick]');
  await call(st, 'trip_update', 2);
  await page.waitForTimeout(200);
  const ticked = st.calls.filter(c => c.t === 'trip_update').map(c => c.id).sort();
  expect(ticked).toEqual([T2(5), T2(6)]);
  await expect(page.locator('#transportRoot [data-week-tick]')).toHaveCount(0);
  // A day with nothing: «No transfers» under the title.
  expect(await page.evaluate(() => TransportUI.dayMessage('2026-11-20'))).toBe('*TRANSFERS - FRI 20 NOV*\n\nNo transfers');
  // A changed trip (time moved after it was sent) is marked changed — the full message is sent again, never a diff.
  await page.evaluate(id => { const t = TransportUI._state.trips.find(x => x.id === id); t.status = 'sent'; t.needs_resend = true; t.trip_time = '15:20'; TransportUI.render(); }, T2(3));
  const again = await page.evaluate(() => TransportUI.weekMessage('2026-11-14'));
  expect(again).toContain('Airport to Camp _(changed)_\nSent Already');
  expect(again.split('\n')[0]).toBe('*TRANSFERS - 14 TO 21 NOV*');
  expect(again).not.toMatch(/UPDATE|^[+–] /m);
});

test('Transport trips with «Send the whole week» and the count line: screenshots at 390 and 1280, no horizontal overflow', async ({ page }) => {
  const SH = require('path').join(__dirname, '..', 'test-results', 'transfers-message-shots');
  require('fs').mkdirSync(SH, { recursive: true });
  await openWeek(page);
  await page.evaluate(() => WeekUI.toTransport());
  for (const [w, hgt] of [[1280, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(150);
    expect(await noOverflow(page)).toBe(true);
    await expect(page.locator('#transportRoot [data-send-week]')).toBeInViewport();
    await page.screenshot({ path: `${SH}/sl-transport-week-${w}.png`, fullPage: true });
  }
});

// ── Golden: the team messages and the transfers message never change (tests/week-golden.js) ─────
// Captured once from main before the transfers moved to Transport (15 Nov 2026). Rooms, Kitchen, Surf
// and Guests are the «zero errors» area: byte-identical. The transfers message of each day and of the
// whole week = what Week → Transfers sent, now sent from Transport.
const WG = require('./week-golden');
const TRANSFERS_TEXT = (day, ws) => (TransportUI.weekMessage ? (day === 'week' ? TransportUI.weekMessage(ws) : TransportUI.dayMessage(day))
  : WeekUI.dress(WeekUI.bodyOf('transfers', day), TransportUI.colomboNow().slice(0, 10)));
const GOLDEN_TRIPS = () => {
  const T2 = id => `aaaaaaaa-0000-4000-8000-0000000c${String(id).padStart(4, '0')}`;
  return [
    trip({ id: T2(1), guest_names: 'Gone This Morning', trip_date: '2026-11-17', trip_time: '06:30', flight: 'UL504' }),
    trip({ id: T2(2), kind: 'airport_departure', guest_names: 'Last Week Guest', trip_date: '2026-11-14', trip_time: '15:00', flight: 'QR651' }),
    trip({ id: T2(3), guest_names: 'Sent Already', guest_phone: '+491700000003', trip_date: '2026-11-18', trip_time: '14:10', flight: 'QR654', status: 'sent', sent_snapshot: { trip_date: '2026-11-18', trip_time: '14:10', flight: 'QR654', pax: 1 } }),
    trip({ id: T2(4), kind: 'airport_departure', guest_names: 'Confirmed Guest', guest_phone: '+491700000004', trip_date: '2026-11-18', trip_time: '09:05', flight: 'EK651', status: 'confirmed', vehicle: 'Minivan', pax: 3 }),
    trip({ id: T2(5), guest_names: 'Changed Guest', trip_date: '2026-11-19', trip_time: '11:00', flight: 'QR658', status: 'sent', needs_resend: true }),
    trip({ id: T2(6), kind: 'airport_departure', guest_names: 'Saturday Leaver', trip_date: '2026-11-21', trip_time: '15:00', flight: 'QR655', vehicle: 'Minivan' }),
    trip({ id: T2(7), guest_names: 'Next Week Arrival', trip_date: '2026-11-21', trip_time: '10:00', flight: 'QR660' }),
    trip({ id: T2(8), guest_names: 'Cancelled Guest', trip_date: '2026-11-19', trip_time: '12:00', status: 'cancelled' }),
    trip({ id: T2(9), guest_names: 'Held Guest', trip_date: '2026-11-19', trip_time: '13:00', missing_since: '2026-11-16' }),
  ];
};
for (const [kase, opts] of [['default', {}], ['mixed', { trips: GOLDEN_TRIPS() }], ['friday', { now: '2026-11-13T18:00', trips: GOLDEN_TRIPS() }]]) {
  test(`golden (${kase}): Rooms, Kitchen, Surf and Guests messages, To check, people check and the day model are byte-identical; the transfers message = the one Week sent`, async ({ page }) => {
    await openWeek(page, opts);
    if (kase === 'friday') { await page.evaluate(() => { WeekUI.shiftWeek(7); }); await page.waitForFunction(() => WeekUI._state.cache['2026-11-14']); }
    const team = await WG.teamMessages(page);
    expect(WG.check('sl', kase, team)).toEqual([]);
    const tr = await WG.transfersMessages(page, TRANSFERS_TEXT);
    expect(WG.check('sl', kase, tr)).toEqual([]);
    if (process.env.GOLDEN_WRITE !== '1') expect(WG.covered('sl', kase, 'transfers|')).toBe(9);
  });
}

// ── The camp report (booking lines × guests, 16 Nov 2026) through the same Week import ─────────────
test('import: the camp report is recognised, «what will change» is shown, and only today-on legs (or legs the app has by key) are sent', async ({ page }) => {
  const { csv } = require('./bl-report-csv');
  const R = 'Kabalana Beach Shared Room (4p)';
  const text = csv([
    // Emilia: today's arrival, the app has it by key without a time → updated, sent
    { ref: '2026-5074', ci: '2026-11-17', co: '2026-11-21', guests: [{ name: 'Emilia Faccenna', arrT: '23:30', phone: '+393349187890' }],
      lines: [{ p: R, person: 'Emilia Faccenna', start: '2026-11-17', end: '2026-11-21' }, { p: 'Airport Transfer Sri Lanka', person: 'Emilia Faccenna', start: '2026-11-17' }] },
    // Diana: both legs in October, not in the app → past, never sent (would be owed twice)
    { ref: '2026-3842', ci: '2026-10-03', co: '2026-10-10', guests: [{ name: 'Diana Tansiri' }],
      lines: [{ p: R, person: 'Diana Tansiri', start: '2026-10-03', end: '2026-10-10' }, { p: 'Airport Transfer Sri Lanka', person: 'Diana Tansiri', start: '2026-10-03' }, { p: 'Airport Transfer Sri Lanka', person: 'Diana Tansiri', start: '2026-10-10' }] },
    // Beliz: only the 14 Nov arrival is booked → the app's 21 Nov departure is asked about, never cancelled
    { ref: '2026-4070', ci: '2026-11-14', co: '2026-11-21', guests: [{ name: 'Beliz Kuyumcuoglu' }],
      lines: [{ p: R, person: 'Beliz Kuyumcuoglu', start: '2026-11-14', end: '2026-11-21' }, { p: 'Airport Transfer Sri Lanka', person: 'Beliz Kuyumcuoglu', start: '2026-11-14' }] },
    // a new couple → two new trips
    { ref: '2026-9001', ci: '2026-11-28', co: '2026-12-05', guests: [{ name: 'Nia N', arrT: '10:00', arrF: 'QR664' }, { name: 'Oli O' }],
      lines: [{ p: R, person: 'Nia N', start: '2026-11-28', end: '2026-12-05' }, { p: R, person: 'Oli O', start: '2026-11-28', end: '2026-12-05' },
        { p: 'Airport Transfer Sri Lanka', person: 'Nia N', start: '2026-11-28' }, { p: 'Airport Transfer Sri Lanka', person: 'Oli O', start: '2026-11-28' },
        { p: 'Airport Transfer Sri Lanka', person: 'Nia N', start: '2026-12-05' }, { p: 'Airport Transfer Sri Lanka', person: 'Oli O', start: '2026-12-05' }] },
    // a Caparica booking in the Sri Lanka report → left out, its «Airport Shuttle» never becomes a Colombo trip
    { ref: '2026-4776', ci: '2026-11-27', co: '2026-11-29', guests: [{ name: 'Corinne Suter' }],
      lines: [{ p: '17 - Castelo beach mixed dorm', person: 'Corinne Suter', start: '2026-11-27', end: '2026-11-29' }, { p: 'Airport Shuttle', person: 'Corinne Suter', start: '2026-11-27' }] },
  ]);
  const trips = TRIPS().map(t => ({ ...t, import_key: t.booking_ref === '2026-5074' ? 'bl:2026-5074:arr' : t.booking_ref === '2026-4070' ? 'bl:2026-4070:dep' : t.import_key, last_import_at: '2026-11-14T03:00:00Z' }));
  const errors = collectFatalErrors(page);
  const st = await openWeek(page, { trips });
  await page.click('#weekRoot button:has-text("Import Guests file")');
  await page.setInputFiles('#trGuestsFile', { name: '2026-11-16 2007 - teste sri lanka.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await expect(page.locator('#weekRoot .tr-plan-sum')).toBeVisible();
  await expect(page.locator('#weekRoot .tr-plan-sum')).toHaveAttribute('data-plan', '2|1|0|1');
  await expect(page.locator('#weekRoot .tr-plan-sum')).toContainText('3 past legs');
  await expect(page.locator('#weekRoot')).toContainText('Not in the report — cancel?');
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 3');
  await expect(page.locator('#weekRoot .tr-audit')).toContainText('6 guests in the file = 5 guests imported + 1 left out');
  await page.click('#trImportSave');
  const imp = (await call(st, 'import')).body;
  expect(imp.p_trips.map(t => t.key).sort()).toEqual(['bl:2026-5074:arr', 'bl:2026-9001:arr', 'bl:2026-9001:dep']);
  expect(imp.p_is_preset).toBe(false);
  expect(imp.p_cancel_refs).toEqual([]);
  expect(imp.p_guests.map(g => g.booking_ref).sort()).toEqual(['2026-3842', '2026-4070', '2026-5074', '2026-9001', '2026-9001']);
  expect(imp.p_trips.find(t => t.key === 'bl:2026-9001:arr')).toMatchObject({ pax: 2, time: '10:00', flight: 'QR664', expected_price: 21000 });
  expect(errors).toEqual([]);
});
