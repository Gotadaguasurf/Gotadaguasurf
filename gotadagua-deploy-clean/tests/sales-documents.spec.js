// Sales documents register (18 Nov 2026): the app reads the InvoiceXpress SAF-T file
// and never creates a fiscal document. Parser + month rules: lib/saft.js; table and
// functions: supabase/sales-documents.sql; card: HQ → Month close.
// Hermetic: every Supabase call is stubbed; the SAF-T fixture is invented.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const Saft = require('../lib/saft.js');

const PROJECT_REF = 'wnksmcjqnbxaagyhfxlt';
const OWNER = 'miguel@gotadaguasurf.com';
const SHOTS = process.env.SALES_SHOTS || '';   // folder for the 390 / 1280 screenshots (optional)
const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'saft-sample.xml'), 'utf8');

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function fakeSession(page) {
  const id = '00000000-0000-4000-8000-000000000001';
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email: OWNER, role: 'authenticated', exp: 9_999_999_999 })}.test-signature`;
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: 9_999_999_999, refresh_token: 'test-refresh',
    user: { id, aud: 'authenticated', role: 'authenticated', email: OWNER, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' } };
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]);
}

// What sales_documents_month() answers, worked out from an in-memory register (same window as the SQL).
function factsFrom(register, month, partnerInvoices = []) {
  const [y, m] = month.split('-').map(Number);
  const iso = (d) => d.toISOString().slice(0, 10);
  const wFrom = iso(new Date(Date.UTC(y, m - 2, 1))), mFrom = `${month}-01`, mTo = iso(new Date(Date.UTC(y, m, 0))), wTo = iso(new Date(Date.UTC(y, m, 15)));
  const docs = register.filter(d => d.doc_date >= wFrom && d.doc_date <= wTo);
  const refs = new Set(docs.filter(d => d.doc_type === 'NC' && d.doc_date >= mFrom && d.doc_date <= mTo).flatMap(d => (d.raw && d.raw.references) || (d.credits_doc_no ? [d.credits_doc_no] : [])));
  const pk = new Set(partnerInvoices.map(p => String(p.invoice_number).toUpperCase().replace(/\s/g, '')));
  const last = register.slice().sort((a, b) => String(b.imported_at || '').localeCompare(String(a.imported_at || '')))[0];
  return {
    month, company: 'water-movements', total: register.length,
    covered_until: register.map(d => d.doc_date).sort().pop() || null,
    last_import: last ? { file: last.source_file, at: last.imported_at } : null,
    docs: docs.map(d => ({ doc_no: d.doc_no, doc_type: d.doc_type, series: d.series, number: d.number, doc_date: d.doc_date, status: d.status, customer_id: d.customer_id,
      customer_name: d.customer_name, customer_tax_id: d.customer_tax_id, gross: d.gross, credits_doc_no: d.credits_doc_no, refs: (d.raw && d.raw.references) || null })),
    known_refs: register.filter(d => refs.has(d.doc_no)).map(d => d.doc_no),
    partner_invoices: partnerInvoices,
    partner_customers: [...new Set(register.filter(d => d.customer_id && (pk.has(d.doc_no.toUpperCase().replace(/\s/g, '')) || (d.doc_type === 'FT' && pk.has(`${d.series}/${d.number}`.toUpperCase())))).map(d => d.customer_id))],
  };
}

// A realistic October (invented): 431 invoices, 6 credit notes, one missing number, four things to check.
function october() {
  const reg = [];
  const doc = (type, series, number, date, cust, name, gross, status = 'N', credits = null) => reg.push({ doc_no: `${type} ${series}/${number}`, doc_type: type, series, number, doc_date: date,
    customer_id: cust, customer_name: name, customer_tax_id: cust.startsWith('P-') ? '500000001' : '999999990', net: gross, tax: 0, gross, status, credits_doc_no: credits, raw: credits ? { references: [credits] } : {}, source_file: 'saft-2026-10.xml', imported_at: '2026-11-03T09:00:00Z' });
  const cancelled = new Set([17050, 17300, 17400, 17410]);
  for (let n = 17001, i = 0; n <= 17436; n++, i++) {
    if (n === 17200) continue;                                             // the gap
    const day = String(1 + Math.floor(i * 28 / 436)).padStart(2, '0');
    const partner = n === 17020 || n === 17120;
    const sameAsBefore = n === 17051 || n === 17401 || n === 17411;         // the reissue goes to the same customer
    const cust = partner ? 'P-1' : `G-${sameAsBefore ? n - 1 : n}`;
    const name = partner ? 'Blue Tribe Travel' : n === 17300 ? 'Lena Example' : `Guest ${n - 17000}`;
    doc('FT', 'IN2', n, `2026-10-${day}`, cust, name, partner ? 4820 : 589, cancelled.has(n) ? 'A' : 'N');
  }
  for (let k = 0; k < 6; k++) doc('NC', 'IN2', 370 + k, `2026-10-${String(5 + k * 4).padStart(2, '0')}`, `G-${17010 + k}`, k === 5 ? 'Marta Example' : `Guest ${10 + k}`, 120, 'N', k === 5 ? 'FT IN2/9050' : `FT IN2/${17010 + k}`);
  doc('FT', 'IN2', 17437, '2026-11-17', 'G-17437', 'Guest 437', 589);       // the register already reaches mid-November
  const partners = [
    { invoice_number: 'FT IN2/17020', partner_name: 'Blue Tribe Travel', invoice_date: '2026-10-02', amount: 4820 },
    { invoice_number: 'FT IN2/16990', partner_name: 'North Coast Tours', invoice_date: '2026-10-06', amount: 2310.5 },
    { invoice_number: 'SW 202610-004', partner_name: 'Supplier With Its Own Numbers', invoice_date: '2026-10-09', amount: 900 },
  ];
  return { reg, partners };
}

// One HQ with the register in memory: sales_documents_import fills it, sales_documents_month reads it.
async function stubHq(page, { register = [], partners = [], sql = true, calls = [] } = {}) {
  await page.route(/supabase\.co\/(auth|rest)\/v1\/.*/, async route => {
    const req = route.request(), url = req.url();
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (obj) => json(single ? obj : (obj ? [obj] : []));
    const missing = (what) => json({ code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${what} in the schema cache` }, 404);
    if (url.includes('/auth/v1/user')) return json({ id: '00000000-0000-4000-8000-000000000001', email: OWNER, aud: 'authenticated', role: 'authenticated' });
    if (url.includes('/rest/v1/platform_profiles')) return one({ id: '00000000-0000-4000-8000-000000000001', email: OWNER, full_name: 'Test', platform_role: 'super_admin' });
    if (url.includes('/rest/v1/workspace_memberships')) return one({ workspace_id: 'w-hq', can_view: true, active: true, workspaces: { slug: 'hq' } });
    if (url.includes('/rest/v1/rpc/hq_overview_rollup')) return json({ bookings: [], invoices: [], ledger: [] });
    if (url.includes('/rest/v1/rpc/sales_documents_month')) {
      if (!sql) return missing('sales_documents_month');
      return json(factsFrom(register, JSON.parse(req.postData() || '{}').p_month, partners));
    }
    if (url.includes('/rest/v1/rpc/sales_documents_import')) {
      if (!sql) return missing('sales_documents_import');
      const body = JSON.parse(req.postData() || '{}');
      calls.push({ rows: body.p_rows.length, file: body.p_file_name, first: body.p_rows[0] });
      const out = { new: 0, changed: 0, unchanged: 0 };
      body.p_rows.forEach(r => {
        const i = register.findIndex(d => d.doc_no === r.doc_no);
        const same = i >= 0 && ['doc_date', 'status', 'gross', 'net', 'tax', 'customer_id', 'credits_doc_no'].every(k => register[i][k] === r[k]);
        if (i < 0) { register.push({ ...r, source_file: body.p_file_name, imported_at: new Date().toISOString() }); out.new++; }
        else if (same) out.unchanged++;
        else { register[i] = { ...r, source_file: body.p_file_name, imported_at: new Date().toISOString() }; out.changed++; }
      });
      return json(out);
    }
    if (url.includes('/rest/v1/sales_documents')) {
      if (!sql) return json({ code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public.sales_documents' in the schema cache" }, 404);
      // PostgREST pages: .range(from, to) arrives as offset + limit
      const q = new URL(url).searchParams, off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 1000);
      const rows = register.filter(d => d.doc_date >= '2026-10-01' && d.doc_date <= '2026-10-31').sort((a, b) => a.doc_date.localeCompare(b.doc_date) || a.doc_no.localeCompare(b.doc_no));
      return json(rows.slice(off, off + lim));
    }
    if (url.includes('/rest/v1/rpc/hq_todo')) return json({});
    return json([]);
  });
}

