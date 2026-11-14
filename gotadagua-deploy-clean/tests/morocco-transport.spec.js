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

test('morocco transport: the tab shows for the full view; the header says how Morocco pays (SG bank transfer), no «Pay a driver»', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page);
  await expect(page.locator('#transportRoot .tr-how')).toContainText('Let Us Tours');
  await expect(page.locator('#transportRoot .tr-actions')).toContainText('Van runs');
  await page.click('button.pill:has-text("Reconcile")');
  await expect(page.locator('#trPayBtn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('morocco transport: Guests import — Morocco rows only, Agadir / Marrakech prices, both legs, nothing read from HQ bookings, 31 rows = 25 guests + 6 left out', async ({ page }) => {
  const hqReads = [];
  page.on('request', r => { if (/\/rest\/v1\/bookings\?.*(booking_ref=in|check_in_on=gte)/.test(r.url())) hqReads.push(r.url()); });
  const st = await openTab(page);
  await page.click('button.pill:has-text("Next week")');
  await expect(page.locator('#transportRoot .card-hint').first()).toContainText('«Semana Marrocos»');
  await page.setInputFiles('#trGuestsFile', H.CSV(H.FILE));
  await expect(page.locator('#transportRoot')).toContainText('Airport trips from this file · 23');
  await expect(page.locator('.tr-audit')).toContainText('31 rows in the file = 25 guests imported + 6 left out');
  await expect(page.locator('.tr-leftout')).toContainText('17 - Castelo beach mixed dorm');
  await expect(page.locator('.tr-noprice')).toHaveCount(0);
  await expect(page.locator('.tr-noairprice')).toContainText('Nina Larsen, Guest without name (booking MA-1010) (Essaouira), Nina Larsen, Guest without name (booking MA-1010) (Essaouira): no price for this airport');
  await page.click('#trImportSave');
  const imp = (await H.call(st, 'import')).body;
  const by = k => imp.p_trips.find(t => t.key === k);
  expect(by('bl:MA-1007:arr')).toMatchObject({ place: 'RAK', vehicle: 'Car', expected_price: 1200, time: '22:10', flight: 'TO3226' });
  expect(by('bl:MA-1007:dep')).toMatchObject({ place: 'RAK', expected_price: 1200 });            // flies out from Marrakech too (flagged)
  expect(by('bl:MA-1007:dep').flags.join(' ')).toContain('departure airport not in the file: RAK');
  expect(by('bl:MA-1001:arr')).toMatchObject({ place: 'AGA', pax: 2, expected_price: 250, flight: 'FR1110' });
  expect(by('bl:MA-1002:arr').flight).toBe('EJU5371');                                       // easyJet code read
  expect(by('bl:MA-1002:dep').flags.join(' ')).toContain('night departure');
  expect(by('bl:MA-1011:arr').flags.join(' ')).toContain('airport CMN is not a Morocco airport');
  expect(imp.p_trips.filter(t => !(t.expected_price > 0)).map(t => t.key)).toEqual(['bl:MA-1010:arr', 'bl:MA-1010:dep']);   // Essaouira (in, and out like the arrival): no /prices row yet
  expect(imp.p_cancel_refs).toEqual(['MA-1012']);
  expect(imp.p_guests.length).toBe(25);
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
  expect(r.wa.split('\n').pop()).toBe('Car');
  expect(r.confirm).toContain("Hi Oliver! I'm Floriane, the manager of *Gota Dagua Surf Camp Morocco*.");
  expect(r.confirm).toContain('*arrivals exit* of Marrakech airport, holding a *sign with your name*');
  expect(r.ask).toContain('the *date and time* you land in Agadir');
  expect(H.EMOJI.test(r.confirm + r.ask + r.wa)).toBe(false);
});

