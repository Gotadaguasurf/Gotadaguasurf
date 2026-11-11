// Operations Ledger — audit of 12 Nov 2026 (Sri Lanka).
//
// Found by opening every one of the 1.799 real Sri Lanka rows in the edit
// modal and saving without touching anything: 513 Camp Tab sales came back
// as 'manual', 14 monthly rows lost their recurring link, 164 revenue rows
// picked up the tour of the row edited before them, 3 transfers became
// 'Cash Float', a «Money from HQ» row paid from HQ became paid from the camp
// (and so visible to the local manager), and 4 transport rows lost their
// item. A negative amount was accepted (an expense that adds money). Closed
// Camp Tab weeks were turned into revenue rows again in per_guest mode, or
// whenever the list of deleted week rows failed to load.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = 'loc-sl';
let seq = 0;
function uuid() { seq += 1; return `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`; }
function row(type, method, amount, extra = {}) {
  return {
    id: uuid(), location_id: LOC, week_id: null, type, category: extra.category || 'Food',
    linked_item: extra.linked || null, description: extra.description || `${type} ${method} ${amount}`, payment_method: method, qty: 1,
    amount_local: amount, currency: 'LKR', entry_date: extra.date || '2026-10-20',
    business_area: extra.area || null, fx_rate: 370, amount_eur: Number((amount / 370).toFixed(2)),
    recurring_source_id: extra.recurringSourceId || null, recurring_month: extra.recurringMonth || null,
    source_kind: extra.sourceKind || 'manual', is_comp: false, zone_id: null,
    paid_from: extra.paidFrom || 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-10-20T10:00:00Z',
  };
}

// opts.mode: camp_tab_mode of the location; opts.failDeletedList: the saved
// list of deleted Camp Tab week rows cannot be read (HTTP 500).
async function openHub(page, rows, opts = {}) {
  const server = new Map(rows.map(r => [r.id, { ...r }]));
  const writes = [];
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 370, camp_tab_mode: opts.mode || 'per_guest' });
    if (opts.failDeletedList && method === 'GET' && url.includes('/rest/v1/location_state_store') && url.includes('hub_deleted_campclose')) return json({ message: 'stub failure' }, 500);
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json([...server.values()]);
      if (method === 'POST') {
        let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
        (Array.isArray(body) ? body : [body]).forEach(r => { server.set(r.id, { ...(server.get(r.id) || {}), ...r }); writes.push({ op: 'upsert', row: r }); });
        return json([]);
      }
      if (method === 'DELETE') { writes.push({ op: 'delete', url }); return json([]); }
    }
    return json([]);
  });
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return { server, writes };
}

const KEEP = ['type', 'category', 'business_area', 'linked_item', 'payment_method', 'qty', 'amount_local', 'currency', 'entry_date',
  'source_kind', 'paid_from', 'attributed_location', 'recurring_source_id', 'recurring_month', 'is_comp', 'zone_id', 'week_id'];

test('ledger: opening a row in the edit modal and saving without changes keeps every field', async ({ page }) => {
  const errors = collectFatalErrors(page);
  seq = 0;
  const R = {
    tourRevenue: row('revenue', 'Cash', 6000, { category: 'Tours', linked: 'Ice Bath', area: 'Tours' }),
    campTabDrink: row('revenue', 'Cash', 400, { category: 'Drinks', area: 'Bar', sourceKind: 'camp_tab_per_item', description: 'Camp Tab · Julia · Soft Drink' }),
    drHouse: row('revenue', 'Cash', 3000, { category: 'Transport', linked: 'Dr House Transfer', area: 'Transport', sourceKind: 'camp_tab_per_item', description: 'Camp Tab · Julia · Dr House Transfer' }),
    rentMonthly: row('expense', 'Bank Transfer', 500000, { category: 'Rent', area: 'Utilities', recurringSourceId: '0cdc0446-eda8-405b-8ae5-f8035d8b6645', recurringMonth: '2026-10', date: '2026-10-31' }),
    loan: row('money_sent', 'Bank Transfer', 1439000, { category: 'Loan', area: 'General', description: 'Loan to Nadith' }),
    cashOut: row('money_sent', 'Cash Out', 500000, { category: 'Other', area: 'General', description: '2025 shop loan repaid' }),
    hqMoney: row('money_sent', 'HQ Transfer', 5913690, { category: 'Cash Float', area: 'General', paidFrom: 'hq', description: 'Money from the HQ investment account' }),
    oldTransport: row('expense', 'Cash', 9000, { category: 'Transport', linked: 'Airport → Surfcamp (old preset)', area: 'Transport' }),
  };
  const { writes } = await openHub(page, Object.values(R));
  // The order matters: the tour revenue is edited first, so the modal still
  // holds «Ice Bath» when the next rows open.
  const order = ['tourRevenue', 'campTabDrink', 'drHouse', 'rentMonthly', 'loan', 'cashOut', 'hqMoney', 'oldTransport'];
  for (const k of order) {
    await page.evaluate(async (id) => { showPage('expenses'); openEditLedger(id); await saveExpense(); }, R[k].id);
  }
  const saved = Object.fromEntries(writes.filter(w => w.op === 'upsert').map(w => [w.row.id, w.row]));
  for (const k of order) {
    const before = R[k]; const after = saved[before.id];
    expect(after, k).toBeTruthy();
    for (const f of KEEP) expect([k, f, after[f]]).toEqual([k, f, before[f]]);
  }
  expect(errors).toEqual([]);
});

