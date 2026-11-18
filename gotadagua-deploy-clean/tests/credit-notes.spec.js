// Credit notes as a real line type (18 Nov 2026 — lib/credit-notes.js, supabase/credit-notes.sql).
// A supplier credit note can never be lost or mistaken again:
//   · the shared expense form has a «Credit note» switch (amount stored negative, «Cancels which invoice?»);
//   · HQ Expenses, Month close and /suk/ show «NC», and the cancelled invoice «credited −X → net Y»;
//   · the accountant Excel has «Tipo» and «Anula doc.»;
//   · mail-ingest queues an emailed credit note for a person instead of skipping it, and never books it itself;
//   · on /suk/ the refund of a credit note is not sales.
// Hermetic: every Supabase call is stubbed, all names and amounts are invented.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { fakeOwnerSession } = require('./helpers');
const CreditNotes = require('../lib/credit-notes.js');

const SHOTS = process.env.CN_SHOTS || '';   // folder for the 390 / 1280 screenshots (optional)
const shot = async (page, name, fullPage = false) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage }); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// last month, so the Month close (which opens on the previous month) shows the fixture whatever today is
const NOW = new Date();
const PREV = new Date(Date.UTC(NOW.getFullYear(), NOW.getMonth() - 1, 1));
const YM = `${PREV.getUTCFullYear()}-${String(PREV.getUTCMonth() + 1).padStart(2, '0')}`;
const D = (day) => `${YM}-${String(day).padStart(2, '0')}`;

const ID = { inv: '11111111-1111-4111-8111-111111111111', cn: '22222222-2222-4222-8222-222222222222', other: '33333333-3333-4333-8333-333333333333',
  debit: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', refund: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tpa: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const CATS = [{ id: 'cat-eq', name: 'Equipment & maintenance', slug: 'equipment', area: 'general', sort_order: 1, is_personal: false, is_active: true, active: true },
  { id: 'cat-food', name: 'Food', slug: 'food', area: 'general', sort_order: 2, is_personal: false, is_active: true, active: true }];

// One purchase, the credit note that cancels it, and an unrelated expense — for Water (HQ) or Manjar (The Suk)
function lines(company) {
  const base = { location_slug: company === 'manjar' ? 'the-suk' : 'general', paying_company: company, currency: 'EUR', fx_rate: 1, payment_type: 'Card',
    category_id: 'cat-eq', category_name: 'Equipment & maintenance', file_url: null, file_name: null, file_mime: null, needs_review: false, is_duplicate: false,
    notes: '', supplier_nif: '599000001', doc_exempt_reason: null, bank_movement_id: null, commission_in_booking: null, deleted_at: null, deleted_by: null };
  return [
    { ...base, id: ID.inv, invoice_date: D(8), company: 'loja azul', description: 'Oven', amount: 320.4, amount_eur: 320.4, invoice_number: 'FT 2026/881', drive_link: 'https://drive.google.com/file/d/inv881/view' },
    { ...base, id: ID.cn, invoice_date: D(15), company: 'loja azul', description: 'Oven returned', amount: -320.4, amount_eur: -320.4, invoice_number: 'NC 2026/77', drive_link: 'https://drive.google.com/file/d/nc77/view' },
    { ...base, id: ID.other, invoice_date: D(20), company: 'forno verde', description: 'Bread', amount: 45, amount_eur: 45, invoice_number: 'FT 9/12', drive_link: null, category_id: 'cat-food', category_name: 'Food', supplier_nif: '599000002' },
  ];
}
const CN_ROWS = [{ id: ID.cn, doc_type: 'credit_note', credits_invoice_id: ID.inv, amount_eur: -320.4, invoice_number: 'NC 2026/77', invoice_date: D(15), company: 'loja azul' }];
function bank(company) {
  const b = { paying_company: company, bank: company === 'manjar' ? 'bcp' : 'santander', currency: 'EUR', internal_transfer_id: null, notes: null, sales_invoice_ref: null, sales_invoice_link: null, value_date: null, balance: 1000 };
  return [
    { ...b, id: ID.debit, movement_date: D(8), description: 'COMPRA LOJA AZUL', amount: -320.4, kind: 'expense', hq_invoice_id: ID.inv },
    { ...b, id: ID.refund, movement_date: D(17), description: 'DEVOLUCAO LOJA AZUL', amount: 320.4, kind: 'income', hq_invoice_id: ID.cn },
    { ...b, id: ID.tpa, movement_date: D(18), description: 'TPA 1234 UNICRE', amount: 900, kind: 'income', hq_invoice_id: null },
  ];
}