async function openMonthClose(page) {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-18T10:00:00Z'));          // Month close opens on October 2026
  await page.goto('/hq/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#tab-overview') && document.querySelector('#overviewBody .hero-val'), null, { timeout: 15000 });
  await page.evaluate(() => switchTab('fecho'));
  await expect(page.locator('#fechoSales')).toBeVisible();
  await expect(page.locator('#sd_body')).not.toHaveText('Loading…');
  return errs;
}
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// A SAF-T with n invoices (invented), for the «big file» path.
function bigSaft(n, { nif = '515059927', company = 'Water Movements Lda' } = {}) {
  const inv = [];
  for (let i = 1; i <= n; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    inv.push(`<Invoice><InvoiceNo>FT B9/${i}</InvoiceNo><DocumentStatus><InvoiceStatus>N</InvoiceStatus></DocumentStatus><InvoiceDate>2026-10-${day}</InvoiceDate><InvoiceType>FT</InvoiceType><CustomerID>K-${i}</CustomerID><Line><LineNumber>1</LineNumber></Line><DocumentTotals><TaxPayable>0.60</TaxPayable><NetTotal>10.00</NetTotal><GrossTotal>10.60</GrossTotal></DocumentTotals></Invoice>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"><Header><AuditFileVersion>1.04_01</AuditFileVersion><TaxRegistrationNumber>${nif}</TaxRegistrationNumber><CompanyName>${company}</CompanyName><StartDate>2026-10-01</StartDate><EndDate>2026-10-31</EndDate></Header><MasterFiles></MasterFiles><SourceDocuments><SalesInvoices><NumberOfEntries>${n}</NumberOfEntries>${inv.join('')}</SalesInvoices></SourceDocuments></AuditFile>`;
}

// ── the parser (needs the browser's DOMParser) ────────────────────────────
test('saft parser: reads every invoice with its customer, status, totals and what a credit note credits', async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: path.join(__dirname, '..', 'lib', 'saft.js') });
  // the law says Windows-1252: the same file in that encoding must give the same names
  const cp1252 = [...Buffer.from(SAMPLE.replace('encoding="UTF-8"', 'encoding="windows-1252"'), 'latin1')];
  const utf8 = [...Buffer.from(SAMPLE, 'utf8')];
  const out = await page.evaluate(async ([a, b]) => {
    const one = Saft.parse(Saft.decode(new Uint8Array(a).buffer));
    const two = await Saft.parseAsync(Saft.decode(new Uint8Array(b).buffer), { chunk: 3 });
    const bad = (xml) => { try { Saft.parse(xml); return 'ok'; } catch (e) { return e.message; } };
    return { one, sameInBoth: JSON.stringify(one.documents) === JSON.stringify(two.documents),
      notXml: bad('hello'), notSaft: bad('<Invoices/>'), accounting: bad('<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"><Header/><MasterFiles/></AuditFile>') };
  }, [cp1252, utf8]);
  const p = out.one, by = Object.fromEntries(p.documents.map(d => [d.doc_no, d]));
  expect(out.sameInBoth).toBe(true);
  expect(p.company).toEqual({ tax_id: '515059927', name: 'Water Movements Lda' });
  expect(p.period).toEqual({ from: '2026-10-01', to: '2026-10-31', year: '2026' });
  expect(p.version).toBe('1.04_01');
  expect(p.documents).toHaveLength(10);
  expect(p.declared).toBe(10);
  expect(p.payments).toBe(2);                       // receipts are only counted
  expect(p.customers).toBe(3);
  expect(p.months).toEqual({ '2026-10': 10 });
  expect([...new Set(p.documents.map(d => d.series))].sort()).toEqual(['S2', 'T1']);
  expect(p.documents.some(d => d.doc_no.startsWith('PF'))).toBe(false);   // working documents are not sales documents
  expect(by['FT T1/2']).toMatchObject({ doc_type: 'FT', series: 'T1', number: 2, doc_date: '2026-10-02', customer_id: 'C-2', customer_name: 'João Açaí Example',
    customer_tax_id: '999999990', customer_country: 'PT', net: 500, tax: 30, gross: 530, status: 'N', credits_doc_no: null });
  expect(by['FT T1/3'].status).toBe('A');
  expect(by['FT T1/4']).toBeUndefined();
  expect(by['NC T1/1']).toMatchObject({ doc_type: 'NC', number: 1, credits_doc_no: 'FT T1/2', gross: 106 });
  expect(by['NC T1/1'].raw).toMatchObject({ references: ['FT T1/2'], reason: 'Devolução', lines: 1, atcud: 'TESTCODE-1', period: '10' });
  expect(by['FS S2/3'].customer_country).toBe('DE');
  expect(JSON.stringify(by['FT T1/1'].raw)).not.toContain('Surf week');   // the lines are not kept
  expect(out.notXml).toMatch(/not valid XML/);
  expect(out.notSaft).toMatch(/not a SAF-T file/);
  expect(out.accounting).toMatch(/No sales documents in this file/);

  // the fixture through the month rules: one gap, one credit note with no invoice, one cancelled with no reissue
  const s = Saft.monthSummary({ docs: p.documents.map(d => ({ ...d, refs: d.raw.references || null })), covered_until: '2026-11-20', known_refs: [], total: 10 }, '2026-10');
  expect(s.line).toBe('October: 6 invoices · 2 credit notes · 1 gap · 2 to check');
  expect(s.gaps.map(Saft.gapLabel)).toEqual(['FT T1/4']);
  expect(s.creditNoInvoice.map(x => [x.doc.doc_no, x.missing])).toEqual([['NC T1/2', ['FT OLD/9']]]);
  expect(s.cancelledNoReissue.map(d => d.doc_no)).toEqual(['FT T1/6']);    // FT T1/3 was reissued as FT T1/5 to the same customer
});

