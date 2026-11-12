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
//         − expense by Bank Transfer/Card − cash withdrawal − transfer «Out of bank»
//   Cash: + cash withdrawal + transfer «Into cash» + cash revenue (Camp Tab included)
//         − expense by Cash − Cash Deposit − «Out of cash» (Cash Out)
//   Neither: HQ Paid / hq_invoice expenses and Loan offset (still P&L costs).
//
// A cash withdrawal is ONE row (payment_method 'ATM Withdrawal': bank −,
// cash +) since 11 Nov 2026 — Miguel: «quando se levanta dinheiro vai direto
// para a caixa, não é preciso ter outra linha». For one day it was saved as a
// pair («Out of bank» + «Into cash»); the fixture keeps one such pair because
// old pairs must add up the same until the data is converted.
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
    atmOut:       row('money_sent', 'Bank Transfer', 50000, { date: '2026-10-21', description: 'ATM withdrawal · Sampath card 21/10 — out of bank' }), // OLD pair: bank −
    atmIn:        row('money_sent', 'Cash', 50000, { date: '2026-10-21', description: 'ATM withdrawal · Sampath card 21/10 — into cash' }),         //           cash +
    legacyAtm:    row('money_sent', 'ATM Withdrawal', 5000, { description: 'ATM withdrawal · Sampath card 20/10' }), // ONE row: bank − / cash +
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
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka', currency: 'LKR', default_fx_to_eur: 340, camp_tab_mode: 'per_guest' }); // Sri Lanka runs per_guest (locations table, 11 Nov 2026)
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

test('camp cash: a cash withdrawal is saved as ONE row and moves Bank → Cash', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { writes } = await openHub(page, Object.values(fixture()));
  const before = await page.evaluate(() => S.ledger.length);
  const modal = await page.evaluate(async () => {
    showPage('expenses');
    openExpModal('transfer', null, { paymentMethod: 'ATM Withdrawal' });
    const out = {
      title: document.getElementById('expModalTitle').textContent,
      label: document.querySelector('#em_pay_wrap label').textContent,
      visible: document.getElementById('em_pay_wrap').style.display !== 'none',
      kinds: [...document.getElementById('em_pay').options].map(o => [o.value, o.textContent]),
      chosen: document.getElementById('em_pay').value,
    };
    document.getElementById('em_date').value = '2026-11-10';
    document.getElementById('em_amount').value = '25000';
    await saveExpense();
    return out;
  });
  // The modal names the kind in plain words, with its from → to.
  expect(modal.title).toBe('Add Transfer');
  expect(modal.label).toBe('Kind of transfer');
  expect(modal.visible).toBe(true);
  expect(modal.chosen).toBe('ATM Withdrawal');
  expect(modal.kinds).toEqual([
    ['HQ Transfer', 'Money from HQ · HQ → Bank'],
    ['ATM Withdrawal', 'ATM withdrawal · Bank → Cash'],
    ['Cash Deposit', 'Cash deposit · Cash → Bank'],
    ['Bank Transfer', 'Out of bank · Bank → Outside'],
    ['Cash', 'Into cash · Outside → Cash'],
    ['Cash Out', 'Out of cash · Cash → Outside'],
  ]);
  // ONE row reaches the server — not the old out-of-bank + into-cash pair.
  const saved = writes.filter(w => w.op === 'upsert').map(w => [w.row.type, w.row.payment_method, w.row.amount_local, w.row.entry_date, w.row.description]);
  expect(saved).toEqual([['money_sent', 'ATM Withdrawal', 25000, '2026-11-10', 'ATM withdrawal']]);
  expect(await page.evaluate(() => S.ledger.length)).toBe(before + 1);
  const d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK - 25000);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 25000);
  expect(d.ledgerTotal).toBe(EXPECTED_BANK + EXPECTED_CASH); // a withdrawal never changes the total
  expect(d.ovBank).toBe(d.ledgerBank);
  expect(d.ovCash).toBe(d.ledgerCash);
  // The list shows it once: grey «ATM withdrawal» badge, «Bank → Cash», the amount without a sign.
  const shown = await page.evaluate(() => {
    const ps = document.getElementById('expPeriodSel'); if (ps) ps.value = 'all';
    renderExpenses();
    return [...document.querySelectorAll('#expTable tbody tr')].filter(tr => tr.children[0].textContent.trim() === fmtd('2026-11-10'))
      .map(tr => ({ badge: tr.children[2].querySelector('.badge')?.textContent.trim(), grey: !!tr.children[2].querySelector('.badge.badge-grey'), flow: tr.children[2].querySelector('.cell-sub')?.textContent.trim(), via: tr.children[4].textContent.trim(), local: tr.children[8].textContent.trim(), mob: tr.children[2].querySelector('.amt-mob')?.textContent.trim() }));
  });
  expect(shown).toEqual([{ badge: 'ATM withdrawal', grey: true, flow: 'Bank → Cash', via: 'Bank → Cash', local: 'LKR 25,000', mob: 'LKR 25,000' }]);
  expect(errors).toEqual([]);
});