// sqlMissing: the database as it is BEFORE supabase/credit-notes.sql — any request that names the new columns fails
async function stub(page, { company = 'water-movements', sqlMissing = false, mail = [] } = {}) {
  const seen = { patch: null, post: null, decide: null, docTypeRequests: 0, rpc: [] };
  const rows = lines(company);
  await page.route(/supabase\.co\/functions\/v1\/mail-ingest/, async route => {
    seen.decide = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'inserted', reason: 'nota de crédito lançada a negativo' }) });
  });
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(), url = decodeURIComponent(req.url()), method = req.method();
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (obj) => json(single ? obj : (obj ? [obj] : []));
    const body = req.postData() || '';
    if (/doc_type|credits_invoice_id/.test(url + body)) {
      seen.docTypeRequests++;
      if (sqlMissing) return json({ code: '42703', details: null, hint: null, message: 'column hq_invoices.doc_type does not exist' }, 400);
    }
    if (url.includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001', email: 'miguel@gotadaguasurf.com', aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return one({ id: '00000000-0000-4000-8000-000000000001', email: 'miguel@gotadaguasurf.com', full_name: 'Test', platform_role: 'super_admin' });
    if (url.includes('/rest/v1/workspace_memberships')) return one({ workspace_id: 'w-hq', can_view: true, can_edit: true, active: true, workspaces: { slug: 'hq' } });
    if (url.includes('/rest/v1/locations')) return url.includes('slug=eq.the-suk') ? one({ id: 'suk-0', slug: 'the-suk', name: 'The Suk' }) : json([{ id: 'suk-0', slug: 'the-suk', name: 'The Suk', currency: 'EUR' }]);
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/hq_bank_unmatched')) return json([]);
    if (url.includes('/rest/v1/rpc/')) { seen.rpc.push(url.split('/rpc/')[1].split('?')[0]); return json(url.includes('hq_credit_notes_to_bank') ? 1 : {}); }
    if (url.includes('/rest/v1/hq_invoice_categories')) return json(CATS);
    if (url.includes('/rest/v1/mail_ingest_items')) return json(mail);
    if (url.includes('/rest/v1/hq_bank_movements')) return json(method === 'GET' ? bank(company) : []);
    if (url.includes('/rest/v1/hq_invoices')) {
      if (method === 'PATCH') { seen.patch = JSON.parse(body || '{}'); return json([]); }
      if (method === 'POST') { seen.post = JSON.parse(body || '{}'); return single ? json({ id: 'new-line' }) : json([{ id: 'new-line' }], 201); }
      if (url.includes('doc_type=eq.credit_note')) return json(CN_ROWS);
      if (url.includes('amount_eur=gt.0')) return json(rows.filter(r => r.amount_eur > 0));   // the picker's lookup
      const byId = url.match(/[?&]id=eq\.([0-9a-f-]{36})/);
      if (byId) return one(rows.find(r => r.id === byId[1]) || null);
      if (/[?&]id=in\./.test(url)) return json(rows.filter(r => url.includes(r.id)));
      if (company === 'manjar' && url.includes('paying_company=eq.water-movements')) return json([]);   // Water's lines «manjar» (Bank tab)
      return json(rows);
    }
    return json([]);
  });
  return seen;
}
async function openHq(page) {
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#tab-overview') && document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
}
async function openHqExpenses(page) {
  await openHq(page);
  await page.evaluate(() => window.switchTab('invoices'));
  await page.waitForSelector('#invListBody tr.inv-r');
}