// ── the rules (pure) ──────────────────────────────────────────────────────
const D = (doc_no, doc_date, customer_id, extra = {}) => ({ doc_no, ...Saft.splitDocNo(doc_no), doc_date, customer_id, customer_name: customer_id, customer_tax_id: '999999990', gross: 100, status: 'N', credits_doc_no: null, ...extra });

test('saft rules: document numbers are normalised the same way everywhere', () => {
  expect(Saft.docKey('FT IN2/17655')).toBe('FT IN2/17655');
  expect(Saft.docKey(' ft in2 / 017655 ')).toBe('FT IN2/17655');
  expect(Saft.docKey('IN2/17655')).toBe('FT IN2/17655');            // no type = an invoice
  expect(Saft.docKey('NC IN2/45')).toBe('NC IN2/45');
  expect(Saft.docKey('SW 202610-004')).toBeNull();                   // a supplier's own numbering
  expect(Saft.docKey('17655')).toBeNull();
  expect(Saft.splitDocNo('FR 2026A/12')).toEqual({ doc_type: 'FR', series: '2026A', number: 12 });
  expect(Saft.batches(new Array(1201).fill(0)).map(b => b.length)).toEqual([500, 500, 201]);
});

test('saft rules: gaps count per type and series, never from 1, a cancelled document keeps its number', () => {
  const docs = [
    D('FT A/98', '2026-09-30', 'c1'), D('FT A/101', '2026-10-01', 'c2'),                       // 99–100 missing → belongs to October
    D('FT A/102', '2026-10-02', 'c3', { status: 'A' }), D('FT A/103', '2026-10-03', 'c4'),     // cancelled 102 is not a gap
    D('FT A/105', '2026-10-09', 'c5'),                                                          // 104 missing
    D('NC A/7', '2026-10-04', 'c2', { credits_doc_no: 'FT A/101' }), D('NC A/8', '2026-10-05', 'c2', { credits_doc_no: 'FT A/101' }),   // its own counter: no gap against FT A
    D('FR B/40', '2026-10-06', 'c6'),                                                           // starts at 40: nothing «missing» before it
    D('FT A/110', '2026-11-03', 'c7'),                                                          // 106–109 missing → November's
  ];
  const all = Saft.numberingGaps(docs);
  expect(all.map(g => [Saft.gapLabel(g), g.month])).toEqual([['FT A/99–100 (2 numbers)', '2026-10'], ['FT A/104', '2026-10'], ['FT A/106–109 (4 numbers)', '2026-11']]);
  const oct = Saft.monthSummary({ docs, covered_until: '2026-11-30' }, '2026-10');
  expect(oct.gaps).toHaveLength(2);
  expect(oct.invoices).toBe(4);            // 101, 103, 105, FR B/40 — the cancelled one is not counted
  expect(oct.creditNotes).toBe(2);
  expect(oct.cancelled).toBe(1);
  expect(Saft.monthSummary({ docs, covered_until: '2026-11-30' }, '2026-11').gaps.map(Saft.gapLabel)).toEqual(['FT A/106–109 (4 numbers)']);
});

