// ════════════════════════════════════════════════════════════════════════════
//  SRI LANKA — what the person sees (12 Nov 2026 audit, «ui» dimension)
//
//  Labels that did not say what the number is, words that named one thing
//  two ways, a table whose Edit / Delete buttons sat off-screen on a laptop,
//  and a ledger that lagged ~1 s per key on a phone.
//  - «HQ-paid» in Utilities / Transport / Payroll / Laundry summed rows paid
//    by Bank Transfer — the CAMP's bank, not HQ. Now «Cash» / «Bank».
//  - Paid via said «HQ Paid» on some rows and «Paid by HQ» on others.
//  - «On-site revenue» said «Tours + merch + bar» but also counts transport.
//  - Transport card said «Dunes · Souk · Paradise» (Morocco) in Sri Lanka.
//  - Weekly «Cash left this week» is HQ money + sales − ALL spend (bank too).
//  - A transfer saved with no description became «Cash sent to camp», also
//    for an ATM-free «Out of cash» or a loan out of the bank.
//  - Camp Tab: «1 items», ISO «closed 2026-07-23», discount note «€1500»
//    in an LKR camp, closed guests in database order.
//
//  Hermetic like the smoke suite: Supabase is stubbed, nothing is written.
// ════════════════════════════════════════════════════════════════════════════

const { test, expect } = require('@playwright/test');
const { fakeOwnerSession } = require('./helpers');

const LOC = '83cda02b-0000-4000-8000-00000000ui00';
let n = 0;
const row = (o) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  location_id: LOC, week_id: null, qty: 1, currency: 'LKR', fx_rate: 400,
  payment_method: 'Cash', source_kind: 'manual', is_comp: false, zone_id: null,
  linked_item: null, paid_from: 'sri-lanka', attributed_location: 'sri-lanka',
  created_at: '2026-08-01T10:00:00Z', business_area: null, ...o,
  amount_eur: Number((o.amount_local / 400).toFixed(2)),
});
const ROWS = [
  row({ type: 'expense', category: 'Utilities', business_area: 'Utilities', linked_item: 'Electricity', payment_method: 'Bank Transfer', amount_local: 50000, entry_date: '2026-08-03', description: 'CEB bill' }),
  row({ type: 'expense', category: 'Utilities', business_area: 'Utilities', linked_item: 'Electricity', amount_local: 10000, entry_date: '2026-08-04', description: 'CEB top-up' }),
  row({ type: 'expense', category: 'Rent', business_area: 'General', payment_method: 'HQ Paid', amount_local: 110000, entry_date: '2026-08-05', description: 'House rent paid in Portugal' }),
  row({ type: 'expense', category: 'Services', business_area: 'General', payment_method: 'Bank Transfer', amount_local: 1200, entry_date: '2026-08-06', description: 'FEE:VISH_CORP_CHG_30072026_LONG_BANK_REFERENCE_TOKEN' }),
  row({ type: 'expense', category: '<i>Odd</i>', business_area: 'General', linked_item: '<u>li</u>', amount_local: 500, entry_date: '2026-08-07', description: 'odd category' }),
  row({ type: 'expense', category: 'Transport', business_area: 'Transport', linked_item: 'Airport', amount_local: 20000, entry_date: '2026-08-08', description: 'Airport run' }),
  row({ type: 'revenue', category: 'Transport', business_area: 'Transport', amount_local: 30000, entry_date: '2026-08-08', description: 'Transfers sold' }),
  row({ type: 'revenue', category: 'Tours', business_area: 'Tours', linked_item: 'River Safari', amount_local: 36000, entry_date: '2026-08-09', description: 'Camp Tab · A · River Safari', source_kind: 'camp_tab_per_item' }),
  row({ type: 'expense', category: 'Tours & activities', business_area: 'Tours', linked_item: 'River Safari', amount_local: 27152739.91, entry_date: '2026-08-09', description: 'Boat' }),
  row({ type: 'money_sent', category: 'Cash Float', business_area: 'General', payment_method: 'HQ Transfer', amount_local: 4000000, entry_date: '2026-08-02', description: 'Money from HQ' }),
];

async function boot(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(); const url = req.url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/v1/user')) return json({ id: 'u1', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([]);
    if (url.includes('/rest/v1/locations')) return json({ id: LOC, name: 'Sri Lanka', slug: 'sri-lanka' });
    if (url.includes('/rest/v1/ledger_entries')) return json(ROWS);
    return json([]);
  });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await fakeOwnerSession(page);
  await page.goto('/camp-hub/?location=sri-lanka', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof HUB_LEDGER_HYDRATED !== 'undefined' && HUB_LEDGER_HYDRATED === true, null, { timeout: 15000 });
  return { errs };
}

