// Camp hub · Transport for Morocco (14 Nov 2026) — stubbed Supabase, synthetic guests.
//
// Airport transfers go to Let Us Tours (prices from /prices by airport and vehicle), the
// surf vans (Fathoune) are logged one tap per run with the people in the van, and every
// driver is paid by SG bank transfer: a trip is Paid only when linked to a Transport ·
// Bank Transfer line of the ledger. «Now» = Sat 14 Nov 2026 10:00 Casablanca.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');

const SHOTS = path.join(__dirname, '..', 'test-results', 'morocco-shots');
const DRV_SHOTS = process.env.DRV_SHOTS || path.join(__dirname, '..', 'test-results', 'drv-shots');
async function openTab(page, opts = {}) {
  const st = await H.open(page, opts);
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  return st;
}
function ledgerRow(id, desc, amount, date, extra = {}) {
  return { id, location_id: H.LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: null, description: desc, payment_method: 'Bank Transfer', qty: 1, amount_local: amount, currency: 'MAD',
    entry_date: date, business_area: 'Transport', fx_rate: 10.8, amount_eur: amount / 10.8, recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: 'morocco', attributed_location: 'morocco', created_at: '2026-11-14T09:00:00Z', ...extra };
}

test('morocco transport: the tab shows for the full view; pills in Floriane\'s words (Airport · Surf vans · Tours · Overview), no header button row; paying lives in «Owed to drivers» (16 Nov 2026 UX pass)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page);
  await expect(page.locator('#transportRoot .tr-how')).toContainText('Let Us Tours');
  await expect(page.locator('#transportRoot .tr-tabs .pill')).toHaveText(['All', 'Airport', 'Surf vans', 'Tours', 'Overview']);
  await expect(page.locator('#transportRoot .tr-actions, #trPayBtn')).toHaveCount(0);   // no «Van runs / Pay a driver / Add transfer / Drivers / Export month» row
  await expect(page.locator('#transportRoot')).not.toContainText('Van runs');
  await expect(page.locator('#trOwed #trPayOther')).toHaveText('Pay another driver');
  await expect(page.locator('#transportRoot [data-foot-links] button')).toHaveText(['Drivers and contacts', 'Export month']);
  await page.click('#transportRoot .tr-tabs .pill[data-cat="vans"]');
  await expect(page.locator('#transportRoot .btn-p:visible')).toHaveCount(1);
  await expect(page.locator('#transportRoot [data-add-runs="vans"]')).toHaveText('Add surf vans');
  await page.click('#transportRoot [data-add-runs="vans"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Surf vans');
  await expect(page.locator('#trOv .tr-tap-main[data-key="van|dunes"]')).toHaveCount(0);   // the Surf vans pill: surf routes only
  await page.evaluate(() => TransportUI.closeModal());
  await page.click('#transportRoot .tr-tabs .pill[data-cat="tours"]');
  await expect(page.locator('#transportRoot [data-add-runs="tours"]')).toHaveText('Add tour vans');
  await page.click('#transportRoot [data-plan]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Tour vans');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Plan the day');
  await page.evaluate(() => TransportUI.closeModal());
  await expect(page.locator('#transportRoot .tr-views')).toHaveCount(0);            // no Reconcile any more
  expect(errors).toEqual([]);
});

test('morocco transport: Guests import — Morocco rows only, Agadir / Marrakech prices, both legs, nothing read from HQ bookings, 38 rows = 32 guests + 6 left out', async ({ page }) => {
  const hqReads = [];
  page.on('request', r => { if (/\/rest\/v1\/bookings\?.*(booking_ref=in|check_in_on=gte)/.test(r.url())) hqReads.push(r.url()); });
  const st = await openTab(page);
  await page.evaluate(() => TransportUI.toImport());              // the one import door is in Week (15 Nov 2026)
  await expect(page.locator('#weekRoot .wk-import .card-hint').first()).toContainText('«Semana Marrocos»');
  await page.setInputFiles('#trGuestsFile', H.CSV(H.FILE));
  await expect(page.locator('#weekRoot')).toContainText('Airport trips from this file · 27');
  await expect(page.locator('.tr-audit')).toContainText('38 rows in the file = 32 guests imported + 6 left out');
  await expect(page.locator('.tr-leftout')).toContainText('17 - Castelo beach mixed dorm');
  await expect(page.locator('.tr-noprice')).toHaveCount(0);
  await expect(page.locator('.tr-noairprice')).toContainText('Nina Larsen, Guest without name (booking MA-1010) (Essaouira): no price for this airport');
  await page.click('#trImportSave');
  const imp = (await H.call(st, 'import')).body;
  const by = k => imp.p_trips.find(t => t.key === k);
  expect(by('bl:MA-1007:arr')).toMatchObject({ place: 'RAK', vehicle: 'Car', expected_price: 1200, time: '22:10', flight: 'TO3226' });
  expect(by('bl:MA-1007:dep')).toMatchObject({ place: 'RAK', expected_price: 1200 });            // the product says Marrakesh
  // Real file: «Airport Transfer Morocco (Marrakesh)», arrival location «-»: both legs from Marrakech at 1,200 (was Agadir 250).
  expect(by('bl:MA-1027:arr')).toMatchObject({ place: 'RAK', expected_price: 1200, flight: 'EZY2621' });
  expect(by('bl:MA-1027:dep')).toMatchObject({ place: 'RAK', expected_price: 1200 });
  expect(by('bl:MA-1028:arr').place).toBe('RAK');                                             // the location wins, the product disagrees:
  expect(by('bl:MA-1028:arr').flags.join(' ')).toContain('transfer booked for Agadir airport, the flight / location says Marrakech — check');
  expect(by('bl:MA-1001:arr')).toMatchObject({ place: 'AGA', pax: 2, expected_price: 250, flight: 'FR1110' });
  expect(by('bl:MA-1002:arr').flight).toBe('EJU5371');                                       // easyJet code read
  expect(by('bl:MA-1002:dep').flags.join(' ')).toContain('night departure');
  expect(by('bl:MA-1011:arr').flags.join(' ')).toContain('airport CMN is not a Morocco airport');
  expect(imp.p_trips.filter(t => !(t.expected_price > 0)).map(t => t.key)).toEqual(['bl:MA-1010:arr']);   // Essaouira arrival (no /prices row); out to Agadir as the product says: no /prices row yet
  expect(imp.p_cancel_refs).toEqual(['MA-1012']);
  expect(imp.p_guests.length).toBe(32);
  expect(by('bl:MA-1025:arr')).toMatchObject({ pax: 3, guests: ['Marco Bianchi', 'Guest without name (booking MA-1025)', 'Guest without name (booking MA-1025) (2)'] });   // two nameless +1s: 3 people, never merged
  expect(imp.p_guests.find(g => g.guest_name === 'Ines Costa').phone).toBe('+212661000019');
  expect(hqReads).toEqual([]);
});

