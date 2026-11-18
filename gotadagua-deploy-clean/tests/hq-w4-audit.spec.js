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
      if (m === 'PATCH') { writes.push(['bank', decodeURIComponent(url.split('?')[1]), JSON.parse(req.postData())]); return json([{ id: 'bk1' }]); }
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
  expect(await page.evaluate(() => document.querySelector('#invToast')?.textContent || '')).not.toMatch(/not linked/);
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

// ── HQ-08 ────────────────────────────────────────────────────────────────
test('HQ-08 Expenses: typing a search or picking a category filters the loaded rows; only location / period / archived read the server again', async ({ page }) => {
  let listReads = 0;
  const ROWS = [
    { id: 'a', invoice_date: '2026-10-02', company: 'prio', amount: 40, amount_eur: 40, currency: 'EUR', location_slug: 'portugal', paying_company: 'water-movements', category_id: 'c1', category_name: 'Transport', payment_type: 'Card', needs_review: false, is_duplicate: false },
    { id: 'b', invoice_date: '2026-10-03', company: 'edp', amount: 107.3, amount_eur: 107.3, currency: 'EUR', location_slug: 'portugal', paying_company: 'water-movements', category_id: 'c2', category_name: 'Utilities', payment_type: 'Bank Transfer', needs_review: false, is_duplicate: false },
  ];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = decodeURIComponent(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/hq_invoices?select=id,location_slug')) { listReads++; return json(ROWS); }
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderInvoiceList === 'function' && document.querySelector('#tab-invoices'));
  await page.evaluate(() => switchTab('invoices'));
  await page.waitForFunction(() => /edp/.test(document.querySelector('#invListBody')?.textContent || ''), null, { timeout: 15000 });
  const before = listReads;
  await page.fill('#filter_search', 'pri');
  await page.waitForFunction(() => !/edp/.test(document.querySelector('#invListBody')?.textContent || '') && /prio/.test(document.querySelector('#invListBody')?.textContent || ''), null, { timeout: 5000 });
  await page.fill('#filter_search', '');
  await page.waitForFunction(() => /edp/.test(document.querySelector('#invListBody')?.textContent || ''), null, { timeout: 5000 });
  expect(listReads).toBe(before);              // no server read for the search
  await page.evaluate(() => { $('filter_from').value = '2026-10-01'; hqPeriodo = null; onFilterChanged(); });
  await expect.poll(() => listReads).toBe(before + 1);   // a new period reads the server
});

// ── DATA-02 / DATA-06 ────────────────────────────────────────────────────
test('DATA-02 a booking with no camp is a «No camp set» row and column, so the hero, the table and the P&L agree; DATA-06 prepaid months sit at the end of the period lists', async ({ page }) => {
  const rollup = {
    bookings: [
      { month_key: '2026-10', location: 'Portugal', slug: 'portugal', direct: true, total: 1000, net_amount: 1000, commission_amount: 0, pax: 1, n: 1 },
      { month_key: '2026-10', location: 'Unknown', slug: null, direct: true, total: 600, net_amount: 600, commission_amount: 0, pax: 2, n: 2 },
    ],
    invoices: [{ month: '2028-02', location_slug: 'sri-lanka', category_id: 'c1', personal: false, amount_eur: 100, n: 1 }],
    ledger: [],
    pnl: [
      { slug: 'portugal', month: '2026-10', rev_book: 1000, rev_ops: 0, exp_local: 0, exp_hq: 0 },
      { slug: null, month: '2026-10', rev_book: 600, rev_ops: 0, exp_local: 0, exp_hq: 0 },
      { slug: 'sri-lanka', month: '2028-02', rev_book: 0, rev_ops: 0, exp_local: 0, exp_hq: 100 },
    ],
  };
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json(rollup);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('#overviewBody td.loc-name')].some(td => /No camp set/.test(td.textContent)), null, { timeout: 15000 });
  const ov = await page.evaluate(() => ({
    row: [...document.querySelectorAll('#overviewBody tbody tr')].find(tr => /No camp set/.test(tr.textContent)),
    total: [...document.querySelectorAll('#overviewBody tfoot td')].map(td => td.textContent.trim())[1],
    options: [...document.querySelector('#ov_period').children].map(c => c.tagName === 'OPTGROUP' ? 'group:' + c.label + ':' + [...c.children].map(o => o.value).join(',') : c.value),
  }));
  expect(ov.total).toBe('€1,600.00');           // bookings column Total = Portugal 1,000 + no camp 600
  expect(ov.options[0]).toBe('__all__');
  expect(ov.options[1]).toBe('2026-10');
  expect(ov.options[ov.options.length - 1]).toBe('group:Prepaid (later months):2028-02');
  const noDrill = await page.evaluate(() => [...document.querySelectorAll('#overviewBody tbody tr')].find(tr => /No camp set/.test(tr.textContent)).getAttribute('onclick'));
  expect(noDrill).toBeNull();
  await page.evaluate(() => renderPnl());
  await page.waitForFunction(() => /No camp set/.test(document.querySelector('#pnlGrid thead')?.textContent || ''), null, { timeout: 10000 });
  const pnl = await page.evaluate(() => ({
    head: [...document.querySelectorAll('#pnlGrid thead th')].map(th => th.textContent.trim()),
    first: [...document.querySelectorAll('#pnlGrid tbody tr')][0].lastElementChild.textContent.trim(),
    options: [...document.querySelector('#pnl_period').children].map(c => c.tagName === 'OPTGROUP' ? 'group' : c.value),
  }));
  expect(pnl.head[pnl.head.length - 2]).toBe('No camp set');
  expect(pnl.first).toBe('€1,600.00');           // P&L bookings Total = the Overview's
  expect(pnl.options).toEqual(['all', '2026-10', 'group']);
  expect(errs).toEqual([]);
});