test('ledger: a negative or zero amount is refused, a positive one saved', async ({ page }) => {
  const { writes } = await openHub(page, []);
  const tryAmount = (v) => page.evaluate(async (v) => {
    showPage('expenses'); resetQuickExpense();
    document.getElementById('qe_amount').value = v;
    await saveQuickExpense();
    return document.getElementById('toast').textContent;
  }, v);
  expect(await tryAmount('-500')).toBe('Date and amount required');
  expect(await tryAmount('0')).toBe('Date and amount required');
  expect(writes.filter(w => w.op === 'upsert')).toEqual([]);
  expect(await tryAmount('500')).toBe('Entry added');
  const up = writes.filter(w => w.op === 'upsert');
  expect(up.map(w => [w.row.type, w.row.payment_method, w.row.amount_local])).toEqual([['expense', 'Cash', 500]]);
});

test('ledger: an «HQ Paid» row typed in the hub counts as HQ in the totals and hides with «Include HQ-paid invoices»', async ({ page }) => {
  seq = 0;
  const local = row('expense', 'Cash', 37000, { category: 'Rent', date: '2026-01-15' });
  const hqTyped = row('expense', 'HQ Paid', 110000, { category: 'Rent', date: '2026-01-31', description: 'Casa do Lapo — renda 01/2026' });
  const hqMirror = row('expense', 'HQ Paid', 74000, { category: 'Salary', date: '2026-01-31', sourceKind: 'hq_invoice' });
  await openHub(page, [local, hqTyped, hqMirror]);
  const r = await page.evaluate(() => {
    showPage('expenses'); clearExpFilters();
    const jan = __ledgerTotalsCsvRows.find(x => x[0] === 'Month' && x[1] === '2026-01');
    document.getElementById('expIncludeHq').checked = false; renderExpenses();
    const listed = __ledgerExportRows.map(x => x.description);
    document.getElementById('expIncludeHq').checked = true; renderExpenses();
    return { jan, listed, transportLabel: [...document.querySelectorAll('#tqPaidVia option')].map(o => o.textContent) };
  });
  expect(r.jan.slice(2).map(Number)).toEqual([100, 497.3, 597.3]); // 37.000/370 local · (110.000+74.000)/370 HQ
  expect(r.listed).toEqual(['expense Cash 37000']);
  // Transport quick add: «Bank Transfer» takes money from the camp bank (Sampath), it is not HQ-paid.
  expect(r.transportLabel.join(' | ')).not.toMatch(/HQ/);
});

// A closed Camp Tab week with one paid guest, as the camp tab sends it.
const HISTORY = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', start: '2026-05-16', closedAt: '2026-05-21T09:52:35Z',
  guests: [{ name: 'Old Guest', paid: true, items: [{ c: 'Tours', n: 'Cooking Class', p: 6000 }, { c: 'Drinks', n: 'Lion Lager', p: 900 }] }], staff: [] }];
const reconcile = (page) => page.evaluate(async (h) => { await reconcileClosedWeeksWithLedger(h); return S.ledger.filter(r => r.sourceKind === 'camp_tab').length; }, HISTORY);

test('ledger: per_guest camp — an old closed Camp Tab week never becomes revenue rows', async ({ page }) => {
  const { writes } = await openHub(page, [], { mode: 'per_guest' });
  expect(await reconcile(page)).toBe(0);
  expect(writes.filter(w => w.op === 'upsert')).toEqual([]);
});

test('ledger: weekly camp — deleted week rows are not re-created when their list fails to load', async ({ page }) => {
  const { writes } = await openHub(page, [], { mode: 'weekly', failDeletedList: true });
  expect(await reconcile(page)).toBe(0);
  expect(writes.filter(w => w.op === 'upsert')).toEqual([]);
});

test('ledger: weekly camp — with the list loaded, a missing closed-week row is still added (control)', async ({ page }) => {
  const { writes } = await openHub(page, [], { mode: 'weekly' });
  expect(await reconcile(page)).toBe(2);
  expect(writes.filter(w => w.op === 'upsert').map(w => [w.row.category, w.row.amount_local, w.row.source_kind]).sort())
    .toEqual([['Drinks', 900, 'camp_tab'], ['Tours', 6000, 'camp_tab']]);
});
