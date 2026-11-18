// HQ audit wave 4 (18 Nov 2026): one test per finding fixed in hq/index.html,
// hq/my-tasks.js and /contabilista/. Hermetic: every Supabase call is stubbed.
const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

async function openHqBare(page) {
  await fakeOwnerSession(page);
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, route => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/hq/index.html');
  await page.waitForFunction(() => typeof buildAccountantSheets === 'function');
}

// ── HQ-03 ────────────────────────────────────────────────────────────────
test('HQ-03 accountant Excel: one statement sheet per bank with its own totals, and a «Banco» column for unmatched debits', async ({ page }) => {
  await openHqBare(page);
  const out = await page.evaluate(() => {
    const pack = buildAccountantSheets({
      period: accPeriod('month', '2026-10'), invoices: [], transfers: [], partnerInvoices: [], folders: [],
      bank: [
        { id: 's1', bank: 'santander', movement_date: '2026-10-02', description: 'COMPRA PRIO', amount: -40, balance: 1000, kind: 'expense' },
        { id: 's2', bank: 'santander', movement_date: '2026-10-03', description: 'TRF DE PAYPAL', amount: 300, balance: 1300, kind: 'income' },
        { id: 'c1', bank: 'cgd', movement_date: '2026-10-04', description: 'COMISSAO', amount: -5, balance: 50, kind: 'bank_fee' },
        { id: 'p1', bank: 'paypal', movement_date: '2026-10-03', description: 'Withdrawal to bank', amount: -300, balance: null, kind: 'internal_transfer' },
        { id: 'p2', bank: 'paypal', movement_date: '2026-10-05', description: 'Uber', amount: -12.5, balance: null, kind: 'expense' },
      ],
      bankUnmatched: [{ id: 'p2', movement_date: '2026-10-05', description: 'Uber', amount: -12.5 }],
    });
    const by = Object.fromEntries(pack.sheets.map(s => [s.name, s]));
    const resumo = pack.sheets[0].rows.map(r => r[0] + '=' + r[1]);
    return { names: pack.sheets.map(s => s.name), san: by['Extrato Santander'].rows.length, cgd: by['Extrato CGD'].rows.length,
      pp: by['Extrato PayPal'].rows.map(r => r[2]), bancoSem: by['Banco sem lançamento'].rows, header: by['Banco sem lançamento'].header, resumo };
  });
  expect(out.names.slice(-3)).toEqual(['Extrato Santander', 'Extrato CGD', 'Extrato PayPal']);   // no card sheet: no card movements
  expect(out.san).toBe(2);
  expect(out.cgd).toBe(1);
  expect(out.pp).toEqual([-300, -12.5]);
  expect(out.header[2]).toBe('Banco');
  expect(out.bancoSem).toEqual([['Não', '2026-10-05', 'PayPal', 'Uber', -12.5, '']]);
  // Santander's debits are its own (40), not 357.50 over every bank
  const block = (name) => { const i = out.resumo.indexOf(`EXTRATO ${name}=`); return out.resumo.slice(i + 1, i + 4); };
  expect(block('SANTANDER')).toEqual(['Movimentos=2', 'Débitos (EUR)=40', 'Créditos (EUR)=300']);
  expect(block('PAYPAL')).toEqual(['Movimentos=2', 'Débitos (EUR)=312.5', 'Créditos (EUR)=0']);
  expect(out.resumo).toContain('Débitos do banco sem linha na app=1');
  expect(out.resumo.join('\n')).not.toMatch(/comissões, leasing, anúncios, PayPal/);
});

// ── HQ-04 (page half) ─────────────────────────────────────────────────────
test('HQ-04 Month close: a debit noted as financing / asset / refund, or a salary batch, is not «No expense line" (same rule as the chip and the Excel)', async ({ page }) => {
  await openHqBare(page);
  const out = await page.evaluate(() => {
    const st = (m) => fechoBankStatus({ amount: -100, kind: 'expense', ...m }, []);
    return [
      st({ notes: '[financiamento — COVID loan]' }), st({ notes: '[ativo — loja]' }), st({ notes: '[devolução ao cliente]' }),
      st({ description: 'LOTE TRF CRED SEPA+ pag mes setembro' }), st({ description: 'COMPRA LIDL' }),
    ].map(s => [s.ok, s.label]);
  });
  expect(out).toEqual([
    [true, 'Financing (see note)'], [true, 'Asset (see note)'], [true, 'Refund (see note)'],
    [true, 'Salary batch (lines per person)'], [false, 'No expense line'],
  ]);
});