test('morocco transport: van runs — people in the van, one tap = one run at 110 MAD per person, totals, the order for tomorrow', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const st = await openTab(page);
  await page.evaluate(() => TransportUI.openTuktuk());
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Van runs');
  for (let i = 0; i < 8; i++) await page.click('#trOv .tr-people button[title="One person more"]');
  await expect(page.locator('#tk_people')).toHaveText('9');
  await page.locator('.tr-tap-main[data-key="van|surf"]').click();
  const ins = (await H.call(st, 'trip_insert')).rows[0];
  expect(ins).toMatchObject({ kind: 'other', route: 'Surf', purpose: 'surf', pax: 9, expected_price: 990, vehicle: 'Van', status: 'done', currency: 'MAD', driver_id: H.D.fat });
  await expect(page.locator('.tr-tap-main[data-key="van|surf"] .tr-tap-n')).toHaveText('1');
  await expect(page.locator('#trOv .tr-tuk-total')).toContainText('1 run · 9 people');
  // Plan tomorrow: 2 vans of 8 to the surf spot at 08:00 → the order for Fathoune
  await page.click('#tk_mode .pill:has-text("Plan tomorrow")');
  await page.fill('#tk_pt', '08:00');
  await page.selectOption('#tk_pr', 'van|surf');
  await page.fill('#tk_pn', '2');
  await page.fill('#tk_pp', '8');
  await page.click('#tk_padd');
  await expect(page.locator('#tk_plan .tr-plan-line')).toHaveCount(1);
  const order = await page.evaluate(() => TransportUI.orderText('2026-11-15', TransportUI._state.trips.filter(t => t.status === 'planned')));
  expect(order).toBe('*VANS - SUN 15 NOV*\n\n08:00 Surf spot - 2 vans, 16 people');
  expect(H.EMOJI.test(order)).toBe(false);
  await page.click('#tk_send');
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => decodeURIComponent(window.__opened.pop()))).toContain('wa.me/212600000102');
  await page.click('#trOv .btn:has-text("Done")');
  await expect(page.locator('#transportRoot [data-total="tuktuk"] .kpi-label')).toContainText('Van · 3 runs');   // the run done + the 2 planned for tomorrow
  expect(errors).toEqual([]);
});

test('morocco transport: a bank transfer to Fathoune shows in Reconcile → Payments «to review», is linked to his runs, and they turn Paid; upcoming trips never green', async ({ page }) => {
  const runs = [1, 2, 3].map(i => ({ id: `cccccccc-0000-4000-8000-00000000000${i}`, location_id: H.LOC, kind: 'other', trip_date: '2026-11-1' + (i + 1), trip_time: '08:00', route: 'Surf', purpose: 'surf', pax: 10, vehicle: 'Van',
    driver_id: H.D.fat, expected_price: 1100, currency: 'MAD', status: 'done', source: 'manual', payment_entry_id: null, import_flags: [], edited_fields: [], created_at: '2026-11-12T08:00:00Z' }));
  const upcoming = { ...H.tripsFromFile().find(t => t.import_key === 'bl:MA-1007:arr') };
  const ledger = [ledgerRow('e1e1e1e1-0000-4000-8000-000000000001', 'Fathoune Mounir — transport services (bank, paid 14 Nov)', 3300, '2026-11-14'),
    ledgerRow('e1e1e1e1-0000-4000-8000-000000000002', 'Afriquia — car diesel', 400, '2026-11-14', { payment_method: 'Card' })];
  const st = await openTab(page, { trips: [...runs, upcoming], ledger, goLive: '2026-11-07' });
  const chip = await page.evaluate(() => { const c = CAMP_CHECKS.find(x => x.id === 'transport-bank-unlinked'); return c.run({ ledger: S.ledger, location: 'morocco', isLocal: false, today: '2026-11-14' }); });
  expect(chip.text.replace(/\s/g, ' ')).toBe('Bank transfer to a driver not linked to trips · 1 · MAD 3,300');
  await page.evaluate(() => TransportUI.setRec('payments'));
  const row = page.locator('tr[data-pay="e1e1e1e1-0000-4000-8000-000000000001"]');
  await expect(row).toHaveAttribute('data-state', 'review');
  await expect(page.locator('tr[data-pay="e1e1e1e1-0000-4000-8000-000000000002"]')).toHaveCount(0);   // a card fuel payment is no driver payment
  await row.locator('button:has-text("Link trips")').click();
  await expect(page.locator('#lk_dr')).toHaveValue(H.D.fat);
  for (const r of runs) await page.locator(`#trOv input[data-id="${r.id}"]`).check();
  await expect(page.locator('#lk_sum')).toHaveText(/Ticked MAD\s3,300 of MAD\s3,300/);
  await page.click('#lk_save');
  const set = (await H.call(st, 'link_set')).body;
  expect(set).toMatchObject({ p_entry: 'e1e1e1e1-0000-4000-8000-000000000001', p_driver: H.D.fat });
  expect(set.p_trip_ids.sort()).toEqual(runs.map(r => r.id));
  await expect(row).toHaveAttribute('data-state', 'matched');
  await page.evaluate(() => TransportUI.setRec('airport'));
  await expect(page.locator(`tr[data-trip="${upcoming.id}"]`)).toHaveAttribute('data-rec', 'upcoming');
  await expect(page.locator(`tr[data-trip="${upcoming.id}"] .tr-ok-y`)).toHaveCount(0);
});