test('sl ui: ledger on a laptop keeps Edit / Delete on screen; «Paid by HQ» is one name; odd text is shown as text', async ({ page }) => {
  const { errs } = await boot(page, { width: 1440, height: 900 });
  await page.evaluate(() => showPage('expenses'));
  const out = await page.evaluate(() => {
    const w = document.querySelector('#expTable .tbl-wrap');
    const rows = [...document.querySelectorAll('#expTable tbody tr')];
    const rent = rows.find(r => /House rent/.test(r.innerText));
    const odd = rows.find(r => /odd category/.test(r.innerText));
    return {
      fits: w.scrollWidth <= w.clientWidth + 1,
      rentPaid: rent.children[4].innerText.trim(),
      payOpts: [...document.getElementById('expPayF').options].map(o => o.value + '=' + o.text),
      oddCat: odd.children[3].innerText.trim(), oddCatHtml: odd.children[3].querySelector('i') ? 'tag' : 'text',
      oddLinked: odd.children[5].innerText.trim(),
    };
  });
  expect(out.fits).toBe(true);
  expect(out.rentPaid).toBe('Paid by HQ');
  expect(out.payOpts).toContain('HQ Paid=Paid by HQ');
  expect(out.oddCat).toBe('<i>Odd</i>');
  expect(out.oddCatHtml).toBe('text');
  expect(out.oddLinked).toBe('<u>li</u>');
  // The edit modal offers the same words for the HQ-paid row
  const modalPay = await page.evaluate(() => {
    const id = S.ledger.find(x => x.paymentMethod === 'HQ Paid').id;
    openEditLedger(id);
    const sel = document.querySelector('#expOv select[id$="_pay"]');
    const txt = sel.options[sel.selectedIndex].text; closeOv('expOv'); return txt;
  });
  expect(modalPay).toBe('Paid by HQ');
  expect(errs).toEqual([]);
});

test('sl ui: on a phone each ledger row says what it is (category · description) without scrolling sideways', async ({ page }) => {
  const { errs } = await boot(page, { width: 390, height: 844 });
  await page.evaluate(() => showPage('expenses'));
  const out = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#expTable tbody tr')].find(r => /Airport run/.test(r.innerText));
    const what = tr.querySelector('.what-mob');
    const r = what && what.getBoundingClientRect();
    return { text: what && what.innerText, visible: !!r && r.width > 0 && r.right <= innerWidth };
  });
  expect(out.text).toBe('Transport · Airport run');
  expect(out.visible).toBe(true);
  expect(errs).toEqual([]);
});

test('sl ui: Overview labels say what the number is (camp / HQ, transport in revenue, no Morocco words, Drinks)', async ({ page }) => {
  const { errs } = await boot(page, { width: 1440, height: 900 });
  await page.evaluate(() => showPage('overview'));
  const txt = await page.evaluate(() => document.getElementById('page-overview').innerText);
  expect(txt).not.toMatch(/HQ-paid|Camp-paid/i);
  expect(txt).not.toMatch(/Dunes|Souk|Paradise/);
  expect(txt).toMatch(/Bar, tours, transport and merch sold at the camp/);
  // Utilities: Electricity = 50,000 by bank + 10,000 cash — all paid by the camp (the split is camp vs HQ)
  const elec = await page.evaluate(() => [...document.querySelectorAll('#page-overview .ov-chip')].find(c => /^ELECTRICITY$|^Electricity$/.test(c.firstElementChild?.innerText.trim()))?.innerText.replace(/\s+/g, ' '));
  expect(elec).toMatch(/Camp: LKR 60,000/);
  expect(elec).not.toMatch(/Paid by HQ: LKR/);
  expect(txt).toMatch(/\bDrinks\b/);
  // Tour cards: nothing pokes out of its card even with LKR 27,152,740
  const cut = await page.evaluate(() => {
    const card = document.getElementById('ovTourTotals').closest('.card');
    return [...card.querySelectorAll('div')].filter(d => d.clientWidth > 0 && d.scrollWidth > d.clientWidth + 1).length;
  });
  expect(cut).toBe(0);
  expect(errs).toEqual([]);
});

test('sl ui: Weekly P&L calls the last column «Net this week», not cash', async ({ page }) => {
  const { errs } = await boot(page, { width: 1440, height: 900 });
  await page.evaluate(() => { showPage('weekly'); wplSetView('cash'); }); // the cash-control table of the page
  const heads = await page.evaluate(() => [...document.querySelectorAll('#wplCashTable thead th')].map(th => th.innerText.trim().toLowerCase()));
  expect(heads).toContain('net this week');
  expect(heads.join('|')).not.toMatch(/cash left/);
  expect(heads).toContain('drinks sales');
  expect(errs).toEqual([]);
});

