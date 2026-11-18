// Sales documents register — read-only (18 Nov 2026).
//
// The app never creates or edits a fiscal document: invoices and credit notes
// are issued in InvoiceXpress. This file reads the billing SAF-T (PT) 1.04_01
// that InvoiceXpress exports (Contabilidade → SAF-T) so the app knows every
// sales document, and holds the month checks (numbering gaps, credit notes
// with no invoice, cancelled with no new invoice, Partners ↔ file).
//
//   Saft.decode(arrayBuffer)        bytes → text (SAF-T is Windows-1252 by law)
//   Saft.parse / parseAsync(xml)    text → { company, period, documents, payments, … }
//   Saft.monthSummary(facts, month) facts of sales_documents_month() → counts + checks
//   Saft.vendasSheet / vendasTotals register rows → the «Vendas» sheet of the accountant Excel
//
// Only parse / parseAsync need a DOMParser (browser); everything else is pure
// and runs in Node (tests). Table and functions: supabase/sales-documents.sql.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Saft = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // Whose file is accepted where (Header > TaxRegistrationNumber).
  const COMPANY_NIF = { 'water-movements': '515059927' };
  const FINAL_CONSUMER = '999999990';
  const BATCH = 500;                 // documents per sales_documents_import call
  const REISSUE_DAYS = 15;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STATUS_PT = { N: 'Normal', A: 'Anulada', F: 'Faturada', S: 'Autofaturação', R: 'Resumo' };

  // ── reading the file ─────────────────────────────────────────────────────
  function decode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes);
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 200); i++) head += String.fromCharCode(bytes[i]);
    const m = head.match(/encoding\s*=\s*["']([\w.-]+)["']/i);
    try { return new TextDecoder(m ? m[1].toLowerCase() : 'utf-8').decode(bytes); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  // The file has a default namespace, so elements are matched by local name.
  function kids(el, name) { const out = []; if (!el) return out; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c); return out; }
  function kid(el, name) { if (!el) return null; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; }
  function txt(el, ...path) { let cur = el; for (const p of path) { cur = kid(cur, p); if (!cur) return ''; } return String(cur.textContent || '').trim(); }
  function money(s) { const n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }

  // «FT IN2/17655» → { doc_type:'FT', series:'IN2', number:17655 }
  function splitDocNo(docNo) {
    const m = String(docNo || '').trim().match(/^(\S+)\s+(.+)\/(\d+)$/);
    return m ? { doc_type: m[1].toUpperCase(), series: m[2].trim(), number: parseInt(m[3], 10) } : null;
  }

  function open(xml, opts) {
    const P = (opts && opts.DOMParser) || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!P) throw new Error('No XML parser available here.');
    const dom = new P().parseFromString(String(xml || ''), 'application/xml');
    const rootEl = dom.documentElement;
    if (!rootEl || dom.getElementsByTagName('parsererror').length) throw new Error('This file is not valid XML — export the SAF-T again.');
    if (rootEl.localName !== 'AuditFile') throw new Error('This is not a SAF-T file (no AuditFile).');
    const header = kid(rootEl, 'Header');
    const customers = new Map();
    kids(kid(rootEl, 'MasterFiles'), 'Customer').forEach(c => customers.set(txt(c, 'CustomerID'), {
      name: txt(c, 'CompanyName'), tax_id: txt(c, 'CustomerTaxID'), country: txt(c, 'BillingAddress', 'Country'),
    }));
    const source = kid(rootEl, 'SourceDocuments');
    const sales = kid(source, 'SalesInvoices');
    if (!sales) throw new Error('No sales documents in this file — it must be the billing SAF-T from InvoiceXpress.');
    const pay = kid(source, 'Payments');
    return {
      customers,
      invoiceEls: kids(sales, 'Invoice'),
      info: {
        version: txt(header, 'AuditFileVersion'),
        company: { tax_id: txt(header, 'TaxRegistrationNumber'), name: txt(header, 'CompanyName') },
        period: { from: txt(header, 'StartDate'), to: txt(header, 'EndDate'), year: txt(header, 'FiscalYear') },
        declared: parseInt(txt(sales, 'NumberOfEntries'), 10) || 0,
        payments: pay ? (kids(pay, 'Payment').length || parseInt(txt(pay, 'NumberOfEntries'), 10) || 0) : 0,
        customers: customers.size,
      },
    };
  }

  // One <Invoice> → one register row (the shape of public.sales_documents).
  // The lines are not kept: only what they credit (References) and how many there are.
  function readInvoice(el, customers) {
    const docNo = txt(el, 'InvoiceNo');
    const split = splitDocNo(docNo);
    if (!split) return null;
    const custId = txt(el, 'CustomerID');
    const cust = customers.get(custId) || {};
    const totals = kid(el, 'DocumentTotals');
    const lines = kids(el, 'Line');
    const refs = []; let reason = '';
    lines.forEach(l => kids(l, 'References').forEach(r => {
      const ref = txt(r, 'Reference'); if (ref && !refs.includes(ref)) refs.push(ref);
      if (!reason) reason = txt(r, 'Reason');
    }));
    const raw = { lines: lines.length };
    const put = (k, v) => { if (v) raw[k] = v; };
    put('atcud', txt(el, 'ATCUD')); put('period', txt(el, 'Period')); put('entry_date', txt(el, 'SystemEntryDate'));
    put('status_date', txt(el, 'DocumentStatus', 'InvoiceStatusDate')); put('status_reason', txt(el, 'DocumentStatus', 'Reason'));
    put('source_billing', txt(el, 'DocumentStatus', 'SourceBilling'));
    put('currency', txt(totals, 'Currency', 'CurrencyCode')); put('currency_amount', txt(totals, 'Currency', 'CurrencyAmount'));
    if (refs.length) raw.references = refs;
    put('reason', reason);
    return {
      doc_no: `${split.doc_type} ${split.series}/${split.number}`,
      doc_type: (txt(el, 'InvoiceType') || split.doc_type).toUpperCase(), series: split.series, number: split.number,
      doc_date: txt(el, 'InvoiceDate'),
      customer_id: custId || null, customer_name: cust.name || null, customer_tax_id: cust.tax_id || null, customer_country: cust.country || null,
      net: money(txt(totals, 'NetTotal')), tax: money(txt(totals, 'TaxPayable')), gross: money(txt(totals, 'GrossTotal')),
      status: (txt(el, 'DocumentStatus', 'InvoiceStatus') || 'N').toUpperCase(),
      credits_doc_no: refs[0] || null,
      raw,
    };
  }

  function finish(o, rows) {
    // a document that comes twice in one file is sent once (the last one wins)
    const byNo = new Map(); let unreadable = 0;
    rows.forEach(r => { if (r && r.doc_date) byNo.set(r.doc_no, r); else unreadable++; });
    const documents = [...byNo.values()];
    const months = {};
    documents.forEach(d => { const k = d.doc_date.slice(0, 7); months[k] = (months[k] || 0) + 1; });
    return { ...o.info, documents, months, unreadable, repeated: rows.length - unreadable - documents.length };
  }
  function parse(xml, opts) { const o = open(xml, opts); return finish(o, o.invoiceEls.map(el => readInvoice(el, o.customers))); }
  // Same result, but gives the screen a breath every `chunk` documents (files are 5–20 MB).
  async function parseAsync(xml, opts) {
    const o = open(xml, opts); const chunk = (opts && opts.chunk) || 1000; const rows = [];
    for (let i = 0; i < o.invoiceEls.length; i++) {
      rows.push(readInvoice(o.invoiceEls[i], o.customers));
      if ((i + 1) % chunk === 0) { if (opts && opts.onProgress) opts.onProgress(i + 1, o.invoiceEls.length); await new Promise(r => setTimeout(r, 0)); }
    }
    return finish(o, rows);
  }
  function batches(list, size) { const out = []; for (let i = 0; i < list.length; i += (size || BATCH)) out.push(list.slice(i, i + (size || BATCH))); return out; }

  // ── the rules ────────────────────────────────────────────────────────────
  const isCredit = (d) => d.doc_type === 'NC';
  const isLive = (d) => d.status !== 'A';
  // One spelling for a document number, so «ft in2 / 0123», «IN2/123» and «FT IN2/123» meet.
  // A number with no type is an invoice (FT). Anything else (a supplier's own numbering) → null.
  function docKey(s) {
    const m = String(s || '').toUpperCase().trim().match(/^(?:([A-Z]{2,3})\s+)?([^\s\/]+)\s*\/\s*0*(\d+)$/);
    return m ? `${m[1] || 'FT'} ${m[2]}/${m[3]}` : null;
  }
  // The same customer = the same InvoiceXpress customer record. Never the NIF alone:
  // most guests share the final-consumer NIF.
  function custKey(d) {
    if (d.customer_id) return 'id:' + d.customer_id;
    if (d.customer_tax_id && d.customer_tax_id !== FINAL_CONSUMER) return 'nif:' + d.customer_tax_id;
    return 'name:' + String(d.customer_name || '').toLowerCase().trim();
  }
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  // Missing numbers per type + series (FT IN2 and NC IN2 count apart), only between
  // documents the register holds — never from 1. A cancelled document keeps its number.
  // Each gap belongs to the month of the document that follows it.
  function numberingGaps(docs) {
    const groups = new Map();
    (docs || []).forEach(d => { const k = `${d.doc_type} ${d.series}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
    const out = [];
    [...groups.keys()].sort().forEach(k => {
      const list = groups.get(k).slice().sort((a, b) => a.number - b.number);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        if (b.number - a.number > 1) out.push({ doc_type: b.doc_type, series: b.series, from: a.number + 1, to: b.number - 1, count: b.number - a.number - 1, month: String(b.doc_date || '').slice(0, 7), next: b.doc_no });
      }
    });
    return out;
  }
  function gapLabel(g) { return g.count === 1 ? `${g.doc_type} ${g.series}/${g.from}` : `${g.doc_type} ${g.series}/${g.from}–${g.to} (${g.count} numbers)`; }

  // facts = sales_documents_month(): the month's documents plus the month before and
  // 15 days after, which credit-note references exist, the Partners invoices and the
  // customers known to be partners.
  function monthSummary(facts, month) {
    const f = (facts && !Array.isArray(facts) && typeof facts === 'object') ? facts : {};
    const docs = Array.isArray(f.docs) ? f.docs : [];
    const mine = docs.filter(d => String(d.doc_date || '').slice(0, 7) === month);
    const invoices = mine.filter(d => !isCredit(d) && isLive(d));
    const credits = mine.filter(d => isCredit(d) && isLive(d));
    const cancelled = mine.filter(d => !isLive(d));
    const gaps = numberingGaps(docs).filter(g => g.month === month);

    // credit notes whose invoice the register does not hold
    const known = new Set(docs.map(d => d.doc_no).concat(f.known_refs || []));
    const refsOf = (d) => (Array.isArray(d.refs) && d.refs.length ? d.refs : (d.credits_doc_no ? [d.credits_doc_no] : []));
    const creditNoInvoice = credits.map(d => ({ doc: d, missing: refsOf(d).filter(r => !known.has(r)), none: !refsOf(d).length })).filter(x => x.none || x.missing.length);

    // cancelled invoices with no new invoice to the same customer within 15 days —
    // judged only once the register reaches those 15 days
    const covered = String(f.covered_until || '');
    const cancelledNoReissue = cancelled.filter(d => {
      if (isCredit(d)) return false;
      const until = addDays(d.doc_date, REISSUE_DAYS);
      if (!covered || covered < until) return false;
      const who = custKey(d);
      return !docs.some(o => o.doc_no !== d.doc_no && !isCredit(o) && isLive(o) && custKey(o) === who && o.doc_date <= until &&
        (o.doc_date > d.doc_date || (o.doc_date === d.doc_date && (o.doc_type !== d.doc_type || o.series !== d.series || o.number > d.number))));
    });

    // Partners ↔ file, both ways, on the normalised number
    const partnerByKey = new Map();
    (f.partner_invoices || []).forEach(p => { const k = docKey(p.invoice_number); if (k) partnerByKey.set(k, p); });
    const fileByKey = new Map(docs.map(d => [docKey(d.doc_no), d]));
    const seriesOf = (k) => (k ? k.slice(0, k.indexOf('/')) : '');
    const seriesInFile = new Set([...fileByKey.keys()].map(seriesOf));
    const partnerCustomers = new Set(f.partner_customers || []);
    const notOnPartners = invoices.filter(d => d.customer_id && partnerCustomers.has(d.customer_id) && !partnerByKey.has(docKey(d.doc_no)));
    const notInFile = [];
    if (mine.length) partnerByKey.forEach((p, k) => {
      if (String(p.invoice_date || '').slice(0, 7) !== month) return;
      if (!seriesInFile.has(seriesOf(k))) return;        // another issuer's numbering (a partner's own invoice)
      const d = fileByKey.get(k);
      if (!d) notInFile.push({ ...p, why: 'not in the file' });
      else if (!isLive(d)) notInFile.push({ ...p, why: 'cancelled in InvoiceXpress' });
    });

    const sum = (list, k) => Math.round(list.reduce((s, d) => s + Number(d[k] || 0), 0) * 100) / 100;
    const toCheck = creditNoInvoice.length + cancelledNoReissue.length + notOnPartners.length + notInFile.length;
    const out = {
      month, empty: !mine.length, registerEmpty: !Number(f.total || 0) && !docs.length,
      invoices: invoices.length, creditNotes: credits.length, cancelled: cancelled.length,
      gross: Math.round((sum(invoices, 'gross') - sum(credits, 'gross')) * 100) / 100,
      gaps, creditNoInvoice, cancelledNoReissue, notOnPartners, notInFile, toCheck,
      lastImport: f.last_import || null, coveredUntil: covered || null,
    };
    out.line = summaryLine(out);
    return out;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function monthName(key) { const m = Number(String(key || '').slice(5, 7)); return MONTHS[m - 1] || String(key || ''); }
  // «October: 431 invoices · 6 credit notes · 0 gaps · 2 to check»
  function summaryParts(s) { return [plural(s.invoices, 'invoice', 'invoices'), plural(s.creditNotes, 'credit note', 'credit notes'), plural(s.gaps.length, 'gap', 'gaps'), `${s.toCheck} to check`]; }
  function summaryLine(s) { return `${monthName(s.month)}: ${summaryParts(s).join(' · ')}`; }

  // ── accountant Excel: the «Vendas» sheet ─────────────────────────────────
  function sortDocs(rows) {
    return (rows || []).slice().sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)) || String(a.doc_type).localeCompare(String(b.doc_type)) ||
      String(a.series).localeCompare(String(b.series)) || Number(a.number || 0) - Number(b.number || 0));
  }
  // Credit-note totals are positive in the SAF-T and a cancelled document keeps its
  // amounts, so the sheet has no column sum: the totals are worked out here.
  function vendasTotals(rows) {
    const live = (rows || []).filter(isLive);
    const inv = live.filter(d => !isCredit(d)), nc = live.filter(isCredit);
    const net = (k) => Math.round((inv.reduce((s, d) => s + Number(d[k] || 0), 0) - nc.reduce((s, d) => s + Number(d[k] || 0), 0)) * 100) / 100;
    return { invoices: inv.length, creditNotes: nc.length, cancelled: (rows || []).length - live.length, net: net('net'), tax: net('tax'), gross: net('gross') };
  }
  function vendasSheet(rows) {
    const list = sortDocs(rows);
    return {
      name: 'Vendas', kind: 'sales',
      header: ['Documento', 'Data', 'Cliente', 'NIF', 'Valor s/ IVA', 'IVA', 'Total', 'Estado', 'Credita'],
      widths: [18, 11, 38, 14, 13, 11, 13, 12, 18],
      rows: list.map(d => [d.doc_no || '', d.doc_date || '', d.customer_name || '', d.customer_tax_id || '', Number(d.net || 0), Number(d.tax || 0), Number(d.gross || 0), STATUS_PT[d.status] || d.status || '', d.credits_doc_no || '']),
      links: [], moneyCols: [4, 5, 6], statusCol: 7,
    };
  }

  return { COMPANY_NIF, FINAL_CONSUMER, BATCH, REISSUE_DAYS, STATUS_PT, decode, parse, parseAsync, batches, splitDocNo, docKey, custKey,
    numberingGaps, gapLabel, monthSummary, summaryParts, summaryLine, monthName, vendasTotals, vendasSheet };
}));
