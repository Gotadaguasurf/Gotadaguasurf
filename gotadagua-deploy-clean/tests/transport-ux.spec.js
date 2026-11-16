// Camp hub · Transport UX pass (16 Nov 2026) — Morocco, stubbed Supabase, synthetic guests and invented ledger lines.
//
// Miguel: «van runs???? depois pay driver e depois add transfer??? isto tem de estar melhor… sem coisas duplicadas»,
// «poder ter check point do que está certo», and the QA pass on main 0985956. What these tests pin:
//   · the page order — pills, To do, Owed to drivers (with Pay), the week bar with the pill's ONE blue button, the days,
//     Drivers and contacts · Export month at the foot;
//   · every airport row's checkpoint strip (Booked · Info · Driver · Guest · Paid) and its labelled «Edit», whose typed
//     values go into edited_fields;
//   · QA 1 «Link trips» never pays trips after the payment nor several months in one tap; Morocco's bank check starts 1 Nov;
//   · QA 2 a «did the driver go?» trip asks the question and Pay never ticks it by itself;
//   · QA 6 «Not booked» on a trip that already happened asks the question instead of cancelling.
// «Now» = Sat 14 Nov 2026 10:00 Casablanca (ma-helpers).
const { test, expect } = require('@playwright/test');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');

async function openTab(page, opts = {}) {
  const st = await H.open(page, opts);
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  return st;
}
const ledgerRow = (id, desc, amount, date) => ({ id, location_id: H.LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: null, description: desc, payment_method: 'Bank Transfer', qty: 1,
  amount_local: amount, currency: 'MAD', entry_date: date, business_area: 'Transport', fx_rate: 10.8, amount_eur: amount / 10.8, recurring_source_id: null, recurring_month: null, source_kind: 'manual',
  is_comp: false, zone_id: null, paid_from: 'morocco', attributed_location: 'morocco', created_at: '2026-11-14T09:00:00Z' });
const key = k => H.tripsFromFile().find(t => t.import_key === k);
const rowOf = (page, id) => page.locator(`#transportRoot .tr-row[data-trip="${id}"]`);

test('page order: pills → To do → Owed to drivers (Pay) → week bar with one blue button → days → foot links; every pill keeps one blue button', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openTab(page, { trips: H.tripsFromFile() });
  const order = await page.evaluate(() => [...document.querySelectorAll('#transportRoot > *, #transportRoot .tr-tripview > *')].map(el => el.className.split(' ').find(c => /^(section-head|tr-tabs|pills|health-strip|tr-owed|ov-filters|tr-sheet|tr-foot-links|hint)$/.test(c)) || el.className.split(' ')[0]));
  const idx = c => order.indexOf(c);
  expect(idx('section-head')).toBeLessThan(idx('pills'));
  expect(idx('pills')).toBeLessThan(idx('health-strip'));
  expect(idx('health-strip')).toBeLessThan(idx('tr-owed'));
  expect(idx('tr-owed')).toBeLessThan(order.indexOf('tr-tripview'));
  expect(order[order.length - 1]).toBe('tr-foot-links');
  for (const cat of ['all', 'airport', 'vans', 'tours']) {
    await page.click(`#transportRoot .tr-tabs .pill[data-cat="${cat}"]`);
    await expect(page.locator('#transportRoot .btn-p:visible'), cat).toHaveCount(1);
  }
  await page.click('#transportRoot .tr-tabs .pill[data-cat="airport"]');
  await expect(page.locator('#transportRoot .btn-p:visible')).toHaveText('Send the whole week');
  expect(errors).toEqual([]);
});