test('saft rules: a credit note is fine when every invoice it references is in the register', () => {
  const docs = [
    D('FT A/1', '2026-10-01', 'c1'),
    D('NC A/1', '2026-10-05', 'c1', { doc_type: 'NC', credits_doc_no: 'FT A/1' }),                               // in the window
    D('NC A/2', '2026-10-06', 'c2', { doc_type: 'NC', credits_doc_no: 'FT OLD/5' }),                             // older invoice, the server says it exists
    D('NC A/3', '2026-10-07', 'c3', { doc_type: 'NC', credits_doc_no: 'FT A/1', refs: ['FT A/1', 'FT GONE/2'] }), // two references, one unknown
    D('NC A/4', '2026-10-08', 'c4', { doc_type: 'NC' }),                                                          // credits nothing
    D('NC A/5', '2026-10-09', 'c5', { doc_type: 'NC', credits_doc_no: 'FT GONE/9', status: 'A' }),                // cancelled credit note: ignored
  ];
  const s = Saft.monthSummary({ docs, known_refs: ['FT OLD/5'], covered_until: '2026-11-30' }, '2026-10');
  expect(s.creditNoInvoice.map(x => [x.doc.doc_no, x.missing, x.none])).toEqual([['NC A/3', ['FT GONE/2'], false], ['NC A/4', [], true]]);
  expect(s.creditNotes).toBe(4);
});