test('morocco transport: driver and guest messages — the camp\'s format, Floriane signs, Marrakech airport, a sign with the name, no emoji', async ({ page }) => {
  await openTab(page, { trips: H.tripsFromFile() });
  const r = await page.evaluate(() => {
    const T = TransportUI._state.trips; const o = T.find(t => t.import_key === 'bl:MA-1007:arr'); const m = T.find(t => t.import_key === 'bl:MA-1004:arr');
    return { confirm: TransportUI.confirmText(o), ask: TransportUI.askText(m), wa: GuestsTrips.whatsappText(o, CampConfig.MA) };
  });
  // Floriane's driver format (16 Nov 2026): Oliver lands in Marrakech.
  expect(r.wa).toBe(['Marrakech airport to Surfcamp', 'Number of people: 1', 'Name: Oliver Smith', 'Contact WhatsApp: +447700900007', 'Flight number: TO3226', 'Arrival time: 22:10', 'Date: 16.11.2026', 'Car: small car'].join('\n'));
  expect(r.confirm).toContain("Hi Oliver! I'm Floriane, the manager of *Gota Dagua Surf Camp Morocco*.");
  expect(r.confirm).toContain('*arrivals exit* of Marrakech airport, holding a *sign with your name*');
  expect(r.ask).toContain('the *date and time* you land in Agadir');
  expect(H.EMOJI.test(r.confirm + r.ask + r.wa)).toBe(false);
});

test('morocco transport: van runs — day, driver, vehicle (from /prices), tap where it went = one run at the VEHICLE price, no head count; the order for tomorrow', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page);
  await page.evaluate(() => TransportUI.openTuktuk());
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Surf vans and tours');
  // Miguel, 17 Nov 2026: no «People in the van» stepper — the vehicle is picked, the price is the vehicle's
  await expect(page.locator('#tk_people')).toHaveCount(0);
  await expect(page.locator('#trOv .tr-people')).toHaveCount(0);
  await expect(page.locator('#tk_veh .pill')).toHaveText(['Car', 'Minivan', 'Big Van']);   // the vehicles /prices has, smallest first
  await expect(page.locator('#tk_veh .pill.active')).toHaveText('Minivan');
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .hint')).toHaveText('MAD 500 · Minivan');
  await expect(page.locator('.tr-tap-main[data-key="van|paradise-souk"] .hint')).toHaveText('MAD 1,100 · Minivan');   // Paradise Valley van 700 + Souk van 400, no special price
  await expect(page.locator('.tr-tap-main[data-key="van|taghazout-party"]')).toHaveCount(0);              // guests pay those drivers directly
  await expect(page.locator('.tr-tap-main[data-key="van|tamri"] .hint')).toHaveText('MAD 600 · Minivan');
  await page.click('#tk_veh .pill[data-v="Big Van"]');
  await expect(page.locator('#tk_veh .pill.active')).toHaveText('Big Van');
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .hint')).toHaveText('MAD 700 · Big Van');
  await page.locator('.tr-tap-main[data-key="van|surf"]').click();
  const ins = (await H.call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'other', route: 'Surf', purpose: 'surf', pax: null, expected_price: 700, vehicle: 'Big Van', status: 'done', currency: 'MAD', driver_id: H.D.fat });
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .tr-tap-n')).toHaveText('1');
  await expect(page.locator('#trOv .tr-tuk-total')).toHaveText(/^Sat 14 Nov · 1 run\s*MAD\s700$/);   // «day · N runs · MAD X», no people
  // Plan tomorrow: 2 vans of 8 to the surf spot at 08:00 → the order for Fathoune
  await page.click('#tk_mode .pill:has-text("Plan the day")');
  await page.fill('#tk_pt', '08:00');
  await page.selectOption('#tk_pr', 'van|surf');
  await page.fill('#tk_pn', '2');
  await expect(page.locator('#tk_pp')).toHaveCount(0);                              // no «People per van»
  await expect(page.locator('#tk_pv')).toHaveValue('Minivan');
  await page.click('#tk_padd');
  await expect(page.locator('#tk_plan .tr-plan-line')).toHaveCount(1);
  const order = await page.evaluate(() => TransportUI.orderText('2026-11-15', TransportUI._state.trips.filter(t => t.status === 'planned')));
  expect(order).toBe('*VANS - SUN 15 NOV*\n\n08:00 Surf Taghazout - 2 × Minivan');
  expect(await page.evaluate(() => TransportUI._state.trips.filter(t => t.status === 'planned').map(t => t.pax))).toEqual([null, null]);
  expect(await page.evaluate(() => TransportUI._state.trips.filter(t => t.status === 'planned').map(t => [t.vehicle, t.expected_price]))).toEqual([['Minivan', 500], ['Minivan', 500]]);
  expect(H.EMOJI.test(order)).toBe(false);
  await page.click('#tk_send');
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => decodeURIComponent(window.__opened.pop()))).toContain('wa.me/212600000102');
  await page.click('#trOv .btn:has-text("Done")');
  expect(await page.evaluate(() => TransportUI._state.trips.filter(t => t.kind === TransportUI.RUN.kind).length)).toBe(3);   // the run done + the 2 planned for tomorrow
  expect(errors).toEqual([]);
});