// ── the rules (lib/credit-notes.js) ─────────────────────────────────────────
test('rules: what is a credit note, its sign, and the invoice it cancels', () => {
  expect(CreditNotes.isCreditNote({ doc_type: 'credit_note' })).toBe(true);
  ['NC 2026/77', 'NCC-LS026/010433', 'NCRTP 1/5', 'ADC 2026/13', ' nc 5'].forEach(n => expect(CreditNotes.isCreditNote({ doc_type: 'invoice', invoice_number: n }), n).toBe(true));
  ['FT 2026/1', 'FR ATSIRE01FR/45', 'NCE 4', 'INC 9', '', null].forEach(n => expect(CreditNotes.isCreditNote({ doc_type: 'invoice', invoice_number: n }), String(n)).toBe(false));
  // stored negative whatever sign is typed
  expect([CreditNotes.signed(320.4, true), CreditNotes.signed(-320.4, true), CreditNotes.signed(320.4, false), CreditNotes.signed(-12, false)]).toEqual([-320.4, -320.4, 320.4, -12]);
  expect(CreditNotes.proposal({ doc_type: 'credit_note', amount: 320.4, invoice_number: 'NC 2026/77', credits_invoice_number: 'FT 2026/881' })).toMatchObject({ doc_type: 'credit_note', amount: -320.4, currency: 'EUR', cancels_number: 'FT 2026/881' });

  const rows = [
    { id: 'a', invoice_number: 'FT 2026/881', invoice_date: '2026-09-08', company: 'loja azul', amount_eur: 320.4 },
    { id: 'b', invoice_number: 'FT 2026/700', invoice_date: '2026-08-01', company: 'Loja Azul Lda', amount_eur: 80 },
    { id: 'c', invoice_number: 'X 1', invoice_date: '2026-09-08', company: 'marketplace xyz', amount_eur: 320.39 },   // same amount (1 cent), other supplier name
    { id: 'd', invoice_number: 'FT 1', invoice_date: '2026-04-01', company: 'loja azul', amount_eur: 320.4 },          // older than 120 days
    { id: 'e', invoice_number: 'FT 2', invoice_date: '2026-09-20', company: 'loja azul', amount_eur: 320.4 },          // after the credit note
    { id: 'f', invoice_number: 'NC 1', invoice_date: '2026-09-01', company: 'loja azul', amount_eur: -320.4 },         // a credit note never cancels a credit note
    { id: 'g', invoice_number: 'FT 3', invoice_date: '2026-09-02', company: 'forno verde', amount_eur: 45 },
  ];
  const c = CreditNotes.candidates(rows, { supplier: 'loja azul', amount: 320.4, date: '2026-09-15' });
  expect(c.map(x => x.row.id)).toEqual(['a', 'c', 'b']);   // same amount first (newest first), then the supplier's other invoices
  expect(CreditNotes.optionLabel(c[0], 'loja azul')).toBe('FT 2026/881 · 8 Sep · €320.40');
  expect(CreditNotes.optionLabel(c[1], 'loja azul')).toBe('X 1 · 8 Sep · €320.39 · marketplace xyz');
  // mail-ingest links by itself only when it is certain: the one named invoice, or the one of the same supplier AND amount
  expect(CreditNotes.autoPick(c)).toBe('a');
  expect(CreditNotes.autoPick(CreditNotes.candidates(rows, { supplier: 'outra loja', amount: 320.4, date: '2026-09-15' }))).toBe(null);   // amount alone is not enough
  expect(CreditNotes.autoPick(CreditNotes.candidates(rows, { supplier: 'outra loja', amount: 1, date: '2026-09-15', cancelsNumber: 'ft 2026-700' }))).toBe('b');   // the document names it
  expect(CreditNotes.autoPick(CreditNotes.candidates(rows.concat([{ ...rows[0], id: 'a2' }]), { supplier: 'loja azul', amount: 320.4, date: '2026-09-15' }))).toBe(null);   // two could match
  // what the lists show
  const st = { byId: new Map([['cn', { id: 'cn', credits_invoice_id: 'a', amount_eur: -100, invoice_number: 'NC 9', invoice_date: '2026-09-15' }]]),
    byTarget: new Map([['a', { total: -100, notes: [{ invoice_number: 'NC 9', invoice_date: '2026-09-15', amount_eur: -100 }] }]]), targets: new Map([['a', rows[0]]]) };
  expect(CreditNotes.credited(st, rows[0]).text).toBe('credited −€100.00 → net €220.40');
  expect(CreditNotes.badge(st, { id: 'cn' })).toContain('>NC<');
  expect(CreditNotes.badge(st, rows[0])).toBe('');
  expect([CreditNotes.tipoPt(st, { id: 'cn' }), CreditNotes.anulaDoc(st, { id: 'cn' }), CreditNotes.tipoPt(st, rows[0]), CreditNotes.anulaDoc(st, rows[0])]).toEqual(['Nota de crédito', 'FT 2026/881', 'Fatura', '']);
});

