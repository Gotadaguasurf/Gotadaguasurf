// Camp hub — euro ↔ LKR conversions in Sri Lanka (audit 12 Nov 2026).
//
// Rules (agreed with Miguel):
//   • the € of ONE row = amount_local ÷ that row's own fx_rate (an HQ
//     transfer's rate is LKR that arrived ÷ € sent, not the rate of the day);
//   • the € of a Bank / Cash BALANCE = local balance ÷ today's rate;
//   • daily_fx_rates holds the rate OF a day — never a guess for a day that
//     has not happened yet.
// Supabase is stubbed; nothing reaches the network.
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
// Local date the hub calls today() (browser and test share the machine clock).
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// opts.rate: what daily_fx_rates holds for ANY date (null = no row);
// opts.fxDelay: ms before daily_fx_rates answers; opts.frankfurter: rate the
// public API returns (undefined = request fails).
async function openHub(page, rows, opts = {}) {
  const fxWrites = [];
  await page.route(/api\.frankfurter\.dev/, route => opts.frankfurter
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rate: opts.frankfurter }) })
    : route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime|functions)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 330, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/daily_fx_rates')) {
      if (method !== 'GET') {
        let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) {}
        fxWrites.push(body);
        return json([]);
      }
      if (opts.fxDelay) await new Promise(r => setTimeout(r, opts.fxDelay));
      return json(opts.rate ? { rate: opts.rate } : null);
    }
    if (url.includes('/functions/v1/parse-invoice')) return json({ extracted: opts.invoice || {} });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json(rows);
      return json([]);
    }
    return json([]);
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return { fxWrites };
}
// Text of a KPI tile (value + first sub line) on the Overview, «All months».
async function ovTile(page, label, { render = true } = {}) {
  return page.evaluate(([label, render]) => {
    if (render) { const ms = document.getElementById('ovMonthSel'); if (ms) ms.value = 'all'; renderOverview(); }
    const card = [...document.querySelectorAll('#ovKpis .kpi')].find(c => (c.querySelector('.kpi-label')?.textContent || '').trim() === label);
    return card ? { value: card.querySelector('.kpi-value')?.textContent.trim(), sub: card.querySelector('.kpi-sub,.kpi-breakdown')?.textContent.trim() } : null;
  }, [label, render]);
}

test('fx: a row keeps its own rate even when the rate of its day is cached (HQ transfer = LKR received ÷ € sent)', async ({ page }) => {
  seq = 0;
  // 9,000 € sent, 3,274,531.21 LKR arrived → 363.8368; the rate of the day is 370.38.
  const hq = row('money_sent', 'HQ Transfer', 3274531.21, 363.8368, { date: localToday(), eur: 9000, sourceKind: 'hq_transfer' });
  await openHub(page, [hq], { rate: 370.38 });
  await page.waitForFunction(() => cachedFxRateForDate(today()) > 0); // boot cached today's rate
  const eur = await page.evaluate(() => entryEurAmount(S.ledger[0]));
  expect(eur).toBe(9000);
  const tile = await ovTile(page, 'Money from HQ');
  expect(tile.sub).toContain('9,000');
});

test('fx: an inverted rate (€ per LKR, from an HQ invoice) is read as 1 ÷ rate, not replaced by today\'s rate', async ({ page }) => {
  seq = 0;
  // hq_invoices keeps fx_rate as € per unit (amount × fx = €); the mirror copies it as-is.
  const uber = row('expense', 'HQ Paid', 1476.47, 0.002716, { date: '2026-06-13', eur: 4.01, sourceKind: 'hq_invoice', category: 'Transport' });
  await openHub(page, [uber], { rate: 372.36 });
  const r = await page.evaluate(() => ({ fx: S.ledger[0].fxRate, eur: entryEurAmount(S.ledger[0]) }));
  expect(Math.abs(r.fx - 1 / 0.002716)).toBeLessThan(0.01);
  expect(r.eur).toBe(4.01);
});

test('fx: no rate is stored for a day that has not happened yet', async ({ page }) => {
  seq = 0;
  // The public API answers a future date with the latest rate it has; storing
  // that as the rate of the future day froze it (e.g. 31 Oct stored on 18 Oct).
  const { fxWrites } = await openHub(page, [], { rate: null, frankfurter: 371.5 });
  const r = await page.evaluate(async () => {
    const got = await fetchFxRateForDate('2099-12-31');
    await new Promise(res => setTimeout(res, 300));
    return { got, cached: cachedFxRateForDate('2099-12-31'), today: today() };
  });
  expect(r.got).toBe(371.5);          // still answers with the current rate…
  expect(r.cached).toBe(0);           // …but does not remember it for that day
  const future = fxWrites.flat().filter(w => w && w.rate_date > r.today);
  expect(future).toEqual([]);
});

test('fx: Bank € follows today\'s rate once it arrives (not the 330 default)', async ({ page }) => {
  seq = 0;
  const hq = row('money_sent', 'HQ Transfer', 1000000, 360, { date: '2026-10-01', sourceKind: 'hq_transfer' });
  await openHub(page, [hq], { rate: 372.36, fxDelay: 2500 });
  await page.waitForFunction(() => LOCAL_PER_EUR === 372.36, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  // Read what is on screen WITHOUT forcing a render.
  const tile = await ovTile(page, 'Bank', { render: false });
  expect(tile.value).toContain('1,000,000');
  expect(tile.sub).toContain('2,685.57'); // 1,000,000 ÷ 372.36 (330 would show 3,030.30)
});

test('fx: an LKR invoice read by AI gets the rate of its date, not the 330 default', async ({ page }) => {
  seq = 0;
  await openHub(page, [], { rate: 381.65, invoice: { amount: 38165, currency: 'LKR', invoice_date: '2026-09-15', company: 'Supplier', category_hint: 'Services' } });
  const saved = await page.evaluate(async () => {
    const f = new File(['%PDF-1.4'], 'inv.pdf', { type: 'application/pdf' });
    await processAiInvoiceFiles([f]);
    const e = S.ledger.find(x => x.sourceKind === 'invoice_ai');
    return e ? { fx: e.fxRate, eur: e.amount, local: e.amountLocal } : null;
  });
  expect(saved).not.toBeNull();
  expect(saved.local).toBe(38165);
  expect(saved.fx).toBe(381.65);
  expect(saved.eur).toBe(100);
});