// ── HQ-15 ────────────────────────────────────────────────────────────────
test('HQ-15 «Create now» on a recurring template never adds a second line for the month without asking', async ({ page }) => {
  const posts = []; let twin = true;
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/hq_invoices') && req.method() === 'POST') { posts.push(JSON.parse(req.postData())); return json([]); }
    if (url.includes('/rest/v1/hq_invoices?select=id,invoice_date,amount,amount_eur')) return json(twin ? [{ id: 'x', invoice_date: '2026-11-01', amount: 1300, amount_eur: 1300 }] : []);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof spawnOneRecurring === 'function');
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => { REC_ROWS = [{ id: 'r1', company: 'renda escritorio portugal', paying_company: 'water-movements', location_slug: 'portugal', amount: 1300, amount_eur: 1300, currency: 'EUR', fx_rate: 1, day_of_month: 1, active: true, payment_type: 'Cash' }]; });
  await page.evaluate(() => spawnOneRecurring('r1'));
  expect(dialogs.length).toBe(1);
  expect(dialogs[0]).toMatch(/already in/);
  expect(posts).toEqual([]);
  twin = false;
  await page.evaluate(() => spawnOneRecurring('r1', { silent: true }));
  expect(posts.length).toBe(1);
  expect(posts[0].notes).toMatch(/^\[recorrente mensal/);
});

// ── SEAM-15 / HQ-16 / SEAM-12 ────────────────────────────────────────────
async function overviewWithTodo(page, todoResponse) {
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/hq_todo')) return todoResponse.status ? json(todoResponse.body, todoResponse.status) : json(todoResponse);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
  return page.evaluate(() => [...document.querySelectorAll('#overviewBody .health-chip')].map(b => b.textContent.trim()));
}
test('SEAM-15 / HQ-16 the review, duplicate and recurring chips read hq_todo (no own queries); «Clear» resets the bank filter; the PDF chip opens from the date hq_todo counts', async ({ page }) => {
  const chips = await overviewWithTodo(page, { since: '2026-09-01', review: [{ company: 'water-movements', n: 3 }, { company: 'manjar', n: 5 }], duplicates: 2, recurring_due: 1, no_pdf: [{ company: 'water-movements', n: 4 }] });
  expect(chips).toEqual(expect.arrayContaining(['3 to review', '2 duplicates', '1 recurring due', '4 without PDF since Sept']));
  await page.evaluate(() => { switchTab('invoices'); $('filter_bank').value = 'none'; goToInvoicesFilter('nopdf'); });
  expect(await page.evaluate(() => [$('filter_bank').value, $('filter_from').value, $('filter_nopdf').checked])).toEqual(['__all__', '2026-09-01', true]);
  // the lists behind the chips leave duplicates out, like the counts
  await page.waitForFunction(() => window.__invListCache && JSON.parse(window.__invListCache.key)[2] === '2026-09-01', null, { timeout: 10000 });   // the chip's own read has landed
  const kept = await page.evaluate(async () => {
    const base = { invoice_date: '2026-10-01', company: 'x', amount: 1, amount_eur: 1, currency: 'EUR', payment_type: 'Card', paying_company: 'water-movements', location_slug: 'portugal', needs_review: true };
    window.__invListCache = { key: JSON.stringify(['__all__', '', '2026-09-01', '', false]), rows: [{ ...base, id: 'a' }, { ...base, id: 'b', is_duplicate: true }], bankByInv: new Map() };
    const out = {};
    await renderInvoiceList({ reuse: true }); out.nopdf = window.__lastRenderedRows.map(r => r.id);
    $('filter_nopdf').checked = false; $('filter_review').checked = true;
    await renderInvoiceList({ reuse: true }); out.review = window.__lastRenderedRows.map(r => r.id);
    return out;
  });
  expect(kept).toEqual({ nopdf: ['a'], review: ['a'] });
});
test('HQ-16 when hq_todo fails the strip says so instead of going quiet', async ({ page }) => {
  const chips = await overviewWithTodo(page, { status: 500, body: { code: 'XX000', message: 'boom in hq_todo' } });
  expect(chips.some(c => /Could not load pending items: boom in hq_todo/.test(c))).toBe(true);
});

