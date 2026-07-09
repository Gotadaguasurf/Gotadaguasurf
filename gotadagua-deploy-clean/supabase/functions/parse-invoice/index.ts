// ════════════════════════════════════════════════════════════════════════════
//  parse-invoice — extract structured fields from a PDF/image invoice.
//
//  POST { storage_path: string }
//
//  1. Auths the caller via their Supabase JWT (RLS on hq-invoices bucket
//     already restricts read/write to HQ members via public.is_hq_member()).
//  2. Downloads the file from storage.
//  3. Sends it to the Anthropic Messages API with vision (Claude Sonnet 4.5).
//  4. Returns a strict JSON object with the 10 invoice fields the HQ form
//     expects, so the frontend can auto-fill and let the user confirm.
//
//  Secrets required:
//    ANTHROPIC_API_KEY
//    SUPABASE_URL              (auto)
//    SUPABASE_ANON_KEY         (auto — used to verify caller JWT)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY') || ''

const MODEL = 'claude-sonnet-4-5'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

const EXTRACTION_PROMPT = `You are an invoice-parsing assistant for a surf-camp business with entities in Portugal, Morocco, and Sri Lanka. Extract data from this invoice and return ONLY valid JSON, no markdown, no commentary.

Schema:
{
  "invoice_date": "YYYY-MM-DD or null",
  "company": "supplier name in lowercase, strip Lda/SA/SARL/Ltda suffixes",
  "supplier_nif": "tax registration number if present (Portuguese NIF, Moroccan ICE, etc.), or null",
  "description": "one-line description of what was purchased/paid, or null",
  "amount": "numeric total including tax, no currency symbol",
  "currency": "EUR | MAD | LKR | USD | GBP — inferred from currency symbol or country",
  "invoice_number": "invoice reference number, or null",
  "payment_type": "Cash | Card | Bank Transfer | Other — null if not visible on the document",
  "category_hint": "best guess from: Food, Setup, Rent, Services, Insurances, Transport, Salary, Utilities, Partners, Benefits, Taxes, Work Trips, Accounting, Cleaning Supplies, Miguel - Personal",
  "location_hint": "best guess from: portugal, surf-school, junior-camp, kids-camp, morocco, sri-lanka, general"
}

Rules:
- Portuguese addresses/NIF (9-digit) → location_hint=portugal or one of the PT camps if the item is camp-specific.
- Moroccan addresses (Dirham/MAD/ICE number) → location_hint=morocco.
- Sri Lankan (LKR/Colombo/Weligama) → location_hint=sri-lanka.
- Generic digital services (Google Workspace, Cloudways, Uber, Anthropic) → location_hint=general.
- "Utulities" is a legacy typo → return "Utilities".
- Amount uses . as decimal separator and no thousand separators.
- If a value is unreadable or absent, return null (except amount).

Return the JSON object and nothing else.`

interface Extracted {
  invoice_date: string | null
  company: string | null
  supplier_nif: string | null
  description: string | null
  amount: number | null
  currency: string | null
  invoice_number: string | null
  payment_type: string | null
  category_hint: string | null
  location_hint: string | null
}

// btoa on arbitrary bytes fails for values > 0xFF. Chunked encoding avoids
// stack overflow on large PDFs (a few MB) and correctness issues on Deno.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)

  try {
    if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500)

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

    const body = await req.json().catch(() => ({}))
    const storagePath = String(body?.storage_path || '').trim()
    if (!storagePath) return json({ error: 'storage_path required' }, 400)

    // Auth via caller JWT so bucket RLS applies (is_hq_member() check).
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: fileBlob, error: dlErr } = await sb.storage
      .from('hq-invoices')
      .download(storagePath)
    if (dlErr || !fileBlob) return json({ error: `Download failed: ${dlErr?.message || 'no file'}` }, 400)

    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    if (bytes.length > 15 * 1024 * 1024) {
      return json({ error: 'File too large (max 15 MB)' }, 413)
    }
    const base64 = bytesToBase64(bytes)

    // Infer media type. Storage sometimes returns application/octet-stream.
    let mediaType = fileBlob.type || 'application/octet-stream'
    const lower = storagePath.toLowerCase()
    if (lower.endsWith('.pdf'))                  mediaType = 'application/pdf'
    else if (lower.endsWith('.png'))             mediaType = 'image/png'
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mediaType = 'image/jpeg'
    else if (lower.endsWith('.webp'))            mediaType = 'image/webp'
    else if (lower.endsWith('.heic'))            mediaType = 'image/heic'

    const isPdf = mediaType === 'application/pdf'
    const contentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: base64 } }

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }],
        }],
      }),
    })

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text()
      return json({ error: `Anthropic API error (${anthropicResp.status}): ${errText.slice(0, 500)}` }, 502)
    }

    const anthropicJson = await anthropicResp.json()
    const rawText = anthropicJson?.content?.[0]?.text || ''

    // Claude sometimes wraps JSON in ```json ... ```. Peel any wrapping.
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return json({ error: 'Model returned no JSON', raw: rawText.slice(0, 500) }, 502)
    }

    let extracted: Extracted
    try {
      extracted = JSON.parse(jsonMatch[0])
    } catch (e) {
      return json({ error: 'Model JSON was invalid', raw: rawText.slice(0, 500) }, 502)
    }

    // Normalise amount to a number (model sometimes returns as string).
    if (typeof extracted.amount === 'string') {
      const cleaned = (extracted.amount as unknown as string).replace(/[^0-9.\-]/g, '')
      const n = Number(cleaned)
      extracted.amount = isNaN(n) ? null : n
    }
    // Fix known category typo.
    if (extracted.category_hint === 'Utulities') extracted.category_hint = 'Utilities'

    return json({
      extracted,
      model: MODEL,
      usage: anthropicJson.usage || null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ error: `parse-invoice failed: ${msg}` }, 500)
  }
})