test('sl ui: a transfer saved without a description is named after its kind, never «Cash sent to camp»', async ({ page }) => {
  await boot(page, { width: 1440, height: 900 });
  const out = await page.evaluate(() => {
    const desc = {};
    for (const pm of ['HQ Transfer', 'Cash Out', 'Bank Transfer', 'Cash']) {
      document.getElementById('qe_type').value = 'transfer';
      renderQuickExpenseCategories();
      document.getElementById('qe_date').value = '2026-08-10';
      document.getElementById('qe_amount').value = '1000';
      document.getElementById('qe_pay').value = pm;
      document.getElementById('qe_desc').value = '';
      desc[pm] = buildLedgerPayload('qe', 'transfer').description;
    }
    return desc;
  });
  expect(out['HQ Transfer']).toBe('Money from HQ');
  expect(out['Cash Out']).toBe('Out of cash');
  expect(out['Bank Transfer']).toBe('Out of bank');
  expect(out['Cash']).toBe('Into cash');
  const btn = await page.locator('#expQuickBar [data-cat="Cash Float"]').getAttribute('onclick');
  expect(btn).not.toMatch(/Cash sent to camp/);
});

test('sl ui: date formatters give the same text as before (cached Intl) and weekStartSat is stable', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  const out = await page.evaluate(() => ({
    d: fmtd('2026-09-25'), empty: fmtd(''),
    same: fmtd('2026-02-01') === new Date('2026-02-01T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    added: fmtAdded('2026-11-11T08:11:00'),
    eur: euro(1234.5),
    ws: [weekStartSat('2026-11-11'), weekStartSat('2026-11-11'), weekStartSat('2026-11-07')],
  }));
  expect(out.same).toBe(true);
  expect(out.empty).toBe('—');
  expect(out.added).toBe(new Date('2026-11-11T08:11:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' 08:11');
  expect(out.eur).toBe('€1,234.50');
  expect(out.ws).toEqual(['2026-11-07', '2026-11-07', '2026-11-07']);
});

test('sl ui: Camp Tab history — «1 item», readable closed date, newest first; discount note in LKR', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  await page.evaluate(() => showPage('pos'));
  const frame = await (async () => {
    for (let i = 0; i < 60; i++) {
      const f = page.frames().find(fr => /camp-tab-inner/.test(fr.url()));
      if (f && await f.evaluate(() => typeof renderHistoryPerGuest === 'function').catch(() => false)) return f;
      await page.waitForTimeout(250);
    }
    throw new Error('camp tab frame not ready');
  })();
  const out = await frame.evaluate(() => {
    const wk = { id: 'w1', start: '2026-07-18', guests: [
      { id: 'g1', name: 'Older', closedAt: '2026-07-23T10:00:00Z', items: [{ n: 'Cider', p: 1000, c: 'Drinks', paidAt: '2026-07-23T09:00:00Z' }] },
      { id: 'g2', name: 'Newer', closedAt: '2026-10-26T10:00:00Z', items: [{ n: 'Cider', p: 1000, c: 'Drinks', paidAt: '2026-10-26T09:00:00Z' }, { n: 'Shot', p: 1000, c: 'Drinks', paidAt: '2026-10-26T09:00:00Z' }] },
    ] };
    window.currentWeek = () => wk;
    const el = document.createElement('div'); document.body.appendChild(el);
    renderHistoryPerGuest(el);
    const subs = [...el.querySelectorAll('.hw-title')].map(t => t.innerText.trim());
    const meta = [...el.querySelectorAll('.hw-sub')].map(t => t.innerText.trim());
    el.remove();
    return { subs, meta };
  });
  expect(out.subs).toEqual(['Newer', 'Older']);
  expect(out.meta[1]).toBe('1 paid item · closed 23 Jul 2026');
  // The discount modal's custom price with no note is labelled in the camp's currency
  const src = await frame.evaluate(() => openDiscountModal.toString());
  expect(src).not.toMatch(/`€\$\{price\}`/);
});

test.describe('touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('sl ui: Camp Tab delete buttons are visible and finger-sized on a phone', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showPage('pos'));
    let frame = null;
    for (let i = 0; i < 60 && !frame; i++) {
      const f = page.frames().find(fr => /camp-tab-inner/.test(fr.url()));
      if (f && await f.evaluate(() => document.readyState === 'complete').catch(() => false)) frame = f;
      else await page.waitForTimeout(250);
    }
    const out = await frame.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<div class="c-guest"><button class="c-guest-del">×</button></div><button class="ctr-del">×</button>';
      document.body.appendChild(box);
      const g = box.querySelector('.c-guest-del').getBoundingClientRect();
      const d = box.querySelector('.ctr-del').getBoundingClientRect();
      const op = getComputedStyle(box.querySelector('.c-guest-del')).opacity;
      box.remove();
      return { g: [g.width, g.height], d: [d.width, d.height], op: Number(op) };
    });
    expect(out.op).toBeGreaterThan(0);
    expect(Math.min(...out.g)).toBeGreaterThanOrEqual(32);
    expect(Math.min(...out.d)).toBeGreaterThanOrEqual(32);
  });
});

test('sl ui: Overview months read «August 2026» like the Ledger, not «2026-08»', async ({ page }) => {
  await boot(page, { width: 1440, height: 900 });
  await page.evaluate(() => showPage('overview'));
  const opts = await page.evaluate(() => [...document.getElementById('ovMonthSel').options].map(o => o.text));
  expect(opts).toContain('August 2026');
  expect(opts.join('|')).not.toMatch(/\b2026-08\b/);
});
