// Camp hub — Bank and Cash drawers (Sri Lanka, 11 Nov 2026).
//
// Miguel restarts money control in Sri Lanka: the Sampath statement is loaded
// every 3 days, Nadith enters every payment, and the hub's Bank and Cash
// figures must match reality exactly. These tests load camp-hub with a fixed,
// stubbed ledger (nothing reaches Supabase) that holds one row of every kind
// of money movement, and assert the Bank / Cash numbers the page SHOWS — in
// the ledger's all-time tiles and in the Overview — plus what happens when a
// manager adds, edits and deletes rows.
//
// The rules (Miguel, all confirmed):
//   Bank: + HQ Transfer + Cash Deposit + revenue by Card/Bank Transfer
//         − expense by Bank Transfer/Card − transfer «Out of bank» − legacy ATM
//   Cash: + transfer «Into cash» + legacy ATM + cash revenue (Camp Tab included)
//         − expense by Cash − Cash Deposit − «Out of cash» (Cash Out)
//   Neither: HQ Paid / hq_invoice expenses and Loan offset (still P&L costs).
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession, collectFatalErrors } = require('./helpers');

const LOC = 'loc-sl';
let seq = 0;
function uuid() {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}
// One DB row (ledger_entries shape). type: expense | revenue | money_sent.
function row(type, method, amount, extra = {}) {
  return {
    id: uuid(), location_id: LOC, week_id: null, type, category: extra.category || (type === 'money_sent' ? 'Cash Float' : type === 'revenue' ? 'Other Revenue' : 'Food'),
    linked_item: null, description: extra.description || `${type} ${method} ${amount}`, payment_method: method, qty: 1,
    amount_local: amount, currency: extra.currency || 'LKR', entry_date: extra.date || '2026-10-20',
    business_area: null, fx_rate: 340, amount_eur: Number((amount / 340).toFixed(2)),
    recurring_source_id: null, recurring_month: null, source_kind: extra.sourceKind || 'manual', is_comp: false, zone_id: null,
    paid_from: 'sri-lanka', attributed_location: 'sri-lanka', created_at: extra.createdAt || '2026-10-20T10:00:00Z',
  };
}

// Every kind of movement once. Expected drawers are worked out by hand below.
function fixture() {
  seq = 0;
  const R = {
    hqTransfer:   row('money_sent', 'HQ Transfer', 1000000, { sourceKind: 'hq_transfer' }), // bank +
    cashDeposit:  row('money_sent', 'Cash Deposit', 10000),                                 // bank + / cash −
    expBank:      row('expense', 'Bank Transfer', 100000, { category: 'Rent' }),            // bank −
    expCard:      row('expense', 'Card', 20000),                                            // bank − (bank card purchase)
    atmOut:       row('money_sent', 'Bank Transfer', 50000, { date: '2026-10-21' }),        // ATM pair: bank −
    atmIn:        row('money_sent', 'Cash', 50000, { date: '2026-10-21' }),                 //           cash +
    legacyAtm:    row('money_sent', 'ATM Withdrawal', 5000),                                // bank − / cash +
    loanOut:      row('money_sent', 'Bank Transfer', 30000, { category: 'Loan', date: '2026-09-14' }), // lone out of bank
    revCard:      row('revenue', 'Card', 7000),                                             // bank +
    revBank:      row('revenue', 'Bank Transfer', 3000),                                    // bank +
    revCash:      row('revenue', 'Cash', 4000),                                             // cash +
    campTab:      row('revenue', 'Cash', 2500, { category: 'Drinks', sourceKind: 'camp_tab_per_item', description: 'Camp Tab · Guest · Lion Lager' }), // cash +
    expCash:      row('expense', 'Cash', 12000),                                            // cash −
    cashOut:      row('money_sent', 'Cash Out', 6000, { description: '2025 shop debt' }),  // cash −
    hqInvoice:    row('expense', 'HQ Paid', 30000, { sourceKind: 'hq_invoice', category: 'Services' }), // neither
    hqPaidManual: row('expense', 'HQ Paid', 40000, { category: 'Salary' }),                 // neither
    loanOffset:   row('expense', 'Loan offset', 20000, { category: 'Salary' }),             // neither
    opening:      row('money_sent', 'Cash', 80000, { date: '2026-01-01', description: 'Opening cash' }), // lone into cash
  };
  return R;
}
const EXPECTED_BANK = 1000000 + 10000 - 100000 - 20000 - 50000 - 5000 - 30000 + 7000 + 3000; // 815,000
const EXPECTED_CASH = -10000 + 50000 + 5000 + 4000 + 2500 - 12000 - 6000 + 80000;           // 113,500
const EXPECTED_SPENT = 100000 + 20000 + 12000 + 30000 + 40000 + 20000;                      // 222,000 (P&L costs incl. HQ-paid + loan offset)