test('saft rules: cancelled with no new invoice — same customer record, 15 days, only once the register reaches them', () => {
  const docs = [
    D('FT A/1', '2026-10-01', 'anna', { status: 'A' }), D('FT A/2', '2026-10-01', 'anna'),      // reissued the same day
    D('FT A/3', '2026-10-02', 'ben', { status: 'A' }),  D('FT A/4', '2026-10-17', 'ben'),       // day 15: still a reissue
    D('FT A/5', '2026-10-03', 'cara', { status: 'A' }), D('FT A/6', '2026-10-19', 'cara'),      // day 16: too late
    D('FT A/7', '2026-10-04', 'dan', { status: 'A' }),  D('FT A/8', '2026-10-05', 'eve'),       // another guest with the same final-consumer NIF does not count
    D('FT A/9', '2026-10-06', 'fay'), D('FT A/10', '2026-10-06', 'fay', { status: 'A' }),       // an EARLIER invoice the same day is not a reissue
    D('FT A/11', '2026-10-07', 'gus', { status: 'A' }), D('FT A/12', '2026-10-08', 'gus', { status: 'A' }),   // «reissued» by a cancelled one: no
    D('FT A/13', '2026-10-09', 'hal', { status: 'A' }), D('NC A/1', '2026-10-09', 'hal', { doc_type: 'NC', credits_doc_no: 'FT A/13' }),   // a credit note is not a new invoice
    D('FT A/14', '2026-10-25', 'ivy', { status: 'A' }),                                          // 15 days end on 9 Nov
  ];
  const flagged = (covered) => Saft.monthSummary({ docs, covered_until: covered }, '2026-10').cancelledNoReissue.map(d => d.doc_no);
  expect(flagged('2026-11-30')).toEqual(['FT A/5', 'FT A/7', 'FT A/10', 'FT A/11', 'FT A/12', 'FT A/13', 'FT A/14']);
  expect(flagged('2026-11-08')).not.toContain('FT A/14');           // the register does not reach 9 Nov yet: not judged
  expect(flagged('2026-11-09')).toContain('FT A/14');
  expect(flagged(null)).toEqual([]);
  // with no customer record the NIF decides — unless it is the final-consumer NIF, then the name
  expect(Saft.custKey({ customer_tax_id: '500000001', customer_name: 'X' })).toBe('nif:500000001');
  expect(Saft.custKey({ customer_tax_id: '999999990', customer_name: ' Anna ' })).toBe('name:anna');
});

test('saft rules: Partners and the file are compared both ways on the normalised number', () => {
  const docs = [
    D('FT A/1', '2026-10-01', 'P-1'), D('FT A/2', '2026-10-02', 'P-1'), D('FT A/3', '2026-10-03', 'P-2', { status: 'A' }),
    D('FT A/4', '2026-10-04', 'guest'), D('FT A/5', '2026-10-05', 'P-1', { status: 'A' }), D('NC A/1', '2026-10-06', 'P-1', { doc_type: 'NC', credits_doc_no: 'FT A/1' }),
  ];
  const partner_invoices = [
    { invoice_number: 'FT A/1', partner_name: 'Blue Tribe', invoice_date: '2026-10-01', amount: 100 },    // on both sides
    { invoice_number: 'a/0003', partner_name: 'North Coast', invoice_date: '2026-10-03', amount: 100 },   // cancelled in InvoiceXpress
    { invoice_number: 'FT A/77', partner_name: 'North Coast', invoice_date: '2026-10-20', amount: 250 },  // not in the file
    { invoice_number: 'FT A/88', partner_name: 'North Coast', invoice_date: '2026-11-02', amount: 250 },  // another month: not this card's
    { invoice_number: 'FT ZZ/4', partner_name: 'Old Series', invoice_date: '2026-10-08', amount: 10 },    // a series the file does not have
    { invoice_number: 'SW 202610-004', partner_name: 'Supplier', invoice_date: '2026-10-09', amount: 900 }, // the partner's own invoice to us
  ];
  const s = Saft.monthSummary({ docs, partner_invoices, partner_customers: ['P-1', 'P-2'], covered_until: '2026-10-10' }, '2026-10');
  expect(s.notOnPartners.map(d => d.doc_no)).toEqual(['FT A/2']);          // live invoice to a partner customer; cancelled ones and credit notes are not asked for
  expect(s.notInFile.map(p => [p.invoice_number, p.why])).toEqual([['a/0003', 'cancelled in InvoiceXpress'], ['FT A/77', 'not in the file']]);
  expect(s.toCheck).toBe(3);
  expect(s.line).toBe('October: 3 invoices · 1 credit note · 0 gaps · 3 to check');
  // a month with nothing imported never lists Partners invoices as «not in the file»
  const nov = Saft.monthSummary({ docs, partner_invoices, partner_customers: ['P-1'], covered_until: '2026-10-31' }, '2026-11');
  expect(nov.empty).toBe(true);
  expect(nov.notInFile).toEqual([]);
});

