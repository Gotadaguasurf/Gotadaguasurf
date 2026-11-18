// ════════════════════════════════════════════════════════════════════════════
//  mail-ingest · route — what a parsed document is and where it goes, apart from
//  index.ts so the Node tests can run it against a fake database
//  (tests/credit-notes.spec.js), like reports.ts.
//
//    routeByBuyer     which company a document belongs to, or why it is skipped
//    findExisting     the line it already has in the app (never duplicate)
//    queueCreditNote  a credit note waits in «to decide» with the negative line it
//                     proposes — never booked by the harvester (Miguel, 30 Oct 2026),
//                     never skipped silently (audit 18 Nov 2026: 3 arrived, 3 skipped)
//    creditedInvoice  the invoice a credit note cancels, only when it is certain
//    writeLine        insert/update that survives the two credit-note columns not
//                     existing yet (before supabase/credit-notes.sql)
// ════════════════════════════════════════════════════════════════════════════
import { isCreditNote, type Parsed } from '../_shared/invoice-parse.ts'

// deno-lint-ignore no-explicit-any
type Db = any
type Row = Record<string, unknown>
// deno-lint-ignore no-explicit-any
const CreditNotes = (globalThis as any).CreditNotes   // lib/credit-notes.js, registered by invoice-parse.ts

export const WATER_NIF = '515059927', MANJAR_NIF = '502379723'
const PERSONAL_NIFS = new Set(['268990719', '231351224'])

export interface Outcome { status: 'inserted' | 'linked' | 'skipped' | 'review' | 'error'; reason: string; company?: string | null; hq_invoice_id?: string | null; bank_movement_id?: string | null; drive_file_id?: string | null; drive_link?: string | null }

export function firstToken(s: string): string { return String(s || '').toLowerCase().replace(/[^a-z0-9àáâãçéêíóôõú ]/g, ' ').trim().split(/\s+/)[0] || '' }

// The line a document already has in the app (never duplicate). `amount` carries its sign: a credit note (negative)
// only ever meets another negative line — never the invoice it cancels, which has the same absolute amount.
export async function findExisting(db: Db, parsed: Parsed, payingCompany: string, amount: number, backfill: boolean): Promise<Record<string, unknown> | null> {
  const base = db.from('hq_invoices').select('id, drive_link, invoice_number, supplier_nif, company, amount_eur, invoice_date, notes').eq('paying_company', payingCompany).is('deleted_at', null)
  let existing: Record<string, unknown> | null = null
  if (parsed.invoice_number) {
    // a number is only unique per supplier: every freelancer's Portal das Finanças receipt is «FR ATSIRE01FR/<n>»,
    // so FR/36 of one freelancer is not FR/36 of another — same NIF, or the same name when a NIF is missing
    const { data } = await base.ilike('invoice_number', parsed.invoice_number.trim()).limit(20)
    const nif = String(parsed.supplier_nif || '').replace(/\s/g, ''), tok = firstToken(parsed.company || '')
    existing = (data || []).find((r: Row) => {
      const rn = String(r.supplier_nif || '').replace(/\s/g, '')
      if (nif && rn) return nif === rn
      return tok.length >= 3 && String(r.company || '').toLowerCase().startsWith(tok)
    }) || null
  }
  if (!existing) {
    // backfill of old mail: a supplier is often paid weeks after the invoice date (direct debits, «pag referencia»)
    const lo = new Date(parsed.invoice_date!); lo.setDate(lo.getDate() - 10)
    const hi = new Date(parsed.invoice_date!); hi.setDate(hi.getDate() + (backfill ? 45 : 10))
    const { data } = await db.from('hq_invoices').select('id, drive_link, invoice_number, supplier_nif, company, amount_eur, amount, currency, invoice_date, notes')
      .eq('paying_company', payingCompany).is('deleted_at', null).gte('invoice_date', lo.toISOString().slice(0, 10)).lte('invoice_date', hi.toISOString().slice(0, 10))
    const tok = firstToken(parsed.company || '')
    const cands = (data || []).filter((r: Row) => {
      const sameAmt = Math.abs(Number(r.amount_eur ?? r.amount) - amount) < 0.011 || (r.currency && r.currency === parsed.currency && Math.abs(Number(r.amount) - amount) < 0.011)
      if (!sameAmt) return false
      // SKILL rule 8: a different invoice number is a different document (two e-tickets of the same price, two Chubb policies…)
      if (parsed.invoice_number && r.invoice_number && String(r.invoice_number).trim().toLowerCase() !== parsed.invoice_number.trim().toLowerCase()) return false
      if (parsed.supplier_nif && r.supplier_nif && String(r.supplier_nif).replace(/\s/g, '') === parsed.supplier_nif) return true
      if (tok.length >= 4 && String(r.company || '').toLowerCase().startsWith(tok)) return true
      if (String(r.notes || '').includes('[do extrato')) return true
      return false
    })
    if (cands.length) existing = cands.sort((a: Row, b: Row) => Math.abs(new Date(String(a.invoice_date)).getTime() - new Date(parsed.invoice_date!).getTime()) - Math.abs(new Date(String(b.invoice_date)).getTime() - new Date(parsed.invoice_date!).getTime()))[0]
  }
  return existing
}