// ── mail-ingest: the parser's signal and the queue (route.ts against a fake database) ──
test('mail-ingest: a credit note is queued for a person with a negative proposal — never skipped, never booked, never glued to the invoice it cancels', async () => {
  globalThis.CreditNotes = CreditNotes;   // in Deno lib/credit-notes.js registers itself on self; in Node it is CommonJS
  const { normaliseCreditNote, isCreditNote } = require('../supabase/functions/_shared/invoice-parse.ts');
  const { routeByBuyer, queueCreditNote, findExisting, creditedInvoice, writeLine } = require('../supabase/functions/mail-ingest/route.ts');
  const T = { hq_invoices: [
    { id: 'line-inv', paying_company: 'manjar', deleted_at: null, invoice_date: '2026-09-08', company: 'loja azul', supplier_nif: '599000001', invoice_number: 'FT 2026/881', amount: 320.4, amount_eur: 320.4, currency: 'EUR', drive_link: 'https://drive/x', notes: '[do extrato BCP Manjar 08 Sep 2026]' },
  ] };
  class Q {
    constructor(t) { this.t = t; this.f = []; }
    select() { return this; } limit() { return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; } is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; }
    ilike(k, v) { this.f.push(r => String(r[k] || '').toLowerCase() === String(v).toLowerCase()); return this; }
    gt(k, v) { this.f.push(r => Number(r[k]) > v); return this; } gte(k, v) { this.f.push(r => String(r[k]) >= v); return this; } lte(k, v) { this.f.push(r => String(r[k]) <= v); return this; }
    then(ok) { ok({ data: (T[this.t] || []).filter(r => this.f.every(f => f(r))), error: null }); }
  }
  const db = { from: (t) => new Q(t) };

  // the reader marked a credit note as «cancelled» (the live case of 12 Nov 2026): it is a credit note, not a void document
  const asRead = { doc_type: 'credit_note', is_cancelled: true, invoice_date: '2026-09-15', company: 'loja azul', supplier_nif: '599000001', buyer_nif: '502379723', amount: -320.4, total_vat: -59.9, currency: 'EUR', invoice_number: 'NC 2026/77', credits_invoice_number: 'FT 2026/881' };
  const parsed = normaliseCreditNote({ ...asRead });
  expect(parsed).toMatchObject({ doc_type: 'credit_note', is_cancelled: false, amount: 320.4, total_vat: 59.9 });
  // a number of a credit-note series is enough, even when the reader says «invoice»
  expect(normaliseCreditNote({ doc_type: 'invoice', is_cancelled: false, invoice_number: 'NCRTP 1/5', amount: 10 }).doc_type).toBe('credit_note');
  expect(isCreditNote({ doc_type: 'invoice', invoice_number: 'FT 1' })).toBe(false);

  // routed like an invoice (by the buyer's NIF), even if an old reader still says is_cancelled
  expect(routeByBuyer(parsed)).toEqual({ company: 'manjar' });
  expect(routeByBuyer(asRead)).toEqual({ company: 'manjar' });
  expect(routeByBuyer({ doc_type: 'invoice', is_cancelled: true, buyer_nif: '502379723' }).outcome).toMatchObject({ status: 'skipped' });   // a void invoice is still skipped
  expect(routeByBuyer({ doc_type: 'statement', buyer_nif: '502379723' }).outcome).toMatchObject({ status: 'skipped' });
  expect(routeByBuyer({ ...parsed, buyer_nif: '999999990', buyer_name: 'someone else' }).outcome).toMatchObject({ status: 'review' });     // unknown buyer: the person picks the company

  // queued: status review, the company, the negative line it proposes — nothing is written
  const out = await queueCreditNote(db, parsed, 'manjar');
  expect(out).toMatchObject({ status: 'review', company: 'manjar' });
  expect(out.reason).toContain('linha proposta -320.4 EUR');
  expect(out.reason).toContain('anula FT 2026/881');
  expect(T.hq_invoices).toHaveLength(1);
  // the invoice it cancels has the same absolute amount and a «[do extrato» note: it must never be taken for the credit note's own line
  expect(await findExisting(db, parsed, 'manjar', -320.4, false)).toBe(null);
  expect((await findExisting(db, { ...parsed, invoice_number: 'FT 2026/881' }, 'manjar', 320.4, false)).id).toBe('line-inv');
  // the link is set only when certain: here the document names the invoice
  expect(await creditedInvoice(db, parsed, 'manjar')).toBe('line-inv');
  expect(await creditedInvoice(db, { ...parsed, credits_invoice_number: null, company: 'outra loja', supplier_nif: null }, 'manjar')).toBe(null);
  // already booked by hand with its PDF → not queued twice
  T.hq_invoices.push({ id: 'line-cn', paying_company: 'manjar', deleted_at: null, invoice_date: '2026-09-15', company: 'loja azul', supplier_nif: '599000001', invoice_number: 'NC 2026/77', amount: -320.4, amount_eur: -320.4, currency: 'EUR', drive_link: 'https://drive/nc', notes: '' });
  expect(await queueCreditNote(db, parsed, 'manjar')).toMatchObject({ status: 'skipped', hq_invoice_id: 'line-cn' });
  // a credit note nobody can read still reaches a person
  expect(await queueCreditNote(db, { ...parsed, invoice_date: null }, 'manjar')).toMatchObject({ status: 'review' });

  // before supabase/credit-notes.sql the two columns do not exist: the line is written without them, still negative
  const writes = [];
  const run = async (row) => { writes.push(row); return ('doc_type' in row) ? { data: null, error: { message: 'column "doc_type" of relation "hq_invoices" does not exist' } } : { data: { id: 'x' }, error: null }; };
  const res = await writeLine(run, { amount: -320.4, doc_type: 'credit_note', credits_invoice_id: 'line-inv', notes: '[nota de crédito]' });
  expect(res.error).toBe(null);
  expect(writes[1]).toEqual({ amount: -320.4, notes: '[nota de crédito]' });
});