test('morocco «Which transfers is this for?»: Transport · Agadir Airport · Bank Transfer lists the unpaid airport transfers; Cash only shows the hint', async ({ page }) => {
  const trips = H.tripsFromFile().filter(t => t.kind.startsWith('airport'));
  const st = await H.open(page, { trips, goLive: '2026-11-01' });
  await page.evaluate(() => { showPage('expenses'); });
  const btn = page.locator('.exp-quick-btn[data-cat="Transport"]');
  if (!(await btn.count())) test.skip(true, 'no Transport quick button in this layout');
  await btn.click();
  await page.evaluate(() => { const s = document.getElementById('qe_linked'); if (![...s.options].some(o => o.value === 'Agadir Airport')) s.add(new Option('Agadir Airport', 'Agadir Airport')); });
  await page.selectOption('#qe_linked', 'Agadir Airport');
  await page.selectOption('#qe_pay', 'Cash');
  await expect(page.locator('#qe_paylink_hint')).toHaveText('Paying the airport transfers by bank? Set the payment to Bank Transfer to tick the guests.');
  await page.selectOption('#qe_pay', 'Bank Transfer');
  await expect(page.locator('#qe_paylink_wrap .pl-row').first()).toBeVisible();
  await expect(page.locator('#qe_paylink_wrap #pl_more')).toHaveCount(0);
  expect(st.calls.filter(c => c.t === 'link_own')).toEqual([]);
  // Tick two transfers → the amount fills itself → save → the RPC links them to the saved Bank Transfer line.
  const ids = await page.locator('#qe_paylink_wrap input[data-trip]').evaluateAll(els => els.slice(0, 2).map(e => e.dataset.trip));
  await page.locator('#qe_paylink_wrap .pl-row').nth(0).click();
  await page.locator('#qe_paylink_wrap .pl-row').nth(1).click();
  await page.fill('#qe_desc', 'Let Us Tours · November transfers');
  await page.click('[onclick="saveQuickExpense()"]');
  const c = await H.call(st, 'link_own');
  const row = st.posted[st.posted.length - 1];
  expect(row).toMatchObject({ type: 'expense', category: 'Transport', linked_item: 'Agadir Airport', payment_method: 'Bank Transfer', currency: 'MAD' });
  expect(c.body.p_entry).toBe(row.id);
  expect(c.body.p_trip_ids.sort()).toEqual(ids.sort());
  await expect(page.locator('#toast')).toContainText('2 transfers linked');
});

test('morocco transport: screenshots at 390 and 1280 — Trips, Next week, Reconcile, van runs; no horizontal overflow', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = collectFatalErrors(page);
  const runs = [{ id: 'cccccccc-0000-4000-8000-000000000009', location_id: H.LOC, kind: 'other', trip_date: '2026-11-14', trip_time: '08:00', route: 'Surf', purpose: 'surf', pax: 9, vehicle: 'Van', driver_id: H.D.fat, expected_price: 990, currency: 'MAD', status: 'done', source: 'manual', payment_entry_id: null, import_flags: [], edited_fields: [], created_at: '2026-11-14T08:00:00Z' }];
  await openTab(page, { trips: [...H.tripsFromFile(), ...runs] });
  for (const [w, hgt] of [[390, 844], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const v of ['trips', 'next', 'reconcile']) {
      await page.evaluate(v => TransportUI.setView(v), v);
      await page.waitForTimeout(150);
      expect(await H.noOverflow(page), `${v} at ${w}`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `transport-${v}-${w}.png`), fullPage: true });
    }
    await page.evaluate(() => TransportUI.openTuktuk());
    await page.waitForTimeout(150);
    expect(await H.noOverflow(page), `van runs at ${w}`).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, `transport-vanruns-${w}.png`) });
    await page.evaluate(() => TransportUI.closeModal());
  }
  expect(errors).toEqual([]);
});