// Pay a driver (16 Nov 2026): Fathoune's runs since the last payment, by day × route; the SG transfer
// already brought by the statement is offered («Use SG transfer …») and linked — never a second line.
const fatRuns = () => [1, 2, 3].map(i => ({ id: `cccccccc-0000-4000-8000-00000000000${i}`, location_id: H.LOC, kind: 'other', trip_date: '2026-11-1' + (i + 1), trip_time: '08:00', route: i === 3 ? 'Paradise + Souk' : 'Surf', purpose: i === 3 ? 'tour' : 'surf',
  tour_name: i === 3 ? 'Paradise Valley + Souk Tour' : null, pax: 10, vehicle: 'Big Van', driver_id: H.D.fat, expected_price: 900, currency: 'MAD', status: 'done', source: 'manual', payment_entry_id: null, import_flags: [], edited_fields: [], created_at: '2026-11-12T08:00:00Z' }));
test('morocco pay: tap Fathoune in «Owed to drivers» → his runs ticked; the SG transfer from the statement is offered and linked, no new line', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const runs = fatRuns();
  const upcoming = { ...H.tripsFromFile().find(t => t.import_key === 'bl:MA-1007:arr') };
  const ledger = [ledgerRow('e1e1e1e1-0000-4000-8000-000000000001', 'Fathoune Mounir — transport services (bank, paid 14 Nov)', 2700, '2026-11-14'),
    ledgerRow('e1e1e1e1-0000-4000-8000-000000000002', 'Afriquia — car diesel', 400, '2026-11-14', { payment_method: 'Card' })];
  const st = await openTab(page, { trips: [...runs, upcoming], ledger, goLive: '2026-11-07' });
  const chip = await page.evaluate(() => { const c = CAMP_CHECKS.find(x => x.id === 'transport-bank-unlinked'); return c.run({ ledger: S.ledger, location: 'morocco', isLocal: false, today: '2026-11-14' }); });
  expect(chip.text.replace(/\s/g, ' ')).toBe('Bank transfer to a driver not linked to trips · 1 · MAD 2,700');
  await expect(page.locator('#transportRoot [data-chip="check"]')).toHaveText('1 payment to check');
  await page.click(`#trOwed [data-owed="${H.D.fat}"]`);
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Pay Fathoune');
  await expect(page.locator('#trOv [data-pay-group]')).toHaveCount(3);                       // one line per day × route
  await expect(page.locator('#trOv [data-pay-group]', { hasText: 'Paradise + Souk' })).toContainText('10 people');
  await expect(page.locator('#py_amt')).toHaveValue('2700');
  await expect(page.locator('#trOv label:has-text("Bank transfer to Fathoune")')).toHaveCount(1);
  const bank = page.locator('#trOv [data-bank="e1e1e1e1-0000-4000-8000-000000000001"]');
  await expect(bank).toHaveText(/Use SG transfer 14 Nov · MAD\s2,700/);
  await expect(page.locator('#trOv [data-bank="e1e1e1e1-0000-4000-8000-000000000002"]')).toHaveCount(0);   // a card fuel payment is no driver payment
  fs.mkdirSync(DRV_SHOTS, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await bank.click();
  await expect(page.locator('#py_save')).toHaveText('Link payment');
  expect(await H.noOverflow(page)).toBe(true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(DRV_SHOTS, 'morocco-pay-390.png') });
  await page.click('#py_save');
  const set = (await H.call(st, 'link_set')).body;
  expect(set).toMatchObject({ p_entry: 'e1e1e1e1-0000-4000-8000-000000000001', p_driver: H.D.fat, p_note: null });
  expect(set.p_trip_ids.sort()).toEqual(runs.map(r => r.id));
  expect(st.calls.filter(c => c.t === 'pay')).toEqual([]);                                 // no second line for the same money
  await expect(page.locator('#transportRoot [data-chip="check"]')).toHaveCount(0);
  await expect(page.locator(`.tr-row[data-trip="${upcoming.id}"] [data-pay]`)).toHaveCount(0);   // upcoming never paid: no Paid badge, only its status select (16 Nov 2026)
  expect(errors).toEqual([]);
});

test('morocco pay: no SG line yet → one Bank Transfer row (MAD) for all the runs, linked through camp_trips_pay', async ({ page }) => {
  const runs = fatRuns();
  const st = await openTab(page, { trips: runs, goLive: '2026-11-07' });
  await page.evaluate(id => TransportUI.payPick(id), H.D.fat);
  await expect(page.locator('#trOv [data-bank]')).toHaveCount(0);
  await page.click('#py_save');
  const pay = (await H.call(st, 'pay')).body;
  expect(pay.p_entries.length).toBe(1);
  expect(pay.p_entries[0]).toMatchObject({ category: 'Transport', payment_method: 'Bank Transfer', currency: 'MAD', amount_local: 2700, source_kind: 'trip_payment', linked_item: 'Surf' });
  expect(pay.p_entries[0].trip_ids.sort()).toEqual(runs.map(r => r.id));
  expect(pay.p_entries[0].description).toBe('Fathoune · 3 tour runs (Paradise Valley + Souk Tour) · 12–14 Nov');
});

test('morocco Quick add: Transport naming Fathoune → «Paying Fathoune? Pay in Drivers»; the button opens his Pay sheet (a warning only)', async ({ page }) => {
  const st = await H.open(page, { trips: fatRuns(), goLive: '2026-11-07' });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => { showPage('expenses'); resetQuickExpense(); document.getElementById('qe_type').value = 'expense'; renderQuickExpenseCategories(); document.getElementById('qe_cat').value = 'Transport'; renderEntryCategorySelection('qe'); });
  await page.fill('#qe_desc', 'Fathoune November vans');
  await expect(page.locator('#qe_paylink_wrap')).toContainText('Paying Fathoune? Pay in Drivers');
  await page.click('#pl_pay');
  expect(await page.evaluate(() => activePage)).toBe('transport');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Pay Fathoune');
  expect(st.calls.filter(c => c.t === 'link_own')).toEqual([]);
});