// ── HQ ──────────────────────────────────────────────────────────────────────
test('HQ Expenses: «NC» on the credit note, «credited → net» on the invoice it cancels; Edit shows the switch on and saves it negative', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeOwnerSession(page);
  const seen = await stub(page);
  await openHqExpenses(page);
  const row = (id) => page.locator(`#invListBody tr[data-inv-id="${id}"]`);
  await expect(row(ID.cn).locator('.badge', { hasText: /^NC$/ })).toHaveCount(1);
  await expect(row(ID.inv)).toContainText('credited −€320.40 → net €0.00');
  await expect(row(ID.other).locator('.badge', { hasText: /^NC$/ })).toHaveCount(0);
  await shot(page, 'hq-expenses-1280.png', true);

  // Edit the credit note: switch on, plain amount, the cancelled invoice selected
  await page.evaluate(id => window.openEditInvoice(id), ID.cn);
  await expect(page.locator('#inv_credit_note')).toBeChecked();
  await expect(page.locator('#inv_amount')).toHaveValue('320.40');
  await expect(page.locator('#xf_cn_as')).toHaveText('Saved as−320.40');
  await expect(page.locator('#inv_credits_invoice')).toHaveValue(ID.inv);
  await expect(page.locator('#inv_credits_invoice option:checked')).toHaveText('FT 2026/881 · 8 ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][PREV.getUTCMonth()] + (PREV.getUTCFullYear() !== NOW.getFullYear() ? ' ' + PREV.getUTCFullYear() : '') + ' · €320.40');
  await shot(page, 'hq-form-credit-note-1280.png');
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.patch).not.toBeNull();
  expect(seen.patch).toMatchObject({ amount: -320.4, amount_eur: -320.4, doc_type: 'credit_note', credits_invoice_id: ID.inv });

  // Switching it off gives the minus back: a stored credit never turns into a cost by a toggle (it becomes a plain negative line)
  seen.patch = null;
  await page.evaluate(id => window.openEditInvoice(id), ID.cn);
  await expect(page.locator('#inv_amount')).toHaveValue('320.40');
  await page.locator('#inv_credit_note').uncheck();
  await expect(page.locator('#inv_amount')).toHaveValue('-320.40');
  await expect(page.locator('#xf_cn_pick')).toBeHidden();
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.patch).not.toBeNull();
  expect(seen.patch).toMatchObject({ amount: -320.4, amount_eur: -320.4, doc_type: 'invoice', credits_invoice_id: null });
  // …and on again shows it plain once more
  await page.evaluate(id => window.openEditInvoice(id), ID.cn);
  await page.locator('#inv_credit_note').uncheck();
  await page.locator('#inv_credit_note').check();
  await expect(page.locator('#inv_amount')).toHaveValue('320.40');
  await page.evaluate(() => ExpenseForm.cancel());

  // An ordinary expense is saved exactly as before: no credit-note columns in the request
  seen.patch = null;
  await page.evaluate(id => window.openEditInvoice(id), ID.other);
  await expect(page.locator('#inv_credit_note')).not.toBeChecked();
  await expect(page.locator('#xf_cn_pick')).toBeHidden();
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.patch).not.toBeNull();
  expect(seen.patch.amount).toBe(45);
  expect('doc_type' in seen.patch || 'credits_invoice_id' in seen.patch).toBe(false);
});

test('HQ form: the «Credit note» switch stores the amount negative whatever sign is typed and offers the invoices to cancel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeOwnerSession(page);
  const seen = await stub(page);
  await openHqExpenses(page);
  await page.evaluate(() => window.openAddExpense());
  await expect(page.locator('#xf_cn')).toBeVisible();
  await expect(page.locator('#xf_cn_pick')).toBeHidden();   // off: one small switch, nothing else
  await page.fill('#inv_date', D(16));
  await page.fill('#inv_company', 'loja azul');
  await page.fill('#inv_amount', '320.40');
  await page.selectOption('#inv_category', 'cat-eq');
  await page.locator('#inv_credit_note').check();
  await expect(page.locator('#xf_cn_pick')).toBeVisible();
  // same supplier, last 120 days: number · date · amount (the unrelated supplier is not offered)
  await expect(page.locator('#inv_credits_invoice option')).toHaveCount(2);
  await expect(page.locator('#inv_credits_invoice option').nth(1)).toContainText('FT 2026/881');
  await page.selectOption('#inv_credits_invoice', ID.inv);
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.post).not.toBeNull();
  expect(seen.post).toMatchObject({ amount: -320.4, amount_eur: -320.4, doc_type: 'credit_note', credits_invoice_id: ID.inv, company: 'loja azul' });
  expect(seen.rpc).toContain('hq_credit_notes_to_bank');   // it meets its refund on the statement when there is exactly one

  // typed with a minus sign and not linked: still negative, link empty
  seen.post = null;
  await page.evaluate(() => window.openAddExpense());
  await page.fill('#inv_company', 'forno verde');
  await page.fill('#inv_amount', '-12.5');
  await page.selectOption('#inv_category', 'cat-food');
  await page.locator('#inv_credit_note').check();
  await expect(page.locator('#inv_amount')).toHaveValue('12.50');
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.post).not.toBeNull();
  expect(seen.post).toMatchObject({ amount: -12.5, amount_eur: -12.5, doc_type: 'credit_note', credits_invoice_id: null });
});