// Cash control (Miguel, 10 Nov 2026: «the total balance of the operations
// ledger paid via Cash»): filtering the ledger by Cash must list everything
// that moves the cash box — withdrawals included, as + — and add up to the
// Cash tile. Filtering by Bank Transfer shows the same withdrawal as −.
test('camp cash: payment filter — Cash lists the withdrawal as +, Bank Transfer as −, no filter shows it once without a sign', async ({ page }) => {
  const R = fixture();
  await openHub(page, Object.values(R));
  const view = (pay) => page.evaluate(([pay, ids]) => {
    showPage('expenses');
    const ps = document.getElementById('expPeriodSel'); if (ps) ps.value = 'all';
    ['expTypeF', 'expCatF', 'expWeekF'].forEach(id => { document.getElementById(id).value = 'all'; });
    document.getElementById('expSearch').value = '';
    renderExpenses();
    const sel = document.getElementById('expPayF');
    const options = [...sel.options].map(o => o.value);
    sel.value = pay; renderExpenses();
    const num = (t) => { const n = Number(String(t).replace(/[^0-9.]/g, '')) || 0; return /−/.test(t) ? -n : n; };
    const rows = [...document.querySelectorAll('#expTable tbody tr:not(.empty-row)')].map(tr => ({
      desc: tr.children[6].textContent.trim(), badge: tr.children[2].querySelector('.badge')?.textContent.trim(),
      flow: tr.children[2].querySelector('.cell-sub')?.textContent.trim() || '', local: tr.children[8].textContent.trim(),
      eur: tr.children[9].textContent.trim(), mob: tr.children[2].querySelector('.amt-mob')?.textContent.trim(),
    }));
    const byDesc = (d) => rows.filter(r => r.desc === d);
    return {
      options, n: rows.length, sum: rows.reduce((t, r) => t + num(r.local), 0),
      single: byDesc('ATM withdrawal · Sampath card 20/10'),
      pairOut: byDesc('ATM withdrawal · Sampath card 21/10 — out of bank'), pairIn: byDesc('ATM withdrawal · Sampath card 21/10 — into cash'),
      deposit: byDesc('money_sent Cash Deposit 10000'), hq: byDesc('money_sent HQ Transfer 1000000'), loan: byDesc('money_sent Bank Transfer 30000'),
      cashOut: byDesc('2025 shop debt'), opening: byDesc('Opening cash'),
    };
  }, [pay, null]);

  // No filter: the withdrawal is ONE line, no sign, «Bank → Cash».
  const all = await view('all');
  expect(all.n).toBe(18);
  expect(all.single).toHaveLength(1);
  expect(all.single[0]).toMatchObject({ badge: 'ATM withdrawal', flow: 'Bank → Cash', local: 'LKR 5,000', mob: 'LKR 5,000' });
  expect(all.single[0].eur).not.toMatch(/[+−]/);
  // The filter offers payment methods only — a transfer sits under the wallet it moves.
  expect(all.options).toEqual(['all', 'Bank Transfer', 'Card', 'Cash', 'HQ Paid', 'Loan offset']);

  // Cash: everything that moves the cash box, each with its sign for cash.
  const cash = await view('Cash');
  expect(cash.single).toHaveLength(1);
  expect(cash.single[0]).toMatchObject({ badge: 'ATM withdrawal', flow: 'Bank → Cash', local: '+LKR 5,000', mob: '+LKR 5,000' });
  expect(cash.single[0].eur).toMatch(/^\+/);
  expect(cash.pairIn.map(r => r.local)).toEqual(['+LKR 50,000']);   // old pair: only its cash half
  expect(cash.pairOut).toEqual([]);
  expect(cash.deposit.map(r => r.local)).toEqual(['−LKR 10,000']);  // cash deposit takes from cash
  expect(cash.cashOut.map(r => r.local)).toEqual(['−LKR 6,000']);
  expect(cash.opening.map(r => r.local)).toEqual(['+LKR 80,000']);
  expect(cash.hq).toEqual([]);
  expect(cash.loan).toEqual([]);
  expect(cash.n).toBe(8);
  expect(cash.sum).toBe(EXPECTED_CASH); // the Cash list adds up to the Cash tile

  // Bank Transfer: the same withdrawal, now − out of the bank.
  const bank = await view('Bank Transfer');
  expect(bank.single).toHaveLength(1);
  expect(bank.single[0]).toMatchObject({ badge: 'ATM withdrawal', flow: 'Bank → Cash', local: '−LKR 5,000', mob: '−LKR 5,000' });
  expect(bank.single[0].eur).toMatch(/^−/);
  expect(bank.pairOut.map(r => r.local)).toEqual(['−LKR 50,000']);  // old pair: only its bank half
  expect(bank.pairIn).toEqual([]);
  expect(bank.deposit.map(r => r.local)).toEqual(['+LKR 10,000']);  // cash deposit adds to the bank
  expect(bank.hq.map(r => r.local)).toEqual(['+LKR 1,000,000']);
  expect(bank.loan.map(r => r.local)).toEqual(['−LKR 30,000']);
  expect(bank.cashOut).toEqual([]);
  // Bank Transfer + Card lists = the Bank tile.
  const card = await view('Card');
  expect(bank.sum + card.sum).toBe(EXPECTED_BANK);

  await view('all');
  const d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK);
  expect(d.ledgerCash).toBe(EXPECTED_CASH);
});