test('saft rules: no facts, an empty answer or an old stub never break the card', () => {
  for (const facts of [null, undefined, [], {}, { docs: null }, 'x']) {
    const s = Saft.monthSummary(facts, '2026-10');
    expect(s.empty).toBe(true);
    expect(s.line).toBe('October: 0 invoices · 0 credit notes · 0 gaps · 0 to check');
  }
});

test('saft rules: the «Vendas» sheet lists every document; totals are invoices minus credit notes, cancelled left out', () => {
  const rows = [
    { doc_no: 'NC A/1', doc_type: 'NC', series: 'A', number: 1, doc_date: '2026-10-06', customer_name: 'Blue Tribe', customer_tax_id: '500000001', net: 100, tax: 6, gross: 106, status: 'N', credits_doc_no: 'FT A/1' },
    { doc_no: 'FT A/2', doc_type: 'FT', series: 'A', number: 2, doc_date: '2026-10-02', customer_name: 'Guest', customer_tax_id: '999999990', net: 589, tax: 35.34, gross: 624.34, status: 'A', credits_doc_no: null },
    { doc_no: 'FT A/1', doc_type: 'FT', series: 'A', number: 1, doc_date: '2026-10-01', customer_name: 'Blue Tribe', customer_tax_id: '500000001', net: 1000, tax: 60, gross: 1060, status: 'N', credits_doc_no: null },
  ];
  expect(Saft.vendasTotals(rows)).toEqual({ invoices: 1, creditNotes: 1, cancelled: 1, net: 900, tax: 54, gross: 954 });
  const sh = Saft.vendasSheet(rows);
  expect(sh.name).toBe('Vendas');
  expect(sh.header).toEqual(['Documento', 'Data', 'Cliente', 'NIF', 'Valor s/ IVA', 'IVA', 'Total', 'Estado', 'Credita']);
  expect(sh.rows).toEqual([
    ['FT A/1', '2026-10-01', 'Blue Tribe', '500000001', 1000, 60, 1060, 'Normal', ''],
    ['FT A/2', '2026-10-02', 'Guest', '999999990', 589, 35.34, 624.34, 'Anulada', ''],
    ['NC A/1', '2026-10-06', 'Blue Tribe', '500000001', 100, 6, 106, 'Normal', 'FT A/1'],
  ]);
  expect(sh.totalCol).toBeUndefined();     // a plain column sum would add credit notes and cancelled documents
  expect(sh.moneyCols).toEqual([4, 5, 6]);

  // through the Excel writer (hq/accountant-excel.js) with a stand-in for ExcelJS: money format on the three
  // amount columns, a cancelled document greys its row, no «Total» row
  const log = { cf: [], rows: [] };
  class Row { constructor(v) { this.cells = (v || []).map(x => ({ value: x })); } eachCell(a, b) { const fn = typeof a === 'function' ? a : b; this.cells.forEach((c, i) => fn(c, i + 1)); } getCell(i) { return this.cells[i - 1]; } }
  class Sheet {
    set columns(c) { this.head = new Row(c.map(x => x.header)); }
    getRow() { return this.head; }
    addRow(v) { const r = new Row(v); log.rows.push(r); return r; }
    addConditionalFormatting(x) { log.cf.push(x); }
  }
  class Workbook { addWorksheet(name) { log.name = name; return new Sheet(); } }
  require('../hq/accountant-excel.js')({ Workbook }, { sheets: [sh] });
  expect(log.name).toBe('Vendas');
  expect(log.rows).toHaveLength(3);
  expect(log.rows[0].cells.map(c => c.numFmt || '')).toEqual(['', '', '', '', '#,##0.00 €', '#,##0.00 €', '#,##0.00 €', '', '']);
  expect(log.cf[0].ref).toBe('A2:I4');
  expect(log.cf[0].rules.map(r => r.formulae[0])).toContain('$H2="Anulada"');
});

// ── Month close card ──────────────────────────────────────────────────────
test('month close: with nothing imported the card says quietly what to do', async ({ page }) => {
  await stubHq(page);
  await fakeSession(page);
  const errs = await openMonthClose(page);
  await expect(page.locator('#fechoSales .card-title')).toHaveText('Sales documents');
  await expect(page.locator('#sd_body')).toHaveText('No sales file imported for October — export the SAF-T in InvoiceXpress (Contabilidade → SAF-T) and import it here.');
  await expect(page.locator('#sd_btn')).toContainText('Import SAF-T (.xml)');
  await expect(page.locator('#fechoSales details')).toHaveCount(0);
  // still one blue button on the tab, and the card sits just above «Send to the accountant»
  expect(await page.locator('#tab-fecho .btn-p').allTextContents()).toEqual([expect.stringContaining('Download Excel')]);
  expect(await page.evaluate(() => document.querySelector('#fechoSales').nextElementSibling.id)).toBe('fechoSend');
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(errs).toEqual([]);
});