test('HQ before the SQL has run: the lists load, there is no switch and no badge, and saving works as it always did', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeOwnerSession(page);
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const seen = await stub(page, { sqlMissing: true });
  await openHqExpenses(page);
  await expect(page.locator('#invListBody tr.inv-r')).toHaveCount(3);
  await expect(page.locator('#invListBody .badge', { hasText: /^NC$/ })).toHaveCount(0);
  await expect(page.locator('#invListBody')).not.toContainText('credited');
  await page.evaluate(id => window.openEditInvoice(id), ID.cn);
  await expect(page.locator('#xf_cn')).toBeHidden();
  await expect(page.locator('#inv_amount')).toHaveValue('-320.40');   // the old behaviour: the sign is typed
  const before = seen.docTypeRequests;
  await page.evaluate(() => window.saveInvoice());
  await expect.poll(() => seen.patch).not.toBeNull();
  expect(seen.patch.amount).toBe(-320.4);
  expect('doc_type' in seen.patch).toBe(false);
  // Month close too
  await page.evaluate(() => window.switchTab('fecho'));
  await expect(page.locator('#fechoBanks .card-title')).toContainText('Reconcile');
  await expect(page.locator('#fechoBanks')).not.toContainText('Could not load');
  expect(before).toBeGreaterThan(0);   // the page did ask, and took «no» for an answer
  expect(errs).toEqual([]);
});

test('HQ Month close: an emailed credit note waits in «to decide» with its negative amount and one «Add credit note» button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeOwnerSession(page);
  const mail = [
    { id: 'item-cn', account_email: 'invoices@example.com', received_at: D(15) + 'T09:00:00Z', filename: 'documento-retificativo.pdf', status: 'review', reason: 'nota de crédito NC 2026/77: linha proposta -320.4 EUR — por confirmar', company: 'manjar', gmail_link: 'https://mail.google.com/mail/#all/x', drive_link: null, hq_invoice_id: null,
      parsed: { doc_type: 'credit_note', is_cancelled: false, company: 'loja azul', buyer_name: 'Manjar Lda', amount: 320.4, currency: 'EUR', invoice_number: 'NC 2026/77', credits_invoice_number: 'FT 2026/881' } },
    { id: 'item-inv', account_email: 'invoices@example.com', received_at: D(16) + 'T09:00:00Z', filename: 'fatura.pdf', status: 'review', reason: 'comprador não identificado', company: null, gmail_link: null, drive_link: null, hq_invoice_id: null,
      parsed: { doc_type: 'invoice', company: 'forno verde', amount: 45, currency: 'EUR', invoice_number: 'FT 9/12' } },
  ];
  const seen = await stub(page, { mail });
  await openHq(page);
  await page.evaluate(() => window.switchTab('fecho'));
  const box = page.locator('#fechoMail');
  await expect(box).toContainText('2 to decide');
  const cn = box.locator('tbody tr', { hasText: 'documento-retificativo.pdf' });
  await expect(cn.locator('.badge', { hasText: /^NC$/ })).toHaveCount(1);
  await expect(cn).toContainText('−320.40 EUR');
  await expect(cn).toContainText('Credit note NC 2026/77 · cancels FT 2026/881 · for Manjar (The Suk)');
  await expect(cn.locator('button')).toHaveText([/Add credit note/, 'Ignore']);
  // an ordinary invoice keeps its three buttons
  await expect(box.locator('tbody tr', { hasText: 'fatura.pdf' }).locator('button')).toHaveText(['Water Movements', 'Manjar (The Suk)', 'Ignore']);
  // the refund of the credit note on the statement is not «Income»
  await page.evaluate(() => { FECHO.bankSel = 'santander'; fechoBanksPaint(); });
  const refund = page.locator('#fechoBanks tbody tr', { hasText: 'DEVOLUCAO LOJA AZUL' });
  await expect(refund.locator('.badge', { hasText: /^NC$/ })).toHaveCount(1);
  await expect(refund).toContainText('Credit note');
  await expect(page.locator('#fechoBanks tbody tr', { hasText: 'TPA 1234 UNICRE' })).toContainText('Income');
  await shot(page, 'hq-month-close-1280.png');
  // nothing is booked until the person confirms
  expect(seen.decide).toBeNull();
  await cn.locator('button', { hasText: 'Add credit note' }).click();
  await expect.poll(() => seen.decide).not.toBeNull();
  expect(seen.decide).toEqual({ action: 'decide', id: 'item-cn', company: 'manjar' });
});