test('camp cash: old pairs and single-row withdrawals give the same Bank and Cash; merging a pair in the edit modal keeps them', async ({ page }) => {
  // The same ledger three ways: as loaded (one old pair + one single row),
  // with the pair converted to one row (what the data migration does), and
  // with one more pair and one more single row of the same day and amount.
  const R = fixture();
  const converted = Object.values(fixture()).filter(r => r.description !== R.atmIn.description)
    .map(r => r.description === R.atmOut.description ? { ...r, payment_method: 'ATM Withdrawal', description: 'ATM withdrawal · Sampath card 21/10' } : r);
  expect(converted).toHaveLength(17);
  const { writes } = await openHub(page, Object.values(R));
  const sums = await page.evaluate(([converted]) => {
    const asLoaded = ledgerDrawerBalances(S.ledger);
    const conv = ledgerDrawerBalances(converted.map(r => normalizeLedgerEntry({ id: r.id, date: r.entry_date, type: r.type === 'money_sent' ? 'transfer' : r.type === 'revenue' ? 'income' : 'expense', paymentMethod: r.payment_method, amountLocal: Number(r.amount_local), currency: r.currency, fxRate: Number(r.fx_rate), amount: Number(r.amount_eur), category: r.category, sourceKind: r.source_kind, description: r.description })));
    const T = (paymentMethod, id) => normalizeLedgerEntry({ id, date: '2026-10-21', type: 'transfer', paymentMethod, amountLocal: 50000, currency: 'LKR', fxRate: 340, amount: 147.06, category: 'Cash Float' });
    const mixed = ledgerDrawerBalances([...S.ledger, T('Bank Transfer', 'p2a'), T('Cash', 'p2b'), T('ATM Withdrawal', 's2')]);
    const r = (o) => ({ bank: Math.round(o.bankLocal), cash: Math.round(o.cashLocal) });
    return { asLoaded: r(asLoaded), conv: r(conv), mixed: r(mixed) };
  }, [converted]);
  expect(sums.asLoaded).toEqual({ bank: EXPECTED_BANK, cash: EXPECTED_CASH });
  expect(sums.conv).toEqual({ bank: EXPECTED_BANK, cash: EXPECTED_CASH });
  expect(sums.mixed).toEqual({ bank: EXPECTED_BANK - 100000, cash: EXPECTED_CASH + 100000 });

  // Lone rows keep their meaning next to the pair.
  const flows = await page.evaluate(([a, b, c, d]) => [a, b, c, d].map(id => { const r = S.ledger.find(x => x.id === id); return [transferKindLabel(r), transferFlowLabel(r), ledgerSign(r)]; }), [R.atmOut.id, R.atmIn.id, R.loanOut.id, R.opening.id]);
  expect(flows).toEqual([
    ['Out of bank', 'Bank → Cash', '−'], ['Into cash', 'Bank → Cash', '+'],
    ['Out of bank', 'Bank → Outside', '−'], ['Into cash', 'Outside → Cash', '+'],
  ]);

  // Correcting the bank half of the old pair to «ATM withdrawal» in the edit
  // modal makes it ONE line: the cash half is removed, balances do not move.
  const merged = await page.evaluate(async (id) => {
    showPage('expenses');
    openEditLedger(id);
    const title = document.getElementById('expModalTitle').textContent;
    const chosen = document.getElementById('em_pay').selectedOptions[0].textContent;
    document.getElementById('em_pay').value = 'ATM Withdrawal';
    await saveExpense();
    const r = S.ledger.find(x => x.id === id);
    return { title, chosen, n: S.ledger.length, method: r.paymentMethod, desc: r.description, kind: transferKindLabel(r), flow: transferFlowLabel(r), sign: ledgerSign(r) };
  }, R.atmOut.id);
  expect(merged).toEqual({ title: 'Edit Transfer', chosen: 'Out of bank · Bank → Outside', n: 17, method: 'ATM Withdrawal', desc: 'ATM withdrawal · Sampath card 21/10', kind: 'ATM withdrawal', flow: 'Bank → Cash', sign: '' });
  expect(writes.filter(w => w.op === 'upsert').map(w => [w.row.id, w.row.payment_method])).toEqual([[R.atmOut.id, 'ATM Withdrawal']]);
  expect(writes.filter(w => w.op === 'delete').map(w => w.id)).toEqual([R.atmIn.id]);
  const d = await drawers(page);
  expect(d.ledgerBank).toBe(EXPECTED_BANK);
  expect(d.ledgerCash).toBe(EXPECTED_CASH);
  expect(d.ovBank).toBe(EXPECTED_BANK);
  expect(d.ovCash).toBe(EXPECTED_CASH);
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
    // Sign of a row for one wallet (the list filtered by Cash / Bank Transfer).
    const W = (type, paymentMethod) => { const r = { id: 'x', type, paymentMethod, sourceKind: 'manual' }; return [ledgerSign(r, 'cash'), ledgerSign(r, 'bank'), ledgerPaidViaText(r), ledgerPayFilterKeys(r).join('+')]; };
    return {
      expCash: T('expense', 'Cash'), expCard: T('expense', 'Card'), expBank: T('expense', 'Bank Transfer'),
      hqPaid: T('expense', 'HQ Paid'), hqInv: T('expense', 'Bank Transfer', 'hq_invoice'), loan: T('expense', 'Loan offset'),
      revCash: T('income', 'Cash'), revCard: T('income', 'Card'),
      hq: T('transfer', 'HQ Transfer'), dep: T('transfer', 'Cash Deposit'), atm: T('transfer', 'ATM Withdrawal'),
      outBank: T('transfer', 'Bank Transfer'), inCash: T('transfer', 'Cash'), cashOut: T('transfer', 'Cash Out'),
      wAtm: W('transfer', 'ATM Withdrawal'), wDep: W('transfer', 'Cash Deposit'), wHq: W('transfer', 'HQ Transfer'),
      wOutBank: W('transfer', 'Bank Transfer'), wInCash: W('transfer', 'Cash'), wCashOut: W('transfer', 'Cash Out'),
      wExpCash: W('expense', 'Cash'), wRevCard: W('income', 'Card'),
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
  // Same effect, named apart: a bank transfer to the manager that became cash.
  expect(await page.evaluate(() => transferKindLabel({ type: 'transfer', paymentMethod: 'ATM Withdrawal', description: 'Cash for operations · Sampath transfer to Nadith (SVC-0034229508)' }))).toBe('Transfer to manager');
  expect(looks.outBank).toEqual(['transfer', '−', 'Out of bank', 'Bank → Outside']); // no twin
  expect(looks.inCash).toEqual(['transfer', '+', 'Into cash', 'Outside → Cash']);   // no twin
  expect(looks.cashOut).toEqual(['transfer', '−', 'Out of cash', 'Cash → Outside']);
  // [sign under Cash, sign under Bank Transfer, «Paid via», filter it is listed under]
  expect(looks.wAtm).toEqual(['+', '−', 'Bank → Cash', 'Bank Transfer+Cash']);
  expect(looks.wDep).toEqual(['−', '+', 'Cash → Bank', 'Bank Transfer+Cash']);
  expect(looks.wHq).toEqual(['+', '+', 'Bank', 'Bank Transfer']);
  expect(looks.wOutBank).toEqual(['−', '−', 'Bank', 'Bank Transfer']);
  expect(looks.wInCash).toEqual(['+', '+', 'Cash', 'Cash']);
  expect(looks.wCashOut).toEqual(['−', '−', 'Cash', 'Cash']);
  expect(looks.wExpCash).toEqual(['−', '−', 'Cash', 'Cash']);
  expect(looks.wRevCard).toEqual(['+', '+', 'Card', 'Card']);

  // The old pair in the fixture is recognised as Bank → Cash; the lone loan is Bank → Outside.
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

// Camp Tab → ledger, end to end (Miguel, 11 Nov 2026): the social host runs
// the bar/activities box and enters every sale in the Camp Tab; each paid
// item must reach the ledger by itself as Cash revenue. Today the Camp Tab
// has no payment-method choice at checkout («Pay» / «Pay all» only), so every
// sale is recorded as Cash — this test pins that down.
test('camp cash: Camp Tab sale → Pay all → Cash revenue rows in the ledger → Cash up; unpay takes it back', async ({ page }) => {
  const errors = collectFatalErrors(page);
  const { writes } = await openHub(page, Object.values(fixture()));
  await page.waitForFunction(() => { const f = document.querySelector('iframe[src*="camp-tab-inner"]'); return !!f && /mode=per_guest/.test(f.getAttribute('src') || ''); }, null, { timeout: 15000 });
  const frameHandle = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached' });
  const frame = await frameHandle.contentFrame();
  await frame.waitForFunction(() => { try { return typeof togglePaid === 'function' && typeof addResolvedItem === 'function' && CAMP_TAB_MODE === 'per_guest'; } catch (_) { return false; } }, null, { timeout: 15000 });

  // The social host: pick a guest, ring up a beer and a tuk-tuk, tap «Pay all».
  const tab = await frame.evaluate(async () => {
    window.confirm = () => true;
    await ensurePerGuestWeek();
    currentRoster = 'guests';
    document.getElementById('newGuestName').value = 'Test Guest';
    saveNewGuest(); // the «Add guest» form — sets AG to the new guest
    const g = findConsumer('Test Guest', 'guests');
    AC = 'Drinks'; addResolvedItem({ id: 'm-beer', n: 'Lion Lager', p: 900 });
    AC = 'Tours';  addResolvedItem({ id: 'm-tuk', n: 'Temple Run Tuk Tuk', p: 1500 });
    togglePaid(); // «Pay all (2)»
    const fg = findConsumer(g.id, 'guests');
    return { paid: fg.items.map(i => !!i.paidAt), methodFields: fg.items.map(i => Object.keys(i).filter(k => /method|card|transfer|via/i.test(k))) };
  });
  expect(tab.paid).toEqual([true, true]);
  expect(tab.methodFields).toEqual([[], []]); // the Camp Tab stores no payment method at all

  await page.waitForFunction(() => S.ledger.filter(r => r.sourceKind === 'camp_tab_per_item' && /Test Guest/.test(r.description || '')).length === 2, null, { timeout: 10000 });
  const rows = writes.filter(w => w.op === 'upsert' && w.row.source_kind === 'camp_tab_per_item' && /Test Guest/.test(w.row.description || ''))
    .map(w => [w.row.type, w.row.payment_method, w.row.amount_local, w.row.description]);
  expect(rows).toEqual([
    ['revenue', 'Cash', 900, 'Camp Tab · Test Guest · Lion Lager'],
    ['revenue', 'Cash', 1500, 'Camp Tab · Test Guest · Temple Run Tuk Tuk'],
  ]);
  let d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 2400);
  expect(d.ledgerBank).toBe(EXPECTED_BANK);
  expect(d.ovCash).toBe(EXPECTED_CASH + 2400);

  // The host reverses the beer («Paid» pill) → its ledger row goes, Cash back down.
  await frame.evaluate(() => { window.confirm = () => true; unpayItemOnGuest(findConsumer('Test Guest', 'guests'), 0); });
  await page.waitForFunction(() => S.ledger.filter(r => r.sourceKind === 'camp_tab_per_item' && /Test Guest/.test(r.description || '')).length === 1, null, { timeout: 10000 });
  d = await drawers(page);
  expect(d.ledgerCash).toBe(EXPECTED_CASH + 1500);
  expect(writes.some(w => w.op === 'delete')).toBe(true);
  expect(errors).toEqual([]);
});

// A gift is free on both rosters (12 Nov 2026): «Gift · free» on the Staff
// tab used to come back at the staff price whenever the catalog item had a
// «Staff» alt price, so a gifted beer still asked for LKR 300.
test('camp tab: «Gift · free» is LKR 0 on the Staff and Guests tabs, and the staff price still applies to a normal tap', async ({ page }) => {
  await openHub(page, Object.values(fixture()));
  const frameHandle = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 15000 });
  const frame = await frameHandle.contentFrame();
  await frame.waitForFunction(() => { try { return typeof addItemAtCustomPrice === 'function' && typeof addResolvedItem === 'function' && CAMP_TAB_MODE === 'per_guest'; } catch (_) { return false; } }, null, { timeout: 15000 });
  const out = await frame.evaluate(async () => {
    window.confirm = () => true;
    await ensurePerGuestWeek();
    const beer = { id: 'm-gift-beer', n: 'Gift Test Lager', p: 900, altPrice: 300, altLabel: 'Staff' };
    MENU.Drinks = [...(MENU.Drinks || []), beer];
    AC = 'Drinks';
    // Staff tab
    currentRoster = 'staff';
    document.getElementById('newGuestName').value = 'Jude Test';
    saveNewGuest(); // same form as «+ Staff» — adds to the current roster and selects it
    addItemAtCustomPrice(beer.id, beer.n, 0, 'Gift', null);   // «Gift · free»
    addResolvedItem(beer);                                      // normal staff tap
    const staff = findConsumer('Jude Test', 'staff').items.map(i => [i.p, i.priceType]);
    // Guests tab
    currentRoster = 'guests';
    document.getElementById('newGuestName').value = 'Gift Guest';
    saveNewGuest();
    addItemAtCustomPrice(beer.id, beer.n, 0, 'Gift', null);
    addItemAtCustomPrice(beer.id, beer.n, 450, '-50%', null);
    const guest = findConsumer('Gift Guest', 'guests').items.map(i => [i.p, i.priceType]);
    return { staff, guest };
  });
  expect(out.staff).toEqual([[0, 'Gift'], [300, 'staff']]);
  expect(out.guest).toEqual([[0, 'Gift'], [450, '-50%']]);
});