test('month close: before the SQL has run the card is quiet and the rest of the tab works', async ({ page }) => {
  const calls = [];
  await stubHq(page, { sql: false, calls });
  await fakeSession(page);
  const errs = await openMonthClose(page);
  await expect(page.locator('#sd_body')).toHaveText('Not switched on yet — run supabase/sales-documents.sql once, then import the SAF-T here.');
  await expect(page.locator('#fechoSend .btn-p')).toBeVisible();
  await expect(page.locator('#fecho_kpis .kpi')).toHaveCount(3);
  // importing anyway explains itself instead of failing silently
  await page.locator('#sd_file').setInputFiles({ name: 'saft-2026-10.xml', mimeType: 'text/xml', buffer: Buffer.from(SAMPLE, 'utf8') });
  await expect(page.locator('#sd_msg')).toHaveText('Not imported: the sales register is not switched on yet (run supabase/sales-documents.sql once).');
  // and the accountant Excel simply has no «Vendas» sheet
  const pack = await page.evaluate(async () => {
    const period = accPeriod('month', '2026-10');
    const sales = await fetchSalesDocs(period);
    const p = buildAccountantSheets({ period, invoices: [], transfers: [], bank: [], partnerInvoices: [], folders: [], bankUnmatched: [], salesDocs: sales });
    return { sales, names: p.sheets.map(s => s.name), resumo: p.sheets[0].rows.map(r => r[0]) };
  });
  expect(pack.sales).toEqual([]);
  expect(pack.names).not.toContain('Vendas');
  expect(pack.resumo.some(l => /VENDAS/.test(l))).toBe(false);
  expect(errs).toEqual([]);
});

test('month close: one line of facts, and the list only when something is wrong (390 and 1280)', async ({ page }) => {
  const { reg, partners } = october();
  await stubHq(page, { register: reg, partners });
  await fakeSession(page);
  const errs = await openMonthClose(page);
  await expect(page.locator('#sd_line')).toHaveText('October: 431 invoices · 6 credit notes · 1 gap · 4 to check');
  await expect(page.locator('#sd_line .sd-warn')).toHaveText(['1 gap', '4 to check']);
  const groups = page.locator('#fechoSales .sd-group');
  await expect(groups.locator('.sd-group-title')).toHaveText([
    '1 gap in the numbering',
    '1 credit note whose invoice is not in the register',
    '1 cancelled with no new invoice to the same customer within 15 days',
    '1 partner invoice in the file not yet on Partners',
    '1 invoice on Partners to confirm',
  ]);
  await expect(groups.nth(0)).toContainText('FT IN2/17200');
  await expect(groups.nth(1)).toContainText('NC IN2/375');
  await expect(groups.nth(1)).toContainText('credits FT IN2/9050');
  await expect(groups.nth(2)).toContainText('FT IN2/17300');
  await expect(groups.nth(2)).toContainText('Lena Example');
  await expect(groups.nth(3)).toContainText('FT IN2/17120');
  await expect(groups.nth(3)).toContainText('€4,820.00');
  await expect(groups.nth(4)).toContainText('FT IN2/16990');
  await expect(groups.nth(4)).toContainText('not in the file');
  await expect(page.locator('#fechoSales')).not.toContainText('SW 202610-004');     // a supplier's own invoice is never asked for
  // phone: nothing pushes the page sideways, with the list open
  expect(await page.evaluate(() => document.querySelector('#fechoSales details').open)).toBe(true);
  expect(await noSidewaysScroll(page)).toBe(true);
  const card = page.locator('#fechoSales');
  await card.scrollIntoViewIfNeeded();
  if (SHOTS) { await card.screenshot({ path: path.join(SHOTS, 'sales-documents-390.png') }); await page.screenshot({ path: path.join(SHOTS, 'month-close-390.png'), fullPage: true }); }
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await noSidewaysScroll(page)).toBe(true);
  if (SHOTS) { await card.screenshot({ path: path.join(SHOTS, 'sales-documents-1280.png') }); await page.screenshot({ path: path.join(SHOTS, 'month-close-1280.png'), fullPage: true }); }
  // another month with nothing imported goes back to the quiet sentence
  await page.selectOption('#fecho_mes', '2026-08');
  await expect(page.locator('#sd_body')).toContainText('No sales file imported for August');
  expect(errs).toEqual([]);
});