test('morocco transport: screenshots at 390 and 1280 — Trips, the Guests import (in Week), van runs; no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = collectFatalErrors(page);
  const runs = [{ id: 'cccccccc-0000-4000-8000-000000000009', location_id: H.LOC, kind: 'other', trip_date: '2026-11-14', trip_time: '08:00', route: 'Surf', purpose: 'surf', pax: 9, vehicle: 'Van', driver_id: H.D.fat, expected_price: 990, currency: 'MAD', status: 'done', source: 'manual', payment_entry_id: null, import_flags: [], edited_fields: [], created_at: '2026-11-14T08:00:00Z' }];
  await openTab(page, { trips: [...H.tripsFromFile(), ...runs] });
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const v of ['trips', 'import']) {
      await page.evaluate(v => { if (v === 'import') TransportUI.toImport(); else { showPage('transport'); TransportUI.setView(v); } }, v);
      await page.waitForTimeout(150);
      expect(await H.noOverflow(page), `${v} at ${w}`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `transport-${v}-${w}.png`), fullPage: true });
    }
    await page.evaluate(() => { showPage('transport'); TransportUI.openTuktuk(); });
    await page.waitForTimeout(150);
    expect(await H.noOverflow(page), `van runs at ${w}`).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, `transport-vanruns-${w}.png`) });
    await page.evaluate(() => TransportUI.closeModal());
  }
  expect(errors).toEqual([]);
});