// ── HQ-21 ────────────────────────────────────────────────────────────────
test('HQ-21 «no invoice by nature» is a prefix match, exactly like hq_doc_status', async ({ page }) => {
  await openHqBare(page);
  const out = await page.evaluate(() => ['Santander (comissões)', 'CGD (comissões)', 'Transportes Santander Lda', 'Santander - transferencia devolvida'].map(c => docStatus({ company: c, payment_type: 'Card' })));
  expect(out).toEqual(['isento', 'isento', 'falta', 'isento']);
});

// ── HQ-23 / DATA-08 ──────────────────────────────────────────────────────
test('DATA-08 an archived line stops pointing at its bank debit; HQ-23 a receipt copy that fails is not shown as copied', async ({ page }) => {
  const writes = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const m = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (m === 'PATCH') {
      writes.push(url.replace(/^.*\/rest\/v1\//, '') + ' ' + req.postData());
      if (url.includes('id=eq.p2')) return json({ code: '42501', message: 'denied' }, 403);
      return json([]);
    }
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof deleteInvoice === 'function');
  page.on('dialog', d => d.accept());
  await page.evaluate(() => deleteInvoice('i9'));
  expect(writes.some(w => /^hq_invoices\?id=eq\.i9 .*deleted_at/.test(w))).toBe(true);
  expect(writes.some(w => w.startsWith('hq_bank_movements'))).toBe(false);   // the debit keeps its link: freed, the import would create a new line
  expect(writes).toContain('hq_invoices?id=in.(i9)&bank_movement_id=not.is.null {"bank_movement_id":null}');
  const shown = await page.evaluate(async () => {
    FECHO.rows = [
      { id: 'p1', invoice_date: '2026-09-01', company: 'pietro', category_name: 'Salary', amount_eur: 510, location_slug: 'surf-school', drive_link: 'https://drive.google.com/file/d/r/view', notes: '' },
      { id: 'p2', invoice_date: '2026-09-01', company: 'pietro', category_name: 'Salary', amount_eur: 120, location_slug: 'junior-camp', drive_link: null, notes: '' },
    ];
    await fechoPropagateLinks();
    return FECHO.rows.map(r => !!r.drive_link);
  });
  expect(writes.some(w => w.startsWith('hq_invoices?id=eq.p2'))).toBe(true);   // the copy was tried…
  expect(shown).toEqual([true, false]);                                          // …and refused, so it is not shown as copied
});

// ── HQ-12 ────────────────────────────────────────────────────────────────
const SHOTS = process.env.W4_SHOTS || '';
test('HQ-12 «Pack sent» says how many lines of the month came in after the tick, and asks before ticking a month that has not ended', async ({ page }) => {
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/hq_month_checks')) return json(req.method() === 'GET' ? [{ item: 'pacote', done_at: '2026-10-29T06:24:37Z', done_by: 'miguel@gotadaguasurf.com' }] : []);
    if (url.includes('/rest/v1/hq_invoices') && url.includes('created_at')) return json([
      { id: 'i1', invoice_date: '2026-10-02', company: 'prio', amount_eur: 40, category_name: 'Transport', location_slug: 'portugal', drive_link: 'https://drive.google.com/file/d/a/view', paying_company: 'water-movements', created_at: '2026-10-03T10:00:00Z' },
      { id: 'i2', invoice_date: '2026-10-30', company: 'edp', amount_eur: 107.3, category_name: 'Utilities', location_slug: 'portugal', drive_link: null, paying_company: 'water-movements', created_at: '2026-11-02T10:00:00Z' },
      { id: 'i3', invoice_date: '2026-10-31', company: 'meo', amount_eur: 42.78, category_name: 'Utilities', location_slug: 'portugal', drive_link: null, paying_company: 'water-movements', created_at: '2026-11-03T10:00:00Z' },
    ]);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderFecho === 'function' && document.querySelector('[data-tab="fecho"]'));
  await page.evaluate(() => switchTab('fecho'));
  await page.selectOption('#fecho_mes', '2026-10');
  await page.waitForFunction(() => /added since/.test(document.querySelector('#fecho_kpis')?.textContent || ''), null, { timeout: 15000 });
  const kpi = await page.evaluate(() => [...document.querySelectorAll('#fecho_kpis .kpi')].map(k => k.textContent.replace(/\s+/g, ' ').trim()).find(t => /Pack sent/.test(t)));
  expect(kpi).toBe('Pack sentYesmiguel · 29 Oct · 2 lines added since');
  if (SHOTS) {
    await page.locator('#fecho_kpis').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/hq12-pack-sent-390.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#fecho_kpis').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/hq12-pack-sent-1280.png` });
  }
  // a month that has not ended: ticking asks first, and «Cancel» leaves it unticked
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const cur = await page.evaluate(() => { FECHO.month = currentMonth(); FECHO.checks = []; return fechoToggleCheck('pacote', true).then(() => FECHO.checks.length); });
  expect(dialogs[0]).toMatch(/has not ended yet/);
  expect(cur).toBe(0);
});