test('accountant Excel (HQ): «Tipo» and «Anula doc.» are the last two columns of the expense sheets', async ({ page }) => {
  await fakeOwnerSession(page);
  await stub(page);
  await openHq(page);
  const out = await page.evaluate(async ({ rows, ym }) => {
    const pack = buildAccountantSheets({ period: accPeriod('month', ym), invoices: rows, transfers: [], bank: [], partnerInvoices: [], folders: [], bankUnmatched: [], creditNotes: await loadCreditNotes() });
    const sheet = (n) => pack.sheets.find(s => s.name === n);
    const tail = (s) => ({ header: s.header.slice(-2), rows: s.rows.map(r => [r[s.header.indexOf('Fornecedor')], ...r.slice(-2)]) });
    const plain = buildAccountantSheets({ period: accPeriod('month', ym), invoices: rows, transfers: [], bank: [], partnerInvoices: [], folders: [], bankUnmatched: [] });
    return { despesas: tail(sheet('Despesas')), checklist: tail(sheet('Checklist')), total: sheet('Despesas').rows.reduce((s, r) => s + r[7], 0), linkCols: sheet('Despesas').links.map(l => l.c),
      resumo: sheet('Resumo').rows.find(r => /^Notas de crédito/.test(r[0])), plainTipos: [...new Set(plain.sheets.find(s => s.name === 'Despesas').rows.map(r => r[r.length - 2]))] };
  }, { rows: lines('water-movements'), ym: YM });
  expect(out.despesas.header).toEqual(['Tipo', 'Anula doc.']);
  expect(out.despesas.rows).toEqual([['loja azul', 'Fatura', ''], ['loja azul', 'Nota de crédito', 'FT 2026/881'], ['forno verde', 'Fatura', '']]);
  expect(out.checklist.header).toEqual(['Tipo', 'Anula doc.']);
  expect(out.checklist.rows).toContainEqual(['loja azul', 'Nota de crédito', 'FT 2026/881']);
  expect(Math.round(out.total * 100) / 100).toBe(45);   // the credit note is negative: purchase + credit note = 0
  expect(out.linkCols.every(c => c === 11)).toBe(true);   // the Drive links still sit on «Documento»
  expect(out.resumo[1]).toBe(1);
  expect(out.plainTipos).toEqual(['Fatura']);   // without the credit-note data every line is a «Fatura», as before
});

// ── The Suk ─────────────────────────────────────────────────────────────────
test('The Suk: the refund of a credit note is not sales; «NC» in Expenses and Month close; the Excel has «Tipo» and «Anula doc.»', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeOwnerSession(page);
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const seen = await stub(page, { company: 'manjar' });
  await page.goto('/suk/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openInvoice === 'function' && document.querySelector('#xfModal') && document.querySelector('#ovBody .kpi'));
  const out = await page.evaluate((ids) => {
    const refund = BANK_ROWS.find(r => r.id === ids.refund), tpa = BANK_ROWS.find(r => r.id === ids.tpa);
    const pack = mcPack('all'); const check = pack.sheets.find(s => s.name === 'Checklist');
    return { refundRubric: refund.rubric, tpaRubric: tpa.rubric, salesKpi: document.querySelector('#ovBody .kpi .kpi-value').textContent.trim(),
      refundStatus: mcBankStatus(refund).label, tpaStatus: mcBankStatus(tpa).label,
      header: check.header.slice(-2), rows: check.rows.map(r => [r[1], r[6], ...r.slice(-2)]) };
  }, ID);
  expect(out.refundRubric).toBe('Reembolso de fornecedor');   // not «Outras entradas»
  expect(out.tpaRubric).toBe('Vendas TPA (cartão)');
  expect(out.salesKpi).toBe('€900.00');                        // 900 of card sales; the 320.40 refund is not sales
  expect(out.refundStatus).toBe('Credit note refund');
  expect(out.tpaStatus).toBe('Income');
  expect(out.header).toEqual(['Tipo', 'Anula doc.']);
  expect(out.rows).toEqual([['loja azul', 320.4, 'Fatura', ''], ['loja azul', -320.4, 'Nota de crédito', 'FT 2026/881'], ['forno verde', 45, 'Fatura', '']]);

  await page.evaluate(() => showPage('invoices'));
  const row = (text) => page.locator('#invBody tr.inv-r', { hasText: text });
  await expect(row('NC 2026/77').locator('.badge', { hasText: /^NC$/ })).toHaveCount(1);
  await expect(row('FT 2026/881')).toContainText('credited −€320.40 → net €0.00');
  await shot(page, 'suk-expenses-1280.png', true);

  // Edit the credit note: switch on, plain amount, and the bank picker lists the CREDIT it came back as
  await page.evaluate(id => openInvoice(id), ID.cn);
  await expect(page.locator('#inv_credit_note')).toBeChecked();
  await expect(page.locator('#inv_amount')).toHaveValue('320.40');
  await expect(page.locator('#inv_bankpick_lbl')).toContainText('refund');
  await expect(page.locator('#inv_bankpick label')).toHaveCount(1);
  await expect(page.locator('#inv_bankpick label')).toContainText('+€320.40');
  await shot(page, 'suk-form-credit-note-1280.png');
  await page.evaluate(() => saveInvoice());
  await expect.poll(() => seen.patch && seen.patch.amount).toBe(-320.4);
  // an ordinary expense still picks among the DEBITS, as before (the linked refund is not offered)
  await page.waitForFunction(() => !document.querySelector('#xfModal').classList.contains('open'));
  await page.evaluate(id => openInvoice(id), ID.other);
  await expect(page.locator('#inv_credit_note')).not.toBeChecked();
  await expect(page.locator('#inv_bankpick_lbl')).toContainText('debit');
  await expect(page.locator('#inv_bankpick')).not.toContainText('DEVOLUCAO');
  // a new line switched on, then off again, keeps the amount as typed
  await page.evaluate(() => openInvoice(null, { company: 'forno verde', amount_eur: 12.5, category_name: 'Food' }));
  await page.locator('#inv_credit_note').check();
  await page.locator('#inv_credit_note').uncheck();
  await expect(page.locator('#inv_amount')).toHaveValue('12.5');
  expect(errs).toEqual([]);
});

