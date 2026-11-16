// Sri Lanka, 16 Nov 2026: Miguel loads the Sampath card payments from the bank
// statement («Sea Fair · Sampath card …», Bank Transfer). When Nadith then
// types the same receipt as Cash, the purchase counts twice and his cash looks
// short. The hub now asks before saving it.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = 'loc-sl';
let seq = 0;
function uuid() { seq += 1; return `00000000-0000-4000-9100-${String(seq).padStart(12, '0')}`; }
function row(type, method, amount, extra = {}) {
  return {
    id: uuid(), location_id: LOC, week_id: null, type, category: extra.category || 'Food',
    linked_item: null, description: extra.description || `${type} ${method} ${amount}`, payment_method: method, qty: 1,
    amount_local: amount, currency: 'LKR', entry_date: extra.date || '2026-11-14',
    business_area: null, fx_rate: 370, amount_eur: Number((amount / 370).toFixed(2)),
    recurring_source_id: null, recurring_month: null, source_kind: 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: '2026-11-14T10:00:00Z',
  };
}

async function openHub(page, rows, answer) {
  const server = new Map(rows.map(r => [r.id, { ...r }]));
  const writes = []; const dialogs = [];
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/camp-tab-inner\.html/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 370, camp_tab_mode: 'per_guest' });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json([...server.values()]);
      if (method === 'POST') {
        let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
        (Array.isArray(body) ? body : [body]).forEach(r => { server.set(r.id, { ...r }); writes.push(r); });
        return json([]);
      }
    }
    return json([]);
  });
  page.on('dialog', d => { dialogs.push(d.message()); answer.value ? d.accept() : d.dismiss(); });
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return { writes, dialogs };
}

const typeExpense = (page, { amount, date, pay = 'Cash', cat = 'Food' }) => page.evaluate(async ({ amount, date, pay, cat }) => {
  showPage('expenses'); resetQuickExpense();
  document.getElementById('qe_type').value = 'expense';
  const c = document.getElementById('qe_cat'); if (c) c.value = cat;
  document.getElementById('qe_date').value = date;
  document.getElementById('qe_amount').value = String(amount);
  const p = document.getElementById('qe_pay'); if (p) p.value = pay;
  await saveQuickExpense();
}, { amount, date, pay, cat });

test('bank twin: a Cash receipt equal to a card line from the bank (±2 days, any category) asks first; Cancel saves nothing', async ({ page }) => {
  const errors = collectFatalErrors(page);
  seq = 0;
  const bank = row('expense', 'Bank Transfer', 4250, { category: 'Food', date: '2026-11-14', description: 'Sea Fair · Sampath card (POS Sea Fair Supermarket, 14 Nov)' });
  const answer = { value: false };
  const { writes, dialogs } = await openHub(page, [bank], answer);
  await typeExpense(page, { amount: 4250, date: '2026-11-15', cat: 'Cleaning' });
  expect(dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('This looks like the card payment already in from the bank: Sea Fair · 4,250 on 14 Nov');
  expect(writes).toEqual([]);
  // A different payment of the same amount: OK saves it.
  answer.value = true;
  await typeExpense(page, { amount: 4250, date: '2026-11-15', cat: 'Cleaning' });
  expect(writes.map(w => [w.payment_method, w.amount_local, w.entry_date])).toEqual([['Cash', 4250, '2026-11-15']]);
  expect(errors).toEqual([]);
});

test('bank twin: no question when the amount differs, the days are 3+ apart, or both rows are Cash', async ({ page }) => {
  seq = 0;
  const bank = row('expense', 'Bank Transfer', 4250, { date: '2026-11-14', description: 'Sea Fair · Sampath card' });
  const cash = row('expense', 'Cash', 900, { date: '2026-11-10', category: 'Drinks', description: 'Ice' });
  const answer = { value: false };
  const { writes, dialogs } = await openHub(page, [bank, cash], answer);
  await typeExpense(page, { amount: 4251, date: '2026-11-14' });
  await typeExpense(page, { amount: 4250, date: '2026-11-17' });
  await typeExpense(page, { amount: 900, date: '2026-11-11', cat: 'Food' });
  expect(dialogs).toEqual([]);
  expect(writes.length).toBe(3);
});