// Gift lines saved at the staff price before the fix (Jude, 12 Nov 2026) are
// healed on read: unpaid → LKR 0; a paid gift line keeps its amount.
test('camp tab: an old unpaid «Gift» line saved with a price shows LKR 0; a paid one is left alone', async ({ page }) => {
  await openHub(page, Object.values(fixture()));
  const frameHandle = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 15000 });
  const frame = await frameHandle.contentFrame();
  await frame.waitForFunction(() => { try { return typeof normalizeItemRows === 'function'; } catch (_) { return false; } }, null, { timeout: 15000 });
  const out = await frame.evaluate(() => normalizeItemRows([
    { n: 'Lion Lager', p: 300, c: 'Drinks', priceType: 'Gift', s: 'Gift' },
    { n: 'Lion Lager', p: 300, c: 'Drinks', priceType: 'Gift', s: 'Gift', paidAt: '2026-11-10T08:00:00Z' },
    { n: 'Lion Lager', p: 300, c: 'Drinks', priceType: 'staff' },
  ]).map(i => i.p));
  expect(out).toEqual([0, 300, 300]);
});

// «This week» expanded card has «Pay all» too (12 Nov 2026): every unpaid
// line paid, one revenue row each, gifts (LKR 0) left alone.
test('camp tab: This week «Pay all» pays every unpaid line of that guest', async ({ page }) => {
  await openHub(page, Object.values(fixture()));
  const frameHandle = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 15000 });
  const frame = await frameHandle.contentFrame();
  await frame.waitForFunction(() => { try { return typeof payAllForGuestId === 'function' && CAMP_TAB_MODE === 'per_guest'; } catch (_) { return false; } }, null, { timeout: 15000 });
  const out = await frame.evaluate(async () => {
    window.confirm = () => true;
    await ensurePerGuestWeek();
    currentRoster = 'guests';
    document.getElementById('newGuestName').value = 'Week Guest';
    saveNewGuest();
    AC = 'Drinks';
    MENU.Drinks = [...(MENU.Drinks || []), { id: 'w-beer', n: 'Lion Lager', p: 900 }];
    addResolvedItem({ id: 'w-beer', n: 'Lion Lager', p: 900 });
    addResolvedItem({ id: 'w-soft', n: 'Soft Drink', p: 400 });
    addItemAtCustomPrice('w-beer', 'Lion Lager', 0, 'Gift', null);
    const g = findConsumer('Week Guest', 'guests');
    twExpanded = g.id; renderThisWeek();
    const btn = [...document.querySelectorAll('.tw-actions button')].find(b => /^Pay all/.test(b.textContent));
    const label = btn && btn.textContent;
    btn.click();
    return { label, paid: findConsumer('Week Guest', 'guests').items.map(i => [i.p, !!i.paidAt]) };
  });
  expect(out.label).toBe('Pay all (2)');
  expect(out.paid).toEqual([[900, true], [400, true], [0, false]]);
});