// ── phone ───────────────────────────────────────────────────────────────────
test('390 × 844: credit notes never make the page scroll sideways (HQ Expenses, the form, Month close, The Suk)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeOwnerSession(page);
  const mail = [{ id: 'item-cn', account_email: 'invoices@example.com', received_at: D(15) + 'T09:00:00Z', filename: 'documento-retificativo.pdf', status: 'review', reason: 'nota de crédito', company: 'manjar', gmail_link: null, drive_link: null, hq_invoice_id: null,
    parsed: { doc_type: 'credit_note', company: 'loja azul', buyer_name: 'Manjar Lda', amount: 320.4, currency: 'EUR', invoice_number: 'NC 2026/77', credits_invoice_number: 'FT 2026/881' } }];
  await stub(page, { mail });
  await openHqExpenses(page);
  await expect(page.locator('#invListBody .badge', { hasText: /^NC$/ })).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);
  await page.locator(`#invListBody tr[data-inv-id="${ID.inv}"]`).scrollIntoViewIfNeeded();
  await shot(page, 'hq-expenses-390.png', true);

  await page.evaluate(id => window.openEditInvoice(id), ID.cn);
  await expect(page.locator('#inv_credit_note')).toBeChecked();
  await expect(page.locator('#inv_credits_invoice')).toHaveValue(ID.inv);
  await page.locator('#xf_cn').scrollIntoViewIfNeeded();
  expect(await noSideScroll(page)).toBe(true);
  const fits = await page.evaluate(() => { const b = document.querySelector('#xf_cn').getBoundingClientRect(), s = document.querySelector('#inv_credits_invoice').getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth && s.right <= window.innerWidth && s.width > 200; });
  expect(fits).toBe(true);
  await shot(page, 'hq-form-credit-note-390.png');
  await page.evaluate(() => { ExpenseForm.cancel(); window.switchTab('fecho'); });
  await expect(page.locator('#fechoMail')).toContainText('Add credit note');
  expect(await noSideScroll(page)).toBe(true);
  await page.locator('#fechoMail').scrollIntoViewIfNeeded();
  await shot(page, 'hq-month-close-390.png');

  // The Suk
  await page.unroute(/supabase\.co\/(auth|rest)\/v1\/.*/);
  await stub(page, { company: 'manjar' });
  await page.goto('/suk/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openInvoice === 'function' && document.querySelector('#xfModal') && document.querySelector('#ovBody .kpi'));
  await page.evaluate(() => showPage('invoices'));
  await expect(page.locator('#invBody .badge', { hasText: /^NC$/ })).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, 'suk-expenses-390.png', true);
  await page.evaluate(id => openInvoice(id), ID.cn);
  await expect(page.locator('#inv_credit_note')).toBeChecked();
  await page.locator('#xf_cn').scrollIntoViewIfNeeded();
  expect(await noSideScroll(page)).toBe(true);
  await shot(page, 'suk-form-credit-note-390.png');
});
