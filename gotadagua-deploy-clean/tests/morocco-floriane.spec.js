// Camp hub · Floriane's feedback on Week and Transport (Morocco manager, 16 Nov 2026) — stubbed Supabase, synthetic guests.
//
//   1  IN / OUT in two colours (Week → Overview transfers, Transport rows)
//   2a Rooms → «By room» in arrival order, not by name / bed
//   2b Cleaning day message in two parts (in tests/morocco-week.spec.js and morocco-darija.spec.js)
//   4a the status with the driver as one select: Pending → Message Sent → Confirmed
//   4b missing information for the driver: a red row that says what is missing
//   4c «Export month»: a CSV of the month's trips for the provider's invoice
//   4d the driver message in Floriane's labelled format
const { test, expect } = require('@playwright/test');
const { collectFatalErrors } = require('./helpers');
const H = require('./ma-helpers');

async function openTab(page, opts = {}) {
  const st = await H.open(page, opts);
  await page.waitForFunction(() => window.TransportUI && TransportUI._state.loaded, null, { timeout: 10000 });
  await page.evaluate(() => showPage('transport'));
  return st;
}
// Every detail the driver needs, so only what a test removes is missing.
const complete = t => ({ ...t, flight: t.flight || 'FR 5297', trip_time: t.trip_time || '23:20', guest_phone: t.guest_phone || '+33600000000', pickup_time: t.kind === 'airport_departure' ? (t.pickup_time || '06:15') : null, vehicle: t.vehicle || 'Car' });

test('floriane 4d: the driver message — departure and arrival blocks in her shape, airport city, dd.mm.yyyy, vehicle words; Sri Lanka keeps its format', async ({ page }) => {
  await openTab(page);
  const r = await page.evaluate(() => {
    const base = { trip_date: '2026-11-17', pax: 1, guest_names: 'Jane Example', guest_phone: '+33600000000', place: 'AGA', vehicle: 'Car' };
    return {
      dep: GuestsTrips.whatsappText({ ...base, kind: 'airport_departure', trip_time: '09:30', pickup_time: '6:15' }, CampConfig.MA),
      depNoPickup: GuestsTrips.whatsappText({ ...base, kind: 'airport_departure', trip_time: '09:30', pickup_time: null }, CampConfig.MA),
      arr: GuestsTrips.whatsappText({ ...base, kind: 'airport_arrival', trip_date: '2026-11-16', guest_names: 'John Example, Ann Example', pax: 2, guest_phone: '+32400000000', flight: 'FR 5297', trip_time: '23:20', place: 'ESU', vehicle: 'Big Van' }, CampConfig.MA),
      mini: GuestsTrips.whatsappText({ ...base, kind: 'airport_arrival', place: 'RAK', vehicle: 'Minivan' }, CampConfig.MA),
      sl: GuestsTrips.whatsappText({ ...base, kind: 'airport_departure', trip_time: '09:30', pickup_time: '6:15', place: 'CMB' }),
    };
  });
  expect(r.dep).toBe(['Surfcamp to Agadir airport:', 'Number of people: 1', 'Name: Jane Example', 'Contact WhatsApp: +33600000000', 'Departure time from camp: 6:15', 'Date: 17.11.2026', 'Car: small car'].join('\n'));
  expect(r.depNoPickup).toContain('Departure time from camp: TBC');          // never the flight time (09:30)
  expect(r.depNoPickup).not.toContain('09:30');
  expect(r.arr).toBe(['Essaouira airport to Surfcamp', 'Number of people: 2', 'Name: John Example, Ann Example', 'Contact WhatsApp: +32400000000', 'Flight number: FR 5297', 'Arrival time: 23:20', 'Date: 16.11.2026', 'Car: big van'].join('\n'));
  expect(r.mini.split('\n')[0]).toBe('Marrakech airport to Surfcamp');
  expect(r.mini).toContain('Flight number: TBC\nArrival time: TBC');
  expect(r.mini.split('\n').pop()).toBe('Car: minivan');
  expect(r.sl).toBe('Camp to Airport\nJane Example\n+33600000000\n1 person\nFlight Number: TBC\nTime: 6:15\nDate: 17 Nov\nSmall Car');
  // «Send the whole day»: one block per trip, a blank line between them.
  const day = await page.evaluate(() => GuestsTrips.transfersText([
    { kind: 'airport_arrival', status: 'planned', trip_date: '2026-11-16', trip_time: '23:20', flight: 'FR 5297', guest_names: 'John Example', guest_phone: '+32400000000', place: 'AGA', vehicle: 'Car', pax: 1 },
    { kind: 'airport_departure', status: 'sent', trip_date: '2026-11-16', trip_time: '09:30', pickup_time: '06:15', guest_names: 'Jane Example', guest_phone: '+33600000000', place: 'AGA', vehicle: 'Car', pax: 1 },
  ], { day: '2026-11-16', now: '2026-11-14T10:00', cfg: CampConfig.MA }));
  expect(day).toBe(['*TRANSFERS - MON 16 NOV*', '',
    'Surfcamp to Agadir airport: _(already sent)_', 'Number of people: 1', 'Name: Jane Example', 'Contact WhatsApp: +33600000000', 'Departure time from camp: 06:15', 'Date: 16.11.2026', 'Car: small car', '',
    'Agadir airport to Surfcamp', 'Number of people: 1', 'Name: John Example', 'Contact WhatsApp: +32400000000', 'Flight number: FR 5297', 'Arrival time: 23:20', 'Date: 16.11.2026', 'Car: small car'].join('\n'));
});