test('checkpoints: Booked · Info · Driver (status select) · Guest on a transfer to come; red «No …» + Edit + Ask guest when info is missing; Paid / Owed once it has happened', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const trips = H.tripsFromFile().map(t => t.import_key === 'bl:MA-1001:arr' ? { ...t, bl_checked_at: '2026-11-13T08:00:00Z', vehicle: 'Car', trip_date: '2026-11-15' }
    : t.import_key === 'bl:MA-1002:arr' ? { ...t, bl_checked_at: null, trip_date: '2026-11-13', trip_time: '09:00' } : { ...t, bl_checked_at: null });
  await openTab(page, { trips });
  const full = rowOf(page, key('bl:MA-1001:arr').id);
  expect(await full.locator('[data-step]').evaluateAll(els => els.map(e => [e.dataset.step, e.dataset.state]))).toEqual([['booked', 'ok'], ['info', 'ok'], ['driver', 'planned'], ['guest', undefined]]);
  await expect(full.locator('[data-step="driver"] [data-status-sel]')).toHaveValue('planned');
  await expect(full.locator('[data-step="info"]')).toHaveText('Info');
  // Missing: the red step says what and «Edit» opens the sheet; «Ask guest» sits next to it.
  const miss = rowOf(page, key('bl:MA-1004:arr').id);
  await expect(miss.locator('[data-step="info"] [data-missline]')).toHaveText(/No flight$/);
  await expect(miss.locator('[data-step="info"] [data-edit-info]')).toHaveText('Edit');
  await expect(miss.locator('[data-step="booked"]')).toHaveAttribute('data-state', 'todo');
  await expect(miss.locator('.tr-step-act button')).toHaveText(/Ask guest for flight/);
  // Happened, not paid: no select any more — the Paid step says Owed.
  const done = rowOf(page, key('bl:MA-1002:arr').id);
  await page.click('button[title="Previous week"]');
  await expect(done.locator('[data-step="paid"] [data-pay="owed"]')).toHaveText('Owed');
  await expect(done.locator('[data-status-sel]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Edit: every field a manager may fix is in the sheet behind the row\'s «Edit»; typed values go into edited_fields (a re-import keeps them)', async ({ page }) => {
  const dep = key('bl:MA-1002:dep');
  const st = await openTab(page, { trips: H.tripsFromFile() });
  await page.evaluate(() => TransportUI.setWeek('2026-11-14', '2026-11-21'));
  await rowOf(page, dep.id).locator('[data-edit]').click();
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Edit departure · Sat 21 Nov');
  for (const id of ['tr_d', 'tr_t', 'tr_pu', 'tr_f', 'tr_p', 'tr_g', 'tr_ph', 'tr_v', 'tr_pr', 'tr_dr', 'tr_n']) await expect(page.locator(`#${id}`), id).toBeVisible();
  await expect(page.locator('#trOv')).toContainText('the next Guests import does not overwrite it');
  await page.fill('#tr_pu', '00:30');
  await page.fill('#tr_ph', '+33 600 000 099');
  await page.selectOption('#tr_v', 'Minivan');
  await page.fill('#tr_pr', '320');
  await page.click('#trOv .btn-p');
  const up = await H.call(st, 'trip_update');
  expect(up.body).toMatchObject({ pickup_time: '00:30', guest_phone: '+33600000099', vehicle: 'Minivan', expected_price: 320 });
  expect(up.body.edited_fields).toEqual(expect.arrayContaining(['pickup_time', 'guest_phone', 'vehicle', 'expected_price']));
  await expect(rowOf(page, dep.id).locator('[data-missline]')).toHaveCount(0);           // the pick-up time is in: Info ✓
});

test('QA 1 — Link trips: only trips on or before the payment, one month at a time (the month the payment names first), «Tick all» = that month; Mark explained in the sheet', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const base = key('bl:MA-1001:arr');
  const old = (n, date) => ({ ...base, id: `aaaaaaaa-0000-4000-8000-0000000e${String(n).padStart(4, '0')}`, import_key: `hist2026:${n}`, source: 'manual', trip_date: date, trip_time: '12:00', status: 'done', guest_names: `Old ${n}`, expected_price: 250 });
  const trips = [old(1, '2026-10-03'), old(2, '2026-10-05'), old(3, '2026-10-10'), old(4, '2026-10-20'), old(5, '2026-11-02'), old(6, '2026-11-05')];
  const pay = 'e1e1e1e1-0000-4000-8000-0000000000a1';
  const ledger = [ledgerRow(pay, 'October · Let Us Tours', 750, '2026-11-08'), ledgerRow('e1e1e1e1-0000-4000-8000-0000000000a2', 'September · Let Us Tours', 16000, '2026-10-12')];
  const st = await openTab(page, { trips, ledger });
  // Morocco checks bank lines from 1 Nov only: the 12 Oct «September» line does not nag (QA 16 Nov 2026).
  await expect(page.locator('#transportRoot [data-chip="check"]')).toHaveText('1 payment to check');
  await page.click('#transportRoot [data-chip="check"]');
  await expect(page.locator('#trOv .mhdr-title')).toHaveText('Link trips');
  await expect(page.locator('#lk_months .pill')).toHaveText(['Oct 2026', 'Nov 2026']);
  await expect(page.locator('#lk_months .pill.active')).toHaveText('Oct 2026');            // the month the payment names
  await expect(page.locator('#trOv .tr-pick')).toHaveCount(4);                              // October only, never after 8 Nov
  await page.click('#lk_all');
  await expect(page.locator('#lk_sum')).toContainText('Ticked MAD 1,000 of MAD 750'.replace(/ /g, ' '));
  await page.click('#lk_none');
  await page.click('#lk_months .pill:has-text("Nov 2026")');
  await expect(page.locator('#trOv .tr-pick')).toHaveCount(2);
  await expect(page.locator('#lk_all')).toHaveCount(0);                                      // 2 trips: no «Tick all»
  await expect(page.locator('#trOv [data-lk-explain]')).toHaveText('Mark explained');
  // A payment never pays a trip dated after it.
  expect(await page.evaluate(() => TransportUI.namedMonth('September · Let Us Tours', '2026-10-12'))).toBe('2026-09');
  expect(await page.evaluate(() => TransportUI.namedMonth('Paid December', '2027-01-05'))).toBe('2026-12');
  expect(st.calls.filter(c => c.t === 'link_set')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('QA 2 / QA 6 — «did the driver go?»: the amber question with «Driver went (pay)» / «Didn\'t go (cancel)»; Pay never ticks it by itself; «Not booked» on a past trip asks instead of cancelling', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const base = key('bl:MA-1001:arr');
  const t1 = { ...base, id: 'aaaaaaaa-0000-4000-8000-0000000f0001', import_key: 'bl:MA-7001:arr', booking_ref: 'MA-7001', trip_date: '2026-11-10', trip_time: '10:00', guest_names: 'Asked Once',
    import_flags: ['Transfer cancelled in Bookinglayer: did Yassine go? If not, cancel this trip'], bl_checked_at: null };
  const t2 = { ...base, id: 'aaaaaaaa-0000-4000-8000-0000000f0002', import_key: 'bl:MA-7002:arr', booking_ref: 'MA-7002', trip_date: '2026-11-11', trip_time: '11:00', guest_names: 'Plain Owed', import_flags: [], bl_checked_at: '2026-11-11T08:00:00Z' };
  const t3 = { ...base, id: 'aaaaaaaa-0000-4000-8000-0000000f0003', import_key: 'bl:MA-7003:arr', booking_ref: 'MA-7003', trip_date: '2026-11-13', trip_time: '11:00', guest_names: 'Yesterday Unchecked', import_flags: [], bl_checked_at: null };
  const st = await openTab(page, { trips: [t1, t2, t3], goLive: '2026-11-01' });
  await page.click('button[title="Previous week"]');
  await expect(rowOf(page, t1.id).locator('[data-flag]')).toHaveText(/Transfer cancelled in Bookinglayer — did Yassine go\?/);
  await expect(rowOf(page, t1.id).locator('[data-went]')).toHaveText('Driver went (pay)');
  await expect(rowOf(page, t2.id).locator('[data-went]')).toHaveCount(0);
  // Pay Let Us Tours: the flagged trip is listed «did the driver go?», not ticked.
  await page.click(`#trOwed [data-owed="${H.D.lut}"]`);
  const g1 = page.locator(`#trOv [data-pay-group="${t1.id}"]`);
  await expect(g1).toContainText('did the driver go?');
  await expect(g1.locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(page.locator(`#trOv [data-pay-group="${t2.id}"] input[type="checkbox"]`)).toBeChecked();
  await page.evaluate(() => TransportUI.closeModal());
  // He went → the question goes, the trip is plain owed.
  await rowOf(page, t1.id).locator('[data-went]').click();
  const up = await H.call(st, 'trip_update');
  expect(up.id).toBe(t1.id);
  expect(up.body.import_flags).toEqual([]);
  await expect(rowOf(page, t1.id).locator('[data-flag]')).toHaveCount(0);
  // «Not booked» on yesterday's unchecked trip (already happened): flagged with the question, never cancelled.
  await page.click('button[title="Next week"]');
  await page.click('button[title="Previous week"]');
  await rowOf(page, t3.id).locator('[data-bl-not]').click();
  const nb = await H.call(st, 'trip_update', 2);
  expect(nb.id).toBe(t3.id);
  expect(nb.body.status).toBeUndefined();
  expect(nb.body.import_flags).toEqual(['Not booked in Bookinglayer: did the driver go? If not, cancel this trip']);
  await expect(rowOf(page, t3.id).locator('[data-didnt]')).toBeVisible();
  // He did not go → cancelled with that reason.
  await rowOf(page, t3.id).locator('[data-didnt]').click();
  const c = await H.call(st, 'trip_update', 3);
  expect(c.body).toMatchObject({ status: 'cancelled', cancel_reason: 'Driver did not go (checked by hand)', import_flags: [] });
  expect(errors).toEqual([]);
});
