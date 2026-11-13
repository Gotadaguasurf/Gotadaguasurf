// Camp hub — Sri Lanka cash count + checks strip (Phase 1, 13 Nov 2026).
//
// Nadith counts the camp cash every evening from his Cash tile (?view=local):
// bar box → pocket → ATM after the statement → result with a reason. Francisco
// or Miguel settle the count (RPC camp_cash_settle). A strip of checks sits
// under the ledger tiles and on the Overview. Everything is stubbed: nothing
// reaches Supabase.
//
// Clock: the browser runs in Lisbon, the camp in Colombo (UTC+5:30), so a
// count saved at 23:50 Colombo (18:20 UTC, still 13 Nov in Lisbon) and one at
// 00:10 Colombo (18:40 UTC, 13 Nov in Lisbon, 14 Nov in Colombo) prove the
// date never goes through UTC or the browser's zone.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

test.use({ timezoneId: 'Europe/Lisbon' });

const LOC = 'loc-sl';
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
function row(type, method, amount, extra = {}) {
  return {
    id: extra.id || uuid(), location_id: LOC, week_id: null, type,
    category: extra.category || (type === 'money_sent' ? 'Cash Float' : type === 'revenue' ? 'Other Revenue' : 'Food'),
    linked_item: null, description: extra.description || `${type} ${method} ${amount}`, payment_method: method, qty: 1,
    amount_local: amount, currency: 'LKR', entry_date: extra.date || '2026-11-01',
    business_area: null, fx_rate: 340, amount_eur: Number((amount / 340).toFixed(2)),
    recurring_source_id: null, recurring_month: null, source_kind: extra.sourceKind || 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: extra.createdAt || '2026-11-10T08:00:00Z',
  };
}

// Real names and shapes from the Sri Lanka ledger (Oct–Nov 2026).
function fixture() {
  seq = 0;
  const R = {
    opening:  row('money_sent', 'Cash', 300000, { date: '2026-10-01', description: 'Opening cash', createdAt: '2026-10-01T08:00:00Z' }),
    atm1:     row('money_sent', 'ATM Withdrawal', 100000, { date: '2026-11-11', description: 'ATM withdrawal · Sampath card 11/11', createdAt: '2026-11-12T07:00:00Z' }),
    atm2:     row('money_sent', 'ATM Withdrawal', 100000, { date: '2026-11-11', description: 'ATM withdrawal · Sampath card 11/11', createdAt: '2026-11-12T07:00:00Z' }),
    atm3:     row('money_sent', 'ATM Withdrawal', 100000, { date: '2026-11-12', description: 'ATM withdrawal · Sampath card 12/11', createdAt: '2026-11-12T07:00:00Z' }),
    atm4:     row('money_sent', 'ATM Withdrawal', 100000, { date: '2026-11-12', description: 'ATM withdrawal · Sampath card 12/11', createdAt: '2026-11-12T07:00:00Z' }),
    drinks1:  row('expense', 'Cash', 38400, { date: '2026-11-04', category: 'Drinks', description: 'Soft Drinks(Month Of October)', createdAt: '2026-11-10T08:49:00Z' }),
    drinks2:  row('expense', 'Cash', 38400, { date: '2026-11-04', category: 'Drinks', description: 'Sampath Shop For Bewerages(Month Of October)', createdAt: '2026-11-10T09:10:00Z' }),
    shrimps1: row('expense', 'Cash', 6000, { date: '2026-10-30', category: 'Food', description: 'Shrimps', createdAt: '2026-11-10T09:00:00Z' }),
    shrimps2: row('expense', 'Cash', 6000, { date: '2026-11-05', category: 'Food', description: 'Shrimps', createdAt: '2026-11-10T09:01:00Z' }),
    kavindu:  row('expense', 'Cash', 50000, { date: '2026-10-31', category: 'Salary', description: 'Kavindu salary October', createdAt: '2026-11-10T09:02:00Z' }),
    sithum:   row('expense', 'Cash', 50000, { date: '2026-11-01', category: 'Salary', description: 'Sithum salary October', createdAt: '2026-11-10T09:03:00Z' }),
    dilan:    row('expense', 'Cash', 152000, { date: '2026-11-02', category: 'Transport', description: 'Dilan(19/10-29/10)', createdAt: '2026-11-10T09:04:00Z' }),
    lion1:    row('revenue', 'Cash', 1200, { date: '2026-11-12', category: 'Drinks', sourceKind: 'camp_tab_per_item', description: 'Camp Tab · Julia · Lion Lager', createdAt: '2026-11-12T15:00:00Z' }),
    lion2:    row('revenue', 'Cash', 1200, { date: '2026-11-12', category: 'Drinks', sourceKind: 'camp_tab_per_item', description: 'Camp Tab · Federico · Lion Lager', createdAt: '2026-11-12T15:00:00Z' }),
  };
  return R;
}
// 300,000 + 4 × 100,000 + 2 × 1,200 − (2 × 38,400 + 2 × 6,000 + 2 × 50,000 + 152,000)
const EXPECTED_CASH = 361600;