// The invoice a credit note cancels, only when it is certain (the one the document names, or the one invoice of the
// same supplier and amount in the 120 days before — CreditNotes.autoPick); otherwise the person picks it in the form.
export async function creditedInvoice(db: Db, parsed: Parsed, payingCompany: string): Promise<string | null> {
  try {
    const from = new Date(parsed.invoice_date!); from.setDate(from.getDate() - CreditNotes.WINDOW_DAYS)
    const { data } = await db.from('hq_invoices').select('id, invoice_number, invoice_date, company, supplier_nif, amount_eur')
      .eq('paying_company', payingCompany).is('deleted_at', null).gt('amount_eur', 0)
      .gte('invoice_date', from.toISOString().slice(0, 10)).lte('invoice_date', parsed.invoice_date!).limit(1000)
    return CreditNotes.autoPick(CreditNotes.candidates(data || [], { supplier: parsed.company, nif: parsed.supplier_nif, amount: parsed.amount, date: parsed.invoice_date, cancelsNumber: parsed.credits_invoice_number }))
  } catch { return null }
}
// The two credit-note columns do not exist before supabase/credit-notes.sql: write without them rather than fail
// (the amount is already negative and the note says «nota de crédito», which the SQL's backfill recognises).
// deno-lint-ignore no-explicit-any
export async function writeLine(run: (row: Record<string, unknown>) => PromiseLike<any>, row: Record<string, unknown>) {
  let out = await run(row)
  if (out.error && /doc_type|credits_invoice_id/.test(String(out.error.message || ''))) {
    const { doc_type: _d, credits_invoice_id: _c, ...rest } = row
    out = await run(rest)
  }
  return out
}

// A credit note is never booked by the harvester (Miguel, 30 Oct 2026) and never skipped silently (audit 18 Nov 2026:
// 3 arrived, 3 skipped). It waits in «to decide» (status review) with the negative line it proposes; the HQ Month close
// shows it and a person confirms («Add credit note» → decide → placeDocument) or ignores it.
export async function queueCreditNote(db: Db, parsed: Parsed, company: string): Promise<Outcome> {
  if (!parsed.invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice_date) || parsed.amount == null) return { status: 'review', reason: 'nota de crédito sem data ou valor legível — confirmar à mão', company }
  const p = CreditNotes.proposal(parsed)
  const existing = await findExisting(db, parsed, company, p.amount, false)
  if (existing && existing.drive_link) return { status: 'skipped', reason: `nota de crédito já na app com PDF (linha ${String(existing.id).slice(0, 8)}, ${existing.invoice_number || 'sem nº'})`, company, hq_invoice_id: String(existing.id) }
  return { status: 'review', reason: `nota de crédito ${p.invoice_number || ''}: linha proposta ${p.amount} ${p.currency}${p.cancels_number ? ' (anula ' + p.cancels_number + ')' : ''}${existing ? ` · completa a linha ${String(existing.id).slice(0, 8)} sem PDF` : ''} — por confirmar`.replace(/\s+/g, ' '), company }
}


export function routeByBuyer(parsed: Parsed): { company: string | null; outcome?: Outcome } {
  const dt = String(parsed.doc_type || 'other')
  // a credit note comes first: it is neither «cancelled» nor «not an invoice» — it is routed like an invoice and then queued
  const creditNote = isCreditNote(parsed)
  if (parsed.is_cancelled && !creditNote) return { company: null, outcome: { status: 'skipped', reason: 'documento anulado / sem efeito' } }
  if (!creditNote && !['invoice', 'receipt'].includes(dt)) return { company: null, outcome: { status: 'skipped', reason: `não é fatura (${dt})` } }
  const nif = parsed.buyer_nif || ''
  if (PERSONAL_NIFS.has(nif)) return { company: null, outcome: { status: 'skipped', reason: 'documento pessoal' } }
  if (nif === WATER_NIF) return { company: 'water-movements' }
  if (nif === MANJAR_NIF) return { company: 'manjar' }
  const buyer = String(parsed.buyer_name || '').toLowerCase()
  if (/water\s*movements|gota\s*d.?\s*[aá]gua|gotadagua/.test(buyer)) return { company: 'water-movements' }   // partners invoice us as «Gota Dagua Camps»
  if (/manjar/.test(buyer)) return { company: 'manjar' }
  return { company: null, outcome: { status: 'review', reason: nif ? `comprador desconhecido (NIF ${nif}${buyer ? ', ' + buyer : ''})` : 'comprador não identificado' } }
}


// A PDF that is plainly not an invoice by its file name (a CV, a cover letter, a catalogue, a portfolio):
// recorded as skipped and never sent to the reader. info@ sent 186 PDFs to the reader in four weeks for 5 lines,
// mostly job applicants' CVs (audit 18 Nov 2026, AUT-07). File name only — no subject, sender or mailbox rule — and
// never when the name also says invoice / fatura / recibo, so a real invoice is never held back («Fatura em mão vai para a app»).
const NOT_INVOICE_NAME = /(^|[^a-z0-9])(cv|curriculum|curr[ií]culo|resume|r[ée]sum[ée]|cover[ _-]?letter|carta[ _-]de[ _-]apresenta[cç][aã]o|motivation[ _-]?letter|portfolio|portf[oó]lio|catalog(ue)?|cat[aá]logo)([^a-z0-9]|$)/i
const INVOICE_NAME = /(invoice|fatura|factura|recibo|receipt|nota[ _-]de[ _-]cr[eé]dito|credit[ _-]?note)/i
export function notAnInvoiceByName(filename: string): boolean {
  const name = String(filename || '')
  return NOT_INVOICE_NAME.test(name) && !INVOICE_NAME.test(name)
}
