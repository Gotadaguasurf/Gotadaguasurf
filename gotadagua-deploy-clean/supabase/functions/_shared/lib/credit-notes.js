// Credit notes as a real line type (18 Nov 2026 — audit C1/M1: «notas de crédito são o ponto cego»).
//
// A supplier credit note is an hq_invoices line with doc_type = 'credit_note', a NEGATIVE amount and,
// when known, credits_invoice_id → the invoice it cancels (supabase/credit-notes.sql).
// This one file holds the rules every place shares:
//   · the HQ and The Suk (badge «NC», «credited −X → net Y», the picker of the expense form, the Excel columns);
//   · the mail-ingest Edge Function (through the synced copy in supabase/functions/_shared/lib/):
//     is this document a credit note, which line it proposes, which invoice it cancels;
//   · the Node tests.
// Pure functions first (no DOM, no Supabase); the two loaders at the end take the page's Supabase client.
//
// Before supabase/credit-notes.sql has run the two columns do not exist: load() answers
// { available:false } with empty maps and the pages behave exactly as before (no switch, no badge).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CreditNotes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WINDOW_DAYS = 120;          // «Cancels which invoice?» looks this far back
  const CENT = 0.011;               // two amounts are the same within one cent (120.00 vs 119.99)
  // Portuguese credit-note series: NC, NCC (a crédito), NCRTP (retificativo), ADC (acerto de conta)
  const NUMBER_RE = /^\s*(NCRTP|NCC|NC|ADC)(?![a-z])/i;
  const TYPES_PT = { invoice: 'Fatura', credit_note: 'Nota de crédito', receipt: 'Recibo' };

  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round(num(n) * 100) / 100;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normNumber = (s) => norm(s).replace(/[^a-z0-9]/g, '');
  const STOP = new Set(['sociedade', 'unipessoal', 'lda', 'ltda', 'ltd', 'limited', 'the', 'sarl', 'cia', 'unip', 'compra', 'trf', 'imed', 'sepa', 'emitida']);
  // first meaningful word of a supplier name («loja azul electrodomésticos» → «loja»)
  function supplierKey(name) {
    return norm(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).find(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) || '';
  }
  // same supplier = the first word of the typed name is the first word of the line's supplier, or appears in it
  const sameSupplier = (a, b) => { const ka = supplierKey(a); return !!ka && (ka === supplierKey(b) || norm(b).includes(ka)); };

  // ── the parser's signal ────────────────────────────────────────────────
  // A document is a credit note when the reader says so or its number is of a credit-note series.
  function isCreditNoteNumber(number) { return NUMBER_RE.test(String(number || '')); }
  function isCreditNote(parsed) {
    if (!parsed) return false;
    return String(parsed.doc_type || '').toLowerCase() === 'credit_note' || isCreditNoteNumber(parsed.invoice_number);
  }
  // Whatever sign is typed or read, a credit note is stored negative.
  function signed(amount, creditNote) { const n = num(amount); return creditNote ? -Math.abs(n) : n; }
  // What mail-ingest proposes for an emailed credit note (a person confirms it; never booked by itself).
  function proposal(parsed) {
    return {
      doc_type: 'credit_note',
      amount: round2(signed(parsed && parsed.amount, true)),
      currency: String((parsed && parsed.currency) || 'EUR').toUpperCase(),
      invoice_number: (parsed && parsed.invoice_number) || null,
      company: (parsed && parsed.company) || null,
      cancels_number: (parsed && parsed.credits_invoice_number) || null,
    };
  }

  // ── which invoice does it cancel ───────────────────────────────────────
  // rows: positive lines of the same company; cn: { supplier, nif, amount, date, cancelsNumber }.
  // Kept: the invoice the document names, the same supplier's invoices, and any line of the same amount
  // (a marketplace refund comes under another supplier name), all within the 120 days before the credit note.
  // Order: named invoice, same amount, then newest first.
  function candidates(rows, cn) {
    const amt = Math.abs(num(cn && cn.amount)), date = String((cn && cn.date) || '').slice(0, 10);
    const from = date ? addDays(date, -WINDOW_DAYS) : '';
    const ref = normNumber(cn && cn.cancelsNumber), nif = String((cn && cn.nif) || '').replace(/\s/g, '');
    const out = [];
    (rows || []).forEach(r => {
      if (!r || num(r.amount_eur) <= 0 || (cn && cn.excludeId && r.id === cn.excludeId)) return;
      const d = String(r.invoice_date || '').slice(0, 10);
      if (date && (d > date || d < from)) return;
      const named = !!ref && normNumber(r.invoice_number) === ref;
      const sameAmount = amt > 0 && Math.abs(num(r.amount_eur) - amt) < CENT;
      const supplier = (!!nif && String(r.supplier_nif || '').replace(/\s/g, '') === nif) || sameSupplier((cn && cn.supplier) || '', r.company);
      if (!named && !sameAmount && !supplier) return;
      out.push({ row: r, named, sameAmount, supplier });
    });
    out.sort((a, b) => (b.named - a.named) || (b.sameAmount - a.sameAmount) || String(b.row.invoice_date).localeCompare(String(a.row.invoice_date)));
    return out;
  }
  // The link mail-ingest may set by itself: the one invoice the document names, or the one invoice of the
  // same supplier and the same amount. Anything less certain is left for the person (the form's picker).
  function autoPick(cands) {
    const named = (cands || []).filter(c => c.named);
    if (named.length === 1) return named[0].row.id;
    if (named.length > 1) return null;
    const strong = (cands || []).filter(c => c.supplier && c.sameAmount);
    return strong.length === 1 ? strong[0].row.id : null;
  }

  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number); return m ? `${d} ${MON[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}` : ''; };
  const money = (n) => (num(n) < 0 ? '−' : '') + '€' + Math.abs(num(n)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // «number · date · amount» — one option of the picker (the supplier only when it is another one)
  function optionLabel(c, supplier) {
    const r = c.row || c;
    const other = supplier && !sameSupplier(supplier, r.company);
    return [r.invoice_number || 'no number', day(r.invoice_date), money(r.amount_eur), other ? r.company : ''].filter(Boolean).join(' · ');
  }

  // ── what the lists show ────────────────────────────────────────────────
  // state = the object load() returns. A row may also carry doc_type itself (fixtures, the Edge Function).
  function is(state, row) {
    if (!row) return false;
    if (row.doc_type) return row.doc_type === 'credit_note';
    return !!(state && state.byId && state.byId.has(row.id));
  }
  function badge(state, row) {
    if (!is(state, row)) return '';
    const t = state && state.targets && state.byId && state.byId.get(row.id) ? state.targets.get(state.byId.get(row.id).credits_invoice_id) : null;
    const title = t ? `Credit note · cancels ${t.invoice_number || t.company || 'an invoice'} of ${day(t.invoice_date)}` : 'Credit note · not linked to an invoice yet';
    return `<span class="badge badge-blue" title="${esc(title)}">NC</span>`;
  }
  // the invoice a credit note cancels: «credited −€120.00 → net €0.00»
  function credited(state, row) {
    const e = state && state.byTarget && row ? state.byTarget.get(row.id) : null;
    if (!e) return null;
    const net = round2(num(row.amount_eur) + e.total);
    return { total: e.total, net, notes: e.notes, text: `credited ${money(e.total)} → net ${money(net)}`,
      title: e.notes.map(n => `${n.invoice_number || 'Credit note'} of ${day(n.invoice_date)}: ${money(n.amount_eur)}`).join(' · ') };
  }
  function creditedBadge(state, row) {
    const c = credited(state, row);
    return c ? `<span class="badge badge-blue" title="${esc(c.title)}">${esc(c.text)}</span>` : '';
  }
  // Excel (Portuguese, for the accountant): «Tipo» and «Anula doc.»
  function tipoPt(state, row) { return TYPES_PT[is(state, row) ? 'credit_note' : (row && row.doc_type) || 'invoice'] || TYPES_PT.invoice; }
  function anulaDoc(state, row) {
    if (!is(state, row)) return '';
    const cn = state && state.byId ? state.byId.get(row.id) : null;
    const t = state && state.targets ? state.targets.get((cn || row).credits_invoice_id) : null;
    return t ? (t.invoice_number || `${t.company || ''} ${t.invoice_date || ''}`.trim()) : '';
  }

  // ── loaders (browser: the page's Supabase client) ──────────────────────
  const EMPTY = () => ({ available: false, byId: new Map(), byTarget: new Map(), targets: new Map() });
  // Every credit note with the invoice it cancels. Never throws: a missing column (SQL not run yet)
  // or no access gives the empty state, and the page shows what it showed before.
  async function load(sb) {
    const st = EMPTY();
    try {
      const PAGE = 1000; let from = 0, rows = [];
      for (;;) {
        const { data, error } = await sb.from('hq_invoices').select('id, doc_type, credits_invoice_id, amount_eur, invoice_number, invoice_date, company')
          .eq('doc_type', 'credit_note').is('deleted_at', null).order('id').range(from, from + PAGE - 1);
        if (error) return st;
        rows = rows.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      st.available = true;
      rows.filter(r => r && r.doc_type === 'credit_note').forEach(r => {   // only what really is one, whatever came back
        st.byId.set(r.id, r);
        if (!r.credits_invoice_id) return;
        const e = st.byTarget.get(r.credits_invoice_id) || { total: 0, notes: [] };
        e.total = round2(e.total + num(r.amount_eur)); e.notes.push(r);
        st.byTarget.set(r.credits_invoice_id, e);
      });
      const ids = [...st.byTarget.keys()];
      for (let k = 0; k < ids.length; k += 100) {
        const { data, error } = await sb.from('hq_invoices').select('id, invoice_number, invoice_date, company, amount_eur').in('id', ids.slice(k, k + 100));
        if (error) break;
        (data || []).forEach(t => st.targets.set(t.id, t));
      }
    } catch (_e) { return st.available ? st : EMPTY(); }
    return st;
  }
  // The picker's options: positive lines of the company in the 120 days before the date, filtered by candidates().
  async function lookup(sb, { company, supplier, nif, amount, date, excludeId, cancelsNumber }) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : new Date().toISOString().slice(0, 10);
    try {
      let q = sb.from('hq_invoices').select('id, invoice_number, invoice_date, company, supplier_nif, amount_eur')
        .is('deleted_at', null).gt('amount_eur', 0).gte('invoice_date', addDays(d, -WINDOW_DAYS)).lte('invoice_date', d).order('invoice_date', { ascending: false }).limit(1000);
      q = company === 'manjar' ? q.eq('paying_company', 'manjar') : q.neq('paying_company', 'manjar');
      const { data, error } = await q;
      if (error) return [];
      return candidates(data || [], { supplier, nif, amount, date: d, excludeId, cancelsNumber }).slice(0, 40);
    } catch (_e) { return []; }
  }

  return { WINDOW_DAYS, isCreditNote, isCreditNoteNumber, signed, proposal, candidates, autoPick, supplierKey, optionLabel,
    is, badge, credited, creditedBadge, tipoPt, anulaDoc, load, lookup, money, day, EMPTY };
});