// Stateful stub: ledger rows, camp_cash_counts, and the settle RPC.
async function stubSupabase(page, rows, opts = {}) {
  const server = new Map(rows.map(r => [r.id, { ...r }]));
  const counts = (opts.counts || []).map(c => ({ ...c }));
  const calls = { countInserts: [], rpc: [] };
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/camp_cash_counts')) {
      if (opts.countsMissing) return json({ code: 'PGRST205', message: "Could not find the table 'public.camp_cash_counts' in the schema cache" }, 404);
      if (method === 'GET') return json(counts);
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        const saved = { ...body, id: `count-${counts.length + 1}`, created_at: '2026-11-13T18:20:00Z', settled_by: null, settled_at: null, adjustment_entry_id: null, settled_expected: null, settled_difference: null };
        calls.countInserts.push(body); counts.unshift(saved);
        return json([saved], 201);
      }
      return json([]);
    }
    if (url.includes('/rest/v1/rpc/camp_cash_settle')) {
      const body = JSON.parse(req.postData() || '{}');
      calls.rpc.push(body);
      const res = opts.settleResponse ? opts.settleResponse(body, server) : { status: 'settled', expected: 0, difference: 0, adjustment: null };
      if (res.adjustment) server.set(res.adjustment.id, res.adjustment);
      return json(res);
    }
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json([...server.values()]);
      if (method === 'POST') {
        let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
        (Array.isArray(body) ? body : [body]).forEach(r => server.set(r.id, { ...r, created_at: r.created_at || new Date().toISOString() }));
        return json([]);
      }
      if (method === 'DELETE') {
        const m = url.match(/[?&]id=eq\.([^&]+)/); if (m) server.delete(decodeURIComponent(m[1]));
        return json([]);
      }
      return json([]);
    }
    return json([]);
  });
  return { server, counts, calls };
}