// Stateful Supabase stub: GET returns the server rows, upsert/delete change them.
async function stubSupabase(page, rows) {
  const server = new Map(rows.map(r => [r.id, { ...r }]));
  const writes = [];
  await page.route(/api\.frankfurter\.dev/, route => route.abort());
  await page.route(/supabase\.co\/(auth|rest|realtime)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'weekly' });
    if (url.includes('/rest/v1/ledger_entries')) {
      if (method === 'GET') return json([...server.values()]);
      if (method === 'POST') {
        let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
        (Array.isArray(body) ? body : [body]).forEach(r => { server.set(r.id, { ...r, created_at: r.created_at || new Date().toISOString() }); writes.push({ op: 'upsert', row: r }); });
        return json([]);
      }
      if (method === 'DELETE') {
        const m = url.match(/[?&]id=eq\.([^&]+)/); const id = m ? decodeURIComponent(m[1]) : '';
        server.delete(id); writes.push({ op: 'delete', id });
        return json([]);
      }
      return json([]);
    }
    return json([]);
  });
  return { server, writes };
}

async function openHub(page, rows, query = '') {
  const stub = await stubSupabase(page, rows);
  page.on('dialog', d => d.accept());
  await fakeOwnerSession(page);
  await page.goto(`/camp-hub/?location=sri-lanka${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return HUB_LEDGER_HYDRATED === true; } catch (_) { return false; } }, null, { timeout: 15000 });
  return stub;
}

// Reads the Bank / Cash tiles the page renders: ledger (#expKpis, all time)
// and Overview (#ovKpis, «All months» = all time too).
async function drawers(page) {
  return page.evaluate(() => {
    const num = (txt) => {
      const t = String(txt || '');
      const n = Number(t.replace(/[^0-9.]/g, '')) || 0;
      return /[-−]/.test(t) ? -n : n;
    };
    const tile = (rootId, label) => {
      const root = document.getElementById(rootId);
      const card = [...(root ? root.querySelectorAll('.kpi') : [])].find(c => (c.querySelector('.kpi-label')?.textContent || '').trim() === label);
      return card ? num(card.querySelector('.kpi-value')?.textContent) : null;
    };
    const ms = document.getElementById('ovMonthSel'); if (ms) ms.value = 'all';
    const ps = document.getElementById('expPeriodSel'); if (ps) ps.value = 'all';
    renderExpenses(); renderOverview();
    return {
      ledgerBank: tile('expKpis', 'Bank'), ledgerCash: tile('expKpis', 'Cash'), ledgerTotal: tile('expKpis', 'Total Balance'),
      ovBank: tile('ovKpis', 'Bank'), ovCash: tile('ovKpis', 'Cash'), ovSpent: tile('ovKpis', 'Total Spent'),
    };
  });
}

test('camp cash: every kind of row moves the right drawer (ledger tiles = Overview)', async ({ page }) => {
  const errors = collectFatalErrors(page);
  await openHub(page, Object.values(fixture()));
  const d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK);
  expect(d.ledgerCash).toBe(EXPECTED_CASH);
  expect(d.ledgerTotal).toBe(EXPECTED_BANK + EXPECTED_CASH);
  expect(d.ovBank).toBe(EXPECTED_BANK);
  expect(d.ovCash).toBe(EXPECTED_CASH);
  // HQ-paid and Loan offset touch no drawer but are still costs.
  expect(d.ovSpent).toBe(EXPECTED_SPENT);
  // EUR figures of both surfaces agree too.
  const eur = await page.evaluate(() => {
    const a = ledgerDrawerBalances(S.ledger);
    return { a, n: S.ledger.length };
  });
  expect(eur.n).toBe(18);
  expect(Math.round(eur.a.bankLocal)).toBe(EXPECTED_BANK);
  expect(Math.round(eur.a.cashLocal)).toBe(EXPECTED_CASH);
  expect(errors).toEqual([]);
});

test('camp cash: drawer rule per method (revenue by card/bank → bank; HQ Paid, Loan offset → none)', async ({ page }) => {
  await openHub(page, []);
  const r = await page.evaluate(() => {
    const D = (type, paymentMethod, sourceKind = 'manual') => ledgerDrawerDelta({ type, paymentMethod, sourceKind });
    return {
      expCash: D('expense', 'Cash'), expCard: D('expense', 'Card'), expBank: D('expense', 'Bank Transfer'),
      expHqPaid: D('expense', 'HQ Paid'), expHqInvoiceBank: D('expense', 'Bank Transfer', 'hq_invoice'), expLoan: D('expense', 'Loan offset'),
      revCash: D('income', 'Cash'), revCard: D('income', 'Card'), revBank: D('income', 'Bank Transfer'),
      tHq: D('transfer', 'HQ Transfer'), tDep: D('transfer', 'Cash Deposit'), tAtm: D('transfer', 'ATM Withdrawal'),
      tOutBank: D('transfer', 'Bank Transfer'), tInCash: D('transfer', 'Cash'), tCashOut: D('transfer', 'Cash Out'),
    };
  });
  expect(r.expCash).toEqual({ bank: 0, cash: -1 });
  expect(r.expCard).toEqual({ bank: -1, cash: 0 });
  expect(r.expBank).toEqual({ bank: -1, cash: 0 });
  expect(r.expHqPaid).toEqual({ bank: 0, cash: 0 });
  expect(r.expHqInvoiceBank).toEqual({ bank: 0, cash: 0 });
  expect(r.expLoan).toEqual({ bank: 0, cash: 0 });
  expect(r.revCash).toEqual({ bank: 0, cash: 1 });
  expect(r.revCard).toEqual({ bank: 1, cash: 0 });
  expect(r.revBank).toEqual({ bank: 1, cash: 0 });
  expect(r.tHq).toEqual({ bank: 1, cash: 0 });
  expect(r.tDep).toEqual({ bank: 1, cash: -1 });
  expect(r.tAtm).toEqual({ bank: -1, cash: 1 });
  expect(r.tOutBank).toEqual({ bank: -1, cash: 0 });
  expect(r.tInCash).toEqual({ bank: 0, cash: 1 });
  expect(r.tCashOut).toEqual({ bank: 0, cash: -1 });
});

test('camp cash: local manager Quick add — Cash expense lowers Cash, Bank Transfer lowers Bank, card revenue goes to Bank', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { writes } = await openHub(page, Object.values(fixture()), '&view=local');
  // Defaults a local manager gets: expense → Cash, revenue → Cash.
  const defaults = await page.evaluate(() => {
    showPage('expenses');
    resetQuickExpense();
    const exp = document.getElementById('qe_pay').value;
    document.getElementById('qe_type').value = 'income'; renderQuickExpenseCategories();
    const rev = document.getElementById('qe_pay').value;
    const revVisible = document.getElementById('qe_pay_wrap').style.display !== 'none';
    const revOptions = [...document.getElementById('qe_pay').options].map(o => o.value);
    resetQuickExpense();
    return { mode: LOCAL_MANAGER_MODE, exp, rev, revVisible, revOptions };
  });
  expect(defaults.mode).toBe(true);
  expect(defaults.exp).toBe('Cash');
  expect(defaults.rev).toBe('Cash');
  expect(defaults.revVisible).toBe(true);
  expect(defaults.revOptions).toEqual(['Cash', 'Card', 'Bank Transfer']);

  const quickAdd = async (type, pay, amount, cat) => {
    await page.evaluate(async ([type, pay, amount, cat]) => {
      resetQuickExpense();
      document.getElementById('qe_type').value = type; renderQuickExpenseCategories();
      if (cat) { document.getElementById('qe_cat').value = cat; renderEntryCategorySelection('qe'); }
      document.getElementById('qe_pay').value = pay;
      document.getElementById('qe_amount').value = String(amount);
      document.getElementById('qe_desc').value = `test ${type} ${pay} ${amount}`;
      await saveQuickExpense();
    }, [type, pay, amount, cat]);
  };

  await quickAdd('expense', 'Cash', 1000);
  let d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH - 1000);
  expect(d.ledgerBank).toBe(EXPECTED_BANK);

  await quickAdd('expense', 'Bank Transfer', 2000);
  d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK - 2000);
  expect(d.ledgerCash).toBe(EXPECTED_CASH - 1000);

  await quickAdd('income', 'Card', 3000, 'Other Revenue');
  d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK - 2000 + 3000);
  expect(d.ledgerCash).toBe(EXPECTED_CASH - 1000);

  await quickAdd('income', 'Cash', 500, 'Other Revenue');
  d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH - 1000 + 500);
  expect(d.ovCash).toBe(d.ledgerCash);
  expect(d.ovBank).toBe(d.ledgerBank);

  // What reached the (stubbed) server carries the method the manager chose.
  const saved = writes.filter(w => w.op === 'upsert').map(w => [w.row.type, w.row.payment_method, w.row.amount_local]);
  expect(saved).toEqual([
    ['expense', 'Cash', 1000],
    ['expense', 'Bank Transfer', 2000],
    ['revenue', 'Card', 3000],
    ['revenue', 'Cash', 500],
  ]);
  expect(errors).toEqual([]);
});

test('camp cash: «Record ATM withdrawal» saves out-of-bank + into-cash and moves Bank → Cash', async ({ page }) => {
  const { writes } = await openHub(page, Object.values(fixture()));
  await page.evaluate(async () => {
    showPage('expenses');
    openExpModal('transfer', null, { paymentMethod: 'ATM Withdrawal' });
    document.getElementById('em_date').value = '2026-11-10';
    document.getElementById('em_amount').value = '25000';
    await saveExpense();
  });
  const pair = writes.filter(w => w.op === 'upsert').map(w => [w.row.type, w.row.payment_method, w.row.amount_local, w.row.entry_date]);
  expect(pair).toEqual([
    ['money_sent', 'Bank Transfer', 25000, '2026-11-10'],
    ['money_sent', 'Cash', 25000, '2026-11-10'],
  ]);
  const d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK - 25000);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 25000);
  const flows = await page.evaluate(() => S.ledger.filter(r => r.date === '2026-11-10').map(r => transferFlowLabel(r)));
  expect(flows).toEqual(['Bank → Cash', 'Bank → Cash']);
});

test('camp cash: editing method/amount and deleting move the drawers; HQ Paid, Loan offset and card revenue keep their channel', async ({ page }) => {
  const R = fixture();
  const { writes } = await openHub(page, Object.values(R));
  const edit = async (id, fields) => page.evaluate(async ([id, fields]) => {
    showPage('expenses');
    openEditLedger(id);
    if (fields.pay) document.getElementById('em_pay').value = fields.pay;
    if (fields.amount) document.getElementById('em_amount').value = String(fields.amount);
    await saveExpense();
    return S.ledger.find(r => r.id === id)?.paymentMethod;
  }, [id, fields]);

  // Cash expense 12,000 → paid by bank transfer, 15,000.
  expect(await edit(R.expCash.id, { pay: 'Bank Transfer', amount: 15000 })).toBe('Bank Transfer');
  let d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 12000);
  expect(d.ledgerBank).toBe(EXPECTED_BANK - 15000);

  // Loan offset salary part: change only the amount — it must stay a loan offset (no drawer).
  expect(await edit(R.loanOffset.id, { amount: 25000 })).toBe('Loan offset');
  // Manual HQ-paid salary: change only the amount — stays HQ Paid.
  expect(await edit(R.hqPaidManual.id, { amount: 45000 })).toBe('HQ Paid');
  // Card revenue: change only the amount — stays in the bank.
  expect(await edit(R.revCard.id, { amount: 9000 })).toBe('Card');
  d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 12000);
  expect(d.ledgerBank).toBe(EXPECTED_BANK - 15000 + 2000);
  expect(d.ovSpent).toBe(EXPECTED_SPENT - 12000 + 15000 + 5000 + 5000);

  // A transfer's kind can be corrected in the edit modal: «Into cash» opening → stays, amount 70,000.
  expect(await edit(R.opening.id, { amount: 70000 })).toBe('Cash');
  d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 12000 - 10000);

  // Delete the Cash Out row → cash goes back up by 6,000.
  await page.evaluate(async (id) => { await delLedger(id); }, R.cashOut.id);
  d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 12000 - 10000 + 6000);
  expect(d.ovCash).toBe(d.ledgerCash);
  expect(d.ovBank).toBe(d.ledgerBank);
  expect(writes.some(w => w.op === 'delete' && w.id === R.cashOut.id)).toBe(true);

  // HQ invoice rows cannot be edited or deleted from the camp hub.
  const hqLocked = await page.evaluate((id) => { const before = S.ledger.length; openEditLedger(id); delLedger(id); return { open: document.getElementById('expOv')?.classList.contains('open') || false, same: S.ledger.length === before }; }, R.hqInvoice.id);
  expect(hqLocked.same).toBe(true);
});

test('camp cash: ledger look — kind, sign and labels for every method; «Added» column and «Sort: last added»', async ({ page }) => {
  const R = fixture();
  R.expCash.created_at = '2026-11-11T08:30:00Z';   // the newest line
  R.cashOut.created_at = '2026-11-10T19:00:00Z';
  await openHub(page, Object.values(R));
  const looks = await page.evaluate(() => {
    const T = (type, paymentMethod, sourceKind = 'manual') => {
      const r = { id: 'x', type, paymentMethod, sourceKind, date: '2026-10-01', amountLocal: 1 };
      return [ledgerKind(r), ledgerSign(r), type === 'transfer' ? transferKindLabel(r) : '', type === 'transfer' ? transferFlowLabel(r) : ''];
    };
    return {
      expCash: T('expense', 'Cash'), expCard: T('expense', 'Card'), expBank: T('expense', 'Bank Transfer'),
      hqPaid: T('expense', 'HQ Paid'), hqInv: T('expense', 'Bank Transfer', 'hq_invoice'), loan: T('expense', 'Loan offset'),
      revCash: T('income', 'Cash'), revCard: T('income', 'Card'),
      hq: T('transfer', 'HQ Transfer'), dep: T('transfer', 'Cash Deposit'), atm: T('transfer', 'ATM Withdrawal'),
      outBank: T('transfer', 'Bank Transfer'), inCash: T('transfer', 'Cash'), cashOut: T('transfer', 'Cash Out'),
    };
  });
  expect(looks.expCash).toEqual(['expense', '−', '', '']);
  expect(looks.expCard).toEqual(['expense', '−', '', '']);
  expect(looks.expBank).toEqual(['expense', '−', '', '']);
  expect(looks.hqPaid).toEqual(['hq', '−', '', '']);
  expect(looks.hqInv).toEqual(['hq', '−', '', '']);
  expect(looks.loan).toEqual(['expense', '−', '', '']);
  expect(looks.revCash).toEqual(['revenue', '+', '', '']);
  expect(looks.revCard).toEqual(['revenue', '+', '', '']);
  expect(looks.hq).toEqual(['transfer', '+', 'Money from HQ', 'HQ → Bank']);
  expect(looks.dep).toEqual(['transfer', '', 'Cash deposit', 'Cash → Bank']);
  expect(looks.atm).toEqual(['transfer', '', 'ATM withdrawal', 'Bank → Cash']);
  expect(looks.outBank).toEqual(['transfer', '−', 'Out of bank', 'Bank → Outside']); // no twin
  expect(looks.inCash).toEqual(['transfer', '+', 'Into cash', 'Outside → Cash']);   // no twin
  expect(looks.cashOut).toEqual(['transfer', '−', 'Out of cash', 'Cash → Outside']);

  // ATM pair in the fixture is recognised as Bank → Cash; the lone loan is Bank → Outside.
  const pairFlows = await page.evaluate(([a, b, c]) => [a, b, c].map(id => transferFlowLabel(S.ledger.find(r => r.id === id))), [R.atmOut.id, R.atmIn.id, R.loanOut.id]);
  expect(pairFlows).toEqual(['Bank → Cash', 'Bank → Cash', 'Bank → Outside']);

  // «Added» column renders, and «Sort: last added» puts the newest line first.
  const table = await page.evaluate(() => {
    showPage('expenses');
    const ps = document.getElementById('expPeriodSel'); if (ps) ps.value = 'all';
    const sort = document.getElementById('expSortF');
    const heads = [...document.querySelectorAll('#expTable thead th')].map(th => th.textContent.trim());
    sort.value = 'added'; renderExpenses();
    const firstAdded = [...document.querySelectorAll('#expTable tbody tr')].slice(0, 2).map(tr => tr.children[1].textContent.trim());
    const firstDesc = [...document.querySelectorAll('#expTable tbody tr')].slice(0, 2).map(tr => tr.children[6].textContent.trim());
    sort.value = 'date'; renderExpenses();
    const byDate = document.querySelector('#expTable tbody tr').children[0].textContent.trim();
    return { heads, firstAdded, firstDesc, byDate, expected: fmtAdded('2026-11-11T08:30:00Z') };
  });
  expect(table.heads.slice(0, 3)).toEqual(['Date', 'Added', 'Type']);
  expect(table.firstAdded[0]).toBe(table.expected);
  expect(table.firstAdded[0]).not.toBe('—');
  expect(table.firstDesc).toEqual(['expense Cash 12000', '2025 shop debt']);
  expect(table.byDate).not.toBe('');
});