// A change on the Bookinglayer side is said on the import result, one line each (coordinator, 14 Nov):
// a missing column, a room not in the list, a transfer product with a new name or an unknown airport, a new package.
test('morocco import: loud warnings — missing column, room not in the list, new transfer product / unknown airport, new package; Essaouira without a price', async ({ page }) => {
  const rows = H.GT.parseCsv(fs.readFileSync(H.CSV(H.FILE), 'utf8')).filter(r => r.length > 1);
  const head = rows[0]; const col = n => head.indexOf(n);
  const set = (guest, name, v) => { rows.find(r => r[col('Guest')] === guest)[col(name)] = v; };
  set('Karl Nilsson', 'Transfers', 'Airport Shuttle Tamraght');                                   // a new product name
  set('Lisa Brown', 'Transfers', 'Airport Transfer Morocco (Casablanca), Airport Transfer Morocco (Casablanca)');   // an airport the camp does not use
  set('Eva Novak', 'Transfers', 'Airport Transfer Morocco (Essaouira)'); set('Eva Novak', 'Has transfer', 'Yes');   // known airport, no /prices row
  set('Lucas Dubois', 'Packages', 'Surf & Yoga Retreat Morocco');                                 // a package never seen
  const drop = col('Bed number');
  const csv = rows.map(r => r.filter((_, i) => i !== drop).map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
  await openTab(page);
  await page.evaluate(() => TransportUI.toImport());
  await page.setInputFiles('#trGuestsFile', { name: 'ma-guests-2026-11-14.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  const w = page.locator('.tr-impwarn');
  await expect(w).toBeVisible();
  const lines = await w.locator('.tr-impwarn-l').allInnerTexts();
  expect(lines).toEqual([
    'Column «Bed number» is missing from the file — add it back in the «Semana Marrocos» tab of Bookinglayer',
    'Room «10 - Mirleft Private Room» is not in the room list (1 guest: Sara Ali) — counted, its beds are not checked; ask Miguel to add it',
    'Transfer product «Airport Shuttle Tamraght» is new — the app cannot tell the airport, Agadir assumed (Karl Nilsson)',
    'Transfer product «Airport Transfer Morocco (Casablanca)»: airport «Casablanca» is not one the camp knows (Lisa Brown)',
    'Package «Surf & Yoga Retreat Morocco» was never seen before (1 guest: Lucas Dubois) — check what it includes (transfer, lessons, yoga)',
  ]);
  await expect(page.locator('.tr-noairprice')).toContainText('Eva Novak (Essaouira): no price for this airport');
});

test('morocco import: the real fixture gives one warning only (the room not in the list); Sri Lanka files give none', async () => {
  const w = H.GT.importWarnings(fs.readFileSync(H.CSV(H.FILE), 'utf8'), H.FILE, H.CC.MA);
  expect(w.map(x => x.kind)).toEqual(['room']);
  const sl = fs.readFileSync(path.join(__dirname, 'fixtures', 'Bookinglayer-Guests-2026-11-07 14_23.csv'), 'utf8');
  expect(H.GT.importWarnings(sl, 'x')).toEqual([]);
});

test('morocco import: a «Booking location» column, when the export has one, decides the camp («Tamraght Camp (MA)» in, anything else out)', () => {
  const rows = H.GT.parseCsv(fs.readFileSync(H.CSV(H.FILE), 'utf8')).filter(r => r.length > 1);
  rows[0].push('Booking location');
  rows.slice(1).forEach(r => r.push(r[1] === 'Joana Silva' ? 'Surf Camp Ericeira (PT)' : r[1] === 'Sara Ali' ? 'Tamraght Camp (MA)' : r[1] === 'Ravi Perera' ? 'Surf Camp Ahamgama (LK)' : 'Tamraght Camp (MA)'));
  const csv = rows.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
  const a = H.GT.guestAudit(csv, 'x.csv', H.CC.MA);
  expect(a.left.filter(x => x.kind === 'other_camp').map(x => x.name)).toEqual(['Joana Silva', 'Ravi Perera']);   // Pedro («13 - Castelo …») is in: the column says Tamraght
  expect(a.guests).toBe(33);
});

test('morocco «Send the whole day»: the same house-style message the old Week → Transfers sent, to Let Us Tours, sent ones marked, held out', async ({ page }) => {
  const trips = H.tripsFromFile().map(t => t.import_key === 'bl:MA-1001:arr' ? { ...t, status: 'confirmed' } : t.import_key === 'bl:MA-1010:arr' ? { ...t, missing_since: '2026-11-14' } : t);
  await openTab(page, { trips });
  await page.evaluate(() => TransportUI.sendDay('2026-11-14'));
  const url = decodeURIComponent(await page.evaluate(() => window.__opened.pop()));
  expect(url.startsWith('https://wa.me/212600000101?text=')).toBe(true);
  expect(url.split('?text=')[1]).toBe([
    '*TRANSFERS TODAY - 14 NOV*',
    'Agadir airport to Surfcamp\nNumber of people: 1\nName: Sophie Martin\nContact WhatsApp: +33600000002\nFlight number: EJU5371\nArrival time: 10:05\nDate: 14.11.2026\nCar: small car',
    'Agadir airport to Surfcamp _(already sent)_\nNumber of people: 2\nName: Lena Hoffmann, Jonas Weber\nContact WhatsApp: +491510000001\nFlight number: FR1110\nArrival time: 14:20\nDate: 14.11.2026\nCar: small car',
  ].join('\n\n'));   // now 10:00: Karl 09:00 and Yuki 06:40 have passed; Nina is held (not in the latest file)
});

// The week as one sheet (16 Nov 2026, Miguel: «em Marrocos surf vans, tours… e aeroporto (este é sempre pelo
// mesmo)»): Airport · Surf vans · Tours; «+ Add» on a Tours day opens the van sheet with the tours only and
// Fathoune; on an Airport day the transfer form with Let Us Tours.
const SHEET_SHOTS = process.env.SHEET_SHOTS || path.join(__dirname, '..', 'test-results', 'sheet-shots');
test('morocco sheet: Airport / Surf vans / Tours pills, identical tour runs as one row «× 2», «+ Add» prefilled (tours only, Fathoune; airport with Let Us Tours)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const base = { location_id: H.LOC, kind: 'other', trip_time: '09:00', vehicle: 'Van', driver_id: H.D.fat, currency: 'MAD', source: 'manual', payment_entry_id: null, import_flags: [], edited_fields: [], created_at: '2026-11-14T08:00:00Z' };
  const id = n => `cccccccc-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  const trips = [
    { ...base, id: id(1), trip_date: '2026-11-14', trip_time: '08:00', route: 'Surf', purpose: 'surf', pax: 8, vehicle: 'Minivan', expected_price: 800, status: 'done' },
    { ...base, id: id(2), trip_date: '2026-11-16', route: 'Dunes', purpose: 'tour', tour_name: 'Dunes — Sandboarding', pax: 6, vehicle: 'Minivan', expected_price: 800, status: 'planned' },
    { ...base, id: id(3), trip_date: '2026-11-16', route: 'Dunes', purpose: 'tour', tour_name: 'Dunes — Sandboarding', pax: 6, vehicle: 'Minivan', expected_price: 800, status: 'planned' },
    { ...base, id: id(4), trip_date: '2026-11-17', route: 'Paradise + Souk', purpose: 'tour', tour_name: 'Paradise Valley + Souk Tour', pax: 10, vehicle: 'Big Van', expected_price: 900, status: 'planned' },
    { ...base, id: id(5), kind: 'airport_arrival', trip_date: '2026-11-15', trip_time: '12:00', route: 'Airport → Surfcamp', purpose: 'guests', guest_names: 'Sheet Guest', pax: 2, vehicle: 'Car', driver_id: H.D.lut, expected_price: 250, status: 'planned', place: 'AGA', charge: 'bookinglayer' },
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, { trips, goLive: '2026-11-07' });
  await expect(page.locator('#transportRoot .tr-cats .pill')).toHaveText(['All', 'Airport', 'Surf vans', 'Tours', 'Overview']);
  await expect(page.locator('#transportRoot .tr-day')).toHaveCount(7);
  await expect(page.locator('#transportRoot [data-foot]')).toHaveCount(3);
  await page.click('#transportRoot .tr-cats .pill[data-cat="vans"]');
  await expect(page.locator('#transportRoot .tr-tuk-line')).toHaveCount(1);
  await expect(page.locator('#transportRoot .tr-tuk-line')).toContainText('Surf Taghazout');
  await page.click('#transportRoot .tr-cats .pill[data-cat="tours"]');
  await expect(page.locator('#transportRoot .tr-row')).toHaveCount(0);
  await expect(page.locator('#transportRoot .tr-tuk-line')).toHaveCount(2);
  const dunes = page.locator('#transportRoot .tr-tuk-line[data-n="2"]');
  await expect(dunes).toContainText('Dunes');
  await expect(dunes).toContainText('× 2');
  await expect(dunes.locator('.tr-c-meta')).toHaveText('Minivan · 12 people · Fathoune');
  await expect(page.locator('#transportRoot [data-foot="tours"]')).toContainText('3 runs · MAD 2,500');
  await expect(page.locator('#transportRoot .tr-tuk-line', { hasText: 'Paradise + Souk' }).locator('.tr-confirm')).toHaveCount(0);   // priced: Paradise van + Souk van
  await expect(page.locator('#transportRoot .tr-tuk-line', { hasText: 'Paradise + Souk' }).locator('.tr-c-meta')).toHaveText('Big Van · 10 people · Fathoune');
  expect(await H.noOverflow(page)).toBe(true);
  fs.mkdirSync(SHEET_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHEET_SHOTS, 'morocco-tours-390.png'), fullPage: true });
  // «+ Add» on a Tours day still to come: the plan sheet, tours only, Fathoune.
  await page.click('#transportRoot [data-add="2026-11-18"]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Plan the day');
  await expect(page.locator('#tk_pday .pill.active')).toHaveAttribute('data-day', '2026-11-18');   // a day that is neither today nor tomorrow: its own chip
  await expect(page.locator('#tk_dr')).toHaveValue(H.D.fat);
  const routes = await page.locator('#tk_pr option').allInnerTexts();
  expect(routes.length).toBeGreaterThan(0);
  expect(routes.some(r => /Surf|Imsouane|Tamri/.test(r))).toBe(false);
  expect(routes.some(r => /Dunes/.test(r))).toBe(true);
  await page.evaluate(() => TransportUI.closeModal());
  // Airport: always Let Us Tours.
  await page.click('#transportRoot .tr-cats .pill[data-cat="airport"]');
  await page.click('#transportRoot [data-add="2026-11-19"]');
  await expect(page.locator('#at_d')).toHaveValue('2026-11-19');
  await expect(page.locator('#at_dr')).toHaveValue(H.D.lut);
  expect(errors).toEqual([]);
});

test('morocco per-vehicle price in the edit sheet and in Pay «Run not in the list»: the price follows the vehicle, never the people', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const runs = fatRuns();
  const st = await openTab(page, { trips: runs, goLive: '2026-11-07' });
  await page.evaluate(id => TransportUI.openRuns([id]), runs[0].id);
  await expect(page.locator('#rn_v')).toHaveValue('Big Van');
  await expect(page.locator('#rn_pax')).toHaveCount(0);                         // no head count on a van run (17 Nov 2026)
  await page.selectOption('#rn_v', 'Car');
  await expect(page.locator('#rn_pr')).toHaveValue('300');                      // Surf — Car
  await page.click('#rn_save');
  const upd = (await H.call(st, 'trip_update')).body;
  expect(upd).toMatchObject({ vehicle: 'Car', expected_price: 300 });
  expect('pax' in upd).toBe(false);                                             // the stored head count is left as it was
  await expect(page.locator('#trOv.open')).toHaveCount(0);
  await page.evaluate(id => TransportUI.payPick(id), H.D.fat);
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Pay Fathoune');
  await page.locator('#py_add').scrollIntoViewIfNeeded();
  await page.click('#py_add');
  await page.fill('#py_ad', '2026-11-13');
  await page.selectOption('#py_ar', 'van|dunes');
  await page.selectOption('#py_av', 'Big Van');
  await page.click('#py_addok');
  const ins = (await H.call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ route: 'Dunes', purpose: 'tour', vehicle: 'Big Van', expected_price: 800, status: 'done', notes: 'Added when paying' });
  expect(errors).toEqual([]);
});

// Checked in Bookinglayer (supabase/camp-trips-bl-check.sql, 16 Nov 2026), Morocco: the same amber line, chip and
// «Booked ✓»; Week → Overview → To check carries the count and opens Transport on the list. Invented guests.
test('morocco bl check: unchecked Let Us Tours legs are «to check in Bookinglayer»; Week → To check opens the list; «Booked ✓» clears it', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const base = { location_id: H.LOC, route: 'Airport → Surfcamp', purpose: 'guests', tour_name: null, pickup_time: null, place: 'AGA', pax: 2, vehicle: 'Car', driver_id: H.D.lut, expected_price: 250, currency: 'MAD',
    status: 'planned', source: 'bookinglayer', charge: 'bookinglayer', import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null, created_at: '2026-11-14T08:00:00Z' };
  const trips = [
    { ...base, id: 'aaaaaaaa-0000-4000-8000-0000000bc001', kind: 'airport_arrival', trip_date: '2026-11-16', trip_time: '14:05', flight: 'FR1110', guest_names: 'Mona Invented, Nils Invented', guest_phone: '+212600000201', booking_ref: 'MA-9101', import_key: 'bl:MA-9101:arr', bl_checked_at: null },
    { ...base, id: 'aaaaaaaa-0000-4000-8000-0000000bc002', kind: 'airport_departure', route: 'Surfcamp → Airport', trip_date: '2026-11-18', trip_time: '10:00', pickup_time: '07:00', flight: 'FR1111', guest_names: 'Mona Invented, Nils Invented', guest_phone: '+212600000201', booking_ref: 'MA-9101', import_key: 'bl:MA-9101:dep', bl_checked_at: '2026-11-14T06:00:00Z' },
  ];
  const st = await H.openWeek(page, { trips });
  const chip = page.locator('#weekRoot .wk-tocheck [data-chip="blcheck"]');
  await expect(chip).toHaveText('1 transfer to check in Bookinglayer');
  await chip.click();
  await expect(page.locator('#transportRoot [data-chip="blcheck"]')).toHaveText('1 transfer to check in Bookinglayer');
  await expect(page.locator('#transportRoot .tr-row[data-trip]')).toHaveCount(1);
  const line = page.locator('#transportRoot .tr-row[data-trip="aaaaaaaa-0000-4000-8000-0000000bc001"] [data-blcheck]');
  await expect(line.locator('a.tr-bl-open')).toHaveAttribute('href', 'https://app.bookinglayer.io/bookings?page=1&limit=25&search=MA-9101&query=MA-9101');
  await line.locator('[data-bl-booked]').click();
  const up = await H.call(st, 'trip_update');
  expect(up.body).toMatchObject({ bl_check_note: 'checked by hand' });
  await expect(page.locator('#transportRoot [data-chip="blcheck"]')).toHaveCount(0);
  expect(await page.evaluate(() => TransportUI.blCheck.run({ location: 'morocco', isLocal: false }))).toBe(null);
  expect(errors).toEqual([]);
});

test('morocco van runs with /prices not loaded: a clear «not loaded» line, and a tap saves nothing (never a run at MAD 0)', async ({ page }) => {
  const st = await openTab(page, { noPrices: true });
  await page.evaluate(() => TransportUI.openTuktuk());
  await expect(page.locator('#trOv [data-prices-not-loaded]')).toContainText('Van prices not loaded from /prices');
  await expect(page.locator('#tk_veh')).toHaveCount(0);
  await page.evaluate(() => TransportUI.tap('van|surf'));
  await expect(page.locator('#toast')).toContainText('van prices have not loaded');
  expect(st.calls.filter(c => c.t === 'trip_insert')).toEqual([]);
});

// ════════════════════════════════════════════════════════════════════════════
//  Plan the day → send (17 Nov 2026): Morocco plans the surf vans / tours the DAY BEFORE and sends to Fathoune that
//  evening — one batch per day. A full day by hand: plan → send → change → UPDATE → the day passes → «All went as
//  planned» → Pay. The page clock = TRANSPORT_NOW (Sat 14 Nov 10:00 Casablanca = 09:00 UTC) so «Sent 10:00» reads.
// ════════════════════════════════════════════════════════════════════════════
const PLAN_SHOTS = process.env.PLAN_SHOTS || path.join(__dirname, '..', 'test-results', 'plan-shots');
test('morocco plan the day: default TOMORROW → send to Fathoune (Sent 10:00 ✓) → change → «Changed after sending» + UPDATE with only the change → the day passes → «All went as planned» once → Pay lists them', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await page.clock.setFixedTime(new Date('2026-11-14T09:00:00Z'));
  const st = await openTab(page);
  fs.mkdirSync(PLAN_SHOTS, { recursive: true });
  const shot = async name => { for (const [w, hgt] of [[390, 844], [1280, 900]]) { await page.setViewportSize({ width: w, height: hgt }); await page.waitForTimeout(450); await page.screenshot({ path: path.join(PLAN_SHOTS, `${name}-${w}.png`) }); } await page.setViewportSize({ width: 390, height: 844 }); };
  expect(await page.evaluate(() => TransportUI.PLAN_DAY)).toBe('tomorrow');
  await page.click('#transportRoot .tr-tabs .pill[data-cat="vans"]');
  await expect(page.locator('#trDay-2026-11-15 [data-plan-state]').first()).toHaveAttribute('data-plan-state', 'none');
  await expect(page.locator('#trDay-2026-11-15 .tr-dstate')).toContainText('Not planned');
  await page.click('#transportRoot [data-plan]');
  await expect(page.locator('#tk_mode .pill.active')).toHaveText('Plan the day');
  await expect(page.locator('#tk_pday .pill.active')).toHaveAttribute('data-day', '2026-11-15');     // tomorrow
  await expect(page.locator('#trOv .mhdr-sub')).toHaveText('Plan the runs, then send the order to the driver the evening before');
  await page.fill('#tk_pt', '08:00'); await page.selectOption('#tk_pr', 'van|surf'); await page.fill('#tk_pn', '2'); await page.selectOption('#tk_pv', 'Minivan'); await page.click('#tk_padd');
  await expect(page.locator('#tk_plan .tr-plan-line')).toHaveCount(1);
  await page.fill('#tk_pt', '14:00'); await page.selectOption('#tk_pr', 'van|imsouane'); await page.fill('#tk_pn', '1'); await page.selectOption('#tk_pv', 'Big Van'); await page.click('#tk_padd');
  await expect(page.locator('#tk_plan .tr-plan-line')).toHaveCount(2);
  await expect(page.locator('#tk_sent')).toHaveText('Planned · not sent');
  await expect(page.locator('#tk_send')).toHaveText('Send to Fathoune on WhatsApp');
  await expect(page.locator('#trOv .btn-p')).toHaveCount(1);
  await shot('ma-plan-sheet-planned');
  await page.click('#tk_send');
  const txt = async i => decodeURIComponent((await page.evaluate(n => window.__opened[n], i)).split('?text=')[1]);
  expect(await page.evaluate(() => window.__opened[0])).toContain('wa.me/212600000102');
  expect(await txt(0)).toBe('*VANS - SUN 15 NOV*\n\n08:00 Surf Taghazout - 2 × Minivan\n\n14:00 Surf Imsouane - 1 × Big Van');
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_update').length).toBe(3);
  expect(st.calls.filter(c => c.t === 'trip_update').every(c => c.body.status === 'sent' && c.body.sent_at && c.body.sent_snapshot.to === 'Fathoune')).toBe(true);
  await expect(page.locator('#tk_sent')).toHaveText('Sent 10:00 ✓ to Fathoune');
  await expect(page.locator('#tk_send')).toHaveCount(0);
  await shot('ma-plan-sheet-sent');
  // A change after sending: one more Surf van, Imsouane removed (kept as cancelled for the message)
  await page.locator('.tr-plan-line', { hasText: 'Surf Taghazout' }).locator('button[title="One run more"]').click();
  await expect(page.locator('.tr-plan-line', { hasText: 'Surf Taghazout' }).locator('.tr-step b')).toHaveText('3');
  await page.locator('.tr-plan-line', { hasText: 'Surf Imsouane' }).locator('button[title="One run less"]').click();
  await expect(page.locator('#tk_plan .tr-plan-line')).toHaveCount(1);
  await expect(page.locator('#tk_sent')).toHaveText('Changed after sending — send again');
  await expect(page.locator('#tk_batches .tr-batch-ch')).toContainText('08:00 Surf Taghazout - 3 × Minivan (was 2)');
  await expect(page.locator('#tk_batches .tr-batch-ch')).toContainText('14:00 Surf Imsouane - 1 × Big Van CANCELLED');
  await expect(page.locator('#tk_send')).toHaveText('Send the update to Fathoune on WhatsApp');
  await shot('ma-plan-sheet-changed');
  await page.click('#trOv #tk_done');
  await expect(page.locator('#trDay-2026-11-15 [data-plan-state]').first()).toHaveAttribute('data-plan-state', 'changed');
  await expect(page.locator('.tr-strip')).toContainText('Van runs for tomorrow changed — send the update');
  await shot('ma-day-header-changed');
  await page.click('#trDay-2026-11-15 [data-plan-day]');
  await page.click('#tk_send');
  expect(await txt(1)).toBe('*UPDATE: VANS - SUN 15 NOV*\n\n08:00 Surf Taghazout - 3 × Minivan (was 2)\n14:00 Surf Imsouane - 1 × Big Van CANCELLED');
  expect(H.EMOJI.test(await txt(1))).toBe(false);
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_delete').length).toBe(1);
  await expect(page.locator('#tk_sent')).toHaveText('Sent 10:00 ✓ to Fathoune');
  await page.click('#trOv #tk_done');
  await expect(page.locator('#trDay-2026-11-15 .tr-dstate')).toContainText('Sent 10:00 ✓ to Fathoune');
  await shot('ma-day-header-sent');
  // Reload: the same state from the rows
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 15000 });
  await page.evaluate(() => { showPage('transport'); TransportUI.setFilter('vans'); });
  await expect(page.locator('#trDay-2026-11-15 .tr-dstate')).toContainText('Sent 10:00 ✓ to Fathoune');
  // The day passes (Sun 15 Nov 19:00): «Log runs» on the day → the plan in the sheet → «All went as planned»
  const before = st.trips.filter(t => t.kind === 'other').length;
  await page.clock.setFixedTime(new Date('2026-11-15T18:00:00Z'));
  await page.evaluate(() => { window.TRANSPORT_NOW = '2026-11-15T19:00'; TransportUI.render(); });
  await expect(page.locator('#trDay-2026-11-15 [data-log-day]')).toHaveCount(1);
  const owed0 = await page.evaluate(id => TransportUI._state.trips.filter(t => t.driver_id === id && TransportUI.reconcileStatus(t) === 'owed').reduce((s, t) => s + Number(t.expected_price || 0), 0), H.D.fat);
  await page.click('#trDay-2026-11-15 [data-log-day]');
  await expect(page.locator('#tk_planlog')).toHaveAttribute('data-n', '3');
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .tr-tap-plan')).toHaveText('+3 planned');
  await expect(page.locator('#tk_allplan')).toHaveClass(/btn-p/);
  await shot('ma-log-sheet-planned');
  const nUp = st.calls.filter(c => c.t === 'trip_update').length;
  await page.click('#tk_allplan');
  await expect.poll(() => st.calls.filter(c => c.t === 'trip_update').length).toBe(nUp + 3);
  expect(st.calls.filter(c => c.t === 'trip_update').slice(nUp).every(c => c.body.status === 'done')).toBe(true);
  await expect(page.locator('#tk_allplan')).toHaveCount(0);                            // once: nothing left to mark
  await page.evaluate(() => TransportUI.allAsPlanned());
  expect(st.calls.filter(c => c.t === 'trip_update').length).toBe(nUp + 3);
  expect(st.trips.filter(t => t.kind === 'other').length).toBe(before);              // the same trips, never new ones
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .tr-tap-n')).toHaveText('3');
  await page.click('#trOv #tk_done');
  await expect(page.locator('#trDay-2026-11-15 .tr-dstate')).toContainText('Logged ✓ · 3 runs');
  // Owed / Pay: the same 3 runs, once, at their price (they were owed by time already — the tap writes it down)
  const owed1 = await page.evaluate(id => TransportUI._state.trips.filter(t => t.driver_id === id && TransportUI.reconcileStatus(t) === 'owed').reduce((s, t) => s + Number(t.expected_price || 0), 0), H.D.fat);
  expect(owed1).toBe(owed0);
  expect(owed1).toBe(1500);
  await page.click(`#trOwed [data-owed="${H.D.fat}"]`);
  const ids = await page.evaluate(() => TransportUI.payGroups(TransportUI._state.payDraft).flatMap(g => g.ids));
  expect(ids.length).toBe(3); expect(new Set(ids).size).toBe(3);
  await shot('ma-pay-after-plan');
  expect(errors).toEqual([]);
});

test('morocco: a sent van changed afterwards (vehicle) → «Changed after sending», the UPDATE names it; a run logged with nothing planned is not in any order; the airport UPDATE in Floriane\'s labelled format', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await page.clock.setFixedTime(new Date('2026-11-14T09:00:00Z'));
  const sentAt = '2026-11-14T08:00:00Z';
  const van = (id, o) => ({ id, location_id: H.LOC, kind: 'other', trip_date: '2026-11-15', trip_time: '08:00', route: 'Surf', purpose: 'surf', tour_name: null, guest_names: null, pax: null, vehicle: 'Minivan', driver_id: H.D.fat,
    expected_price: 500, currency: 'MAD', status: 'sent', source: 'manual', charge: null, payment_entry_id: null, import_flags: [], edited_fields: [], needs_resend: false, sent_at: sentAt,
    sent_snapshot: { trip_date: '2026-11-15', trip_time: '08:00', route: 'Surf', label: 'Surf Taghazout', vehicle: 'Minivan', to: 'Fathoune' }, created_at: '2026-11-13T08:00:00Z', ...o });
  const air = (id, o) => ({ id, location_id: H.LOC, kind: 'airport_arrival', trip_date: '2026-11-15', trip_time: '12:00', pickup_time: null, flight: 'FR 1', place: 'AGA', route: 'Airport → Surfcamp', purpose: 'guests', guest_names: 'Ana Air', guest_phone: '+33600000001',
    pax: 1, vehicle: 'Car', driver_id: H.D.lut, expected_price: 250, currency: 'MAD', status: 'sent', source: 'bookinglayer', charge: 'bookinglayer', import_flags: [], edited_fields: [], missing_since: null, needs_resend: false, payment_entry_id: null,
    sent_at: sentAt, sent_snapshot: { trip_date: '2026-11-15', trip_time: '12:00', flight: 'FR 1', pax: 1, place: 'AGA' }, created_at: '2026-11-13T08:00:00Z', ...o });
  const st = await openTab(page, { trips: [
    van('bbbbbbbb-0000-4000-8000-000000000001'), van('bbbbbbbb-0000-4000-8000-000000000002'),
    { ...van('bbbbbbbb-0000-4000-8000-000000000003'), trip_date: '2026-11-14', trip_time: '09:30', status: 'done', sent_at: null, sent_snapshot: null },
    air('bbbbbbbb-0000-4000-8000-000000000011', { trip_time: '13:30', needs_resend: true }),
  ] });
  await page.click('#transportRoot .tr-tabs .pill[data-cat="vans"]');
  await expect(page.locator('#trDay-2026-11-15 .tr-dstate')).toContainText('Sent 09:00 ✓ to Fathoune');
  await expect(page.locator('#trDay-2026-11-14 [data-plan-state]').first()).toHaveAttribute('data-plan-state', 'logged');   // logged, never «not sent»
  await page.evaluate(() => TransportUI.openRuns(['bbbbbbbb-0000-4000-8000-000000000002']));
  await page.selectOption('#rn_v', 'Big Van');
  await page.click('#rn_save');
  expect((await H.call(st, 'trip_update')).body).toMatchObject({ vehicle: 'Big Van', needs_resend: true });
  await expect(page.locator('#trDay-2026-11-15 [data-plan-state]').first()).toHaveAttribute('data-plan-state', 'changed');
  expect(await page.evaluate(id => TransportUI.planMessage('2026-11-15', id), H.D.fat))
    .toBe('*UPDATE: VANS - SUN 15 NOV*\n\n08:00 Surf Taghazout - 1 × Big Van NEW\n08:00 Surf Taghazout - 1 × Minivan (was 2)');
  // Airport: the day was sent, a time changed since → the labelled block marked with what changed
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await expect(page.locator('#trDay-2026-11-15 [data-air-state]')).toHaveText('Changed after sending — send again · 1');
  await page.click('#trDay-2026-11-15 [data-send-update]');
  const txt = decodeURIComponent((await page.evaluate(() => window.__opened.pop())).split('?text=')[1]);
  expect(txt).toBe(['*UPDATE: TRANSFERS TOMORROW - 15 NOV*', '',
    'Agadir airport to Surfcamp _(changed: time 12:00 → 13:30)_', 'Number of people: 1', 'Name: Ana Air', 'Contact WhatsApp: +33600000001', 'Flight number: FR 1', 'Arrival time: 13:30', 'Date: 15.11.2026', 'Car: small car'].join('\n'));
  expect(H.EMOJI.test(txt)).toBe(false);
  expect(errors).toEqual([]);
});