// at: UTC instant. 13:00Z = 18:30 Colombo (count due).
async function openHub(page, { query = '', at = '2026-11-13T13:00:00Z', rows = Object.values(fixture()), counts, countsMissing, settleResponse, initChecks = true, location = 'sri-lanka' } = {}) {
  await page.clock.setFixedTime(new Date(at));
  const stub = await stubSupabase(page, rows, { counts, countsMissing, settleResponse });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  if (initChecks) {
    // A check registered by another script (transport.js) BEFORE cash-count.js
    // loads — the registry must keep it, and keep it out of ?view=local.
    await page.addInitScript(() => {
      window.CAMP_CHECKS = window.CAMP_CHECKS || [];
      window.CAMP_CHECKS.push({ id: 'transport-unlinked', run: () => ({ text: 'Transport payment not linked to trips', level: 'warn' }) });
    });
  }
  await page.goto(`/camp-hub/?location=${location}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  if (location === 'sri-lanka') await page.waitForFunction(() => window.CampCash && window.CampCash.state.loaded === true, null, { timeout: 15000 });
  return stub;
}
const chipTexts = (page, host) => page.locator(`#${host} .health-chip`).allTextContents();

test.describe('cash count', () => {
  test('local view at 390px: Money from HQ gone, Cash tile has only «Count cash», strip shows only his chips', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openHub(page, { query: '&view=local' });
    await page.evaluate(() => showPage('expenses'));
    await expect(page.locator('#expQuickBar [data-cat="Cash Float"]')).toHaveCount(0);
    await expect(page.locator('#expQuickBar')).not.toContainText('Money from HQ');
    const tile = page.locator('#expKpis .kpi').filter({ has: page.locator('.kpi-label', { hasText: /^Cash$/ }) });
    await expect(tile.locator('#ccOpenBtn')).toBeVisible();
    await expect(tile.locator('#ccLast')).toHaveCount(0);
    await expect(tile.locator('#ccHist')).toHaveCount(0);
    const chips = await chipTexts(page, 'expChecks');
    expect(chips).toEqual(['Count the cash', 'Possible duplicate: Drinks 38,400 ×2', 'Possible duplicate: Food 6,000 ×2']);
    // No Overview strip in his view (he has no Overview).
    await expect(page.locator('#ovChecks .health-chip')).toHaveCount(0);
    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('local view: the 4 count screens, result with reason, saved with the Colombo date', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const { calls } = await openHub(page, { query: '&view=local', at: '2026-11-13T18:20:00Z' }); // 23:50 Colombo, still 13 Nov in Lisbon
    await page.evaluate(() => showPage('expenses'));
    await page.locator('#ccOpenBtn').click();
    const ov = page.locator('#cashCountOv');
    await expect(ov).toHaveClass(/open/);
    await expect(ov.locator('.mhdr-sub')).toHaveText('13 Nov · 1 of 4');
    await expect(ov.locator('.cc-q')).toHaveText('How much cash is in the bar box?');
    // Count by notes fills the amount: 5000×6 + 1000×18 + 500×6 + 100×10 = 52,000.
    await ov.getByRole('button', { name: 'Count by notes' }).click();
    for (const [n, q] of [[5000, 6], [1000, 18], [500, 6], [100, 10]]) await ov.locator(`[data-note="${n}"]`).fill(String(q));
    await expect(ov.locator('#ccBar')).toHaveValue('52000');
    await ov.getByRole('button', { name: 'Next' }).click();
    await expect(ov.locator('.mhdr-sub')).toHaveText('13 Nov · 2 of 4');
    await ov.locator('#ccPocket').fill('300000');
    await ov.getByRole('button', { name: 'Next' }).click();
    await expect(ov.locator('.cc-q')).toHaveText('Cash you took from the ATM after 12 Nov?');
    await expect(ov.getByRole('button', { name: 'Next' })).toBeDisabled();
    await ov.getByRole('button', { name: 'None' }).click();
    await ov.getByRole('button', { name: 'Next' }).click();
    await expect(ov.locator('#ccResult')).toHaveText('LKR 9,600.00 less than the app expects');
    await expect(ov.locator('#ccExpected')).toHaveText('361,600.00');
    await expect(ov.locator('#ccDiff')).toHaveText('−9,600.00');
    // Over the tolerance: a reason is needed before saving.
    const save = ov.getByRole('button', { name: 'Save count' });
    await expect(save).toBeDisabled();
    await ov.locator('[data-v="payments_not_entered"]').click();
    await ov.locator('#ccNote').fill('Laundry bill not entered yet');
    await ov.getByRole('button', { name: 'Save count' }).click();
    await expect(ov).not.toHaveClass(/open/);
    expect(calls.countInserts).toHaveLength(1);
    expect(calls.countInserts[0]).toMatchObject({
      location_id: LOC, count_date: '2026-11-13', bar_box: 52000, pocket: 300000, declared_unloaded_withdrawals: 0,
      statement_through: '2026-11-12', expected_at_save: EXPECTED_CASH, reason: 'payments_not_entered',
      note: 'Laundry bill not entered yet', status: 'open',
    });
    // Counted today → the chip is gone.
    expect(await chipTexts(page, 'expChecks')).not.toContain('Count the cash');
    expect(errors).toEqual([]);
  });

  test('count date and the 18:00 chip follow Colombo, not UTC or the browser', async ({ page }) => {
    // 18:40 UTC = 00:10 on 14 Nov in Colombo (13 Nov in Lisbon).
    const { calls } = await openHub(page, { query: '&view=local', at: '2026-11-13T18:40:00Z' });
    expect(await page.evaluate(() => CampCash.colombo())).toMatchObject({ date: '2026-11-14', hour: 0 });
    expect(await chipTexts(page, 'expChecks')).not.toContain('Count the cash'); // 00:10: not due yet
    await page.evaluate(() => showPage('expenses'));
    await page.locator('#ccOpenBtn').click();
    const ov = page.locator('#cashCountOv');
    await expect(ov.locator('.mhdr-sub')).toHaveText('14 Nov · 1 of 4');
    await ov.locator('#ccBar').fill('61600');
    await ov.getByRole('button', { name: 'Next' }).click();
    await ov.locator('#ccPocket').fill('300000');
    await ov.getByRole('button', { name: 'Next' }).click();
    // He took 100,000 after the statement date: expected rises by it.
    await ov.getByRole('button', { name: 'I took cash' }).click();
    await ov.locator('#ccDeclared').fill('100000');
    await ov.getByRole('button', { name: 'Next' }).click();
    await expect(ov.locator('#ccResult')).toHaveText('LKR 100,000.00 less than the app expects');
    await ov.locator('[data-v="unknown"]').click();
    await ov.getByRole('button', { name: 'Save count' }).click();
    await expect(ov).not.toHaveClass(/open/);
    expect(calls.countInserts[0]).toMatchObject({ count_date: '2026-11-14', declared_unloaded_withdrawals: 100000, expected_at_save: EXPECTED_CASH + 100000 });
  });

  test('«Count the cash» appears at 18:00 Colombo, not before', async ({ page }) => {
    await openHub(page, { query: '&view=local', at: '2026-11-13T12:29:00Z' }); // 17:59 Colombo
    expect(await chipTexts(page, 'expChecks')).not.toContain('Count the cash');
    await page.clock.setFixedTime(new Date('2026-11-13T12:31:00Z')); // 18:01
    await page.evaluate(() => CampCash.render());
    expect(await chipTexts(page, 'expChecks')).toContain('Count the cash');
  });

  test('full view: chips on the ledger and the Overview, history under the Cash tile', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openHub(page, {});
    await page.evaluate(() => { const ms = document.getElementById('ovMonthSel'); if (ms) ms.value = 'all'; renderOverview(); });
    const expected = [
      'Cash not counted today · never counted',
      'No cash payments entered for 3 days · LKR 400,000 withdrawn since 10 Nov',
      'Possible duplicate: Drinks 38,400 ×2',
      'Possible duplicate: Food 6,000 ×2',
      'Transport payment not linked to trips',
    ];
    expect((await chipTexts(page, 'ovChecks')).sort()).toEqual([...expected].sort());
    await page.evaluate(() => showPage('expenses'));
    expect((await chipTexts(page, 'expChecks')).sort()).toEqual([...expected].sort());
    await expect(page.locator('#ccLast')).toHaveText('Last count: never');
    await expect(page.locator('#ccOpenBtn')).toBeVisible();
    // Long chips wrap: nothing wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    // Salaries of two people (same amount, different text) are not duplicates;
    // two Camp Tab beers and two withdrawals of the same day are not either.
    const groups = await page.evaluate(() => CampCash.duplicateGroups(S.ledger, '2026-11-13').map(g => g.rows.map(r => r.description).sort()));
    expect(groups).toEqual([
      ['Sampath Shop For Bewerages(Month Of October)', 'Soft Drinks(Month Of October)'],
      ['Shrimps', 'Shrimps'],
    ]);
    expect(errors).toEqual([]);
  });

  test('duplicate chip filters the ledger to the pair; «Not a duplicate» is remembered', async ({ page }) => {
    const R = fixture();
    await openHub(page, { rows: Object.values(R) });
    await page.evaluate(() => showPage('expenses'));
    await page.locator('#expChecks .health-chip', { hasText: 'Food 6,000' }).click();
    await expect(page.locator('#ccFilterBar')).toContainText('Possible duplicate: Food 6,000 ×2');
    await expect(page.locator('#expTable tbody tr')).toHaveCount(2);
    await expect(page.locator('#expTable tbody')).toContainText('Shrimps');
    await page.locator('#ccFilterBar').getByRole('button', { name: 'Not a duplicate' }).click();
    await expect(page.locator('#ccFilterBar')).toHaveCount(0);
    expect(await chipTexts(page, 'expChecks')).not.toContain('Possible duplicate: Food 6,000 ×2');
    expect((await page.locator('#expTable tbody tr').count())).toBeGreaterThan(2);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.CampCash && window.CampCash.state.loaded === true, null, { timeout: 15000 });
    await page.evaluate(() => showPage('expenses'));
    const chips = await chipTexts(page, 'expChecks');
    expect(chips).toContain('Possible duplicate: Drinks 38,400 ×2');
    expect(chips).not.toContain('Possible duplicate: Food 6,000 ×2');
  });

  const openCount = {
    id: 'count-1', location_id: LOC, count_date: '2026-11-13', bar_box: 52000, pocket: 300000, counted_total: 352000,
    declared_unloaded_withdrawals: 0, statement_through: '2026-11-12', expected_at_save: EXPECTED_CASH, reason: 'payments_not_entered',
    note: null, status: 'open', settled_expected: null, settled_difference: null, settled_by: null, settled_at: null,
    adjustment_entry_id: null, created_by: 'u-nadith', created_at: '2026-11-13T16:10:00Z',
  };

  test('full view: Settle posts the adjustment through the RPC and the Cash tile equals the count', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const settleResponse = (body) => ({
      status: 'settled', expected: EXPECTED_CASH, difference: -9600, declared_used: 0, real_withdrawals: 0,
      adjustment: row('money_sent', 'Cash Out', 9600, { id: 'adj-1', date: '2026-11-13', category: 'Cash count', sourceKind: 'cash_count',
        description: 'Cash count 13 Nov · counted 352,000.00 · expected 361,600.00 · settled by miguel', createdAt: '2026-11-14T04:00:00Z' }),
    });
    const { calls } = await openHub(page, { counts: [openCount], settleResponse });
    await page.evaluate(() => showPage('expenses'));
    await expect(page.locator('#ccLast')).toHaveText('Last count: 13 Nov · −9,600 · open');
    expect(await chipTexts(page, 'expChecks')).not.toContain('Cash not counted today · never counted');
    await page.locator('#ccHist summary').click();
    await page.locator('[data-cc-settle="count-1"]').click();
    const ov = page.locator('#cashSettleOv');
    await expect(ov.locator('.mhdr-title')).toHaveText('Count of 13 Nov');
    await expect(ov.locator('#csDiff')).toHaveText('−9,600.00');
    await expect(ov.locator('#csLine')).toContainText('Cash Out · Cash count · −9,600.00');
    await ov.locator('#csNote').fill('Reset count');
    await ov.getByRole('button', { name: 'Settle count' }).click();
    await expect(ov).not.toHaveClass(/open/);
    expect(calls.rpc).toEqual([{ p_count: 'count-1', p_note: 'Reset count' }]);
    const cash = await page.evaluate(() => ledgerDrawerBalances(S.ledger).cashLocal);
    expect(cash).toBe(352000);
    await expect(page.locator('#ccLast')).toHaveText('Last count: 13 Nov · −9,600 · settled');
    await expect(page.locator('[data-cc-settle]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('settle within 1,000: no ledger line', async ({ page }) => {
    const near = { ...openCount, bar_box: 61000, counted_total: 361000 };
    const { calls } = await openHub(page, { counts: [near], settleResponse: () => ({ status: 'settled', expected: EXPECTED_CASH, difference: -600, adjustment: null }) });
    await page.evaluate(() => showPage('expenses'));
    const n = await page.evaluate(() => S.ledger.length);
    await page.evaluate(() => CampCash.openSettle('count-1'));
    const ov = page.locator('#cashSettleOv');
    await expect(ov.locator('#csLine')).toHaveText('Within 1,000: settling closes the count with no ledger line.');
    await expect(ov.locator('#csNote')).toHaveCount(0);
    await ov.getByRole('button', { name: 'Settle count' }).click();
    await expect(ov).not.toHaveClass(/open/);
    expect(calls.rpc).toHaveLength(1);
    expect(await page.evaluate(() => S.ledger.length)).toBe(n);
  });

  test('local view: no history, no Settle, and a Cash count line is locked', async ({ page }) => {
    const adj = row('money_sent', 'Cash Out', 9600, { id: 'adj-1', date: '2026-11-13', category: 'Cash count', sourceKind: 'cash_count', description: 'Cash count 13 Nov' });
    await openHub(page, { query: '&view=local', rows: [...Object.values(fixture()), adj], counts: [openCount] });
    await page.evaluate(() => showPage('expenses'));
    await expect(page.locator('#ccHist')).toHaveCount(0);
    await expect(page.locator('[data-cc-settle]')).toHaveCount(0);
    await page.evaluate(() => CampCash.openSettle('count-1'));
    await expect(page.locator('#cashSettleOv.open')).toHaveCount(0);
    const adjRow = page.locator('#expTable tbody tr', { hasText: 'Cash count 13 Nov' });
    await expect(adjRow).toHaveCount(1);
    await expect(adjRow.locator('button[title="Edit"]')).toHaveCount(0);
    await expect(adjRow.locator('.exp-table-actions[title="Edit this in HQ"]')).toHaveCount(1);
    // His own cash lines keep their Edit button.
    await expect(page.locator('#expTable tbody tr', { hasText: 'Dilan(19/10-29/10)' }).locator('button[title="Edit"]')).toHaveCount(1);
  });

  test('declared withdrawals are replaced by the real ones once the statement lands (no double count)', async ({ page }) => {
    // Counted 13 Nov with the statement up to 11 Nov, declaring 200,000 taken on
    // 12 Nov. The 12 Nov withdrawals (200,000) are now in the ledger.
    const c = { ...openCount, statement_through: '2026-11-11', declared_unloaded_withdrawals: 200000, bar_box: 61600 };
    await openHub(page, { counts: [c] });
    const v = await page.evaluate(() => CampCash.countView(CampCash.state.counts[0]));
    expect(v).toMatchObject({ ledgerCash: EXPECTED_CASH, real: 200000, declaredUsed: 0, expected: EXPECTED_CASH, counted: 361600, diff: 0 });
    // Before the statement covered 12 Nov, the declared figure was used.
    const before = await page.evaluate(() => CampCash.expectedFor('2026-11-13', 200000, '2026-11-12'));
    expect(before).toMatchObject({ real: 0, covered: false, declaredUsed: 200000, expected: EXPECTED_CASH + 200000 });
  });

  test('statement loaded only part of the way: the missing part of the declared cash still counts', async ({ page }) => {
    // Counted 13 Nov (snapshot 11 Nov), declaring 300,000: 200,000 on 12 Nov (now
    // in the ledger) + 100,000 on 13 Nov (not loaded yet). Expected must be the
    // ledger + 100,000, and the settle sheet must say so.
    const c = { ...openCount, statement_through: '2026-11-11', declared_unloaded_withdrawals: 300000, bar_box: 161600, counted_total: 461600 };
    await openHub(page, { counts: [c] });
    const v = await page.evaluate(() => CampCash.countView(CampCash.state.counts[0]));
    expect(v).toMatchObject({ real: 200000, covered: false, declaredUsed: 100000, expected: EXPECTED_CASH + 100000, diff: 0 });
    await page.evaluate(() => { showPage('expenses'); CampCash.openSettle('count-1'); });
    const ov = page.locator('#cashSettleOv');
    await expect(ov.locator('#csDeclUsed')).toHaveText('100,000.00');
    await expect(ov.locator('#csDiff')).toHaveText('0.00');
    await expect(ov.locator('.cc-warn')).toContainText('100,000.00 of the cash Nadith said he took is not in the ledger yet');
    // Once a withdrawal dated after the count day is loaded, the statement covers
    // the count day: every real withdrawal up to it is in the ledger, so the
    // declared figure is no longer used (here the 13 Nov 100,000 never came:
    // he over-declared, and the count now shows it).
    await page.evaluate(() => {
      const r = { ...S.ledger.find(x => x.paymentMethod === 'ATM Withdrawal'), id: 'atm-14', date: '2026-11-14' };
      S.ledger.push(r);
    });
    const after = await page.evaluate(() => CampCash.countView(CampCash.state.counts[0]));
    expect(after).toMatchObject({ covered: true, declaredUsed: 0, expected: EXPECTED_CASH });
  });

  test('table not created yet: no count button, no «not counted» chip, no errors', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openHub(page, { countsMissing: true });
    await page.evaluate(() => showPage('expenses'));
    await expect(page.locator('#ccOpenBtn')).toHaveCount(0);
    const chips = await chipTexts(page, 'expChecks');
    expect(chips.some(t => /not counted/.test(t))).toBe(false);
    expect(chips).toContain('Possible duplicate: Drinks 38,400 ×2');
    expect(errors).toEqual([]);
  });

  test('other camps: no strip, no count', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openHub(page, { location: 'morocco' });
    await page.evaluate(() => { showPage('expenses'); renderExpenses(); });
    await expect(page.locator('#expChecks .health-chip')).toHaveCount(0);
    await expect(page.locator('#ccOpenBtn')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