test('month close: a clean month is one line and nothing else', async ({ page }) => {
  const reg = october().reg.filter(d => d.doc_type === 'FT' && d.number < 17200).map(d => ({ ...d, status: 'N' }));   // 17001–17199, nothing cancelled
  await stubHq(page, { register: reg });
  await fakeSession(page);
  await openMonthClose(page);
  await expect(page.locator('#sd_line')).toHaveText(`October: ${reg.length} invoices · 0 credit notes · 0 gaps · 0 to check`);
  await expect(page.locator('#sd_line .sd-warn')).toHaveCount(0);
  await expect(page.locator('#fechoSales details')).toHaveCount(0);
  if (SHOTS) await page.locator('#fechoSales').screenshot({ path: path.join(SHOTS, 'sales-documents-clean-390.png') });
});

test('month close: importing the SAF-T saves in batches of 500, says what changed and shows the month', async ({ page }) => {
  const calls = [], register = [];
  await stubHq(page, { register, calls });
  await fakeSession(page);
  const errs = await openMonthClose(page);
  await page.locator('#sd_file').setInputFiles({ name: 'saft-2026-10.xml', mimeType: 'text/xml', buffer: Buffer.from(bigSaft(1201), 'utf8') });
  await expect(page.locator('#sd_msg')).toHaveText('saft-2026-10.xml (01 Oct – 31 Oct 2026): 1201 documents — 1201 new · 0 changed · 0 unchanged · 0 receipts in the file');
  expect(calls.map(c => c.rows)).toEqual([500, 500, 201]);
  expect(calls.every(c => c.file === 'saft-2026-10.xml')).toBe(true);
  expect(Object.keys(calls[0].first).sort()).toEqual(['credits_doc_no', 'customer_country', 'customer_id', 'customer_name', 'customer_tax_id', 'doc_date', 'doc_no', 'doc_type', 'gross', 'net', 'number', 'raw', 'series', 'status', 'tax']);
  await expect(page.locator('#sd_line')).toHaveText('October: 1201 invoices · 0 credit notes · 0 gaps · 0 to check');
  // the same file again changes nothing; the small sample then adds its own documents
  await page.locator('#sd_file').setInputFiles({ name: 'saft-2026-10.xml', mimeType: 'text/xml', buffer: Buffer.from(bigSaft(1201), 'utf8') });
  await expect(page.locator('#sd_msg')).toContainText('0 new · 0 changed · 1201 unchanged');
  await page.locator('#sd_file').setInputFiles({ name: 'sample.xml', mimeType: 'text/xml', buffer: Buffer.from(SAMPLE.replace('encoding="UTF-8"', 'encoding="windows-1252"'), 'latin1') });
  await expect(page.locator('#sd_msg')).toContainText('sample.xml (01 Oct – 31 Oct 2026): 10 documents — 10 new · 0 changed · 0 unchanged · 2 receipts in the file');
  expect(register.find(d => d.doc_no === 'FT T1/2').customer_name).toBe('João Açaí Example');
  // and the accountant Excel gets its «Vendas» sheet, with the totals in the summary
  const pack = await page.evaluate(async () => {
    const period = accPeriod('month', '2026-10');
    const data = await fetchAccountantData(period);
    const p = buildAccountantSheets({ ...data, period });
    const resumo = Object.fromEntries(p.sheets[0].rows.map(r => [r[0], r[1]]));
    return { names: p.sheets.map(s => s.name), vendas: p.sheets.find(s => s.name === 'Vendas').rows.length, stats: p.stats.vendas,
      faturas: resumo['Faturas emitidas'], nc: resumo['Notas de crédito'], anuladas: resumo['Anuladas (não contam nos totais)'], wb: typeof accExcelWorkbook };
  });
  expect(pack.names).toEqual(['Resumo', 'Checklist', 'Banco sem lançamento', 'Despesas', 'A rever', 'Transferências camps', 'Faturas a parceiros', 'Vendas', 'Extrato Santander']);
  expect(pack).toMatchObject({ vendas: 1211, stats: 1211, faturas: 1207, nc: 2, anuladas: 2, wb: 'function' });
  expect(errs).toEqual([]);
});

test('month close: a file from another company, or one that is not a SAF-T, is refused and nothing is saved', async ({ page }) => {
  const calls = [];
  await stubHq(page, { calls });
  await fakeSession(page);
  await openMonthClose(page);
  await page.locator('#sd_file').setInputFiles({ name: 'other.xml', mimeType: 'text/xml', buffer: Buffer.from(bigSaft(3, { nif: '500000009', company: 'Another Company Lda' }), 'utf8') });
  await expect(page.locator('#sd_msg')).toHaveText('Not imported: This file is from Another Company Lda (NIF 500000009). Only Water Movements (515059927) is imported here.');
  await page.locator('#sd_file').setInputFiles({ name: 'notes.xml', mimeType: 'text/xml', buffer: Buffer.from('<notes><n>hello</n></notes>', 'utf8') });
  await expect(page.locator('#sd_msg')).toHaveText('Not imported: This is not a SAF-T file (no AuditFile).');
  expect(calls).toEqual([]);
  expect(await noSidewaysScroll(page)).toBe(true);
});
