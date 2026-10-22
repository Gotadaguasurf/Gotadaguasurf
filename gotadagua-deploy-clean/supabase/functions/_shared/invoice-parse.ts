// ════════════════════════════════════════════════════════════════════════════
//  invoice-parse — ONE prompt + ONE Anthropic call for every place that reads
//  an invoice PDF/image (parse-invoice for the HQ/Suk forms, mail-ingest for
//  the mailbox harvester). Two copies drifted before (drive-sync still had
//  the old category list); anything that parses invoices imports from here.
// ════════════════════════════════════════════════════════════════════════════

export const PARSE_MODEL = 'claude-sonnet-4-5'

export const CATEGORIES = ['Food', 'Drinks', 'Salary', 'Benefits', 'Taxes', 'Rent', 'Utilities', 'Services', 'Insurances',
  'Equipment & maintenance', 'Cleaning', 'Laundry', 'Transport', 'Tours & activities', 'Merchandise', 'Marketing', 'Partners',
  'Work Trips', 'Other']

export const EXTRACTION_PROMPT = `You are an invoice-parsing assistant for a surf-camp business with entities in Portugal (Water Movements Lda, NIF 515059927; Manjar Alentejano Lda, NIF 502379723), Morocco, and Sri Lanka. Extract data from this document and return ONLY valid JSON, no markdown, no commentary.

Schema:
{
  "doc_type": "invoice | receipt | credit_note | proforma | statement | report | other",
  "is_cancelled": true/false — true when the document says Anulado, Anulada, Sem efeito, Cancelled, Void, or is a credit note that cancels an invoice,
  "invoice_date": "YYYY-MM-DD or null",
  "company": "supplier name in lowercase, strip Lda/SA/SARL/Ltda/Unipessoal suffixes",
  "supplier_nif": "supplier tax number if present (Portuguese NIF, Moroccan ICE, etc.), or null",
  "buyer_name": "the client/customer name on the document, or null",
  "buyer_nif": "the client/customer tax number (NIF/VAT) on the document, digits only, or null",
  "description": "one-line description of what was purchased/paid, or null",
  "amount": "numeric total including tax, no currency symbol",
  "total_vat": "numeric VAT amount if shown, else null",
  "currency": "EUR | MAD | LKR | USD | GBP — inferred from currency symbol or country",
  "invoice_number": "invoice reference number exactly as printed (e.g. FT 2026/123, FR ATSIRE01FR/45), or null",
  "atcud": "the ATCUD code if printed (Portuguese documents), or null",
  "service_month": "YYYY-MM when the document states the month the service refers to (e.g. 'Bookings for September', 'Setembro 2026'), else null",
  "payment_type": "Cash | Card | Bank Transfer | Other — null if not visible on the document",
  "category_hint": "best guess from: ${CATEGORIES.join(', ')}",
  "location_hint": "best guess from: portugal, surf-school, junior-camp, kids-camp, morocco, sri-lanka, wild-wednesday, general"
}

Rules:
- Portuguese addresses/NIF (9-digit) → location_hint=portugal or one of the PT camps if the item is camp-specific.
- Moroccan addresses (Dirham/MAD/ICE number) → location_hint=morocco.
- Sri Lankan (LKR/Colombo/Weligama) → location_hint=sri-lanka.
- Generic digital services (Google Workspace, Cloudways, Uber, Anthropic, Supabase) → location_hint=general.
- Party/event suppliers (DJs, sound/light rental, event production, video for the Wednesday party) → location_hint=wild-wednesday, category_hint=Other.
- "Fatura-Recibo" documents issued through the AT portal (Autoridade Tributária, recibos verdes) are freelancer receipts: category_hint=Salary, doc_type=receipt.
- Drinks suppliers (beer, wine, coffee, soft drinks) → Drinks, never Food.
- Bank/card statements, delivery notes, order confirmations, POS daily reports ("Sistema de MANJAR"), payslips, tax forms → doc_type=statement/report/other, never invoice.
- Amount uses . as decimal separator and no thousand separators.
- If a value is unreadable or absent, return null (except amount, which must be a number when any total is visible).

Return the JSON object and nothing else.`

export interface Parsed {
  doc_type: string | null
  is_cancelled: boolean | null
  invoice_date: string | null
  company: string | null
  supplier_nif: string | null
  buyer_name: string | null
  buyer_nif: string | null
  description: string | null
  amount: number | null
  total_vat: number | null
  currency: string | null
  invoice_number: string | null
  atcud: string | null
  service_month: string | null
  payment_type: string | null
  category_hint: string | null
  location_hint: string | null
}

export function mediaTypeFor(filename: string, fallback = 'application/octet-stream'): string {
  const lower = String(filename || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.heic')) return 'image/heic'
  return fallback
}

// btoa on arbitrary bytes fails for values > 0xFF; chunked encoding keeps
// multi-MB PDFs off the stack.
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export async function parseInvoice(base64: string, mediaType: string, apiKey: string): Promise<{ parsed: Parsed; usage: unknown; model: string }> {
  const isPdf = mediaType === 'application/pdf'
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: PARSE_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }] }] }),
  })
  if (!resp.ok) throw new Error(`Anthropic API error (${resp.status}): ${(await resp.text()).slice(0, 500)}`)
  const out = await resp.json()
  const rawText = out?.content?.[0]?.text || ''
  const m = rawText.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('Model returned no JSON: ' + rawText.slice(0, 300))
  let parsed: Parsed
  try { parsed = JSON.parse(m[0]) } catch { throw new Error('Model JSON was invalid: ' + rawText.slice(0, 300)) }
  if (typeof parsed.amount === 'string') { const n = Number(String(parsed.amount).replace(/[^0-9.\-]/g, '')); parsed.amount = isNaN(n) ? null : n }
  if (typeof parsed.total_vat === 'string') { const n = Number(String(parsed.total_vat).replace(/[^0-9.\-]/g, '')); parsed.total_vat = isNaN(n) ? null : n }
  if (parsed.category_hint === 'Utulities') parsed.category_hint = 'Utilities'
  if (parsed.buyer_nif) parsed.buyer_nif = String(parsed.buyer_nif).replace(/\D/g, '') || null
  if (parsed.supplier_nif) parsed.supplier_nif = String(parsed.supplier_nif).replace(/\s/g, '')
  return { parsed, usage: out.usage || null, model: PARSE_MODEL }
}