test('floriane 4a: the status select — Pending → Message Sent → Confirmed on camp_trips, a step back, straight to Confirmed, «Sent ✓» kept for a changed trip', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const trips = H.tripsFromFile().map(complete).map(t => t.import_key === 'bl:MA-1007:arr' ? { ...t, status: 'sent', needs_resend: true } : t);
  const st = await openTab(page, { trips });
  const id = k => trips.find(t => t.import_key === k).id;
  const row = k => page.locator(`.tr-row[data-trip="${id(k)}"]`);
  // Sophie Martin lands Sat 14 10:05 (now 10:00): still to come.
  const sel = row('bl:MA-1002:arr').locator('[data-status-sel]');
  await expect(sel).toHaveValue('planned');
  await expect(sel.locator('option')).toHaveText(['Pending', 'Message Sent', 'Confirmed']);
  await sel.selectOption('sent');
  expect((await H.call(st, 'trip_update')).body).toMatchObject({ status: 'sent', needs_resend: false, sent_snapshot: { trip_date: '2026-11-14', trip_time: '10:05' } });
  await expect(row('bl:MA-1002:arr').locator('[data-status-sel]')).toHaveValue('sent');
  await row('bl:MA-1002:arr').locator('[data-status-sel]').selectOption('confirmed');
  expect((await H.call(st, 'trip_update', 2)).body).toMatchObject({ status: 'confirmed' });
  expect((await H.call(st, 'trip_update', 2)).body.confirmed_at).toBeTruthy();
  await row('bl:MA-1002:arr').locator('[data-status-sel]').selectOption('planned');
  expect((await H.call(st, 'trip_update', 3)).body).toEqual({ status: 'planned' });
  await expect(page.locator('#trOv.open')).toHaveCount(0);
  // Pending straight to Confirmed: it was sent too (the snapshot «changed since sent» reads).
  await row('bl:MA-1001:arr').locator('[data-status-sel]').selectOption('confirmed');
  expect((await H.call(st, 'trip_update', 4)).body).toMatchObject({ status: 'confirmed', needs_resend: false, sent_snapshot: { trip_date: '2026-11-14' } });
  // A changed trip: the select shows Message Sent, «Sent ✓» beside it clears the resend.
  const oliver = row('bl:MA-1007:arr');
  await expect(oliver.locator('[data-status-sel]')).toHaveValue('sent');
  await expect(oliver).toContainText('Time changed, resend');
  await oliver.locator('[data-resent]').click();
  expect((await H.call(st, 'trip_update', 5)).body).toMatchObject({ status: 'sent', needs_resend: false });
  await expect(oliver).not.toContainText('Time changed, resend');
  // A paid trip or one that has passed: no select.
  await expect(row('bl:MA-1011:arr').locator('[data-status-sel]')).toHaveCount(0);   // Karl, 09:00: passed
  expect(errors).toEqual([]);
});

