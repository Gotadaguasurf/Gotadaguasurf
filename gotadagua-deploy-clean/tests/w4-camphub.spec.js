// Wave 4 (audit 18 Nov 2026) — camp hub fixes, Supabase stubbed (nothing reaches the network).
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const LOC = 'loc-sl';
let seq = 0;
function row(type, method, amountLocal, fx, extra = {}) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, location_id: LOC, week_id: null, type,
    category: extra.category || (type === 'money_sent' ? 'Cash Float' : 'Food'), linked_item: null,
    description: extra.description || `${type} ${method}`, payment_method: method, qty: 1,
    amount_local: amountLocal, currency: extra.currency || 'LKR', entry_date: extra.date || '2026-10-20',
    business_area: null, fx_rate: fx, amount_eur: extra.eur != null ? extra.eur : Number((amountLocal / fx).toFixed(2)),
    recurring_source_id: null, recurring_month: null, source_kind: extra.sourceKind || 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-10-20T10:00:00Z',
    hq_invoice_id: null, internal_transfer_id: null,
  };
}

// opts.rate: what daily_fx_rates holds for any date; opts.slug / opts.locations: the location row(s) the hub reads.
async function openHub(page, rows, opts = {}) {
  const writes = []; const stateWrites = [];
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) {
      if (opts.locations) return json(opts.locations);
      return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 330, camp_tab_mode: 'per_guest' });
    }
    if (url.includes('/rest/v1/daily_fx_rates')) return method === 'GET' ? json(opts.rate ? { rate: opts.rate } : null) : json([]);
    if (url.includes('/rest/v1/location_state_store')) {
      if (method !== 'GET') { let b = null; try { b = JSON.parse(req.postData() || 'null'); } catch (_) {} stateWrites.push(b); }
      return json([]);
    }
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json(rows);
      let b = null; try { b = JSON.parse(req.postData() || 'null'); } catch (_) {}
      writes.push({ method, body: b });
      return json(Array.isArray(b) ? b : b ? [b] : []);
    }
    return json([]);
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=${opts.slug || 'sri-lanka'}`, { waitUntil: 'domcontentloaded' });
  if (opts.noWait) return { writes, stateWrites };
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return { writes, stateWrites };
}
const lastLedgerBody = writes => { const w = writes.filter(x => x.method === 'POST' || x.method === 'PATCH').pop(); const b = w && w.body; return Array.isArray(b) ? b[0] : b; };

test('CH-06: editing only the text of an LKR line keeps its FX rate and its € (no re-stamp with the day rate)', async ({ page }) => {
  seq = 0;
  // a hand-typed Money from HQ: 3,600,000 LKR arrived for 10,000 € sent → 360; the day rate is 380
  const hq = row('money_sent', 'HQ Transfer', 3600000, 360, { eur: 10000, description: 'Transfer from HQ' });
  const { writes } = await openHub(page, [hq], { rate: 380 });
  await page.evaluate(id => openEditLedger(id), hq.id);
  await expect(page.locator('#em_fx')).toHaveValue('360');               // the modal shows the rate the line was saved with
  await page.fill('#em_desc', 'Transfer from HQ — October');
  await page.evaluate(() => saveExpense());
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  const b = lastLedgerBody(writes);
  expect(b.description).toBe('Transfer from HQ — October');
  expect(Number(b.fx_rate)).toBe(360);
  expect(Number(b.amount_eur)).toBe(10000);
  // the amount changes → the rate of its day is taken again, as for a new line
  await page.evaluate(id => openEditLedger(id), hq.id);
  await page.fill('#em_amount', '3800000');
  await page.evaluate(() => saveExpense());
  await expect.poll(() => writes.length).toBeGreaterThan(1);
  const c = lastLedgerBody(writes);
  expect(Number(c.fx_rate)).toBe(380);
  expect(Number(c.amount_eur)).toBe(10000);
});

test('CH-12: a ledger save writes the line and the «other devices» ping, not the empty weeks blob', async ({ page }) => {
  seq = 0;
  const { writes, stateWrites } = await openHub(page, [row('expense', 'Cash', 1000, 340)]);
  await page.waitForTimeout(300);
  stateWrites.length = 0;
  await page.evaluate(() => commitLedgerEntry(normalizeLedgerEntry({ id: 'e-w4-1', date: today(), type: 'expense', category: 'Food', paymentMethod: 'Cash',
    currency: 'LKR', fxRate: 340, amountLocal: 3400, amount: 10, description: 'Rice' }), 'w4 test'));
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  await expect.poll(() => stateWrites.map(b => (Array.isArray(b) ? b[0] : b).state_key)).toContain('hub_ledger_ts_sri-lanka');
  expect(stateWrites.map(b => (Array.isArray(b) ? b[0] : b).state_key)).not.toContain('camphub_v2_sri-lanka');
});

test('CH-11: a change from another device redraws only the page on screen', async ({ page }) => {
  seq = 0;
  await openHub(page, [row('expense', 'Cash', 1000, 340)]);
  const n = await page.evaluate(async () => {
    const calls = { overview: 0, expenses: 0, weekly: 0 };
    const o = window.renderOverview, e = window.renderExpenses, w = window.renderWeeklyPL;
    window.renderOverview = (...a) => { calls.overview++; return o(...a); };
    window.renderExpenses = (...a) => { calls.expenses++; return e(...a); };
    window.renderWeeklyPL = (...a) => { calls.weekly++; return w(...a); };
    showPage('overview'); calls.overview = 0;
    scheduleHubLedgerRehydrate();
    await new Promise(r => setTimeout(r, 1500));
    return calls;
  });
  expect(n.overview).toBeGreaterThan(0);
  expect(n.expenses).toBe(0);
  expect(n.weekly).toBe(0);
});