// Sri Lanka pays a tab in one go (12 Nov 2026): no «Pay» on each line, only «Pay all».
test('camp tab: Sri Lanka shows no per-line «Pay» — only «Pay all» on Charge and This week', async ({ page }) => {
  await openHub(page, Object.values(fixture()));
  const frameHandle = await page.waitForSelector('iframe[src*="camp-tab-inner"][src*="mode=per_guest"]', { state: 'attached', timeout: 15000 });
  const frame = await frameHandle.contentFrame();
  await frame.waitForFunction(() => { try { return typeof payAllForGuestId === 'function' && CAMP_TAB_MODE === 'per_guest'; } catch (_) { return false; } }, null, { timeout: 15000 });
  const out = await frame.evaluate(async () => {
    await ensurePerGuestWeek();
    currentRoster = 'guests';
    document.getElementById('newGuestName').value = 'Line Guest';
    saveNewGuest();
    AC = 'Drinks';
    addResolvedItem({ id: 'l-a', n: 'Soft Drink', p: 400 });
    addResolvedItem({ id: 'l-b', n: 'Soft Drink', p: 400 });
    const g = findConsumer('Line Guest', 'guests');
    renderAllCampTabViews();
    twExpanded = g.id; renderThisWeek();
    const twButtons = [...document.querySelectorAll('.tw-item-row button')].map(b => b.textContent.trim());
    const twActions = [...document.querySelectorAll('.tw-actions button')].map(b => b.textContent.trim());
    return { twButtons, twActions };
  });
  expect(out.twButtons).not.toContain('Pay');
  expect(out.twActions).toContain('Pay all (2)');
});

// A double tap on «Add entry» writes ONE row (Sri Lanka, 12 Nov 2026: three
// entries were saved twice within the same second).
test('camp ledger: double tap on Quick add saves the entry once', async ({ page }) => {
  const { writes } = await openHub(page, Object.values(fixture()), '&view=local');
  await page.evaluate(async () => {
    showPage('expenses');
    resetQuickExpense();
    document.getElementById('qe_type').value = 'expense'; renderQuickExpenseCategories();
    document.getElementById('qe_pay').value = 'Cash';
    document.getElementById('qe_amount').value = '45000';
    document.getElementById('qe_desc').value = 'Tuna double tap';
    await Promise.all([saveQuickExpense(), saveQuickExpense()]);
  });
  const saved = writes.filter(w => w.op === 'upsert' && /Tuna double tap/.test(w.row.description || ''));
  expect(saved.length).toBe(1);
});