test('floriane 4b: missing information — a red row saying what is missing (flight, time, phone, pick-up time, vehicle); complete and passed trips stay plain', async ({ page }) => {
  const trips = H.tripsFromFile().map(complete).map(t =>
    t.import_key === 'bl:MA-1002:arr' ? { ...t, flight: null, trip_time: null }
    : t.import_key === 'bl:MA-1001:arr' ? { ...t, guest_phone: null, vehicle: null }
    : t.import_key === 'bl:MA-1002:dep' ? { ...t, pickup_time: null } : t);
  await openTab(page, { trips });
  const id = k => trips.find(t => t.import_key === k).id;
  const row = k => page.locator(`.tr-row[data-trip="${id(k)}"]`);
  await expect(row('bl:MA-1002:arr')).toHaveClass(/tr-missing/);
  await expect(row('bl:MA-1002:arr').locator('[data-missline]')).toHaveText(/No flight · no time$/);
  await expect(row('bl:MA-1001:arr').locator('[data-missline]')).toHaveText(/No phone · no vehicle$/);
  const css = await row('bl:MA-1002:arr').evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, edge: s.boxShadow }; });
  expect(css.bg).toBe('rgb(253, 238, 236)');                    // --red-bg
  expect(css.edge).toContain('rgb(180, 35, 24)');               // --red edge
  await expect(row('bl:MA-1007:arr')).not.toHaveClass(/tr-missing/);   // Oliver Smith: everything there
  await expect(row('bl:MA-1011:arr')).not.toHaveClass(/tr-missing/);   // Karl 09:00: passed, nothing to ask
  const r = await page.evaluate(([a, b]) => { const T = TransportUI._state.trips; return [TransportUI.missingInfo(T.find(t => t.id === a)), TransportUI.missingInfo(T.find(t => t.id === b))]; }, [id('bl:MA-1002:dep'), id('bl:MA-1007:arr')]);
  expect(r).toEqual([['pick-up time'], []]);                   // Morocco: a departure needs the time the driver leaves the camp
  // Departures from the Guests file never carry a pick-up time: red until it is typed (Sat 21 closes this week).
  await expect(page.locator(`.tr-row[data-trip="${id('bl:MA-1002:dep')}"] [data-missline]`)).toHaveText(/No pick-up time$/);
});

test('floriane 4c: «Export month» — a CSV of the month (BOM, quoted, comma), one row per trip with direction, route, guests, flight, vehicle, driver, price, status, paid', async ({ page }) => {
  const trips = H.tripsFromFile().map(t => t.import_key === 'bl:MA-1001:arr' ? { ...t, payment_entry_id: 'cccccccc-0000-4000-8000-000000000001', status: 'confirmed' } : t.import_key === 'bl:MA-1007:arr' ? { ...t, status: 'cancelled' } : t)
    .concat([{ ...H.tripsFromFile()[0], id: 'bbbbbbbb-0000-4000-8000-000000000901', kind: 'other', route: 'Dunes', purpose: 'tour', guest_names: null, pax: 6, vehicle: 'Minivan', flight: null, trip_date: '2026-11-15', trip_time: '14:00', driver_id: H.D.fat, expected_price: 700, import_key: null },
      { ...H.tripsFromFile()[0], id: 'bbbbbbbb-0000-4000-8000-000000000902', trip_date: '2026-10-30', import_key: null, guest_names: 'October Guest' }]);
  const ledger = [{ id: 'cccccccc-0000-4000-8000-000000000001', location_id: H.LOC, week_id: null, type: 'expense', category: 'Transport', linked_item: null, description: 'Let Us Tours', payment_method: 'Bank Transfer', qty: 1, amount_local: 250, currency: 'MAD',
    entry_date: '2026-11-16', business_area: 'Transport', fx_rate: 10.8, amount_eur: 250 / 10.8, recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: 'morocco', attributed_location: 'morocco', created_at: '2026-11-16T09:00:00Z' }];
  await openTab(page, { trips, ledger });
  const csv = await page.evaluate(() => TransportUI.monthCsv('2026-11'));
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split('\r\n');
  expect(lines[0]).toBe('"Date","Time","Direction","Route / what","Guest names","People","Flight","Vehicle","Driver / supplier","Price (MAD)","Status","Paid","Paid on"');
  expect(lines.length - 1).toBe(trips.filter(t => t.trip_date.startsWith('2026-11')).length);   // one row per trip of the month; October out
  expect(csv).not.toContain('October Guest');
  const rowOf = name => lines.find(l => l.includes(name));
  expect(rowOf('"Lena Hoffmann, Jonas Weber"')).toMatch(/^"2026-11-14","14:20","IN","Agadir airport → Surfcamp","Lena Hoffmann, Jonas Weber","2","FR1110","Car","Let Us Tours","\d+","Confirmed","yes","2026-11-16"$/);
  expect(rowOf('"Dunes"')).toBe('"2026-11-15","14:00","run","Dunes","","6","","Minivan","Fathoune","700","Pending","no",""');
  expect(lines.some(l => /"OUT","Surfcamp → \w+ airport"/.test(l))).toBe(true);
  expect(rowOf('"Oliver Smith"')).toContain('"Cancelled","no"');   // cancelled trips stay in, with their status
  expect(lines.slice(1).map(l => l.slice(1, 11))).toEqual(lines.slice(1).map(l => l.slice(1, 11)).sort());   // by date
  // The control: Export month → month (this month by default) → Download CSV.
  await page.click('[data-export-month]');
  await expect(page.locator('#tr_exm')).toHaveValue('2026-11');
  await expect(page.locator('#tr_exm')).toHaveAttribute('min', '2026-10');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-go]')]);
  expect(dl.suggestedFilename()).toBe('transport-morocco-2026-11.csv');
  const body = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(body).toBe(csv);
});