// ── HQ-05 ────────────────────────────────────────────────────────────────
test('HQ-05 «Add expense» from a bank debit links the saved line to that debit (never re-points a linked one)', async ({ page }) => {
  const writes = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url(); const m = req.method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/hq_invoice_categories')) return json([{ id: 'c-eq', name: 'Equipment & maintenance', sort_order: 1, is_personal: false, active: true }]);
    if (url.includes('/rest/v1/hq_bank_movements')) {
      if (m === 'PATCH') { writes.push(['bank', decodeURIComponent(url.split('?')[1]), JSON.parse(req.postData())]); return json([]); }
      return json([{ id: 'bk1', bank: 'santander', movement_date: '2026-09-15', description: 'COMPRA *6962 LEROY MERLIN COVA PIEDADE', amount: -274.19, currency: 'EUR', kind: 'expense', hq_invoice_id: null, internal_transfer_id: null, notes: null }]);
    }
    if (url.includes('/rest/v1/hq_invoices')) {
      if (m === 'POST') { writes.push(['insert', JSON.parse(req.postData()).company]); return json([{ id: 'new1' }]); }
      return json([]);
    }
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderFecho === 'function' && document.querySelector('[data-tab="fecho"]'));
  await page.evaluate(() => switchTab('fecho'));
  await page.selectOption('#fecho_mes', '2026-09');
  await page.waitForFunction(() => (FECHO.mvAll || []).length === 1, null, { timeout: 15000 });
  await page.evaluate(() => fechoLaunch('bk1'));
  await page.waitForFunction(() => document.querySelector('#inv_amount')?.value === '274.19', null, { timeout: 5000 });
  await page.evaluate(() => {
    $('inv_location').value = 'portugal'; $('inv_payment').value = $('inv_payment').options[1].value;
    const c = $('inv_category'); c.value = [...c.options].find(o => o.value)?.value;
    return saveInvoice();
  });
  await page.waitForFunction(() => /Expense saved/.test(document.querySelector('#invToast')?.textContent || ''), null, { timeout: 10000 });
  expect(writes[0]).toEqual(['insert', 'leroy merlin cova piedade']);
  expect(writes[1][0]).toBe('bank');
  expect(writes[1][1]).toContain('id=eq.bk1');
  expect(writes[1][1]).toContain('hq_invoice_id=is.null');
  expect(writes[1][2]).toEqual({ hq_invoice_id: 'new1' });
  // a plain «Add expense» afterwards links nothing
  await page.evaluate(() => { openAddExpense(); return null; });
  expect(await page.evaluate(() => window.__launchBankId)).toBeNull();
  expect(errs).toEqual([]);
});

// ── HQ-07 / PRT-12 (HQ half) ─────────────────────────────────────────────
test('HQ-07 / PRT-12 Cash flow: a cancelled booking is not money in; duplicates and 2026 partner commissions already in the booking are not money out', async ({ page }) => {
  const urls = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url(); urls.push(decodeURIComponent(url));
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/bookings')) return json(url.includes('select=month_key') ? [{ month_key: '2026-10' }] : [
      { total: 1000, net_amount: 1000, month_key: '2026-10', location: 'Portugal', status: 'Paid' },
      { total: 500, net_amount: 500, month_key: '2026-10', location: 'Portugal', status: null },
      { total: 900, net_amount: 900, month_key: '2026-10', location: 'Portugal', status: 'Canceled' },
    ]);
    if (url.includes('/rest/v1/hq_invoices')) return json(url.includes('select=invoice_date') ? [] : [
      { paying_company: 'water-movements', location_slug: 'portugal', amount_eur: 100, category_id: 'c1', category_name: 'Food', invoice_date: '2026-10-02', is_duplicate: false },
      { paying_company: 'water-movements', location_slug: 'portugal', amount_eur: 100, category_id: 'c1', category_name: 'Food', invoice_date: '2026-10-02', is_duplicate: true },
      { paying_company: 'water-movements', location_slug: 'portugal', amount_eur: 250, category_id: 'c2', category_name: 'Partners', invoice_date: '2026-10-05', is_duplicate: false, commission_in_booking: null },
    ]);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderCashflow === 'function' && document.querySelector('#cashflowBody'));
  await page.evaluate(() => renderCashflow());
  await page.waitForFunction(() => /Water Movements/.test(document.querySelector('#cashflowBody tbody')?.textContent || ''), null, { timeout: 15000 });
  const wm = await page.evaluate(() => [...document.querySelectorAll('#cashflowBody tbody tr')].find(tr => /Water Movements/.test(tr.textContent)).children[1].textContent + ' | ' + [...document.querySelectorAll('#cashflowBody tbody tr')].find(tr => /Water Movements/.test(tr.textContent)).children[3].textContent);
  expect(wm).toBe('€1,500.00 | €100.00');
  // the status comes from the booking payload, and every paged read has a unique tiebreak (HQ-09)
  expect(urls.some(u => /\/bookings\?select=.*status:raw_payload->>status.*order=check_in_on\.asc,id\.asc/.test(u))).toBe(true);
  expect(errs).toEqual([]);
});

// ── HQ-09 / HQ-18 ────────────────────────────────────────────────────────
test('HQ-09 every paged HQ read has id as the last sort key; HQ-18 «saved up to» is the Santander statement only', async ({ page }) => {
  const urls = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = decodeURIComponent(route.request().url()); urls.push(url);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/hq_bank_movements') && url.includes('limit=1')) return json([{ movement_date: '2026-11-17' }]);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderInvoiceList === 'function' && document.querySelector('#tab-invoices'));
  await page.evaluate(async () => { switchTab('invoices'); await renderInvoiceList(); await openLocDrilldown('portugal', '__all__', 'Portugal', 0); openAccountantPanel(); await refreshBankStatus(); });
  await page.waitForFunction(() => /Santander statement saved up to/.test(document.querySelector('#acc_bank_status')?.textContent || ''), null, { timeout: 10000 });
  const list = urls.filter(u => /\/rest\/v1\/hq_invoices\?select=id,location_slug/.test(u));
  expect(list.length).toBeGreaterThan(0);
  list.forEach(u => expect(u).toMatch(/order=invoice_date\.desc,id\.desc/));
  const links = urls.filter(u => /hq_bank_movements\?select=hq_invoice_id,movement_date,bank/.test(u));
  links.forEach(u => { expect(u).toMatch(/order=id\.asc/); expect(u).toContain('paying_company=neq.manjar'); });
  const drill = urls.filter(u => /\/(ledger_entries|hq_invoices)\?.*order=amount_eur/.test(u));
  expect(drill.length).toBe(2);
  drill.forEach(u => expect(u).toMatch(/order=amount_eur\.desc,id\.asc/));
  expect(links.length).toBeGreaterThan(0);
  const status = urls.find(u => /hq_bank_movements\?select=movement_date.*limit=1/.test(u));
  expect(status).toContain('bank=eq.santander');
  expect(status).toContain('paying_company=eq.water-movements');
});