// ── PRT-06 / SEAM-06 / AUT-06 (My tasks) ─────────────────────────────────
test('PRT-06 / SEAM-06 / AUT-06 My tasks: the revenue report has its own card (Due with what to decide, Overdue after a day), and emailed invoices that failed show up', async ({ page }) => {
  const MyTasks = require('../hq/my-tasks.js');
  const now = Date.parse('2026-11-18T20:00:00Z');
  const st = (r) => MyTasks.status(r, '2026-11-18', now);
  expect(st({ kind: 'daily', last_run_at: '2026-11-18T08:15:00Z' })).toEqual({ code: 'auto', why: '' });
  expect(st({ kind: 'daily', last_run_at: '2026-11-18T08:15:00Z', warning: 'Location not recognised: Surf Camp Ahamgama' })).toEqual({ code: 'due', why: 'Location not recognised: Surf Camp Ahamgama' });
  expect(st({ kind: 'daily', last_run_at: '2026-11-17T08:15:00Z' }).code).toBe('overdue');    // 36 h: no report today
  expect(st({ kind: 'daily', last_run_at: '2026-11-18T08:15:00Z', error: 'refused' }).code).toBe('overdue');
  expect(st({ kind: 'run', last_run_at: '2026-11-18T19:15:00Z', warning: 'x' }).code).toBe('due');
  expect(st({ kind: 'check', error: '1 emailed invoice failed to import: a.pdf (22 Oct)' }).code).toBe('due');
  expect(st({ kind: 'check' }).code).toBe('auto');
  // before audit-w4-hq.sql runs these rows simply do not exist; after, they render like the others
  const sources = [
    { key: 'santander', block: 'water-movements', kind: 'bank2', last_date: '2026-11-17', loaded_at: '2026-11-17T16:08:56Z' },
    { key: 'mail_items', block: 'water-movements', kind: 'check', error: '1 emailed invoice failed to import: Invoice-0009.pdf (22 Oct)' },
    { key: 'bl_reports', block: 'water-movements', kind: 'run', last_run_at: new Date(Date.now() - 20 * 60000).toISOString() },
    { key: 'bl_revenue', block: 'water-movements', kind: 'daily', last_run_at: new Date(Date.now() - 3 * 3600000).toISOString(), warning: 'Location not recognised: Surf Camp Ahamgama · 5 commission differences' },
  ];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const single = /vnd\.pgrst\.object/.test(route.request().headers()['accept'] || '');
    if (url.includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) { const o = { id: '00000000-0000-4000-8000-000000000001', email: 'miguel@gotadaguasurf.com', full_name: 'Test', platform_role: 'super_admin' }; return json(single ? o : [o]); }
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/hq_my_tasks')) return json({ generated_at: new Date().toISOString(), today: MyTasks.localToday(), sources });
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof renderMyTasks === 'function' && document.querySelector('#tab-tasks'));
  await page.evaluate(() => switchTab('tasks'));
  await page.waitForFunction(() => document.querySelector('.mt-row[data-key="bl_revenue"]'), null, { timeout: 15000 });
  const rev = page.locator('.mt-row[data-key="bl_revenue"]');
  await expect(rev.locator('.badge')).toHaveText('Due');
  await expect(rev).toContainText('Bookinglayer revenue report');
  await expect(rev).toContainText('Location not recognised: Surf Camp Ahamgama · 5 commission differences');
  const mail = page.locator('.mt-row[data-key="mail_items"]');
  await expect(mail.locator('.badge')).toHaveText('Due');
  await expect(mail).toContainText('Invoice-0009.pdf');
  await expect(page.locator('.mt-row[data-key="bl_reports"] .badge')).toHaveText('Automatic');
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/my-tasks-w4-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: `${SHOTS}/my-tasks-w4-1280.png`, fullPage: true });
  }
});