test('floriane 1: IN and OUT in two colours — Week → Overview transfers and Transport rows (green arrivals, amber departures)', async ({ page }) => {
  await H.openWeek(page, { trips: H.tripsFromFile() });
  const col = sel => page.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator('#weekRoot .wk-dir.in').first()).toBeVisible();
  const wIn = await col('#weekRoot .wk-dir.in'), wOut = await col('#weekRoot .wk-dir.out');
  expect(wIn).toBe('rgb(234, 248, 240)');     // --green-bg
  expect(wOut).toBe('rgb(253, 245, 225)');    // --amber-bg
  await page.evaluate(() => WeekUI.toTransport('2026-11-14'));
  await expect(page.locator('#transportRoot .tr-dir.in').first()).toBeVisible();
  expect(await col('#transportRoot .tr-dir.in')).toBe(wIn);
  await page.evaluate(() => TransportUI.setWeek('2026-11-14', '2026-11-21'));
  await expect(page.locator('#transportRoot .tr-dir.out').first()).toHaveText('Departure');
  expect(await col('#transportRoot .tr-dir.out')).toBe(wOut);
});

test('floriane 2a: Rooms → «By room» in arrival order (here first, then by arrival day), not by name or bed', async ({ page }) => {
  await H.openWeek(page);
  await page.click('#weekRoot .wk-tabs .pill[data-tab="rooms"]');
  const rooms = await page.locator('#weekRoot .wk-broom').evaluateAll(els => els.map(el => ({
    room: el.querySelector('.wk-brh b').textContent,
    who: [...el.querySelectorAll('.wk-br')].filter(r => r.querySelector('.wk-brn')).map(r => [r.querySelector('.wk-brn').firstChild.textContent, r.children[1].textContent]),
  })));
  const anchor = rooms.find(r => r.room === '13 - Anchor Point');
  expect(anchor.who[0]).toEqual(['Clara Schmidt', 'here']);          // already here (bed 5) — by bed Karl (bed 1) came first
  const key = ([, d]) => d === 'here' ? 0 : Number(d.replace(/\D/g, ''));
  rooms.forEach(r => { const ks = r.who.map(key); expect(ks, r.room).toEqual(ks.slice().sort((a, b) => a - b)); });
  // Same day, no arrival time in the file: by bed (Sun 15: Lisa Brown bed 4 before Max Müller bed 6 — by name M > L too,
  // so check a day where bed and name disagree: Sat 14 Karl Nilsson bed 1, Clara Schmidt bed 5, Rui Alves bed 7).
  expect(anchor.who.filter(([, d]) => d === 'Sat 14').map(([n]) => n)).toEqual(['Karl Nilsson', 'Rui Alves']);
});
