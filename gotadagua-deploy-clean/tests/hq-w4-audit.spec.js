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
