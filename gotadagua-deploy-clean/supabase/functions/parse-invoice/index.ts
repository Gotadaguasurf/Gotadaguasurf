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
import { parseInvoice, bytesToBase64, mediaTypeFor, PARSE_MODEL } from '../_shared/invoice-parse.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY') || ''

const MODEL = PARSE_MODEL

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)

  try {
    if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500)

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

    const body = await req.json().catch(() => ({}))
    const storagePath = String(body?.storage_path || '').trim()
    const fileB64Direct = String(body?.file_base64 || '').trim()
    const filenameHint  = String(body?.filename || '').toLowerCase()
    if (!storagePath && !fileB64Direct) return json({ error: 'storage_path or file_base64 required' }, 400)

    // Auth via caller JWT so bucket RLS applies (is_hq_member() check on
    // the storage_path branch). The file_base64 branch skips storage — used
    // by camp-hub managers who don't have access to the hq-invoices bucket.
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    let base64: string
    let mediaType: string

    if (fileB64Direct) {
      // Sanity: base64 length ≈ raw × 4/3; cap at ~20 MB base64 ≈ 15 MB raw.
      if (fileB64Direct.length > 20 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413)
      base64 = fileB64Direct
      mediaType = mediaTypeFor(filenameHint)
    } else {
      const { data: fileBlob, error: dlErr } = await sb.storage
        .from('hq-invoices')
        .download(storagePath)
      if (dlErr || !fileBlob) return json({ error: `Download failed: ${dlErr?.message || 'no file'}` }, 400)

      const bytes = new Uint8Array(await fileBlob.arrayBuffer())
      if (bytes.length > 15 * 1024 * 1024) return json({ error: 'File too large (max 15 MB)' }, 413)
      base64 = bytesToBase64(bytes)

      // Infer media type. Storage sometimes returns application/octet-stream.
      mediaType = mediaTypeFor(storagePath, fileBlob.type || 'application/octet-stream')
    }

    let extracted, usage
    try {
      const out = await parseInvoice(base64, mediaType, ANTHROPIC_API_KEY)
      extracted = out.parsed; usage = out.usage
    } catch (e) {
      return json({ error: (e as Error).message || String(e) }, 502)
    }

    return json({
      extracted,
      model: MODEL,
      usage: usage || null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ error: `parse-invoice failed: ${msg}` }, 500)
  }
})