// ── HQ-08 follow-up / HQ-05 follow-up ────────────────────────────────────
test('HQ-08 an inline edit updates the rows kept for filtering; HQ-05 a line saved as a duplicate never takes the bank debit', async ({ page }) => {
  const writes = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const m = req.method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/hq_invoice_categories')) return json([{ id: 'c-eq', name: 'Equipment & maintenance', sort_order: 1, is_personal: false, active: true }]);
    if (m === 'PATCH') { writes.push(url.replace(/^.*\/rest\/v1\//, '')); return json([]); }
    if (url.includes('/rest/v1/hq_invoices') && m === 'POST') return json([{ id: 'new1' }]);
    // findExistingExpense: the same invoice number is already in the app → the new line is a duplicate
    if (url.includes('/rest/v1/hq_invoices') && url.includes('invoice_number=eq.FT')) return json([{ id: 'old1', invoice_date: '2026-09-15', company: 'leroy', amount_eur: 274.19, invoice_number: 'FT 1' }]);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof quickUpdateInvoice === 'function');
  const notes = await page.evaluate(async () => {
    window.__invListCache = { key: 'k', rows: [{ id: 'a', payment_type: 'Card' }], bankByInv: new Map() };
    await quickUpdateInvoice('a', 'payment_type', 'Cash', null);
    return window.__invListCache.rows[0].payment_type;
  });
  expect(notes).toBe('Cash');
  await page.evaluate(async () => {
    window.__launchBankId = 'bk1'; window.__editingInvoiceId = null;
    $('inv_location').value = 'portugal'; $('inv_payment').value = $('inv_payment').options[1].value;
    const c = $('inv_category'); c.value = [...c.options].find(o => o.value)?.value;
    $('inv_date').value = '2026-09-15'; $('inv_company').value = 'leroy'; $('inv_amount').value = '274.19'; $('inv_number').value = 'FT 1';
    await saveInvoice();
  });
  expect(await page.evaluate(() => document.querySelector('#invToast')?.textContent || '')).toMatch(/Expense saved/);
  expect(writes.filter(w => w.startsWith('hq_bank_movements'))).toEqual([]);
});

test('review of wave 4: a debit that was not updated is said, an existing line paid by another debit is not given a second one, a restored line gets its bank link back', async ({ page }) => {
  const writes = [];
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = decodeURIComponent(req.url()); const m = req.method();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (m === 'PATCH') { writes.push(url.replace(/^.*\/rest\/v1\//, '') + ' ' + req.postData()); return json([]); }   // 0 rows updated
    if (url.includes('/rest/v1/hq_bank_movements') && url.includes('hq_invoice_id=eq.line1')) return json([{ id: 'bkOther' }]);
    if (url.includes('/rest/v1/hq_invoice_audit') && m === 'GET') return json([{ snapshot: { id: 'r1', bank_movement_id: 'mvLot' } }]);
    return json([]);
  });
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof linkLaunchedDebit === 'function');
  // 0 rows updated (debit already taken, or refused): reported, and the other parts are not pointed at it
  const r1 = await page.evaluate(async () => { window.__launchBankId = 'bk1'; const e = await linkLaunchedDebit(['n1', 'n2']); return e && e.message; });
  expect(r1).toMatch(/already linked/);
  expect(writes.filter(w => w.startsWith('hq_invoices'))).toEqual([]);
  // attach path: the existing line is already paid by another debit → no write at all
  writes.length = 0;
  const r2 = await page.evaluate(async () => { window.__launchBankId = 'bk2'; const e = await linkLaunchedDebit(['line1'], { existing: true }); return e && e.message; });
  expect(r2).toMatch(/another bank debit/);
  expect(writes).toEqual([]);
  // restore: the bank link the archive let go of comes back from the snapshot
  writes.length = 0;
  await page.evaluate(() => restoreInvoice('r1'));
  expect(writes).toContain('hq_invoices?id=eq.r1&bank_movement_id=is.null {"bank_movement_id":"mvLot"}');
});

// ── screenshots of the visible changes (only with W4_SHOTS=<folder>) ─────
test('w4 screenshots: «No camp set», Month close reasons, the pending-items error, the accountant page line', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only on demand');
  const rollup = {
    bookings: [{ month_key: '2026-11', location: 'Portugal', slug: 'portugal', direct: true, total: 1000, net_amount: 1000, n: 1 },
               { month_key: '2026-11', location: 'Unknown', slug: null, direct: true, total: 11604.87, net_amount: 11604.87, n: 16 }],
    invoices: [], ledger: [],
    pnl: [{ slug: 'portugal', month: '2026-11', rev_book: 1000, rev_ops: 0, exp_local: 0, exp_hq: 0 }, { slug: null, month: '2026-11', rev_book: 11604.87, rev_ops: 0, exp_local: 0, exp_hq: 0 }],
  };
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json(rollup);
    if (url.includes('/rest/v1/rpc/hq_todo')) return json({ code: 'XX000', message: 'statement timeout' }, 500);
    if (url.includes('/rest/v1/rpc/accountant_portal')) return json({ label: 'Teste', generated_at: '2026-11-18T20:00:00Z', extrato_ate: '2026-11-17', folders: {}, months: [{ month_key: '2026-10', linhas: 220, com_doc: 190, isentas: 5, em_falta: 25, total_eur: 50000, falta_eur: 8298.58 }] });
    if (url.includes('/rest/v1/hq_bank_movements')) return json([
      { id: 'b1', bank: 'santander', movement_date: '2026-09-28', description: 'TRF PRESTACAO EMPRESTIMO', amount: -703.13, currency: 'EUR', kind: 'expense', notes: '[financiamento — linha COVID]' },
      { id: 'b2', bank: 'santander', movement_date: '2026-09-10', description: 'LOTE TRF CRED SEPA+ pag mes agosto', amount: -230.12, currency: 'EUR', kind: 'expense', notes: null },
      { id: 'b3', bank: 'santander', movement_date: '2026-09-15', description: 'COMPRA LEROY MERLIN', amount: -74.19, currency: 'EUR', kind: 'expense', notes: null },
    ]);
    return json([]);
  });
  const both = async (name, locator) => {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      if (locator) await page.locator(locator).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/${name}-${w}.png` });
    }
  };
  await fakeOwnerSession(page);
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /No camp set/.test(document.querySelector('#overviewBody')?.textContent || ''), null, { timeout: 15000 });
  await both('overview-chip-error', '.health-strip');
  await both('overview-no-camp-set', 'tr:has-text("No camp set")');
  await page.evaluate(() => { document.querySelector('#pnlGrid')?.closest('details')?.setAttribute('open', ''); return renderPnl(); });
  await page.waitForFunction(() => /No camp set/.test(document.querySelector('#pnlGrid')?.textContent || ''), null, { timeout: 10000 });
  await both('pnl-no-camp-set', '#pnlGrid');
  await page.evaluate(() => switchTab('fecho'));
  await page.selectOption('#fecho_mes', '2026-09');
  await page.waitForFunction(() => [...document.querySelectorAll('#fechoBanks .hq-pill')].some(x => /Santander/.test(x.textContent)), null, { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('#fechoBanks .hq-pill')].find(x => /Santander/.test(x.textContent)).click());
  await page.waitForFunction(() => /Financing \(see note\)/.test(document.querySelector('#fechoBanks')?.textContent || ''), null, { timeout: 15000 });
  await both('month-close-reasons', '#fechoBanks');
  await page.goto('/contabilista/?k=test', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /extratos do banco até/.test(document.body.textContent), null, { timeout: 15000 });
  await both('contabilista-header', null);
});
